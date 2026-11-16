import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

/**
 * Emulator pass 11-16: a member made admin on the same device saw no client
 * (and an empty new contract) until the offline cache was cleared by hand.
 * The cache read landed after the server's answer and put the member-shaped
 * rows back; and a role change while the app is open fetched nothing.
 */

const store = new Map<string, unknown>();
let cacheDelay = 0;
const roleListeners = new Set<() => void>();
const getEvents = vi.fn();

// One user object, as the real AuthContext keeps it between renders.
const auth = { isAuthenticated: true, user: { id: 'me' } };
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/lib/offline/useNetworkStatus', () => ({ getIsNetworkOnline: () => true }));
vi.mock('@/lib/offline/syncQueue', () => ({ getPendingMutations: async () => [] }));
vi.mock('@/lib/offline/storage', () => ({
  getCacheKey: (u: string, b: string | null, k: string) => `bw:${u}:${b || 'global'}:${k}`,
  // A slow device: the value is read now, the answer arrives `cacheDelay` ms later.
  getOfflineItem: async (k: string) => {
    const value = store.get(k) ?? null;
    if (cacheDelay) await new Promise((r) => setTimeout(r, cacheDelay));
    return value;
  },
  setOfflineItem: async (k: string, v: unknown) => { store.set(k, v); },
  onCachedRolesChanged: (cb: () => void) => {
    roleListeners.add(cb);
    return () => roleListeners.delete(cb);
  },
}));
vi.mock('@/lib/services/events', () => ({
  getEvents: (...args: unknown[]) => getEvents(...args),
  getEventStats: async () => ({ data: null, error: null }),
  getUpcomingEvents: async () => ({ data: [], error: null }),
  getMemberPersonalStats: async () => ({ data: null, error: null }),
}));
vi.mock('@/lib/supabase', () => {
  const ch: any = { on: () => ch, subscribe: () => ch };
  return { supabase: { channel: () => ch, removeChannel: () => {} }, getSafeUser: async () => ({ data: { user: { id: 'me' } } }) };
});

import { useEvents, useExpandedEventsData } from '../useData';

const memberRow = { id: 'gig', band_id: 'b1', title: 'Rooftop Session' };
const adminRow = { ...memberRow, client_name: 'Aurora Events', price: 1800 };
const BANDS = ['b1'];

beforeEach(() => {
  store.clear();
  roleListeners.clear();
  cacheDelay = 0;
  getEvents.mockReset();
});

describe('event rows cached for another role', () => {
  it('a slow cache read never puts member rows back over the admin rows the server sent', async () => {
    store.set(`bw:me:b1:events_{}`, [memberRow]);
    store.set(`bw:me:global:events_fallback_{}`, [memberRow]);
    cacheDelay = 40;
    getEvents.mockResolvedValue({ data: [adminRow], error: null });
    const { result } = renderHook(() => useEvents(BANDS));
    await waitFor(() => expect(result.current.events[0]?.client_name).toBe('Aurora Events'));
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    expect(result.current.events[0]?.client_name).toBe('Aurora Events');
  });

  it('the same for the expanded gig lists', async () => {
    store.set(`bw:me:b1:expanded_events_["confirmed"]`, [memberRow]);
    cacheDelay = 40;
    getEvents.mockResolvedValue({ data: [adminRow], error: null });
    const { result } = renderHook(() => useExpandedEventsData('b1', ['confirmed']));
    await waitFor(() => expect(result.current.events[0]?.client_name).toBe('Aurora Events'));
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    expect(result.current.events[0]?.client_name).toBe('Aurora Events');
  });

  it('a role change while the app is open fetches the rows again', async () => {
    getEvents.mockResolvedValue({ data: [memberRow], error: null });
    const { result } = renderHook(() => useEvents(BANDS));
    await waitFor(() => expect(result.current.events[0]?.title).toBe('Rooftop Session'));
    expect(result.current.events[0]?.client_name).toBeUndefined();
    getEvents.mockResolvedValue({ data: [adminRow], error: null });
    await act(async () => { roleListeners.forEach((cb) => cb()); });
    await waitFor(() => expect(result.current.events[0]?.client_name).toBe('Aurora Events'));
  });

  it('and back: made member, the client is gone without waiting for the next poll', async () => {
    getEvents.mockResolvedValue({ data: [adminRow], error: null });
    const { result } = renderHook(() => useEvents(BANDS));
    await waitFor(() => expect(result.current.events[0]?.client_name).toBe('Aurora Events'));
    getEvents.mockResolvedValue({ data: [memberRow], error: null });
    await act(async () => { roleListeners.forEach((cb) => cb()); });
    await waitFor(() => expect(result.current.events[0]?.client_name).toBeUndefined());
  });
});
