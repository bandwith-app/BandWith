import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * A tiny stand-in for the Supabase stage channel: every hook instance is a
 * phone; a broadcast reaches the others (self: false), presence joins are
 * announced.
 */
type Handler = { type: string; event: string; cb: (msg: unknown) => void };
// One entry per channel: the stage topic and, since #283, the clock topic (members' pings) of the same phone
// (the same stand-in as useStageLive.playhead.test.ts after Group 5).
const phones: { key: string; topic: string; handlers: Handler[] }[] = [];
/** The phone whose stage channel was made last: its clock channel (no presence key) comes right after. */
let lastKey = '';
const bus = {
  send(from: string, topic: string, event: string, payload: unknown) {
    for (const p of phones)
      if (p.key !== from && p.topic === topic) p.handlers.filter((h) => h.type === 'broadcast' && h.event === event).forEach((h) => h.cb({ payload }));
  },
};
/** The stage topic of a phone (the count-in is sent there). */
const stageTopic = (key: string) => phones.find((p) => p.key === key && p.handlers.some((h) => h.type === 'presence'))!.topic;
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (topic: string, opts: { config: { presence?: { key: string } } }) => {
      const stage = !!opts.config.presence;
      if (opts.config.presence) lastKey = opts.config.presence.key;
      const phone = { key: lastKey, topic, handlers: [] as Handler[] };
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
          if (!stage) return;
          for (const p of phones)
            if (p.key !== phone.key) p.handlers.filter((h) => h.type === 'presence' && h.event === 'join').forEach((h) => h.cb({ key: phone.key, newPresences: [{}] }));
        },
        send: async (m: { event: string; payload: unknown }) => bus.send(phone.key, topic, m.event, m.payload),
        __phone: phone,
      };
      return ch;
    },
    removeChannel: async (ch: { __phone: { key: string; topic: string } }) => {
      const i = phones.findIndex((p) => p === ch.__phone);
      if (i >= 0) phones.splice(i, 1);
    },
  },
}));
const ble = vi.hoisted(() => ({ burst: vi.fn() }));
// Stable functions, like the real hook's (publishLive: #274).
const bleStub = vi.hoisted(() => ({ status: 'off', publish: () => {}, publishLive: () => {}, burst: (): void => {}, clock: null }));
vi.mock('../useStageBle', () => ({ useStageBle: () => ({ ...bleStub, burst: ble.burst }) }));
vi.mock('@/lib/services/songs', () => ({ saveSetlistOrder: async () => ({ error: null }) }));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: async () => {} }));

import { useStageLive } from '../useStageLive';

import { COUNTIN_EVENT, startCountIn, stopCountIn } from '@/lib/countIn';
import { PING_EVENT } from '@/lib/stageClick';
import { meterOf } from '@/lib/meter';

const SONGS = [
  { id: 'row-1', songId: 'song-1' },
  { id: 'row-2', songId: 'song-2' },
];
const phone = (isLeader: boolean) =>
  renderHook(() => useStageLive({ eventId: 'gig-1', setlistId: 'list-1', songs: SONGS, open: true, isLeader }));
const count = (now = Date.now()) => startCountIn({ from: 'x', songId: 'row-1', bpm: 96, meter: meterOf('6/8'), bars: 2, now });

beforeEach(() => {
  phones.length = 0;
});

describe('useStageLive: the count-in on every phone', () => {
  it("the leader's count reaches the band, as the leader's; Stop ends it everywhere", () => {
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.countIn.set({ ...count(), from: leader.result.current.clientId }));
    expect(leader.result.current.countIn.mine).toBe(true);
    expect(member.result.current.countIn.state).toMatchObject({ on: true, bpm: 96, time: '6/8', bars: 2, songId: 'row-1' });
    expect(member.result.current.countIn.mine).toBe(false);
    act(() => leader.result.current.countIn.set(stopCountIn(leader.result.current.countIn.state!)));
    expect(member.result.current.countIn.state?.on).toBe(false);
  });

  it('a count asks every phone for a fresh clock reading, quickly', async () => {
    const leader = phone(true);
    const member = phone(false);
    const pings: unknown[] = [];
    // Members ping on the clock topic (#283): listened to on the leader's clock channel.
    const lp = phones.find((p) => p.key === leader.result.current.clientId && p.topic !== stageTopic(leader.result.current.clientId))!;
    lp.handlers.push({ type: 'broadcast', event: PING_EVENT, cb: (m) => pings.push(m) });
    act(() => leader.result.current.countIn.set({ ...count(), from: leader.result.current.clientId }));
    expect(member.result.current.countIn.state?.on).toBe(true);
    // A burst of pings, ~110 ms apart, after #283's random start of up to
    // 500 ms (phones don't all ping at once): 1050 ms at most, inside the
    // 1.5 s before the first count. At the click's 200 ms gap only 4 would
    // be out by now in the worst case.
    await act(() => new Promise((r) => setTimeout(r, 1200)));
    expect(pings.length).toBeGreaterThanOrEqual(6);
    // And over Bluetooth: the faster of the two clocks counts (pickClock).
    expect(ble.burst).toHaveBeenCalled();
  });

  it('drops malformed counts and older ones; a late phone gets the running count', () => {
    const leader = phone(true);
    const member = phone(false);
    const c = { ...count(), from: leader.result.current.clientId };
    act(() => leader.result.current.countIn.set(c));
    act(() => bus.send(leader.result.current.clientId, stageTopic(leader.result.current.clientId), COUNTIN_EVENT, { ...c, seq: c.seq + 3, time: '4/3' }));
    act(() => bus.send(leader.result.current.clientId, stageTopic(leader.result.current.clientId), COUNTIN_EVENT, { ...c, seq: c.seq - 1, bpm: 200 }));
    expect(member.result.current.countIn.state).toMatchObject({ seq: c.seq, bpm: 96 });
    const late = phone(false);
    expect(late.result.current.countIn.state).toMatchObject({ on: true, seq: c.seq });
  });

  it('another song or closing the leader’s Stage stops it', () => {
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.countIn.set({ ...count(), from: leader.result.current.clientId }));
    act(() => leader.result.current.select(1));
    expect(member.result.current.countIn.state?.on).toBe(false);
    act(() => leader.result.current.countIn.set({ ...count(), songId: 'row-2', from: leader.result.current.clientId }));
    leader.unmount();
    expect(member.result.current.countIn.state?.on).toBe(false);
  });
});
