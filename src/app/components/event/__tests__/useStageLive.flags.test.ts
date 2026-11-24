import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * The count_in and follow_tempo kill switches (app_flags, docs/flags.md) in
 * useStageLive: off, nothing of the feature is sent, taken or kept, on either
 * path; switched off while it runs, the leader's phone says a normal Stop to
 * every phone and each phone forgets what it had. The stand-ins are those of
 * useStageLive.countInBle.test.ts (`net`: the channel; `air`: Bluetooth).
 * One process, so the switch flips on every phone at once; a phone whose
 * switch is read later than the leader's is the "raw" listener below.
 */
type Handler = { type: string; event: string; cb: (msg: unknown) => void };
const phones: { key: string; topic: string; stage: boolean; handlers: Handler[]; meta: unknown }[] = [];
let lastKey = '';
const net = vi.hoisted(() => ({ up: true }));
const presence = (p: { handlers: Handler[] }, event: string, msg: unknown) =>
  p.handlers.filter((h) => h.type === 'presence' && h.event === event).forEach((h) => h.cb(msg));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (topic: string, opts: { config: { presence?: { key: string } } }) => {
      if (opts.config.presence) lastKey = opts.config.presence.key;
      const phone = { key: lastKey, topic, stage: !!opts.config.presence, handlers: [] as Handler[], meta: null as unknown };
      phones.push(phone);
      const ch = {
        on(type: string, filter: { event: string }, cb: (msg: unknown) => void) {
          phone.handlers.push({ type, event: filter.event, cb });
          return ch;
        },
        subscribe(cb: (s: string) => void) {
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

import { useStageLive } from '../useStageLive';
import { __resetAppFlagsForTest, __setAppFlagsForTest, APP_FLAGS_STORAGE_KEY, isFlagOn, refreshAppFlags } from '@/lib/appFlags';
import { COUNTIN_EVENT, COUNTIN_LEAD_MS, parseCountInBle, startCountIn, type CountInState } from '@/lib/countIn';
import { PLAYHEAD_EVENT, startPlayhead, type PlayheadState } from '@/lib/playhead';
import { nowMs } from '@/lib/stageClick';
import { meterOf } from '@/lib/meter';

const SONGS = [
  { id: 'row-1', songId: 'song-1' },
  { id: 'row-2', songId: 'song-2' },
];
const phone = (isLeader: boolean) =>
  renderHook(() => useStageLive({ eventId: 'gig-1', setlistId: 'list-1', songs: SONGS, open: true, isLeader }));
type Phone = ReturnType<typeof phone>;
const id = (p: Phone) => p.result.current.clientId;
const count = (from: string) => startCountIn({ from, songId: 'row-1', bpm: 120, meter: meterOf('4/4'), now: nowMs() });
const head = (from: string) => startPlayhead({ from, songId: 'row-1', bpm: 120, startAt: nowMs() + 1500 });
const pass = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
/** A phone that only listens on the stage topic (its own switch not read yet): every payload of `event` it gets. */
const raw = (event: string) => {
  const got: unknown[] = [];
  const stage = phones.find((p) => p.stage)!;
  phones.push({ key: 'raw-phone', topic: stage.topic, stage: false, meta: null, handlers: [{ type: 'broadcast', event, cb: (m) => got.push((m as { payload: unknown }).payload) }] });
  return got;
};
/** The channel's copy of a state from another phone, handed to this one. */
const overChannel = (to: Phone, event: string, payload: unknown) =>
  phones.filter((p) => p.key === id(to) && p.stage).forEach((p) => p.handlers.filter((h) => h.type === 'broadcast' && h.event === event).forEach((h) => h.cb({ payload })));
const blePublished = (event: string) => air.published.filter(([e]) => e === event).map(([, p]) => p);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  vi.setSystemTime(new Date('2026-11-23T20:00:00Z'));
  localStorage.clear();
  __resetAppFlagsForTest(null);
  phones.length = 0;
  net.up = true;
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
  vi.useRealTimers();
  __resetAppFlagsForTest(null);
});

describe('count_in switched off', () => {
  it('the leader’s Count in does nothing: no count on its phone, none on the channel, none over Bluetooth', () => {
    act(() => __setAppFlagsForTest({ count_in: false }));
    const leader = phone(true);
    const member = phone(false);
    const heard = raw(COUNTIN_EVENT);
    act(() => leader.result.current.countIn.set(count(id(leader))));
    expect(leader.result.current.countIn.state).toBeNull();
    expect(member.result.current.countIn.state).toBeNull();
    expect(heard).toEqual([]);
    expect(blePublished('countin')).toEqual([]);
  });

  it('a leader whose switch is still on counts in: this phone shows nothing, from the channel or from Bluetooth', () => {
    act(() => __setAppFlagsForTest({ count_in: false }));
    const member = phone(false);
    setClock({ from: 'old-flag-leader', sample: { offset: 0, rtt: 0 } });
    const theirs = count('old-flag-leader');
    act(() => overChannel(member, COUNTIN_EVENT, theirs));
    expect(member.result.current.countIn.state).toBeNull();
    act(() => air.members.forEach((m) => deliver(m, 'countin', { from: theirs.from, songId: theirs.songId, q: theirs.seq, o: 1, b: 120, t: '4/4', a: theirs.startAt })));
    expect(member.result.current.countIn.state).toBeNull();
    // Back on: the same count (still running) read again shows.
    act(() => __setAppFlagsForTest({ count_in: true }));
    act(() => overChannel(member, COUNTIN_EVENT, theirs));
    expect(member.result.current.countIn.state).toMatchObject({ on: true, seq: theirs.seq });
  });

  it('switched off mid-count: the leader’s phone sends a normal Stop on both paths, and every phone forgets the count', () => {
    const leader = phone(true);
    const member = phone(false);
    setClock({ from: id(leader), sample: { offset: 0, rtt: 0 } });
    const heard = raw(COUNTIN_EVENT) as CountInState[];
    act(() => leader.result.current.countIn.set(count(id(leader))));
    const on = leader.result.current.countIn.state!;
    expect(member.result.current.countIn.state?.on).toBe(true);
    pass(COUNTIN_LEAD_MS + 600);
    act(() => __setAppFlagsForTest({ count_in: false }));
    // A phone that has not read the switch yet is told like by "Stop the count-in".
    expect(heard[heard.length - 1]).toMatchObject({ on: false, from: id(leader), songId: 'row-1' });
    expect(heard[heard.length - 1].seq).toBeGreaterThan(on.seq);
    const last = parseCountInBle(blePublished('countin').pop())!;
    expect(last).toMatchObject({ on: false, from: id(leader) });
    expect(last.seq).toBeGreaterThan(on.seq);
    // Nothing left on either phone: no countdown, no "counting" button waiting for anything.
    expect(leader.result.current.countIn.state).toBeNull();
    expect(member.result.current.countIn.state).toBeNull();
    // And nothing more goes out while off.
    const sent = heard.length;
    act(() => leader.result.current.countIn.set(count(id(leader))));
    expect(heard).toHaveLength(sent);
  });

  it('a member alone (the leader’s switch not read yet): the count it showed is gone, and the leader’s next copies are ignored', () => {
    const member = phone(false);
    const theirs = count('other-leader');
    act(() => overChannel(member, COUNTIN_EVENT, theirs));
    expect(member.result.current.countIn.state?.on).toBe(true);
    act(() => __setAppFlagsForTest({ count_in: false }));
    expect(member.result.current.countIn.state).toBeNull();
    act(() => overChannel(member, COUNTIN_EVENT, { ...theirs, seq: theirs.seq + 3 }));
    expect(member.result.current.countIn.state).toBeNull();
  });

  it('leaves Follow the tempo and the click alone', () => {
    act(() => __setAppFlagsForTest({ count_in: false }));
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.playhead.set(head(id(leader))));
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    expect(member.result.current.playhead.state?.on).toBe(true);
    expect(member.result.current.click.state?.on).toBe(true);
  });
});

describe('follow_tempo switched off', () => {
  it('the leader’s Start does nothing: no playhead on its phone, none on the channel, none over Bluetooth', () => {
    act(() => __setAppFlagsForTest({ follow_tempo: false }));
    const leader = phone(true);
    const member = phone(false);
    const heard = raw(PLAYHEAD_EVENT);
    act(() => leader.result.current.playhead.set(head(id(leader))));
    expect(leader.result.current.playhead.state).toBeNull();
    expect(member.result.current.playhead.state).toBeNull();
    expect(heard).toEqual([]);
    expect(blePublished('playhead')).toEqual([]);
  });

  it('a leader whose switch is still on starts: this phone follows nothing, from the channel or from Bluetooth', () => {
    act(() => __setAppFlagsForTest({ follow_tempo: false }));
    const member = phone(false);
    const theirs = head('old-flag-leader');
    act(() => overChannel(member, PLAYHEAD_EVENT, theirs));
    act(() => air.members.forEach((m) => deliver(m, 'playhead', theirs)));
    expect(member.result.current.playhead.state).toBeNull();
    act(() => __setAppFlagsForTest({ follow_tempo: true }));
    act(() => overChannel(member, PLAYHEAD_EVENT, theirs));
    expect(member.result.current.playhead.state).toMatchObject({ on: true, seq: theirs.seq });
  });

  it('switched off mid-song: the leader’s phone sends a normal Stop on both paths, and every phone stops following', () => {
    const leader = phone(true);
    const member = phone(false);
    const heard = raw(PLAYHEAD_EVENT) as PlayheadState[];
    act(() => leader.result.current.playhead.set(head(id(leader))));
    const on = leader.result.current.playhead.state!;
    expect(member.result.current.playhead.state?.on).toBe(true);
    pass(8000);
    act(() => __setAppFlagsForTest({ follow_tempo: false }));
    expect(heard[heard.length - 1]).toMatchObject({ on: false, from: id(leader), songId: 'row-1' });
    expect(heard[heard.length - 1].seq).toBeGreaterThan(on.seq);
    expect(blePublished('playhead').pop()).toMatchObject({ on: false, from: id(leader) });
    expect(leader.result.current.playhead.state).toBeNull();
    expect(member.result.current.playhead.state).toBeNull();
    const sent = heard.length;
    act(() => leader.result.current.playhead.set(head(id(leader))));
    expect(heard).toHaveLength(sent);
  });

  it('a member alone: what it followed is gone, and the leader’s next moves are ignored', () => {
    const member = phone(false);
    const theirs = head('other-leader');
    act(() => overChannel(member, PLAYHEAD_EVENT, theirs));
    expect(member.result.current.playhead.state?.on).toBe(true);
    act(() => __setAppFlagsForTest({ follow_tempo: false }));
    expect(member.result.current.playhead.state).toBeNull();
    act(() => overChannel(member, PLAYHEAD_EVENT, { ...theirs, seq: theirs.seq + 3, bar: 4 }));
    expect(member.result.current.playhead.state).toBeNull();
  });

  it('leaves the count-in and the click alone: the band is still counted in, only bar 1 is not followed', () => {
    act(() => __setAppFlagsForTest({ follow_tempo: false }));
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.countIn.set(count(id(leader))));
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    expect(member.result.current.countIn.state?.on).toBe(true);
    expect(member.result.current.click.state?.on).toBe(true);
  });
});

describe('the two switches with no answer from the server', () => {
  it('first run, no signal (nothing kept, the table can’t be read): both are on and work', async () => {
    const supabase = (await import('@/lib/supabase')).supabase as unknown as { from?: unknown };
    supabase.from = () => ({ select: async () => ({ data: null, error: { message: 'Failed to fetch' } }) });
    await act(async () => refreshAppFlags());
    expect(isFlagOn('count_in')).toBe(true);
    expect(isFlagOn('follow_tempo')).toBe(true);
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.countIn.set(count(id(leader))));
    act(() => leader.result.current.playhead.set(head(id(leader))));
    expect(member.result.current.countIn.state?.on).toBe(true);
    expect(member.result.current.playhead.state?.on).toBe(true);
  });

  it('no signal at the gig: the last answer kept on the phone holds (off stays off)', async () => {
    localStorage.setItem(
      APP_FLAGS_STORAGE_KEY,
      JSON.stringify({ flags: { count_in: { enabled: false, minAppVersion: null }, follow_tempo: { enabled: false, minAppVersion: null } }, version: null }),
    );
    __resetAppFlagsForTest();
    const supabase = (await import('@/lib/supabase')).supabase as unknown as { from?: unknown };
    supabase.from = () => ({ select: async () => ({ data: null, error: { message: 'Failed to fetch' } }) });
    await act(async () => refreshAppFlags());
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.countIn.set(count(id(leader))));
    act(() => leader.result.current.playhead.set(head(id(leader))));
    expect(leader.result.current.countIn.state).toBeNull();
    expect(member.result.current.countIn.state).toBeNull();
    expect(leader.result.current.playhead.state).toBeNull();
    expect(member.result.current.playhead.state).toBeNull();
  });
});
