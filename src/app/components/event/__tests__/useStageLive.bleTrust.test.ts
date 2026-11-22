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
    /** The same clock, set at once (no render in between). */
    clockRef: { current: null as null | { from: string | null; sample: { offset: number; rtt: number } } },
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
const LEAD_BEAT_EXTRA = 5_000;

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

const beat = (from: string, seq?: number) => act(() => emit('broadcast', LEAD_BEAT_EVENT, { payload: seq === undefined ? { from } : { from, seq } }));
const later = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  chan.handlers = [];
  chan.sent = [];
  ble.api.clock = null;
  ble.api.clockRef.current = null;
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
  it('off the channel (Realtime reconnecting), the leader sends no heartbeat: supabase-js would post it over HTTP (Claude on #280)', () => {
    const l = phone(true);
    act(() => l.result.current.go(1));
    later(LIVE_LEAD_FRESH_MS);
    act(() => chan.status?.('CHANNEL_ERROR'));
    const before = chan.sent.filter((s) => s.event === LEAD_BEAT_EVENT).length;
    later(LIVE_LEAD_FRESH_MS);
    expect(chan.sent.filter((s) => s.event === LEAD_BEAT_EVENT)).toHaveLength(before);
    act(() => chan.status?.('SUBSCRIBED'));
    later(LIVE_LEAD_FRESH_MS);
    expect(chan.sent.filter((s) => s.event === LEAD_BEAT_EVENT).length).toBeGreaterThan(before);
  });

  it('a Bluetooth leader whose clock runs a few minutes ahead (measured) is followed (rule B)', () => {
    const ahead = 4 * 60_000;
    ble.api.clock = { from: 'lead', sample: { offset: ahead, rtt: 20 } };
    ble.api.clockRef.current = ble.api.clock;
    const m = phone();
    bt({ seq: nextSeq(null, Date.now() + ahead), from: 'lead', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-3');
  });

  it("a leader's clock more than 5 minutes off (measured, just now: no render yet) never counts: its states are dropped (main session's rule; Codex on #280)", () => {
    const m = phone();
    const ahead = 8 * 60_000;
    // Measured and handed over in the same moment as its state (useStageBle sets the ref at once).
    ble.api.clockRef.current = { from: 'lead', sample: { offset: ahead, rtt: 20 } };
    bt({ seq: nextSeq(null, Date.now() + ahead), from: 'lead', songId: 'row-3', order: null });
    expect(m.result.current.currentId).not.toBe('row-3');
  });

  it('a band member with a clock years ahead: no effect on the order, and the real leader still moves on (Codex on #280)', () => {
    const years = 3 * 365 * 24 * 3_600_000;
    ble.api.clock = { from: 'x', sample: { offset: years, rtt: 20 } };
    ble.api.clockRef.current = ble.api.clock;
    const m = phone();
    bt({ seq: nextSeq(null, Date.now() + years), from: 'x', songId: 'row-3', order: null });
    expect(m.result.current.currentId).not.toBe('row-3');
    bt({ seq: now(), from: 'a', songId: 'row-2', order: null });
    expect(m.result.current.currentId).toBe('row-2');
  });

  it("only the current leader's beat holds Bluetooth back: B took over and went offline, A still online, the member follows B over Bluetooth (Codex on #280)", () => {
    const m = phone();
    live({ seq: now(), from: 'A', songId: 'row-1', order: null });
    live({ seq: now() + 100, from: 'B', songId: 'row-2', order: null });
    expect(m.result.current.currentId).toBe('row-2');
    // B's phone loses the internet; A (an older build, say) keeps beating.
    for (let i = 0; i < 4; i++) {
      later(4_000);
      beat('A');
    }
    bt({ seq: now() + 300, from: 'B', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-3');
  });

  it('a leader that sees a newer leader stops beating: it no longer leads (Codex on #280)', () => {
    const l = phone(true);
    act(() => l.result.current.go(1));
    later(LEAD_BEAT_EXTRA);
    live({ seq: now() + 1000, from: 'B', songId: 'row-3', order: null });
    const before = chan.sent.filter((x) => x.event === LEAD_BEAT_EVENT).length;
    later(12_000);
    expect(chan.sent.filter((x) => x.event === LEAD_BEAT_EVENT).length).toBe(before);
  });

  it("a state the member refused doesn't make its sender a live leader: its beats hold nothing back (Codex on #288)", () => {
    const m = phone();
    live({ seq: now(), from: 'A', songId: 'row-1', order: null });
    // An older state from a phone not heard before: refused.
    live({ seq: now() - 500, from: 'X', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-1');
    later(LIVE_LEAD_FRESH_MS + 1000);
    beat('X');
    bt({ seq: now() + 300, from: 'b', songId: 'row-2', order: null });
    expect(m.result.current.currentId).toBe('row-2');
  });

  it('an admin leading itself: a state from an admin heard for the first time, older than its own, is not applied (Codex on #280)', () => {
    const l = phone(true);
    act(() => l.result.current.go(2));
    expect(l.result.current.currentId).toBe('row-3');
    live({ seq: now() - 500, from: 'Y', songId: 'row-1', order: null });
    expect(l.result.current.currentId).toBe('row-3');
  });

  it('every Stage opening is a new leader id, and seqs never go back below what this phone sent before (Codex + Claude on #280)', () => {
    const l = renderHook((p: { open: boolean }) => useStageLive({ eventId: 'gig-1', setlistId: 'list-1', songs: SONGS, open: p.open, isLeader: true }), {
      initialProps: { open: true },
    });
    const first = l.result.current.clientId;
    act(() => l.result.current.go(1));
    const sent = () => chan.sent.filter((x) => x.event === 'state').map((x) => x.payload as StageLiveState);
    const before = sent()[sent().length - 1].seq;
    l.rerender({ open: false });
    // The phone's clock was a minute ahead, and is fixed meanwhile.
    vi.setSystemTime(Date.now() - 60_000);
    l.rerender({ open: true });
    expect(l.result.current.clientId).not.toBe(first);
    act(() => l.result.current.go(2));
    expect(sent()[sent().length - 1].seq).toBeGreaterThan(before);
  });

  it('with the clock measured, a Bluetooth seq only ~30 s beyond it counts; unmeasured, at most 5 minutes ahead (Claude on #280)', () => {
    ble.api.clock = { from: 'lead', sample: { offset: 500, rtt: 20 } };
    ble.api.clockRef.current = ble.api.clock;
    const m = phone();
    bt({ seq: nextSeq(null, Date.now() + 60_000), from: 'lead', songId: 'row-3', order: null });
    expect(m.result.current.currentId).not.toBe('row-3');
    bt({ seq: nextSeq(null, Date.now() + 10_000), from: 'lead', songId: 'row-2', order: null });
    expect(m.result.current.currentId).toBe('row-2');
    // Another phone, its clock not measured: 6 minutes ahead is too far.
    bt({ seq: nextSeq(null, Date.now() + 6 * 60_000), from: 'other', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-2');
  });

  it("a missed live update arriving over Bluetooth applies once the leader's beat confirms it (Codex on #280)", () => {
    const m = phone();
    const s1 = now();
    live({ seq: s1, from: 'A', songId: 'row-1', order: null });
    // A's next state never reached this phone online; its Bluetooth copy did (held: A leads online).
    bt({ seq: s1 + 50, from: 'A', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-1');
    // A's beat says it's at that seq: the copy is A's latest, it applies.
    beat('A', s1 + 50);
    expect(m.result.current.currentId).toBe('row-3');
    // A beat naming another seq (or another leader's copy) applies nothing.
    bt({ seq: s1 + 80, from: 'A', songId: 'row-2', order: null });
    beat('A', s1 + 90);
    expect(m.result.current.currentId).toBe('row-3');
  });

  it('the leader beats with its seq', () => {
    const l = phone(true);
    act(() => l.result.current.go(1));
    later(LIVE_LEAD_FRESH_MS);
    const last = chan.sent.filter((x) => x.event === 'state').map((x) => x.payload as StageLiveState).pop()!;
    const beats = chan.sent.filter((s) => s.event === LEAD_BEAT_EVENT).map((s) => s.payload as { from: string; seq: number });
    expect(beats[beats.length - 1]).toEqual({ from: l.result.current.clientId, seq: last.seq });
  });

  it("another admin's state refused while the leader led online applies once that leader goes quiet, if that admin still leads (Codex on #280)", () => {
    const m = phone();
    live({ seq: now() + 100, from: 'A', songId: 'row-1', order: null });
    // B's clock is behind A's: its state is older, refused while A leads.
    live({ seq: now(), from: 'B', songId: 'row-2', order: null });
    expect(m.result.current.currentId).toBe('row-1');
    // A goes quiet; B keeps beating (it leads).
    for (let i = 0; i < 3; i++) {
      later(4_000);
      beat('B');
    }
    later(LIVE_LEAD_FRESH_MS);
    expect(m.result.current.currentId).toBe('row-2');
  });

  it("only the followed leader's beat keeps the held Bluetooth state back: another admin's beats don't (Codex on #280)", () => {
    const m = phone();
    live({ seq: now(), from: 'A', songId: 'row-1', order: null });
    live({ seq: now() + 100, from: 'B', songId: 'row-2', order: null });
    bt({ seq: now() + 200, from: 'B', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-2');
    // B goes offline; A (no longer leading) keeps beating.
    for (let i = 0; i < 4; i++) {
      later(4_000);
      beat('A');
    }
    expect(m.result.current.currentId).toBe('row-3');
  });

  it('a seq kept from a clock far ahead (since fixed) is dropped on reopening: a new start from now (Codex + Claude on #280)', () => {
    const real = Date.now();
    vi.setSystemTime(real + 20 * 60_000);
    const l = renderHook((p: { open: boolean }) => useStageLive({ eventId: 'gig-2', setlistId: 'list-1', songs: SONGS, open: p.open, isLeader: true }), {
      initialProps: { open: true },
    });
    act(() => l.result.current.go(1));
    const sent = () => chan.sent.filter((x) => x.event === 'state').map((x) => x.payload as StageLiveState);
    const ahead = sent()[sent().length - 1].seq;
    l.rerender({ open: false });
    vi.setSystemTime(real);
    l.rerender({ open: true });
    act(() => l.result.current.go(2));
    const next = sent()[sent().length - 1].seq;
    expect(next).toBeLessThan(ahead);
    expect(Math.abs(next - nextSeq(null))).toBeLessThan(50);
  });

  it("an hour-fast clock fixed while Stage stays open: the leader's next seq starts from now, not from its last one (Claude on #280)", () => {
    const real = Date.now();
    vi.setSystemTime(real + 60 * 60_000);
    const l = renderHook(() => useStageLive({ eventId: 'gig-3', setlistId: 'list-1', songs: SONGS, open: true, isLeader: true }));
    act(() => l.result.current.go(1));
    const sent = () => chan.sent.filter((x) => x.event === 'state').map((x) => x.payload as StageLiveState);
    const ahead = sent()[sent().length - 1].seq;
    vi.setSystemTime(real);
    act(() => l.result.current.go(2));
    const next = sent()[sent().length - 1].seq;
    expect(next).toBeLessThan(ahead);
    expect(Math.abs(next - nextSeq(null))).toBeLessThan(50);
  });

  it("a member that took a state an hour ahead (that leader's clock, since fixed) follows the leader's next state at once (Claude on #280)", () => {
    const m = phone();
    live({ seq: now() + 36_000, from: 'A', songId: 'row-2', order: null });
    expect(m.result.current.currentId).toBe('row-2');
    live({ seq: now(), from: 'A', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-3');
  });

  it('a live state that arrives after its Bluetooth copy still marks its sender as leading online (Codex on #288)', () => {
    const m = phone();
    const s1 = now();
    bt({ seq: s1, from: 'A', songId: 'row-2', order: null });
    expect(m.result.current.currentId).toBe('row-2');
    live({ seq: s1, from: 'A', songId: 'row-2', order: null });
    // A leads online now: a Bluetooth state from anyone else is held back.
    bt({ seq: s1 + 100, from: 'X', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-2');
  });
});
