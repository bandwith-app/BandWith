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

const listeners = new Set<(consent: AnalyticsConsent | null) => void>();
let lastScreen: string | null = null;
let loggedScreen: string | null = null;

export const analyticsAvailable = (): boolean => Capacitor.isNativePlatform();

export const readAnalyticsConsent = (): AnalyticsConsent | null => {
  try {
    const value = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
};

/** The one-time question: on a phone or tablet, until the user answers. */
export const shouldAskAnalyticsConsent = (): boolean =>
  analyticsAvailable() && readAnalyticsConsent() === null;

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

export const setAnalyticsConsent = async (consent: AnalyticsConsent): Promise<void> => {
  const previous = readAnalyticsConsent();
  try {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, consent);
  } catch {
    // Private storage unavailable: the answer still applies to this run.
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
  lastScreen = null;
  loggedScreen = null;
};
