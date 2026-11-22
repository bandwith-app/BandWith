import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { nextSeq, type StageLiveState } from '@/lib/stageLive';

/**
 * Review of #280: Bluetooth states can be made by anyone with the band key.
 * One with a huge seq must not freeze a member, nor hold back the live
 * channel (where only admins can send).
 */
type Handler = { type: string; event: string; cb: (msg: unknown) => void };
const chan = vi.hoisted(() => ({
  handlers: [] as Handler[],
  status: null as null | ((s: string) => void),
  sent: [] as Array<{ event: string; payload: unknown }>,
}));
vi.mock('@/lib/supabase', () => {
  const ch = {
    on(type: string, filter: { event: string }, cb: (msg: unknown) => void) {
      chan.handlers.push({ type, event: filter.event, cb });
      return ch;
    },
    subscribe: (cb?: (s: string) => void) => {
      chan.status = cb ?? null;
      cb?.('SUBSCRIBED');
      return ch;
    },
    track: async () => {},
    send: async (m: { event: string; payload: unknown }) => {
      chan.sent.push({ event: m.event, payload: m.payload });
    },
  };
  return { supabase: { channel: () => ch, removeChannel: async () => {} } };
});
const emit = (type: string, event: string, msg: unknown) =>
  chan.handlers.filter((h) => h.type === type && h.event === event).forEach((h) => h.cb(msg));
const ble = vi.hoisted(() => ({
  onState: null as null | ((s: StageLiveState) => void),
  // Stable, like the real hook's callbacks (a new one each render would re-open the channel).
  api: {
    status: 'connected',
    publish: () => {},
    burst: () => {},
    clock: null as null | { from: string | null; sample: { offset: number; rtt: number } },
    followers: 0,
    fix: () => {},
  },
}));
vi.mock('../useStageBle', () => ({
  useStageBle: (o: { onState: (s: StageLiveState) => void }) => {
    ble.onState = o.onState;
    return ble.api;
  },
}));
vi.mock('@/lib/services/songs', () => ({ saveSetlistOrder: vi.fn(async () => ({ error: null })) }));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: async () => {} }));

import { useStageLive, LEAD_BEAT_EVENT, LIVE_LEAD_FRESH_MS } from '../useStageLive';

const SONGS = [
  { id: 'row-1', songId: 'song-1', setNumber: 1 },
  { id: 'row-2', songId: 'song-2', setNumber: 1 },
  { id: 'row-3', songId: 'song-3', setNumber: 1 },
];
const phone = (isLeader = false) =>
  renderHook(() => useStageLive({ eventId: 'gig-1', setlistId: 'list-1', songs: SONGS, open: true, isLeader }));
const now = () => nextSeq(null);
const live = (state: StageLiveState) => act(() => emit('broadcast', 'state', { payload: state }));
const bt = (state: StageLiveState) => act(() => ble.onState!(state));

const beat = (from: string) => act(() => emit('broadcast', LEAD_BEAT_EVENT, { payload: { from } }));
const later = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  chan.handlers = [];
  chan.sent = [];
  ble.api.clock = null;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useStageLive: Bluetooth states never outrank the live channel (review of #280)', () => {
  it('a Bluetooth state with a seq far ahead of the clock is dropped', () => {
    const m = phone();
    bt({ seq: 0xffffffff, from: 'x', songId: 'row-3', order: null });
    expect(m.result.current.currentId).not.toBe('row-3');
    bt({ seq: now(), from: 'a', songId: 'row-2', order: null });
    expect(m.result.current.currentId).toBe('row-2');
  });

  it('a Bluetooth state with a higher seq does not hold back the live channel', () => {
    const m = phone();
    bt({ seq: now() + 3000, from: 'x', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-3');
    live({ seq: now(), from: 'admin', songId: 'row-2', order: null });
    expect(m.result.current.currentId).toBe('row-2');
    // On the live channel itself the newest still wins.
    live({ seq: now() - 50, from: 'admin', songId: 'row-1', order: null });
    expect(m.result.current.currentId).toBe('row-2');
  });

  it('a leader leading on the live channel (a state in the last 10 s) holds Bluetooth back; quiet, it no longer does', () => {
    const m = phone();
    live({ seq: now(), from: 'admin', songId: 'row-1', order: null });
    bt({ seq: now() + 100, from: 'x', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-1');
    // The leader's phone lost the internet (no goodbye on the channel): Bluetooth takes over.
    later(LIVE_LEAD_FRESH_MS + 1000);
    bt({ seq: now() + 200, from: 'a', songId: 'row-2', order: null });
    expect(m.result.current.currentId).toBe('row-2');
  });

  it("the leader's heartbeat keeps Bluetooth held back while the song doesn't change", () => {
    const m = phone();
    live({ seq: now(), from: 'admin', songId: 'row-1', order: null });
    for (let i = 0; i < 5; i++) {
      later(4_000);
      beat('admin');
    }
    bt({ seq: now() + 100, from: 'x', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-1');
  });

  it('a phone that only claims to lead in presence (anyone can) holds nothing back (Codex on #280, rule A)', () => {
    const m = phone();
    act(() => emit('presence', 'join', { key: 'member-posing', newPresences: [{ lead: true }] }));
    bt({ seq: now() + 100, from: 'a', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-3');
  });

  it("an admin with Stage open who isn't leading holds nothing back", () => {
    const m = phone();
    act(() => emit('presence', 'join', { key: 'admin', newPresences: [{ lead: true }] }));
    later(LIVE_LEAD_FRESH_MS + 1000);
    bt({ seq: now() + 100, from: 'a', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-3');
  });

  it("a presence claim doesn't reset what the member follows: an older Bluetooth state stays older", () => {
    const m = phone();
    const s = now();
    live({ seq: s, from: 'admin', songId: 'row-2', order: null });
    later(LIVE_LEAD_FRESH_MS + 1000);
    act(() => emit('presence', 'join', { key: 'member-posing', newPresences: [{ lead: true }] }));
    act(() => emit('presence', 'leave', { key: 'member-posing' }));
    bt({ seq: s - 100, from: 'x', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-2');
  });

  it('off the channel, Bluetooth takes over at once, with the newest Bluetooth state held meanwhile', () => {
    const m = phone();
    live({ seq: now(), from: 'admin', songId: 'row-1', order: null });
    bt({ seq: now() + 100, from: 'admin', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-1');
    act(() => chan.status?.('CHANNEL_ERROR'));
    expect(m.result.current.currentId).toBe('row-3');
  });

  it('the held Bluetooth state applies once the online leader goes quiet, without waiting for its next change', () => {
    const m = phone();
    live({ seq: now(), from: 'admin', songId: 'row-1', order: null });
    bt({ seq: now() + 100, from: 'admin', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-1');
    later(LIVE_LEAD_FRESH_MS + 1000);
    expect(m.result.current.currentId).toBe('row-3');
  });

  it('a new leader (Stage reopened, a phone with an earlier clock) is followed once the old one has gone quiet', () => {
    const m = phone();
    live({ seq: now(), from: 'admin-old', songId: 'row-1', order: null });
    // A second admin still leading meanwhile: the newest state wins, as before.
    live({ seq: now() - 3000, from: 'admin-b', songId: 'row-2', order: null });
    expect(m.result.current.currentId).toBe('row-1');
    later(LIVE_LEAD_FRESH_MS + 1000);
    live({ seq: now() - 3000, from: 'admin-new', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-3');
  });

  it('the leader sends a heartbeat every few seconds once it has led, and none before', () => {
    const l = phone(true);
    later(12_000);
    expect(chan.sent.filter((s) => s.event === LEAD_BEAT_EVENT)).toHaveLength(0);
    act(() => l.result.current.go(1));
    later(LIVE_LEAD_FRESH_MS);
    expect(chan.sent.filter((s) => s.event === LEAD_BEAT_EVENT).length).toBeGreaterThanOrEqual(2);
  });
  it("a Bluetooth leader whose clock runs 20 minutes ahead (measured) is followed; another phone with such a seq isn't (Codex on #280, rule B)", () => {
    const ahead = 20 * 60_000;
    ble.api.clock = { from: 'lead', sample: { offset: ahead, rtt: 20 } };
    const m = phone();
    bt({ seq: nextSeq(null, Date.now() + ahead), from: 'other', songId: 'row-2', order: null });
    expect(m.result.current.currentId).not.toBe('row-2');
    bt({ seq: nextSeq(null, Date.now() + ahead), from: 'lead', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-3');
  });
});
