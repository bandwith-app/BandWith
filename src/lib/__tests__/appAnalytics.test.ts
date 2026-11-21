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
  });
});
