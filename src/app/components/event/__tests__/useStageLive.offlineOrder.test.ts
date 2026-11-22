import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * A tiny stand-in for the Supabase stage channel: every hook instance is a
 * phone; a broadcast reaches the others (self: false), presence joins are
 * announced.
 */
type Handler = { type: string; event: string; cb: (msg: unknown) => void };
const phones: { key: string; handlers: Handler[] }[] = [];
const bus = {
  send(from: string, event: string, payload: unknown) {
    for (const p of phones) if (p.key !== from) p.handlers.filter((h) => h.type === 'broadcast' && h.event === event).forEach((h) => h.cb({ payload }));
  },
};
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (_topic: string, opts: { config: { presence: { key: string } } }) => {
      const phone = { key: opts.config.presence.key, handlers: [] as Handler[] };
      phones.push(phone);
      const ch = {
        on(type: string, filter: { event: string }, cb: (msg: unknown) => void) {
          phone.handlers.push({ type, event: filter.event, cb });
          return ch;
        },
        subscribe(cb: (s: string) => void) {
          cb('SUBSCRIBED');
          return ch;
        },
        track: async () => {
          for (const p of phones)
            if (p.key !== phone.key) p.handlers.filter((h) => h.type === 'presence' && h.event === 'join').forEach((h) => h.cb({ key: phone.key, newPresences: [{}] }));
        },
        send: async (m: { event: string; payload: unknown }) => bus.send(phone.key, m.event, m.payload),
        __phone: phone,
      };
      return ch;
    },
    removeChannel: async (ch: { __phone: { key: string } }) => {
      const i = phones.findIndex((p) => p.key === ch.__phone.key);
      if (i >= 0) phones.splice(i, 1);
    },
  },
}));
const bleStub = vi.hoisted(() => ({ status: 'connected', publish: () => {}, burst: () => {}, clock: null, followers: 0, fix: () => {} }));
vi.mock('../useStageBle', () => ({ useStageBle: () => bleStub }));
// No signal at the venue: the save fails with a network error.
// (The Stage order is saved with saveStageOrder since the live outbox; the account that queues it is the session's.)
vi.mock('@/lib/services/songs', () => ({ saveStageOrder: vi.fn(async () => ({ error: new TypeError('Failed to fetch') })) }));
vi.mock('@/lib/sessionUser', () => ({ sessionUserId: async () => 'u-admin' }));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: async () => {} }));
vi.mock('@/lib/services/liveOutboxApi', () => ({
  keepOrderOffline: vi.fn(async (e: { message?: string }) => /fetch|network/i.test(String(e?.message))),
}));

import { useStageLive } from '../useStageLive';
import { saveStageOrder } from '@/lib/services/songs';
import { keepOrderOffline } from '@/lib/services/liveOutboxApi';

const SONGS = [
  { id: 'row-1', songId: 'song-1', setNumber: 1 },
  { id: 'row-2', songId: 'song-2', setNumber: 1 },
  { id: 'row-3', songId: 'song-3', setNumber: 1 },
];
const phone = (isLeader: boolean) =>
  renderHook(() => useStageLive({ eventId: 'gig-1', setlistId: 'list-1', songs: SONGS, open: true, isLeader }));

beforeEach(() => {
  phones.length = 0;
  vi.clearAllMocks();
});

describe('useStageLive: a reorder with no signal (audit #11)', () => {
  it("the new order stays on the band's phones when the save has no signal, and waits to be saved", async () => {
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.move(0, 2));
    const moved = ['row-2', 'row-3', 'row-1'];
    expect(member.result.current.songs.map((s) => s.id)).toEqual(moved);
    await waitFor(() => expect(saveStageOrder).toHaveBeenCalled(), { timeout: 3000 });
    await waitFor(() => expect(keepOrderOffline).toHaveBeenCalled());
    await waitFor(() => expect(leader.result.current.saveState).toBe('waiting'));
    // Not reversed: neither on the leader nor on the member.
    expect(leader.result.current.songs.map((s) => s.id)).toEqual(moved);
    expect(member.result.current.songs.map((s) => s.id)).toEqual(moved);
  });

  it('any other failure (no permission) still goes back to the saved order, for everyone', async () => {
    vi.mocked(saveStageOrder).mockResolvedValueOnce({ error: new Error('permission denied') });
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.move(0, 2));
    await waitFor(() => expect(leader.result.current.saveState).toBe('error'), { timeout: 3000 });
    expect(member.result.current.songs.map((s) => s.id)).toEqual(['row-1', 'row-2', 'row-3']);
  });
});
