import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const store = new Map<string, unknown>();
const pending = () => new Promise(() => {});
const quotesFor = vi.fn();
const statsCalls = vi.fn();
const rtHandlers = vi.hoisted(() => [] as { table: string; cb: () => void }[]);

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 'me' } }) }));
vi.mock('@/lib/offline/useNetworkStatus', () => ({ getIsNetworkOnline: () => true }));
vi.mock('@/lib/offline/syncQueue', () => ({ getPendingMutations: async () => [] }));
vi.mock('@/lib/offline/storage', () => ({
  getCacheKey: (u: string, b: string | null, k: string) => `bw:${u}:${b || 'global'}:${k}`,
  getOfflineItem: async (k: string) => store.get(k) ?? null,
  setOfflineItem: async (k: string, v: unknown) => { store.set(k, v); },
  onCachedRolesChanged: () => () => {},
}));
vi.mock('@/lib/services/events', () => ({
  getEventStats: async () => {
    statsCalls();
    return { data: { totalEvents: 1, confirmedEvents: 1, totalRevenue: 0, upcomingEvents: 1 }, error: null };
  },
  getUpcomingEvents: async () => ({ data: [], error: null }),
  getMemberPersonalStats: async () => ({ data: null, error: null }),
}));
vi.mock('@/lib/services/quotes', () => ({
  getQuoteStats: async () => ({ data: null, error: null }),
  getQuotes: (bandId: string) => quotesFor(bandId),
}));
vi.mock('@/lib/supabase', () => {
  const ch: any = {
    on: (_kind: string, filter: { table: string }, cb: () => void) => {
      rtHandlers.push({ table: filter.table, cb });
      return ch;
    },
    subscribe: () => ch,
  };
  return { supabase: { channel: () => ch, removeChannel: () => {} }, getSafeUser: async () => ({ data: { user: { id: 'me' } } }) };
});

import { useDashboardData } from '../useData';
import { SAFETY_NET_POLL_MS } from '@/lib/safetyNetPoll';

beforeEach(() => {
  store.clear();
  quotesFor.mockReset();
  statsCalls.mockReset();
  rtHandlers.length = 0;
});

describe('useDashboardData', () => {
  it("does not show the previous band's draft quotes after a band switch", async () => {
    quotesFor.mockImplementation((b: string) => (b === 'b1' ? Promise.resolve({ data: [{ id: 'q-b1' }], error: null }) : pending()));
    const { result, rerender } = renderHook(({ band }) => useDashboardData(band), { initialProps: { band: 'b1' } });
    await waitFor(() => expect(result.current.data.recentQuotes.map((q: any) => q.id)).toEqual(['q-b1']));
    await act(async () => { rerender({ band: 'b2' }); });
    expect(result.current.data.recentQuotes).toEqual([]);
  });

  it("does not seed a band from another band's fallback cache", async () => {
    store.set('bw:me:global:dashboard_data_fallback', { bandId: 'b1', eventStats: { totalEvents: 9 }, quoteStats: null, memberStats: null, upcomingEvents: [], recentQuotes: [{ id: 'q-b1' }] });
    quotesFor.mockImplementation(() => pending());
    const { result } = renderHook(() => useDashboardData('b2'));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.data.recentQuotes).toEqual([]);
  });

  // Egress: Home re-fetched 5 queries every 30 s while visible. Realtime
  // (events, event_members) and app resume cover changes; the timer is only
  // a slow safety net.
  describe('refresh without a fast timer', () => {
    const tick = async (ms: number) => {
      await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    };
    beforeEach(() => {
      vi.useFakeTimers();
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      quotesFor.mockImplementation(() => Promise.resolve({ data: [], error: null }));
    });
    afterEach(() => vi.useRealTimers());

    it('does not re-fetch for four minutes while nothing changes', async () => {
      renderHook(() => useDashboardData('b1'));
      await tick(0);
      const afterLoad = statsCalls.mock.calls.length;
      await tick(4 * 60_000);
      expect(statsCalls.mock.calls.length).toBe(afterLoad);
    });

    it('still refreshes on the slow safety-net timer', async () => {
      renderHook(() => useDashboardData('b1'));
      await tick(0);
      const afterLoad = statsCalls.mock.calls.length;
      await tick(SAFETY_NET_POLL_MS + 100);
      expect(statsCalls.mock.calls.length).toBe(afterLoad + 1);
    });

    it('refreshes when a fee or lineup changes (event_members)', async () => {
      renderHook(() => useDashboardData('b1'));
      await tick(0);
      const afterLoad = statsCalls.mock.calls.length;
      const fees = rtHandlers.find((h) => h.table === 'event_members');
      expect(fees).toBeTruthy();
      // A saved event rewrites its line-up row by row: one refresh per burst.
      await act(async () => { fees!.cb(); fees!.cb(); fees!.cb(); });
      await tick(1000);
      expect(statsCalls.mock.calls.length).toBe(afterLoad + 1);
    });

    it('refreshes when the app comes back to the front', async () => {
      renderHook(() => useDashboardData('b1'));
      await tick(0);
      const afterLoad = statsCalls.mock.calls.length;
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
      await tick(0);
      expect(statsCalls.mock.calls.length).toBe(afterLoad + 1);
    });
  });
});
