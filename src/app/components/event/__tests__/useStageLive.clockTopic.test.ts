import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * Realtime as it really authorises (audit #9): a channel's broadcast write is
 * decided once, from its topic, never from the event. On "stage:event:<id>"
 * only admins may broadcast (085); on "stage-clock:event:<id>" every band
 * member may (191). A broadcast nobody may send is dropped.
 */
type Handler = { type: string; event: string; cb: (msg: unknown) => void };
type Phone = { topic: string; key: string; handlers: Handler[]; joined: boolean };
const net = vi.hoisted(() => ({
  admins: new Set<string>(),
  log: [] as Array<{ topic: string; event: string; from: string; payload: unknown }>,
  /** Clock channels wait to join (Realtime reconnecting) until `joinClocks()`. */
  holdClock: false,
  pending: [] as Array<() => void>,
  /** This phone's pings are lost on the way (seen by the others on the topic, not by the leader). */
  dropPingsOf: '',
}));
const phones: Phone[] = [];
const joinClocks = () => {
  net.holdClock = false;
  net.pending.splice(0).forEach((f) => f());
};
const mayBroadcast = (topic: string, key: string) =>
  topic.startsWith('stage-clock:event:') ? true : topic.startsWith('stage:event:') ? net.admins.has(key) : false;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (topic: string, opts: { config: { presence?: { key: string } } }) => {
      const phone: Phone = { topic, key: opts.config.presence?.key ?? `anon-${phones.length}`, handlers: [], joined: false };
      phones.push(phone);
      const ch = {
        on(type: string, filter: { event: string }, cb: (msg: unknown) => void) {
          phone.handlers.push({ type, event: filter.event, cb });
          return ch;
        },
        subscribe(cb: (s: string) => void) {
          const join = () => {
            phone.joined = true;
            cb('SUBSCRIBED');
          };
          if (net.holdClock && topic.startsWith('stage-clock:')) net.pending.push(join);
          else join();
          return ch;
        },
        track: async (meta: { lead?: boolean }) => {
          if (meta?.lead) net.admins.add(phone.key);
        },
        send: async (m: { event: string; payload: { from?: string } }) => {
          const from = m.payload?.from ?? phone.key;
          if (!phone.joined || !mayBroadcast(topic, from)) return 'error';
          net.log.push({ topic, event: m.event, from, payload: m.payload });
          if (net.dropPingsOf === from && m.event === PING_EVENT) return 'ok';
          for (const p of phones)
            if (p !== phone && p.topic === topic) p.handlers.filter((h) => h.type === 'broadcast' && h.event === m.event).forEach((h) => h.cb({ payload: m.payload }));
          return 'ok';
        },
        __phone: phone,
      };
      return ch;
    },
    removeChannel: async (ch: { __phone: Phone }) => {
      const i = phones.indexOf(ch.__phone);
      if (i >= 0) phones.splice(i, 1);
    },
  },
}));
const bleStub = vi.hoisted(() => ({ status: 'off', publish: () => {}, burst: () => {}, clock: null, followers: 0, fix: () => {} }));
vi.mock('../useStageBle', () => ({ useStageBle: () => bleStub }));
vi.mock('@/lib/services/songs', () => ({ saveSetlistOrder: async () => ({ error: null }) }));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: async () => {} }));

import { useStageLive } from '../useStageLive';
import { PING_EVENT, PONG_EVENT } from '@/lib/stageClick';

const SONGS = [{ id: 'row-1', songId: 'song-1' }];
const phone = (isLeader: boolean) =>
  renderHook(() => useStageLive({ eventId: 'gig-1', setlistId: 'list-1', songs: SONGS, open: true, isLeader }));

beforeEach(() => {
  phones.length = 0;
  net.admins.clear();
  net.log = [];
  net.holdClock = false;
  net.pending = [];
  net.dropPingsOf = '';
});

describe("useStageLive: an ordinary member measures the leader's clock (audit #9)", () => {
  it('pings go out on the clock topic members may write, pongs come back on the admin-only stage topic', async () => {
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    expect(member.result.current.click.state?.on).toBe(true);
    const me = member.result.current.clientId;
    const boss = leader.result.current.clientId;
    await waitFor(() => expect(net.log.some((m) => m.event === PING_EVENT && m.from === me && m.topic === 'stage-clock:event:gig-1')).toBe(true), {
      timeout: 3000,
    });
    await waitFor(() =>
      expect(net.log.some((m) => m.event === PONG_EVENT && m.from === boss && m.topic === 'stage:event:gig-1' && (m.payload as { to?: string }).to === me)).toBe(true),
    );
    // Nothing a member sends is meant for the admin-only topic.
    expect(net.log.filter((m) => m.from === me && m.topic === 'stage:event:gig-1')).toEqual([]);
  });

  it("the leader answers a flood of pings from one phone only a few times (it can't be made to spam the band)", async () => {
    const leader = phone(true);
    const boss = leader.result.current.clientId;
    const clock = phones.find((p) => p.topic === 'stage-clock:event:gig-1')!;
    act(() => {
      for (let i = 0; i < 200; i++)
        clock.handlers.filter((h) => h.event === PING_EVENT).forEach((h) => h.cb({ payload: { from: 'noisy', to: boss, t0: i } }));
    });
    expect(net.log.filter((m) => m.event === PONG_EVENT).length).toBeLessThanOrEqual(12);
  });

  it("a member can't fake another member's clock: a pong for a ping this phone never sent is ignored", async () => {
    const leader = phone(true);
    const victim = phone(false);
    const me = victim.result.current.clientId;
    const boss = leader.result.current.clientId;
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    // The victim's real measure (same clock as the leader in this test: offset ~0).
    await waitFor(() => expect(net.log.filter((m) => m.event === PONG_EVENT && (m.payload as { to?: string }).to === me).length).toBeGreaterThanOrEqual(6), {
      timeout: 3000,
    });
    await waitFor(() => expect(Math.abs(victim.result.current.click.offset)).toBeLessThan(50));
    // Another member writes pings on the clock topic in the victim's name, with a t0 from the future.
    const attacker = phones.find((p) => p.topic === 'stage-clock:event:gig-1' && p !== phones.find((q) => q.topic === 'stage-clock:event:gig-1'))!;
    const leaderClock = phones.find((p) => p.topic === 'stage-clock:event:gig-1')!;
    expect(attacker).toBeTruthy();
    act(() => {
      for (let i = 0; i < 6; i++)
        leaderClock.handlers
          .filter((h) => h.event === PING_EVENT)
          .forEach((h) => h.cb({ payload: { from: me, to: boss, t0: performance.timeOrigin + performance.now() + 2000 + i } }));
    });
    // The leader answers (it can't tell), but the victim never asked: its clock doesn't move.
    await new Promise((r) => setTimeout(r, 100));
    expect(Math.abs(victim.result.current.click.offset)).toBeLessThan(50);
  });

  it('a pong is used once: a replayed copy of a real one is ignored', async () => {
    const leader = phone(true);
    const member = phone(false);
    const me = member.result.current.clientId;
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    await waitFor(() => expect(net.log.some((m) => m.event === PONG_EVENT && (m.payload as { to?: string }).to === me)).toBe(true), { timeout: 3000 });
    const real = net.log.find((m) => m.event === PONG_EVENT && (m.payload as { to?: string }).to === me)!.payload as { t0: number; t1: number };
    await waitFor(() => expect(Math.abs(member.result.current.click.offset)).toBeLessThan(50), { timeout: 3000 });
    const stage = phones.find((p) => p.topic === 'stage:event:gig-1' && p.key === me)!;
    // The same t0, a far-off t1, sent later: not a fresh answer.
    act(() =>
      stage.handlers
        .filter((h) => h.event === PONG_EVENT)
        .forEach((h) => h.cb({ payload: { ...real, t1: real.t1 + 5000 } })),
    );
    expect(Math.abs(member.result.current.click.offset)).toBeLessThan(50);
  });

  it("a replay of the member's real ping, answered late, doesn't shift its clock: slow round trips are dropped (Claude on #283)", async () => {
    const leader = phone(true);
    const victim = phone(false);
    const me = victim.result.current.clientId;
    const boss = leader.result.current.clientId;
    // The victim's first pings don't reach the leader, so they stay unanswered.
    net.dropPingsOf = me;
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    await waitFor(() => expect(net.log.some((m) => m.event === PING_EVENT && m.from === me)).toBe(true), { timeout: 3000 });
    const real = net.log.find((m) => m.event === PING_EVENT && m.from === me)!.payload as { t0: number };
    // Another member sends that same ping again, 700 ms later; this time the answer arrives.
    await new Promise((r) => setTimeout(r, 700));
    const leaderClock = phones.find((p) => p.topic === 'stage-clock:event:gig-1')!;
    act(() => leaderClock.handlers.filter((h) => h.event === PING_EVENT).forEach((h) => h.cb({ payload: { from: me, to: boss, t0: real.t0 } })));
    await new Promise((r) => setTimeout(r, 50));
    // Same clock as the leader here: a usable sample would read about 0, the replay about +350 ms.
    expect(Math.abs(victim.result.current.click.offset)).toBeLessThan(50);
  });

  it('an admin following another admin also pings on the stage topic, so a leader on an older app still answers', async () => {
    const leader = phone(true);
    const other = phone(true);
    const me = other.result.current.clientId;
    // The leader runs an older app: it listens for pings on the stage topic only.
    const leaderClock = phones.find((p) => p.topic === 'stage-clock:event:gig-1')!;
    leaderClock.handlers = leaderClock.handlers.filter((h) => h.event !== PING_EVENT);
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    await waitFor(() => expect(net.log.some((m) => m.event === PING_EVENT && m.from === me && m.topic === 'stage:event:gig-1')).toBe(true), {
      timeout: 3000,
    });
    await waitFor(() => expect(net.log.some((m) => m.event === PONG_EVENT && (m.payload as { to?: string }).to === me)).toBe(true));
  });

  it('the leader bounds its answers in all: pings in many names get a few pongs, and it forgets old names', async () => {
    const leader = phone(true);
    const boss = leader.result.current.clientId;
    const clock = phones.find((p) => p.topic === 'stage-clock:event:gig-1')!;
    act(() => {
      for (let i = 0; i < 500; i++)
        clock.handlers.filter((h) => h.event === PING_EVENT).forEach((h) => h.cb({ payload: { from: `name-${i}`, to: boss, t0: i } }));
    });
    expect(net.log.filter((m) => m.event === PONG_EVENT).length).toBeLessThanOrEqual(40);
  });

  it("five admins following on both topics don't use up the leader's answers: a musician joining next still gets the clock", async () => {
    const leader = phone(true);
    for (let i = 0; i < 5; i++) phone(true);
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    await new Promise((r) => setTimeout(r, 700));
    const late = phone(false);
    const me = late.result.current.clientId;
    // The running click reaches the late phone (the leader resends it on presence join).
    const click = net.log.find((m) => m.event === 'click' && m.topic === 'stage:event:gig-1')!.payload;
    const stage = phones.find((p) => p.topic === 'stage:event:gig-1' && p.key === me)!;
    act(() => stage.handlers.filter((h) => h.event === 'click').forEach((h) => h.cb({ payload: click })));
    await waitFor(() => expect(late.result.current.click.state?.on).toBe(true));
    await waitFor(() => expect(net.log.some((m) => m.event === PONG_EVENT && (m.payload as { to?: string }).to === me)).toBe(true), {
      timeout: 3000,
    });
  });

  it('the clock channel joining late (Realtime reconnecting): the member measures again once it is in', async () => {
    net.holdClock = true;
    const leader = phone(true);
    const member = phone(false);
    const me = member.result.current.clientId;
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    // The burst goes nowhere meanwhile.
    await new Promise((r) => setTimeout(r, 1500));
    expect(net.log.some((m) => m.event === PING_EVENT && m.from === me)).toBe(false);
    act(() => joinClocks());
    await waitFor(() => expect(net.log.some((m) => m.event === PONG_EVENT && (m.payload as { to?: string }).to === me)).toBe(true), {
      timeout: 3000,
    });
  });
});
