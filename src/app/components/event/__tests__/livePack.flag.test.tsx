import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, renderHook, act } from '@testing-library/react';

// Kill switch `live_pack` (docs/flags.md): off → no downloads ahead of time,
// no consent sheet, no "Download for offline" / ready rows. The tidy-up
// (old copies moved in, packs of bands left removed) still runs.
type Run = { force?: string[]; downloads?: boolean; keepGoing?: () => boolean };
const h = vi.hoisted(() => ({ runs: [] as Run[] }));
vi.mock('@capacitor/core', async (orig) => ({
  ...(await orig<typeof import('@capacitor/core')>()),
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false },
}));
vi.mock('@/lib/appResume', () => ({ onAppResume: () => () => undefined }));
vi.mock('@/lib/haptics', () => ({ haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), selection: vi.fn() } }));
vi.mock('@/lib/livePackStore', () => ({
  runLivePackPrefetch: async (a: Run) => {
    h.runs.push({ force: a.force, downloads: a.downloads, keepGoing: a.keepGoing });
    return 0;
  },
  refreshPack: async () => true,
  LIVE_PACK_CHANGED: 'bw:live-pack-changed',
}));
vi.mock('@/lib/livePackStatus', () => ({
  readProfileAuto: async () => null,
  saveProfileChoice: async () => undefined,
  fetchEventPackStatus: async () => [],
  remindPackDownload: async () => true,
}));

import { useLivePackPrefetch } from '@/app/hooks/useLivePackPrefetch';
import { OfflineReadyRow } from '../OfflineReadyRow';
import { LivePackConsentSheet } from '../LivePackConsentSheet';
import { LIVE_PACK_REFRESH_EVENT } from '@/lib/livePack';
import { __resetAppFlagsForTest, __setAppFlagsForTest } from '@/lib/appFlags';

const EVENT = { id: 'ev-1', band_id: 'b-1', setlist_id: 'sl-1', date: '2026-11-28', title: 'Brooklyn Bowl' };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  __resetAppFlagsForTest(null);
  h.runs = [];
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('live_pack off', () => {
  it('nothing is downloaded ahead of time, a silent push is ignored; the tidy-up still runs', async () => {
    __setAppFlagsForTest({ live_pack: false });
    renderHook(() => useLivePackPrefetch([], 'u-1', ['b-1']));
    act(() => {
      window.dispatchEvent(new CustomEvent(LIVE_PACK_REFRESH_EVENT, { detail: { eventId: 'ev-9' } }));
      window.dispatchEvent(new Event('online'));
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.runs.length).toBeGreaterThan(0);
    expect(h.runs.every((r) => r.downloads === false && !r.force)).toBe(true);
  });

  it('turned off while the app is open: the next push only tidies up', async () => {
    renderHook(() => useLivePackPrefetch([], 'u-1', ['b-1']));
    act(() => __setAppFlagsForTest({ live_pack: false }));
    h.runs = [];
    act(() => {
      window.dispatchEvent(new CustomEvent(LIVE_PACK_REFRESH_EVENT, { detail: { eventId: 'ev-9' } }));
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.runs.length).toBeGreaterThan(0);
    expect(h.runs.every((r) => r.downloads === false && !r.force)).toBe(true);
  });

  it('a download already running stops when it is switched off', () => {
    renderHook(() => useLivePackPrefetch([], 'u-1', ['b-1']));
    act(() => {
      window.dispatchEvent(new CustomEvent(LIVE_PACK_REFRESH_EVENT, { detail: { eventId: 'ev-9' } }));
    });
    const running = h.runs.find((r) => r.downloads !== false)!;
    expect(running.keepGoing?.()).toBe(true);
    act(() => __setAppFlagsForTest({ live_pack: false }));
    expect(running.keepGoing?.()).toBe(false);
  });

  it('on (the default): a silent push still refreshes', () => {
    renderHook(() => useLivePackPrefetch([], 'u-1', ['b-1']));
    act(() => {
      window.dispatchEvent(new CustomEvent(LIVE_PACK_REFRESH_EVENT, { detail: { eventId: 'ev-9' } }));
    });
    expect(h.runs.some((r) => r.force?.[0] === 'ev-9' && r.downloads !== false)).toBe(true);
  });

  it('no "Download for offline" row on the event', () => {
    const { container, rerender } = render(<OfflineReadyRow pack={null} userId="u-1" event={EVENT} online />);
    expect(screen.getByText('Download for offline')).toBeInTheDocument();
    act(() => __setAppFlagsForTest({ live_pack: false }));
    rerender(<OfflineReadyRow pack={null} userId="u-1" event={EVENT} online />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a pack kept while it was off is partial: on again, the event is not "Offline ready"', () => {
    const pack = {
      v: 1, eventId: 'ev-1', bandId: 'b-1', userId: 'u-1', setlistId: 'sl-1',
      event: { id: 'ev-1', band_id: 'b-1', setlist_id: 'sl-1', event_date: '2026-11-28' },
      songs: [{ id: 'r1', title: 'Hudson Line', setNumber: 1 }], personal: {}, version: 'x',
      savedAt: new Date().toISOString(), expiresAt: '2026-11-30T00:00:00Z', partial: true,
    } as never;
    render(<OfflineReadyRow pack={pack} userId="u-1" event={EVENT} online />);
    expect(screen.queryByText(/Offline ready/)).toBeNull();
  });

  it('no consent sheet, even when the push asks for it', () => {
    __setAppFlagsForTest({ live_pack: false });
    render(<LivePackConsentSheet open onClose={() => {}} userId="u-1" event={EVENT} songs={[]} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
