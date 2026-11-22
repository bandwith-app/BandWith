import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';

/**
 * Usage analytics for the Android and iOS apps (Firebase Analytics, property
 * "bandwith-79115", the same one as the bandwith.fun site).
 *
 * - Opt-in, per device: nothing is collected until the user says yes. The
 *   native defaults (AndroidManifest / Info.plist) keep collection off and
 *   all consent types denied, so even the first launch sends nothing.
 * - Ads signals (ad storage, ad user data, ad personalization) are never
 *   granted, and the apps don't collect the advertising ID / IDFA.
 * - Only screen names are logged by hand, never ids, names or content.
 * - The web app (a browser) has no analytics: every call is a no-op there.
 */
export type AnalyticsConsent = 'granted' | 'denied';

export const ANALYTICS_CONSENT_KEY = 'bw.analytics.consent';
/**
 * The wording the answer was given under. 2 (#277): the question also names
 * crash details (Crashlytics). A yes without it (an older build) still
 * covers usage statistics, never Crashlytics, and the question comes back.
 */
export const ANALYTICS_CONSENT_VERSION_KEY = 'bw.analytics.consent_version';
export const ANALYTICS_CONSENT_VERSION = 2;

/**
 * This run's answer while storage refuses to keep it: it wins over what the
 * disk still says (a no must hold), and the write is tried again.
 */
let unsaved: AnalyticsConsent | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const RETRY_MS = [1_000, 5_000, 15_000, 60_000, 300_000];

const listeners = new Set<(consent: AnalyticsConsent | null) => void>();
let lastScreen: string | null = null;
let loggedScreen: string | null = null;

export const analyticsAvailable = (): boolean => Capacitor.isNativePlatform();

export const readAnalyticsConsent = (): AnalyticsConsent | null => {
  if (unsaved) return unsaved;
  try {
    const value = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
};

const consentVersion = (): number => {
  if (unsaved) return ANALYTICS_CONSENT_VERSION;
  try {
    return Number(localStorage.getItem(ANALYTICS_CONSENT_VERSION_KEY)) || 1;
  } catch {
    return 1;
  }
};

/** Crashlytics (src/lib/crashReports.ts): only a yes given under the wording that names crash details. */
export const readCrashlyticsConsent = (): boolean =>
  readAnalyticsConsent() === 'granted' && consentVersion() >= ANALYTICS_CONSENT_VERSION;

/**
 * The question: on a phone or tablet, until the user answers, and once more
 * for a yes given before the wording named crash details. A no stays a no.
 */
export const shouldAskAnalyticsConsent = (): boolean => {
  if (!analyticsAvailable()) return false;
  const consent = readAnalyticsConsent();
  return consent === null || (consent === 'granted' && consentVersion() < ANALYTICS_CONSENT_VERSION);
};

export const onAnalyticsConsentChange = (fn: (consent: AnalyticsConsent | null) => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

let pluginPromise: Promise<typeof import('@capacitor-firebase/analytics')> | null = null;
const loadPlugin = () => (pluginPromise ??= import('@capacitor-firebase/analytics'));

const apply = async (consent: AnalyticsConsent, previous: AnalyticsConsent | null) => {
  if (!analyticsAvailable()) return;
  try {
    const { FirebaseAnalytics, ConsentType, ConsentStatus } = await loadPlugin();
    const granted = consent === 'granted';
    await FirebaseAnalytics.setConsent({
      type: ConsentType.AnalyticsStorage,
      status: granted ? ConsentStatus.Granted : ConsentStatus.Denied,
    });
    for (const type of [ConsentType.AdStorage, ConsentType.AdUserData, ConsentType.AdPersonalization]) {
      await FirebaseAnalytics.setConsent({ type, status: ConsentStatus.Denied });
    }
    await FirebaseAnalytics.setEnabled({ enabled: granted });
    if (!granted && previous === 'granted') await FirebaseAnalytics.resetAnalyticsData();
  } catch {
    // Analytics must never break the app (no Firebase config in a dev build, etc.).
  }
};

const logScreen = (name: string) => {
  if (!analyticsAvailable() || readAnalyticsConsent() !== 'granted' || loggedScreen === name) return;
  loggedScreen = name;
  void loadPlugin()
    .then(({ FirebaseAnalytics }) => FirebaseAnalytics.setCurrentScreen({ screenName: name, screenClassOverride: name }))
    .catch(() => {});
};

/** At launch: the stored answer, or off when the user hasn't answered yet. */
export const initAppAnalytics = async (): Promise<void> => {
  await apply(readAnalyticsConsent() ?? 'denied', null);
};

const save = (consent: AnalyticsConsent): boolean => {
  try {
    // The answer first, then its version: if the second write fails and the
    // app closes, a no is still a no, and a yes without the version is asked again.
    localStorage.setItem(ANALYTICS_CONSENT_KEY, consent);
    localStorage.setItem(ANALYTICS_CONSENT_VERSION_KEY, String(ANALYTICS_CONSENT_VERSION));
    return true;
  } catch {
    return false;
  }
};

const retrySave = (attempt: number) => {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (!unsaved || attempt >= RETRY_MS.length) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (unsaved && save(unsaved)) unsaved = null;
    else retrySave(attempt + 1);
  }, RETRY_MS[attempt]);
};

export const setAnalyticsConsent = async (consent: AnalyticsConsent): Promise<void> => {
  const previous = readAnalyticsConsent();
  unsaved = null;
  if (!save(consent)) {
    // Storage refused it: the answer holds for this run (a no over a yes on disk), and is saved later.
    unsaved = consent;
    retrySave(0);
  }
  listeners.forEach((fn) => fn(consent));
  await apply(consent, previous);
  if (consent === 'granted' && lastScreen) logScreen(lastScreen);
  if (consent === 'denied') loggedScreen = null;
};

/** The screen on show (a name like "Stage", never ids): also used by crash reports. */
export const currentScreenName = (): string | null => lastScreen;

export const trackScreen = (name: string): void => {
  lastScreen = name;
  logScreen(name);
};

/**
 * A screen that opens over whatever is beneath (Stage / Live mode): logs it,
 * and on close logs again the screen it covered.
 */
export const enterScreen = (name: string): (() => void) => {
  const covered = lastScreen;
  trackScreen(name);
  return () => {
    if (covered && lastScreen === name) trackScreen(covered);
  };
};

/** The stored answer, live (Settings toggle, the one-time sheet). */
export const useAnalyticsConsent = (): AnalyticsConsent | null =>
  useSyncExternalStore(onAnalyticsConsentChange, readAnalyticsConsent, () => null);

/** One layer at a time: the question waits for the first-run tour and for popups that need an answer. */
export const analyticsAskBlocked = (s: { tour?: boolean; urgent?: boolean; rsvp?: boolean; poll?: boolean }): boolean =>
  !!(s.tour || s.urgent || s.rsvp || s.poll);

export type ScreenOverlay =
  | 'settings'
  | 'analytics'
  | 'inventory'
  | 'contracts'
  | 'setlists'
  | 'members'
  | 'pricing'
  | 'pastGigs'
  | 'deputyGigs'
  | 'profile'
  | 'createBand'
  | 'taskTemplates';

const OVERLAY_NAMES: Record<ScreenOverlay, string> = {
  settings: 'Settings',
  analytics: 'Band analytics',
  inventory: 'Inventory',
  contracts: 'Contracts',
  setlists: 'Setlists',
  members: 'Members',
  pricing: 'Pricing',
  pastGigs: 'Past gigs',
  deputyGigs: 'Deputy gigs',
  profile: 'Profile',
  createBand: 'Create band',
  taskTemplates: 'Task templates',
};

const TAB_NAMES: Record<string, string> = {
  Home: 'Home',
  Events: 'Calendar',
  Chat: 'Chats',
  More: 'More',
};

export interface ScreenState {
  tab: string;
  overlay?: ScreenOverlay | null;
  gigOpen?: boolean;
  stageOpen?: boolean;
  chatOpen?: boolean;
}

/** The screen the user is looking at: a full-screen layer first, then the gig, then the tab. */
export const screenNameFor = (s: ScreenState): string => {
  if (s.overlay) return OVERLAY_NAMES[s.overlay];
  if (s.stageOpen) return 'Stage';
  if (s.gigOpen) return 'Gig';
  if (s.chatOpen) return 'Chat thread';
  return TAB_NAMES[s.tab] ?? s.tab;
};

export const resetAppAnalyticsForTests = () => {
  listeners.clear();
  unsaved = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  lastScreen = null;
  loggedScreen = null;
};
