import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Click and playhead over Bluetooth, next to the Realtime channel. Every hook
 * instance is a phone. `net.up` is the internet (the Supabase channel); `air`
 * is the Bluetooth link between the leader's phone and the members'.
 */
type Handler = { type: string; event: string; cb: (msg: unknown) => void };
const phones: { key: string; handlers: Handler[]; meta: unknown }[] = [];
const net = vi.hoisted(() => ({ up: true }));
const presence = (p: { handlers: Handler[] }, event: string, msg: unknown) =>
  p.handlers.filter((h) => h.type === 'presence' && h.event === event).forEach((h) => h.cb(msg));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (_topic: string, opts: { config: { presence: { key: string } } }) => {
      const phone = { key: opts.config.presence.key, handlers: [] as Handler[], meta: null as unknown };
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
          if (!net.up) return;
          phone.meta = meta;
          // Like Supabase: the others hear of me, and I hear of who is already there.
          for (const p of phones) {
            if (p.key === phone.key || !p.meta) continue;
            presence(p, 'join', { key: phone.key, newPresences: [meta] });
            presence(phone, 'join', { key: p.key, newPresences: [p.meta] });
          }
        },
        send: async (m: { event: string; payload: unknown }) => {
          if (!net.up) return;
          for (const p of phones)
            if (p.key !== phone.key) p.handlers.filter((h) => h.type === 'broadcast' && h.event === m.event).forEach((h) => h.cb({ payload: m.payload }));
        },
        __phone: phone,
      };
      return ch;
    },
    removeChannel: async (ch: { __phone: { key: string } }) => {
      const i = phones.findIndex((p) => p.key === ch.__phone.key);
      if (i >= 0) phones.splice(i, 1);
      if (net.up) for (const p of phones) presence(p, 'leave', { key: ch.__phone.key });
    },
  },
}));

type OnLive = (event: string, payload: unknown) => void;
const air = vi.hoisted(() => ({
  linked: true,
  memberStatus: 'connected' as string,
  members: new Set<{ current: OnLive }>(),
  latest: new Map<string, unknown>(),
  bursts: 0,
}));
vi.mock('../useStageBle', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    useStageBle: (o: { isLeader: boolean; onLive?: OnLive; farewell?: () => Record<string, unknown> }) => {
      const ref = React.useRef<OnLive>(() => {});
      ref.current = o.onLive ?? (() => {});
      const bye = React.useRef(o.farewell);
      bye.current = o.farewell;
      React.useEffect(() => {
        if (o.isLeader) {
          // Stopping Bluetooth sends the leader's last words first (useStageBle).
          return () => {
            const last = bye.current?.() ?? {};
            for (const [e, p] of Object.entries(last)) {
              air.latest.set(e, p);
              if (air.linked) air.members.forEach((m) => m.current(e, p));
            }
          };
        }
        air.members.add(ref);
        // Connecting reads the live characteristic: where the band is now.
        if (air.linked) air.latest.forEach((p, e) => ref.current(e, p));
        return () => void air.members.delete(ref);
      }, [o.isLeader]);
      // Stable functions, like the real hook's.
      const fns = React.useMemo(
        () => ({
          publish: () => {},
          publishLive: (event: string, payload: unknown) => {
            if (!o.isLeader) return;
            air.latest.set(event, payload);
            if (air.linked) air.members.forEach((m) => m.current(event, payload));
          },
          burst: () => void air.bursts++,
          fix: () => {},
        }),
        [o.isLeader],
      );
      return { ...fns, status: o.isLeader ? 'leading' : air.memberStatus, clock: null, followers: 0 };
    },
  };
});
vi.mock('@/lib/services/songs', () => ({ saveSetlistOrder: async () => ({ error: null }) }));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: async () => {} }));

import { useStageLive } from '../useStageLive';
import { startPlayhead, holdSection, buildTimeline, stopPlayhead } from '@/lib/playhead';
import { BLE_LEADER_GONE_MS } from '../useStageLive';

const SONGS = [
  { id: 'row-1', songId: 'song-1' },
  { id: 'row-2', songId: 'song-2' },
];
const phone = (isLeader: boolean) =>
  renderHook(() => useStageLive({ eventId: 'gig-1', setlistId: 'list-1', songs: SONGS, open: true, isLeader }));
const tl = buildTimeline({ chart: { v: 1, source: 'ireal', title: 'x', time: '4/4', sections: [{ label: 'A', bars: [{ chords: ['C'] }, { chords: ['G'] }] }] } })!;
const four = { bpm: 120, beats: 4 };

beforeEach(() => {
  phones.length = 0;
  net.up = true;
  air.linked = true;
  air.memberStatus = 'connected';
  air.members.clear();
  air.latest.clear();
  air.bursts = 0;
});
afterEach(() => vi.useRealTimers());

describe('useStageLive: click and playhead over Bluetooth', () => {
  it('no internet: the click and every playhead move reach the member over Bluetooth', () => {
    net.up = false;
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.click.setOn(true, { ...four, groups: null }));
    expect(member.result.current.click.state).toMatchObject({ on: true, bpm: 120, beats: 4 });
    // A fresh clock measure over the link when the click starts.
    expect(air.bursts).toBeGreaterThan(0);

    const start = startPlayhead({ from: 'x', songId: 'row-1', bpm: 120, startAt: Date.now() + 1500 });
    act(() => leader.result.current.playhead.set(start));
    expect(member.result.current.playhead.state).toMatchObject({ on: true, bar: 0, songId: 'row-1' });
    act(() => leader.result.current.playhead.set(holdSection(leader.result.current.playhead.state!, Date.now() + 2000, tl)));
    expect(member.result.current.playhead.state?.hold).toEqual([0, 1]);
    act(() => leader.result.current.playhead.set(stopPlayhead(leader.result.current.playhead.state!)));
    expect(member.result.current.playhead.state?.on).toBe(false);
    act(() => leader.result.current.click.setOn(false));
    expect(member.result.current.click.state?.on).toBe(false);
  });

  it('compound meters keep their groups over Bluetooth (6/8)', () => {
    net.up = false;
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.click.setOn(true, { bpm: 180, beats: 6, groups: [3, 3] }));
    expect(member.result.current.click.state).toMatchObject({ bpm: 180, beats: 6, groups: [3, 3] });
  });

  it('both paths up: a state that arrives twice is applied once, and a late old copy never wins', () => {
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.click.setOn(true, four));
    const on = member.result.current.click.state!;
    const burstsAfterStart = air.bursts;
    // The same state again over Bluetooth (it arrived over Realtime first): nothing new.
    act(() => air.members.forEach((m) => m.current('click', on)));
    expect(member.result.current.click.state).toBe(on);
    expect(air.bursts).toBe(burstsAfterStart);
    // Stopped over Realtime, then the old "on" turns up late over Bluetooth.
    air.linked = false;
    act(() => leader.result.current.click.setOn(false));
    act(() => air.members.forEach((m) => m.current('click', on)));
    expect(member.result.current.click.state?.on).toBe(false);
  });

  it('a phone that connects mid-song lands on the running click and playhead', () => {
    net.up = false;
    const leader = phone(true);
    const startAt = Date.now() - 20_000;
    act(() => leader.result.current.click.setOn(true, { ...four, startAt }));
    act(() => leader.result.current.playhead.set(startPlayhead({ from: 'x', songId: 'row-1', bpm: 120, startAt })));
    const late = phone(false);
    expect(late.result.current.click.state).toMatchObject({ on: true, startAt });
    expect(late.result.current.playhead.state).toMatchObject({ on: true, startAt });
  });

  it("a payload that doesn't check out is ignored", () => {
    net.up = false;
    phone(true);
    const member = phone(false);
    act(() => air.members.forEach((m) => m.current('click', { seq: 1, from: 'x', on: true, bpm: -3 })));
    act(() => air.members.forEach((m) => m.current('playhead', { nope: true })));
    expect(member.result.current.click.state).toBeNull();
    expect(member.result.current.playhead.state).toBeNull();
  });

  it('no internet and the leader out of reach for a while: its click and playhead stop; a short dropout keeps the beat', () => {
    vi.useFakeTimers();
    net.up = false;
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.click.setOn(true, four));
    act(() => leader.result.current.playhead.set(startPlayhead({ from: 'x', songId: 'row-1', bpm: 120, startAt: Date.now() })));
    // A short dropout: back before the grace period ends.
    air.memberStatus = 'searching';
    member.rerender();
    act(() => vi.advanceTimersByTime(BLE_LEADER_GONE_MS - 1000));
    air.memberStatus = 'connected';
    member.rerender();
    act(() => vi.advanceTimersByTime(BLE_LEADER_GONE_MS));
    expect(member.result.current.click.state?.on).toBe(true);
    // Gone for good (the leader closed Stage out of reach).
    air.memberStatus = 'searching';
    member.rerender();
    act(() => vi.advanceTimersByTime(BLE_LEADER_GONE_MS + 100));
    expect(member.result.current.click.state).toBeNull();
    expect(member.result.current.playhead.state).toBeNull();
    // The leader back in reach (the link reads where it is): straight back on the beat.
    air.memberStatus = 'connected';
    member.rerender();
    act(() => air.latest.forEach((p, e) => air.members.forEach((m) => m.current(e, p))));
    expect(member.result.current.click.state?.on).toBe(true);
    expect(member.result.current.playhead.state?.on).toBe(true);
  });

  it('closing Stage on the leader stops its click and playhead over Bluetooth too', () => {
    net.up = false;
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.click.setOn(true, four));
    act(() => leader.result.current.playhead.set(startPlayhead({ from: 'x', songId: 'row-1', bpm: 120, startAt: Date.now() })));
    leader.unmount();
    expect(member.result.current.click.state?.on).toBe(false);
    expect(member.result.current.playhead.state?.on).toBe(false);
  });

  it('a 6/8 at a dotted 120 (360 ticks a minute) starts and stops over Bluetooth like on the channel', () => {
    net.up = false;
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.click.setOn(true, { bpm: 360, beats: 6, groups: [3, 3] }));
    expect(member.result.current.click.state).toMatchObject({ on: true, bpm: 360, beats: 6, groups: [3, 3] });
    // The same wire form as the channel's (older builds' fields plus `tick`).
    expect(air.latest.get('click')).toMatchObject({ bpm: 120, beats: 2, tick: { bpm: 360, beats: 6, groups: [3, 3] } });
    leader.unmount();
    expect(member.result.current.click.state?.on).toBe(false);
  });
});

describe('useStageLive: is the leader there?', () => {
  it("leader in Stage but no song picked yet: the member knows the leader is there (not 'waiting')", () => {
    air.memberStatus = 'off';
    const leader = phone(true);
    const member = phone(false);
    expect(member.result.current.leaderSeen).toBe(false);
    expect(member.result.current.leaderHere).toBe(true);
    leader.unmount();
    expect(member.result.current.leaderHere).toBe(false);
  });

  it('a member who opens Stage after the leader knows it too', () => {
    air.memberStatus = 'off';
    phone(true);
    const member = phone(false);
    expect(member.result.current.leaderHere).toBe(true);
  });

  it("no internet: linked to the leader's phone means the leader is there", () => {
    net.up = false;
    air.memberStatus = 'connected';
    const member = phone(false);
    expect(member.result.current.leaderHere).toBe(true);
    air.memberStatus = 'searching';
    member.rerender();
    expect(member.result.current.leaderHere).toBe(false);
  });

  it('another member opening Stage is not the leader', () => {
    air.memberStatus = 'off';
    const a = phone(false);
    phone(false);
    expect(a.result.current.leaderHere).toBe(false);
  });
});
