import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ runs: [] as Array<{ force?: string[] }>, profileAuto: null as boolean | null }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
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

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  h.runs = [];
  h.profileAuto = null;
});
afterEach(() => vi.useRealTimers());

describe('useLivePackPrefetch', () => {
  it('a silent push refreshes the event it names at once', async () => {
    renderHook(() => useLivePackPrefetch([], 'u-1', ['b-1']));
    act(() => {
      window.dispatchEvent(new CustomEvent(LIVE_PACK_REFRESH_EVENT, { detail: { eventId: 'ev-9' } }));
    });
    expect(h.runs).toContainEqual({ force: ['ev-9'] });
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
