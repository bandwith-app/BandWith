import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render, screen, fireEvent, cleanup } from '@testing-library/react';

/**
 * The count-in over Bluetooth, next to the Realtime channel (the stand-ins of
 * useStageLive.ble.test.ts). Every hook instance is a phone. `net.up` is the
 * internet (the Supabase channel); `air` is the Bluetooth link between the
 * leader's phone and the members': what the leader serves (`latest`), how
 * long a read takes (`delayMs`), whether the phone linked was checked as an
 * admin's (`signed`), and the leader's clock as measured over the link
 * (`clock`).
 *
 * One process, one clock: it stands for the MEMBER's clock. The leader's
 * clock runs `ahead` ms ahead of it, so the leader's `startAt` is made with
 * `nowMs() + ahead`, and a perfect measure of its clock is `offset: ahead`.
 * Time is faked (timers, Date and performance.now together): nothing here
 * depends on how fast the machine is.
 */
type Handler = { type: string; event: string; cb: (msg: unknown) => void };
const phones: { key: string; topic: string; stage: boolean; handlers: Handler[]; meta: unknown; status?: (s: string) => void }[] = [];
let lastKey = '';
const net = vi.hoisted(() => ({ up: true }));
const presence = (p: { handlers: Handler[] }, event: string, msg: unknown) =>
  p.handlers.filter((h) => h.type === 'presence' && h.event === event).forEach((h) => h.cb(msg));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (topic: string, opts: { config: { presence?: { key: string } } }) => {
      if (opts.config.presence) lastKey = opts.config.presence.key;
      const phone: (typeof phones)[number] = { key: lastKey, topic, stage: !!opts.config.presence, handlers: [] as Handler[], meta: null as unknown };
      phones.push(phone);
      const ch = {
        on(type: string, filter: { event: string }, cb: (msg: unknown) => void) {
          phone.handlers.push({ type, event: filter.event, cb });
          return ch;
        },
        subscribe(cb: (s: string) => void) {
          phone.status = cb;
          cb(net.up ? 'SUBSCRIBED' : 'CHANNEL_ERROR');
          return ch;
        },
        track: async (meta: unknown) => {
          if (!net.up || !phone.stage) return;
          phone.meta = meta;
          for (const p of phones) {
            if (p.key === phone.key || !p.meta || !p.stage) continue;
            presence(p, 'join', { key: phone.key, newPresences: [meta] });
            presence(phone, 'join', { key: p.key, newPresences: [p.meta] });
          }
        },
        send: async (m: { event: string; payload: unknown }) => {
          if (!net.up) return;
          for (const p of phones)
            if (p.key !== phone.key && p.topic === topic) p.handlers.filter((h) => h.type === 'broadcast' && h.event === m.event).forEach((h) => h.cb({ payload: m.payload }));
        },
        __phone: phone,
      };
      return ch;
    },
    removeChannel: async (ch: { __phone: (typeof phones)[number] }) => {
      const i = phones.findIndex((p) => p === ch.__phone);
      if (i >= 0) phones.splice(i, 1);
      if (net.up && ch.__phone.stage) for (const p of phones) if (p.stage) presence(p, 'leave', { key: ch.__phone.key });
    },
  },
}));

type OnLive = (event: string, payload: unknown, signed?: boolean) => void;
type OnState = (state: unknown, signed?: boolean) => void;
type Clock = { from: string; sample: { offset: number; rtt: number } } | null;
const air = vi.hoisted(() => ({
  linked: true,
  memberStatus: 'connected' as string,
  members: new Set<{ current: { live: OnLive; state: OnState } }>(),
  latest: new Map<string, unknown>(),
  /** Every payload the leader published, per event, in order. */
  published: [] as Array<[string, unknown]>,
  bursts: 0,
  /** A read of the live frame takes this long (0: at once). */
  delayMs: 0,
  /** The phone linked served a state with the admins' signature, checked. */
  signed: true,
  /** The leader's clock, measured over the link (null: not yet). */
  clock: null as Clock,
  clockListeners: new Set<() => void>(),
  off: false,
  switchOff: () => {},
}));
const setClock = (c: Clock) => {
  air.clock = c;
  air.clockListeners.forEach((l) => l());
};
/** What a read of the live frame brings a member: the count-in with the word on the link, the rest as before. */
const deliver = (m: { current: { live: OnLive } }, event: string, payload: unknown) =>
  event === 'countin' ? m.current.live(event, payload, air.signed) : m.current.live(event, payload);
vi.mock('../useStageBle', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    useStageBle: (o: { isLeader: boolean; onLive?: OnLive; onState?: OnState; farewell?: (why: 'closing' | 'off') => Record<string, unknown> }) => {
      const ref = React.useRef<{ live: OnLive; state: OnState }>({ live: () => {}, state: () => {} });
      ref.current = { live: o.onLive ?? (() => {}), state: o.onState ?? (() => {}) };
      const bye = React.useRef(o.farewell);
      bye.current = o.farewell;
      const clock = React.useSyncExternalStore(
        (l) => {
          air.clockListeners.add(l);
          return () => void air.clockListeners.delete(l);
        },
        () => air.clock,
      );
      React.useEffect(() => {
        if (o.isLeader) {
          const lastWords = (why: 'closing' | 'off') => {
            const last = bye.current?.(why) ?? {};
            for (const [e, p] of Object.entries(last)) {
              air.latest.set(e, p);
              air.published.push([e, p]);
              if (air.linked) air.members.forEach((m) => deliver(m, e, p));
            }
          };
          air.switchOff = () => {
            air.off = true;
            lastWords('off');
          };
          return () => {
            if (!air.off) lastWords('closing');
          };
        }
        air.members.add(ref);
        // Connecting reads the live characteristic: where the band is now.
        if (air.linked) air.latest.forEach((p, e) => deliver(ref, e, p));
        return () => void air.members.delete(ref);
      }, [o.isLeader]);
      const fns = React.useMemo(
        () => ({
          publish: () => {},
          publishLive: (event: string, payload: unknown) => {
            if (!o.isLeader || air.off) return;
            air.latest.set(event, payload);
            air.published.push([event, payload]);
            if (!air.linked) return;
            const go = () => air.members.forEach((m) => deliver(m, event, payload));
            if (air.delayMs > 0) setTimeout(go, air.delayMs);
            else go();
          },
          burst: () => void air.bursts++,
          fix: () => {},
          // Set at once, as the real hook's (states read right after a clock sample are judged with it).
          clockRef: {
            get current() {
              return air.clock;
            },
          },
        }),
        [o.isLeader],
      );
      return { ...fns, status: o.isLeader ? 'leading' : air.memberStatus, clock: o.isLeader ? null : clock, followers: 0 };
    },
  };
});
vi.mock('@/lib/services/songs', () => ({ saveSetlistOrder: async () => ({ error: null }) }));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: async () => {} }));
vi.mock('@/lib/haptics', () => ({ haptic: { tap: () => {}, medium: () => {}, selection: () => {} } }));
vi.mock('@/lib/liveAudio', async () => {
  const real = await vi.importActual<typeof import('@/lib/liveAudio')>('@/lib/liveAudio');
  return { ...real, unlockAudio: () => {} };
});

import { useStageLive, BLE_LEADER_GONE_MS } from '../useStageLive';
import { StageCountInOverlay, useCountInUi } from '@/app/components/dashboard/StageCountIn';
import { COUNTIN_EVENT, COUNTIN_LEAD_MS, GO_MS, countInAt, countInPlan, parseCountInBle, startCountIn, stopCountIn, type CountInState } from '@/lib/countIn';
import { nowMs } from '@/lib/stageClick';
import { nextSeq } from '@/lib/stageLive';
import { meterOf } from '@/lib/meter';

const SONGS = [
  { id: 'row-1', songId: 'song-1' },
  { id: 'row-2', songId: 'song-2' },
];
const phone = (isLeader: boolean) =>
  renderHook(() => useStageLive({ eventId: 'gig-1', setlistId: 'list-1', songs: SONGS, open: true, isLeader }));
type Phone = ReturnType<typeof phone>;
const id = (p: Phone) => p.result.current.clientId;
/** 4/4 at 120: 4 3 2 1 GO, half a second apart; the count starts 1.5 s after the tap. */
const tap = (leader: Phone, ahead = 0, songId = 'row-1') => ({
  ...startCountIn({ from: id(leader), songId, bpm: 120, meter: meterOf('4/4'), now: nowMs() + ahead }),
  // Its seq comes from the leader's clock too, like its start.
  seq: nextSeq(leader.result.current.countIn.state?.seq, Date.now() + ahead),
});
const start = (leader: Phone, ahead = 0, songId = 'row-1') => {
  const c = tap(leader, ahead, songId);
  act(() => leader.result.current.countIn.set(c));
  return leader.result.current.countIn.state!;
};
/** A perfect measure of the leader's clock, `ahead` ms ahead of this phone's. */
const measured = (leader: Phone, ahead = 0, error = 0, rtt = 0) => ({ from: id(leader), sample: { offset: ahead + error, rtt } });
const countIns = () => air.published.filter(([e]) => e === 'countin').map(([, p]) => parseCountInBle(p)!);
/** The count showing on a phone right now (its label), or null: what the overlay draws from the same state and offset. */
const showing = (p: Phone): string | null => {
  const { state, offset } = p.result.current.countIn;
  if (!state?.on) return null;
  const plan = countInPlan(state);
  const pos = countInAt(plan, state, nowMs(), offset);
  return pos.stage === 'done' ? null : pos.stage === 'before' ? 'ready' : plan.events[pos.event].label;
};
/** The channel's copy of a state, handed to one phone (as Realtime would). */
const overChannel = (to: Phone, state: CountInState) =>
  phones.filter((p) => p.key === id(to) && p.stage).forEach((p) => p.handlers.filter((h) => h.type === 'broadcast' && h.event === COUNTIN_EVENT).forEach((h) => h.cb({ payload: state })));
const pass = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
/** The start travels to a tenth of a millisecond: at most half of that off (plus what a double can't hold). */
const WIRE_MS = 0.051;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  vi.setSystemTime(new Date('2026-11-23T20:00:00Z'));
  phones.length = 0;
  net.up = false;
  air.linked = true;
  air.memberStatus = 'connected';
  air.members.clear();
  air.latest.clear();
  air.published = [];
  air.bursts = 0;
  air.delayMs = 0;
  air.signed = true;
  air.clock = null;
  air.clockListeners.clear();
  air.off = false;
  air.switchOff = () => {};
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('count-in over Bluetooth: the leader sends', () => {
  it('no internet: the start and the Stop reach the member, one message each, in the short form', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    const on = start(leader);
    expect(countIns()).toHaveLength(1);
    expect(countIns()[0]).toMatchObject({ seq: on.seq, on: true, from: id(leader), songId: 'row-1', bpm: 120, time: '4/4' });
    // The short form (stageBleSync's frame is one 512-byte value).
    expect(air.published[0][1]).toHaveProperty('q', on.seq);
    expect(member.result.current.countIn.state).toMatchObject({ on: true, seq: on.seq, songId: 'row-1', bpm: 120, time: '4/4', bars: 1, style: 'down' });
    expect(member.result.current.countIn.mine).toBe(false);
    expect(leader.result.current.countIn.mine).toBe(true);
    // Nothing more while it counts: no periodic copy.
    pass(1800);
    expect(countIns()).toHaveLength(1);
    expect(showing(member)).toBe('4');
    act(() => leader.result.current.countIn.set(stopCountIn(leader.result.current.countIn.state!)));
    expect(countIns()).toHaveLength(2);
    expect(countIns()[1]).toMatchObject({ on: false });
    expect(member.result.current.countIn.state?.on).toBe(false);
    expect(showing(member)).toBeNull();
  });

  it('"Count in anyway" (a song with a backing track) travels the same way', () => {
    const song = { id: 'row-1', title: 'Crazy in Love', bpm: 100, backingTrack: true };
    const leader = renderHook(() => {
      const live = useStageLive({ eventId: 'gig-1', setlistId: 'list-1', songs: SONGS, open: true, isLeader: true });
      const ui = useCountInUi({ countIn: live.countIn, playhead: live.playhead, song, isLeader: true, style: 'down' });
      return { ...live, ui };
    });
    const member = phone(false);
    setClock({ from: leader.result.current.clientId, sample: { offset: 0, rtt: 0 } });
    // No Count in button on this song; the sheet's "Count in anyway" is `start`.
    expect(leader.result.current.ui.available).toBe(false);
    expect(leader.result.current.ui.forceable).toBe(true);
    act(() => leader.result.current.ui.start());
    expect(countIns()).toHaveLength(1);
    expect(member.result.current.countIn.state).toMatchObject({ on: true, bpm: 100, songId: 'row-1' });
    // Bar 1 of the song (Follow the tempo) comes with it, where the count ends.
    const count = member.result.current.countIn.state!;
    expect(member.result.current.playhead.state).toMatchObject({ on: true, songId: 'row-1' });
    expect(member.result.current.playhead.state!.startAt).toBeCloseTo(count.startAt + countInPlan(count).endAt, 3);
    act(() => leader.result.current.ui.stop());
    expect(member.result.current.countIn.state?.on).toBe(false);
  });

  it('moving to another song, or closing Stage, stops a count still running over Bluetooth too', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    start(leader);
    act(() => leader.result.current.select(1));
    expect(member.result.current.countIn.state?.on).toBe(false);
    start(leader, 0, 'row-2');
    expect(member.result.current.countIn.state?.on).toBe(true);
    leader.unmount();
    expect(member.result.current.countIn.state?.on).toBe(false);
  });

  it('a Stop that arrives before the count could be shown (no clock yet): the count never shows', () => {
    const leader = phone(true);
    const member = phone(false);
    start(leader, 900);
    expect(member.result.current.countIn.state).toBeNull();
    act(() => leader.result.current.countIn.set(stopCountIn(leader.result.current.countIn.state!)));
    act(() => setClock(measured(leader, 900)));
    expect(member.result.current.countIn.state?.on ?? false).toBe(false);
    expect(showing(member)).toBeNull();
    // The frame read again: the Stop is what it says.
    act(() => air.members.forEach((m) => deliver(m, 'countin', air.latest.get('countin'))));
    expect(showing(member)).toBeNull();
  });

  it('a member’s own count stays on its phone', () => {
    phone(true);
    const member = phone(false);
    act(() => member.result.current.countIn.set(startCountIn({ from: id(member), songId: 'row-1', bpm: 120, meter: meterOf('4/4'), now: nowMs() })));
    expect(member.result.current.countIn.mine).toBe(true);
    expect(countIns()).toHaveLength(0);
  });
});

describe('count-in over Bluetooth: every phone on the same beat', () => {
  // Leader's clock behind, ahead, minutes off; the message at once, late, and almost too late.
  for (const ahead of [-90_000, -1234.5, 0, 3200.25, 240_000])
    for (const delayMs of [0, 180, 1400]) {
      it(`leader's clock ${ahead} ms ahead, the read ${delayMs} ms late: the same count at the same moment`, () => {
        const leader = phone(true);
        const member = phone(false);
        setClock(measured(leader, ahead));
        air.delayMs = delayMs;
        const on = start(leader, ahead);
        pass(delayMs);
        const got = member.result.current.countIn.state!;
        expect(got).toMatchObject({ on: true, seq: on.seq });
        expect(member.result.current.countIn.offset).toBe(ahead);
        const plan = countInPlan(got);
        // When each count falls, on this (the member's) clock: the leader's own moments, to the wire's 0.05 ms.
        for (const e of plan.events) {
          const mine = got.startAt + e.at - member.result.current.countIn.offset;
          const theirs = on.startAt + e.at - ahead;
          expect(Math.abs(mine - theirs)).toBeLessThanOrEqual(WIRE_MS);
        }
        // And through the count: the two phones show the same number at every moment.
        pass(COUNTIN_LEAD_MS - delayMs + 1);
        for (const label of ['4', '3', '2', '1', 'GO']) {
          expect(showing(member)).toBe(label);
          expect(countInAt(countInPlan(on), on, nowMs() + ahead).stage).not.toBe('done');
          expect(countInPlan(on).events[countInAt(countInPlan(on), on, nowMs() + ahead).event].label).toBe(label);
          pass(500);
        }
        // GO stays GO_MS on screen, then the count is over on both.
        pass(GO_MS - 500);
        expect(showing(member)).toBeNull();
        expect(countInAt(countInPlan(on), on, nowMs() + ahead).stage).toBe('done');
      });
    }

  it("a clock measured a little off puts the count off by exactly that, never more (half the read's round trip at most)", () => {
    const leader = phone(true);
    const member = phone(false);
    // A 30 ms round trip, all of it on the way there: the worst a read can do, 15 ms.
    setClock(measured(leader, 5000, 15, 30));
    const on = start(leader, 5000);
    const got = member.result.current.countIn;
    for (const e of countInPlan(on).events) {
      const mine = got.state!.startAt + e.at - got.offset;
      const theirs = on.startAt + e.at - 5000;
      expect(Math.abs(mine - theirs)).toBeGreaterThan(15 - WIRE_MS);
      expect(Math.abs(mine - theirs)).toBeLessThanOrEqual(15 + WIRE_MS);
    }
  });

  it('no measure of the leader’s clock yet: nothing shows (never on this phone’s own clock); measured, the count is where the band is', () => {
    const leader = phone(true);
    const member = phone(false);
    const before = air.bursts;
    start(leader, 7000);
    expect(member.result.current.countIn.state).toBeNull();
    // A measure is asked for at once.
    expect(air.bursts).toBeGreaterThan(before);
    pass(COUNTIN_LEAD_MS + 600);
    expect(member.result.current.countIn.state).toBeNull();
    act(() => setClock(measured(leader, 7000)));
    expect(member.result.current.countIn.state?.on).toBe(true);
    expect(showing(member)).toBe('3');
  });
});

describe('count-in over Bluetooth: a phone that connects late', () => {
  it('in the middle of the count: the remaining beats, on the beat, never the whole count again', () => {
    const leader = phone(true);
    start(leader, -4000);
    // The band is on "2" (the third count).
    pass(COUNTIN_LEAD_MS + 1100);
    const late = phone(false);
    // Linked, the frame read, the clock not measured yet: nothing.
    expect(late.result.current.countIn.state).toBeNull();
    pass(120);
    act(() => setClock(measured(leader, -4000)));
    expect(showing(late)).toBe('2');
    pass(300);
    expect(showing(late)).toBe('1');
    pass(500);
    expect(showing(late)).toBe('GO');
    pass(GO_MS);
    expect(showing(late)).toBeNull();
  });

  it('after it played out: nothing, however long the leader keeps serving it', () => {
    const leader = phone(true);
    start(leader, 2500);
    pass(COUNTIN_LEAD_MS + 2000 + GO_MS);
    const late = phone(false);
    act(() => setClock(measured(leader, 2500)));
    expect(late.result.current.countIn.state).toBeNull();
    // Read again an hour into the gig (a reconnect): still nothing.
    pass(3_600_000);
    act(() => air.latest.forEach((p, e) => air.members.forEach((m) => deliver(m, e, p))));
    expect(late.result.current.countIn.state).toBeNull();
  });

  it('a phone whose clock is far behind does not start an old count from the top', () => {
    const leader = phone(true);
    // The leader's clock is 3 s ahead: on this phone's own clock the count "hasn't started".
    start(leader, 3000);
    pass(COUNTIN_LEAD_MS + 2000 + GO_MS + 10);
    const late = phone(false);
    expect(late.result.current.countIn.state).toBeNull();
    expect(showing(late)).toBeNull();
    act(() => setClock(measured(leader, 3000)));
    expect(showing(late)).toBeNull();
  });
});

describe('count-in over Bluetooth: only the leader followed, only now, only this song', () => {
  it('from a phone not checked as an admin’s: no count, and its Stop stops nothing', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    air.signed = false;
    const fake = start(leader);
    expect(member.result.current.countIn.state).toBeNull();
    // A real count, then a "Stop" from an unchecked phone.
    air.signed = true;
    act(() => air.members.forEach((m) => deliver(m, 'countin', air.latest.get('countin'))));
    expect(member.result.current.countIn.state).toMatchObject({ on: true, seq: fake.seq });
    air.signed = false;
    act(() => air.members.forEach((m) => deliver(m, 'countin', { ...(air.latest.get('countin') as object), o: 0, q: fake.seq + 5 })));
    expect(member.result.current.countIn.state?.on).toBe(true);
  });

  it('a payload that does not check out is ignored', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    for (const bad of [{ nope: true }, { q: 5, from: id(leader), o: 1, b: -3, t: '4/4', a: nowMs() }, null, 'countin'])
      act(() => air.members.forEach((m) => deliver(m, 'countin', bad)));
    expect(member.result.current.countIn.state).toBeNull();
  });

  it('a start later than a tap can put it is not shown', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    act(() => leader.result.current.countIn.set({ ...tap(leader), startAt: nowMs() + 60_000 }));
    expect(member.result.current.countIn.state).toBeNull();
  });

  it('a count for another song than the one that leader is on waits for the leader’s move, and shows with it', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    const lead = (songId: string, seq: number) =>
      act(() => air.members.forEach((m) => m.current.state({ seq, from: id(leader), songId, order: null }, true)));
    const seq = Math.floor((Date.now() - Date.UTC(2024, 0, 1)) / 100);
    lead('row-2', seq);
    // The count names row-1: a leftover, or the move to row-1 still on its way.
    start(leader, 0, 'row-1');
    expect(member.result.current.countIn.state).toBeNull();
    pass(200);
    lead('row-1', seq + 1);
    expect(member.result.current.countIn.state).toMatchObject({ on: true, songId: 'row-1' });
    expect(showing(member)).toBe('ready');
  });

  it('that move never comes: the count never shows', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    act(() => air.members.forEach((m) => m.current.state({ seq: Math.floor((Date.now() - Date.UTC(2024, 0, 1)) / 100), from: id(leader), songId: 'row-2', order: null }, true)));
    start(leader, 0, 'row-1');
    pass(10_000);
    act(() => setClock(measured(leader, 0, 1, 2)));
    expect(member.result.current.countIn.state).toBeNull();
  });
});

describe('count-in: internet and Bluetooth together', () => {
  beforeEach(() => {
    net.up = true;
  });

  it('the count arrives both ways: shown once, the same one, not started again', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    start(leader);
    const shown = member.result.current.countIn.state!;
    expect(shown.on).toBe(true);
    const bursts = air.bursts;
    // The Bluetooth copy again (a reconnect reads the frame), mid-count.
    pass(COUNTIN_LEAD_MS + 700);
    act(() => air.members.forEach((m) => deliver(m, 'countin', air.latest.get('countin'))));
    // The very same state: the countdown on screen (keyed by it) is not restarted, "Hide on this phone" stays.
    expect(member.result.current.countIn.state).toBe(shown);
    expect(air.bursts).toBe(bursts);
    expect(showing(member)).toBe('3');
  });

  it('Bluetooth first, the channel after: still one count', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    // The channel is slow: only Bluetooth brings it.
    net.up = false;
    const on = start(leader);
    net.up = true;
    const shown = member.result.current.countIn.state!;
    expect(shown).toMatchObject({ on: true, seq: on.seq });
    pass(400);
    act(() => overChannel(member, on));
    expect(member.result.current.countIn.state).toBe(shown);
  });

  it('held for a clock over Bluetooth, the channel’s copy shows it at once; the clock arriving later starts nothing again', () => {
    const leader = phone(true);
    const member = phone(false);
    // No Bluetooth clock yet.
    const on = start(leader);
    const shown = member.result.current.countIn.state!;
    expect(shown).toMatchObject({ on: true, seq: on.seq });
    pass(300);
    act(() => setClock(measured(leader)));
    expect(member.result.current.countIn.state).toBe(shown);
  });

  it('stopped on the channel, an old "on" turning up late over Bluetooth never brings it back', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    start(leader);
    const old = air.latest.get('countin');
    air.linked = false;
    act(() => leader.result.current.countIn.set(stopCountIn(leader.result.current.countIn.state!)));
    expect(member.result.current.countIn.state?.on).toBe(false);
    act(() => air.members.forEach((m) => deliver(m, 'countin', old)));
    expect(member.result.current.countIn.state?.on).toBe(false);
  });

  it('Bluetooth for the click switched off mid-count (ble_live): a phone online keeps the very count it had (a countdown it hid stays hidden)', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    start(leader);
    const shown = member.result.current.countIn.state!;
    const led = leader.result.current.countIn.state!;
    pass(COUNTIN_LEAD_MS + 600);
    act(() => air.switchOff());
    // Told "stopped" over Bluetooth: the channel's count is the channel's. Not sent again either: the same state, the same seq.
    expect(member.result.current.countIn.state).toBe(shown);
    expect(leader.result.current.countIn.state).toBe(led);
    expect(showing(member)).toBe('3');
    // The leader's own Stop still ends it, on the channel.
    act(() => leader.result.current.countIn.set(stopCountIn(leader.result.current.countIn.state!)));
    expect(member.result.current.countIn.state?.on).toBe(false);
  });
});

describe('count-in over Bluetooth: the leader goes away', () => {
  it('out of reach mid-count: the count runs out on its own (never frozen), then is forgotten', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader, 800));
    start(leader, 800);
    pass(COUNTIN_LEAD_MS + 600);
    expect(showing(member)).toBe('3');
    // The leader walks out of reach.
    air.memberStatus = 'searching';
    air.linked = false;
    member.rerender();
    pass(500);
    expect(showing(member)).toBe('2');
    pass(1000 + GO_MS);
    expect(showing(member)).toBeNull();
    pass(BLE_LEADER_GONE_MS);
    expect(member.result.current.countIn.state).toBeNull();
    // Back in reach, the frame still says "counting": it is long over.
    air.memberStatus = 'connected';
    air.linked = true;
    member.rerender();
    act(() => air.members.forEach((m) => deliver(m, 'countin', air.latest.get('countin'))));
    expect(member.result.current.countIn.state).toBeNull();
  });

  it('a long count (two slow bars) with the leader gone for good: off the screen after the grace period', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    act(() => leader.result.current.countIn.set(startCountIn({ from: id(leader), songId: 'row-1', bpm: 40, meter: meterOf('4/4'), bars: 2, now: nowMs() })));
    pass(COUNTIN_LEAD_MS + 100);
    expect(showing(member)).toBe('2');
    air.memberStatus = 'searching';
    member.rerender();
    pass(BLE_LEADER_GONE_MS + 100);
    expect(member.result.current.countIn.state).toBeNull();
  });

  it('Bluetooth for the click switched off mid-count (ble_live), no internet: the member is told it stopped; the leader keeps its own', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    start(leader);
    pass(COUNTIN_LEAD_MS + 600);
    act(() => air.switchOff());
    expect(member.result.current.countIn.state?.on).toBe(false);
    expect(leader.result.current.countIn.state?.on).toBe(true);
  });

  it('an old leader (no count-in in its frame): a member on this app shows no count offline, as today', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    // What 1.0.14 serves: the click, nothing else.
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    expect(member.result.current.click.state?.on).toBe(true);
    expect(member.result.current.countIn.state).toBeNull();
  });
});

describe('count-in over Bluetooth: "Hide on this phone" keeps working', () => {
  /** The countdown as Stage mode draws it for a member: one overlay per count (keyed by its seq). */
  const MemberStage: React.FC = () => {
    const live = useStageLive({ eventId: 'gig-1', setlistId: 'list-1', songs: SONGS, open: true, isLeader: false });
    const c = live.countIn;
    return c.state?.on
      ? React.createElement(StageCountInOverlay, { key: c.state.seq, state: c.state, offset: c.offset, accent: '#fff', canStop: c.mine, onStop: () => {} })
      : null;
  };
  const frame = () => act(() => void vi.advanceTimersByTime(20));

  it('hidden by the member, the same count read again over Bluetooth (or arriving on the channel) stays hidden; the next count shows', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    vi.setSystemTime(new Date('2026-11-23T20:00:00Z'));
    const leader = phone(true);
    render(React.createElement(MemberStage));
    act(() => setClock(measured(leader, 1500)));
    const on = start(leader, 1500);
    frame();
    expect(screen.getByRole('dialog', { name: 'Count-in' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide on this phone' }));
    expect(screen.queryByRole('dialog', { name: 'Count-in' })).toBeNull();
    // The frame read again (the link dropped and came back), and the channel's copy turning up late.
    pass(COUNTIN_LEAD_MS + 300);
    act(() => air.members.forEach((m) => deliver(m, 'countin', air.latest.get('countin'))));
    act(() => phones.filter((p) => p.stage).forEach((p) => p.handlers.filter((h) => h.type === 'broadcast' && h.event === COUNTIN_EVENT).forEach((h) => h.cb({ payload: on }))));
    frame();
    expect(screen.queryByRole('dialog', { name: 'Count-in' })).toBeNull();
    // Hidden for that count only: the next one is on screen again.
    pass(4000);
    start(leader, 1500);
    frame();
    expect(screen.getByRole('dialog', { name: 'Count-in' })).toBeTruthy();
  });
});

describe('count-in over Bluetooth: what a phone with the band key cannot do', () => {
  /** A count-in frame as a phone on the link could make it (the band key is every member's). */
  const forged = (from: string, seq: number, over: Record<string, unknown> = {}) => ({ from, songId: 'row-1', q: seq, o: 1, b: 120, t: '4/4', a: nowMs() + 1500, ...over });
  const overBle = (payload: unknown) => act(() => air.members.forEach((m) => deliver(m, 'countin', payload)));
  const dropChannel = (p: Phone) => act(() => phones.filter((x) => x.key === id(p)).forEach((x) => x.status?.('CHANNEL_ERROR')));

  it('a Stop over Bluetooth during a count the channel brought (this phone online) stops nothing', () => {
    net.up = true;
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    const on = start(leader);
    const shown = member.result.current.countIn.state!;
    pass(COUNTIN_LEAD_MS + 600);
    overBle(forged(id(leader), on.seq + 1, { o: 0, a: on.startAt }));
    expect(member.result.current.countIn.state).toBe(shown);
    expect(showing(member)).toBe('3');
  });

  it('nor does another start over Bluetooth take its place while it counts', () => {
    net.up = true;
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    const on = start(leader);
    const shown = member.result.current.countIn.state!;
    pass(COUNTIN_LEAD_MS + 600);
    overBle(forged(id(leader), on.seq + 2, { b: 60 }));
    expect(member.result.current.countIn.state).toBe(shown);
    // Once that count has played out, the leader's next one over Bluetooth is taken (its phone may be offline by then).
    pass(4000);
    overBle(forged(id(leader), on.seq + 80, { b: 60 }));
    expect(member.result.current.countIn.state).toMatchObject({ on: true, bpm: 60 });
  });

  it('off the channel: a Stop only ends a count this same link served', () => {
    net.up = true;
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    // The channel brought it; the phone linked over Bluetooth never served it.
    air.linked = false;
    const on = start(leader);
    air.linked = true;
    dropChannel(member);
    overBle(forged(id(leader), on.seq + 1, { o: 0, a: on.startAt }));
    expect(member.result.current.countIn.state?.on).toBe(true);
    // Served by the link too (the leader's own phone): now its Stop counts, the band having lost the internet mid-count.
    overBle(air.latest.get('countin'));
    expect(member.result.current.countIn.state?.on).toBe(true);
    overBle(forged(id(leader), on.seq + 1, { o: 0, a: on.startAt }));
    expect(member.result.current.countIn.state?.on).toBe(false);
  });

  it('a Stop in another leader’s name ends nothing', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    const on = start(leader);
    overBle(forged('someone-else', on.seq + 1, { o: 0 }));
    expect(member.result.current.countIn.state?.on).toBe(true);
  });

  it('a Stop with nothing counting is not kept: it cannot stand in the way of the next real count', () => {
    net.up = true;
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    const ahead = Math.floor((Date.now() - Date.UTC(2024, 0, 1)) / 100) + 200;
    overBle(forged(id(leader), ahead, { o: 0 }));
    expect(member.result.current.countIn.state).toBeNull();
    // The leader's count, a moment later, with its real (lower) seq.
    const on = start(leader);
    expect(on.seq).toBeLessThan(ahead);
    expect(member.result.current.countIn.state).toMatchObject({ on: true, seq: on.seq });
  });

  it('a seq no clock of that leader could have made (it would beat every count that follows) is dropped', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock(measured(leader));
    overBle(forged(id(leader), 0xffffffff));
    expect(member.result.current.countIn.state).toBeNull();
    overBle(forged(id(leader), Math.floor((Date.now() - Date.UTC(2024, 0, 1)) / 100) + 301));
    expect(member.result.current.countIn.state).toBeNull();
    const on = start(leader);
    expect(member.result.current.countIn.state).toMatchObject({ on: true, seq: on.seq });
  });
});
