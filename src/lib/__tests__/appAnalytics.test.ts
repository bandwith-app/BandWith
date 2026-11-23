/**
 * App analytics (Firebase Analytics in the Android and iOS apps): nothing is
 * collected until the user says yes on this device, ads signals are never
 * granted, and screens are logged only after consent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const native = { value: true };
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.value },
}));

const fa = {
  setConsent: vi.fn(async () => {}),
  setEnabled: vi.fn(async () => {}),
  setCurrentScreen: vi.fn(async () => {}),
  resetAnalyticsData: vi.fn(async () => {}),
};
vi.mock('@capacitor-firebase/analytics', () => ({
  FirebaseAnalytics: fa,
  ConsentType: {
    AnalyticsStorage: 'ANALYTICS_STORAGE',
    AdStorage: 'AD_STORAGE',
    AdUserData: 'AD_USER_DATA',
    AdPersonalization: 'AD_PERSONALIZATION',
  },
  ConsentStatus: { Granted: 'GRANTED', Denied: 'DENIED' },
}));

import {
  ANALYTICS_CONSENT_KEY,
  readAnalyticsConsent,
  shouldAskAnalyticsConsent,
  initAppAnalytics,
  setAnalyticsConsent,
  trackScreen,
  screenNameFor,
  resetAppAnalyticsForTests,
  readCrashlyticsConsent,
  ANALYTICS_CONSENT_VERSION_KEY,
} from '../appAnalytics';

const consentCalls = () =>
  fa.setConsent.mock.calls.map((c) => (c as unknown as [{ type: string; status: string }])[0]);

beforeEach(() => {
  localStorage.clear();
  native.value = true;
  Object.values(fa).forEach((f) => f.mockClear());
  resetAppAnalyticsForTests();
});

describe('consent', () => {
  it('asks once on a phone or tablet, never in a browser', () => {
    expect(shouldAskAnalyticsConsent()).toBe(true);
    native.value = false;
    expect(shouldAskAnalyticsConsent()).toBe(false);
  });

  it('does not ask again once the user answered, either way', async () => {
    await setAnalyticsConsent('denied');
    expect(readAnalyticsConsent()).toBe('denied');
    expect(shouldAskAnalyticsConsent()).toBe(false);
    await setAnalyticsConsent('granted');
    expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe('granted');
    expect(shouldAskAnalyticsConsent()).toBe(false);
  });

  it('keeps collection off at launch until the user says yes', async () => {
    await initAppAnalytics();
    expect(fa.setEnabled).toHaveBeenLastCalledWith({ enabled: false });
    expect(consentCalls()).toContainEqual({ type: 'ANALYTICS_STORAGE', status: 'DENIED' });
  });

  it('turns collection on after yes, ads signals stay denied', async () => {
    await setAnalyticsConsent('granted');
    expect(fa.setEnabled).toHaveBeenLastCalledWith({ enabled: true });
    const calls = consentCalls();
    expect(calls).toContainEqual({ type: 'ANALYTICS_STORAGE', status: 'GRANTED' });
    for (const ad of ['AD_STORAGE', 'AD_USER_DATA', 'AD_PERSONALIZATION']) {
      expect(calls).toContainEqual({ type: ad, status: 'DENIED' });
      expect(calls).not.toContainEqual({ type: ad, status: 'GRANTED' });
    }
  });

  it('clears what was collected when the user switches it off', async () => {
    await setAnalyticsConsent('granted');
    await setAnalyticsConsent('denied');
    expect(fa.setEnabled).toHaveBeenLastCalledWith({ enabled: false });
    expect(fa.resetAnalyticsData).toHaveBeenCalledTimes(1);
  });

  it('never touches the plugin in a browser', async () => {
    native.value = false;
    await initAppAnalytics();
    await setAnalyticsConsent('granted');
    trackScreen('Home');
    await Promise.resolve();
    expect(fa.setEnabled).not.toHaveBeenCalled();
    expect(fa.setCurrentScreen).not.toHaveBeenCalled();
  });
});

describe('screens', () => {
  const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  it('logs nothing without consent', async () => {
    trackScreen('Home');
    await flush();
    expect(fa.setCurrentScreen).not.toHaveBeenCalled();
  });

  it('logs each new screen once after consent', async () => {
    await setAnalyticsConsent('granted');
    trackScreen('Home');
    trackScreen('Home');
    trackScreen('Gig');
    await flush();
    expect(fa.setCurrentScreen.mock.calls.map((c) => (c as unknown as [{ screenName: string }])[0].screenName)).toEqual(['Home', 'Gig']);
  });

  it('logs the screen in view right after the user says yes', async () => {
    trackScreen('Calendar');
    await setAnalyticsConsent('granted');
    await flush();
    expect(fa.setCurrentScreen).toHaveBeenCalledWith({ screenName: 'Calendar', screenClassOverride: 'Calendar' });
  });

  it('names the topmost screen, with no ids or names in it', () => {
    expect(screenNameFor({ tab: 'Home' })).toBe('Home');
    expect(screenNameFor({ tab: 'Events' })).toBe('Calendar');
    expect(screenNameFor({ tab: 'Chat' })).toBe('Chats');
    expect(screenNameFor({ tab: 'Chat', chatOpen: true })).toBe('Chat thread');
    expect(screenNameFor({ tab: 'Events', gigOpen: true })).toBe('Gig');
    expect(screenNameFor({ tab: 'Events', gigOpen: true, stageOpen: true })).toBe('Stage');
    expect(screenNameFor({ tab: 'More', overlay: 'settings' })).toBe('Settings');
    expect(screenNameFor({ tab: 'Home', gigOpen: true, overlay: 'settings' })).toBe('Settings');
  });
});

describe('screens over screens', () => {
  it('logs Stage, then the gig again when Stage closes', async () => {
    const { enterScreen } = await import('../appAnalytics');
    await setAnalyticsConsent('granted');
    trackScreen('Gig');
    const leave = enterScreen('Stage');
    leave();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(fa.setCurrentScreen.mock.calls.map((c) => (c as unknown as [{ screenName: string }])[0].screenName)).toEqual(['Gig', 'Stage', 'Gig']);
  });
});

describe('when to ask', () => {
  it('waits for the tour and for popups that need an answer', async () => {
    const { analyticsAskBlocked } = await import('../appAnalytics');
    expect(analyticsAskBlocked({})).toBe(false);
    expect(analyticsAskBlocked({ tour: true })).toBe(true);
    expect(analyticsAskBlocked({ urgent: true })).toBe(true);
    expect(analyticsAskBlocked({ rsvp: true })).toBe(true);
    expect(analyticsAskBlocked({ poll: true })).toBe(true);
    // Never over Stage mode, a sheet or a modal either (the gate: it found the question over Stage).
    expect(analyticsAskBlocked({ layer: true })).toBe(true);
  });
});

describe('consent wording versions (review #277)', () => {
  it('a yes given before crash details were in the wording does not turn Crashlytics on, and asks again', () => {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, 'granted'); // an older build, no version
    expect(readAnalyticsConsent()).toBe('granted'); // usage statistics keep their yes
    expect(readCrashlyticsConsent()).toBe(false);
    expect(shouldAskAnalyticsConsent()).toBe(true);
  });

  it('a yes under the current wording covers crash details, and is not asked again', async () => {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, 'granted');
    await setAnalyticsConsent('granted');
    expect(localStorage.getItem(ANALYTICS_CONSENT_VERSION_KEY)).toBe('2');
    expect(readCrashlyticsConsent()).toBe(true);
    expect(shouldAskAnalyticsConsent()).toBe(false);
  });

  it('an older no stays a no: not asked again, no Crashlytics', () => {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, 'denied');
    expect(shouldAskAnalyticsConsent()).toBe(false);
    expect(readCrashlyticsConsent()).toBe(false);
  });
});

describe('a no always wins (review #277)', () => {
  it('storage reads but the write fails: the no holds in memory, and the write is tried again', async () => {
    vi.useFakeTimers();
    try {
      const disk = new Map<string, string>([[ANALYTICS_CONSENT_KEY, 'granted'], [ANALYTICS_CONSENT_VERSION_KEY, '2']]);
      let failing = true;
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => disk.get(k) ?? null,
        setItem: (k: string, v: string) => {
          if (failing) throw new DOMException('full', 'QuotaExceededError');
          disk.set(k, v);
        },
        removeItem: (k: string) => disk.delete(k),
        clear: () => disk.clear(),
      });
      await setAnalyticsConsent('denied');
      expect(disk.get(ANALYTICS_CONSENT_KEY)).toBe('granted'); // the disk still says yes
      expect(readAnalyticsConsent()).toBe('denied');
      expect(readCrashlyticsConsent()).toBe(false);
      failing = false;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(disk.get(ANALYTICS_CONSENT_KEY)).toBe('denied');
      expect(readAnalyticsConsent()).toBe('denied');
      vi.unstubAllGlobals();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('round 5 (review #277)', () => {
  it('declining over an old yes: the second write fails and the app closes, Crashlytics stays off', async () => {
    // Every order of the two writes is tried: only the first one lands.
    const disk = new Map<string, string>([[ANALYTICS_CONSENT_KEY, 'granted'], [ANALYTICS_CONSENT_VERSION_KEY, '1']]);
    let writes = 0;
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (writes++ >= 1) throw new DOMException('full', 'QuotaExceededError');
        disk.set(k, v);
      },
      removeItem: (k: string) => disk.delete(k),
      clear: () => disk.clear(),
    });
    await setAnalyticsConsent('denied');
    // The app closes: what is in memory goes, only the disk is left.
    resetAppAnalyticsForTests();
    expect(readCrashlyticsConsent()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('saying yes: the second write fails and the app closes, no Crashlytics without the current wording', async () => {
    const disk = new Map<string, string>();
    let writes = 0;
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (writes++ >= 1) throw new DOMException('full', 'QuotaExceededError');
        disk.set(k, v);
      },
      removeItem: (k: string) => disk.delete(k),
      clear: () => disk.clear(),
    });
    await setAnalyticsConsent('granted');
    resetAppAnalyticsForTests();
    expect(readCrashlyticsConsent()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('a "No" with full storage: the same fallback chain as crash reports (review #277, Claude 8)', () => {
  /** localStorage that still reads what it had but takes nothing new (full). */
  const fullDisk = (entries: Array<[string, string]>) => {
    const disk = new Map<string, string>(entries);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: (k: string) => disk.delete(k),
      clear: () => disk.clear(),
    });
    return disk;
  };
  const OLD_YES: Array<[string, string]> = [[ANALYTICS_CONSENT_KEY, 'granted'], [ANALYTICS_CONSENT_VERSION_KEY, '2']];

  it('localStorage full: the no goes to IndexedDB and still holds after a restart', async () => {
    const { fakeIndexedDB } = await import('@/test/fakeIndexedDB');
    const fake = fakeIndexedDB();
    vi.stubGlobal('indexedDB', fake.indexedDB);
    try {
      fullDisk(OLD_YES);
      await setAnalyticsConsent('denied');
      expect(fake.state.data.get(ANALYTICS_CONSENT_KEY)).toBe('denied');
      resetAppAnalyticsForTests(); // the app restarts: memory gone, the disk still says yes
      fa.setEnabled.mockClear();
      await initAppAnalytics();
      expect(readAnalyticsConsent()).toBe('denied');
      expect(readCrashlyticsConsent()).toBe(false);
      expect(fa.setEnabled).toHaveBeenLastCalledWith({ enabled: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('until the choice can be read everywhere, Crashlytics and analytics stay off', async () => {
    const { fakeIndexedDB } = await import('@/test/fakeIndexedDB');
    vi.stubGlobal('indexedDB', fakeIndexedDB({ failOpen: true }).indexedDB);
    try {
      fullDisk(OLD_YES);
      expect(readCrashlyticsConsent()).toBe(false);
      await initAppAnalytics();
      expect(readCrashlyticsConsent()).toBe(false);
      expect(fa.setEnabled).toHaveBeenLastCalledWith({ enabled: false });
      trackScreen('Home');
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
      expect(fa.setCurrentScreen).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('nothing can save it: the no holds, the other tabs hear it, and Settings says so', async () => {
    const mod = await import('../appAnalytics');
    const { fakeIndexedDB } = await import('@/test/fakeIndexedDB');
    vi.stubGlobal('indexedDB', fakeIndexedDB({ abortWrites: true }).indexedDB);
    const posted: unknown[] = [];
    class FakeChannel {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      postMessage(d: unknown) {
        posted.push(d);
      }
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    try {
      fullDisk(OLD_YES);
      await setAnalyticsConsent('denied');
      expect(readAnalyticsConsent()).toBe('denied');
      expect(readCrashlyticsConsent()).toBe(false);
      expect(posted).toContainEqual({ consent: 'denied' });
      expect((mod as { readAnalyticsConsentSaveFailed?: () => boolean }).readAnalyticsConsentSaveFailed?.()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
