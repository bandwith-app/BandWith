import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({ runs: [] as Array<{ force?: string[] }>, profileAuto: null as boolean | null }));
// getPlatform too: without it the flags can't be read and stay at their default (on).
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
vi.mock('@/lib/appResume', () => ({ onAppResume: () => () => undefined }));
vi.mock('@/lib/livePackStore', () => ({
  runLivePackPrefetch: async (a: { force?: string[] }) => {
    h.runs.push({ force: a.force });
    return 0;
  },
}));
vi.mock('@/lib/livePackStatus', () => ({
  readProfileAuto: async () => h.profileAuto,
  saveProfileChoice: async () => undefined,
}));

import { useLivePackPrefetch } from '../useLivePackPrefetch';
import { LIVE_PACK_REFRESH_EVENT } from '@/lib/livePack';
import { readChoice } from '@/lib/livePackConsent';
import { __resetAppFlagsForTest, __setAppFlagsForTest, isFlagOn } from '@/lib/appFlags';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  h.runs = [];
  h.profileAuto = null;
  __resetAppFlagsForTest(null);
});
// Unmount each test's hook: its listeners would answer the next test's events.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useLivePackPrefetch', () => {
  it('a silent push refreshes the event it names at once', async () => {
    renderHook(() => useLivePackPrefetch([], 'u-1', ['b-1']));
    act(() => {
      window.dispatchEvent(new CustomEvent(LIVE_PACK_REFRESH_EVENT, { detail: { eventId: 'ev-9' } }));
    });
    expect(h.runs).toContainEqual({ force: ['ev-9'] });
  });

  it('switched off: the silent push still reaches the store (it tidies a pack already here)', () => {
    __setAppFlagsForTest({ live_pack: false });
    renderHook(() => useLivePackPrefetch([], 'u-1', ['b-1']));
    act(() => {
      window.dispatchEvent(new CustomEvent(LIVE_PACK_REFRESH_EVENT, { detail: { eventId: 'ev-3' } }));
    });
    expect(isFlagOn('live_pack')).toBe(false);
    expect(h.runs).toContainEqual({ force: ['ev-3'] });
  });

  it('iOS native puts the id on the event itself', () => {
    renderHook(() => useLivePackPrefetch([], 'u-1', ['b-1']));
    const e = Object.assign(new Event(LIVE_PACK_REFRESH_EVENT), { eventId: 'ev-7' });
    act(() => {
      window.dispatchEvent(e);
    });
    expect(h.runs).toContainEqual({ force: ['ev-7'] });
  });

  it('"keep it automatic" chosen on another device counts here', async () => {
    h.profileAuto = true;
    renderHook(() => useLivePackPrefetch([], 'u-2', null));
    await waitFor(() => expect(readChoice('u-2').auto).toBe(true));
  });
});
