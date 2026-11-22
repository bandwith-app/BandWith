// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';

/**
 * Review #273 round 8 (item 3): on the web the hook passes the real online
 * state (navigator.onLine, kept current by the online / offline events), so
 * the privacy sweep runs there too. The real store, a tiny Supabase double.
 */
const h = vi.hoisted(() => ({ declined: false, asked: [] as string[] }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({}),
}));
vi.mock('@/lib/appResume', () => ({ onAppResume: () => () => undefined }));
vi.mock('@/lib/supabase', () => {
  const query = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const chain: any = {
      select: () => chain,
      eq: (c: string, v: unknown) => (filters.push([c, v]), chain),
      in: (c: string, v: unknown) => (filters.push([c, v]), chain),
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => chain,
      then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        h.asked.push(table);
        const ids = (filters.find((f) => f[0] === 'id' || f[0] === 'event_id')?.[1] as string[]) ?? [];
        let data: unknown = [];
        if (table === 'events') data = ids.map((id) => ({ id, status: 'confirmed' }));
        if (table === 'event_members') data = h.declined ? ids.map((event_id) => ({ event_id, status: 'declined' })) : [];
        return Promise.resolve({ data, error: null }).then(ok, ko);
      },
    };
    return chain;
  };
  return {
    supabase: { from: query, rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) },
    isDemoMode: false,
  };
});

import { useLivePackPrefetch } from '../useLivePackPrefetch';
import { readPack, savePackSongs } from '@/lib/livePackStore';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const item = { eventId: 'e1', band_id: 'b1', title: 'The Loft, Brooklyn', eventType: 'gig', date: inDays(3), setlistId: 's1' };
const setOnline = (on: boolean) => Object.defineProperty(window.navigator, 'onLine', { value: on, configurable: true });

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  h.declined = false;
  h.asked = [];
  setOnline(true);
  await savePackSongs({ userId: 'u1', event: { id: 'e1', band_id: 'b1', title: 'The Loft', event_type: 'gig', event_date: inDays(3), setlist_id: 's1' }, songs: [{ title: 'Paper Boats' }] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setOnline(true);
});

describe('useLivePackPrefetch on the web', () => {
  it('online, after declining: the pack is deleted', async () => {
    expect(await readPack('u1', 'b1', 'e1')).not.toBeNull();
    h.declined = true;
    renderHook(() => useLivePackPrefetch([item], 'u1', ['b1']));
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    await waitFor(async () => expect(await readPack('u1', 'b1', 'e1')).toBeNull());
  });

  it('offline: nothing is asked or removed; back online it is', async () => {
    h.declined = true;
    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    renderHook(() => useLivePackPrefetch([item], 'u1', ['b1']));
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.asked).not.toContain('event_members');
    expect(await readPack('u1', 'b1', 'e1')).not.toBeNull();
    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(async () => expect(await readPack('u1', 'b1', 'e1')).toBeNull());
  });
});
