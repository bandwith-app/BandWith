import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * Realtime as it really authorises (audit #9): a channel's broadcast write is
 * decided once, from its topic, never from the event. On "stage:event:<id>"
 * only admins may broadcast (085); on "stage-clock:event:<id>" every band
 * member may (191). A broadcast nobody may send is dropped.
 */
type Handler = { type: string; event: string; cb: (msg: unknown) => void };
type Phone = { topic: string; key: string; handlers: Handler[]; joined: boolean; status?: (s: string) => void };
const net = vi.hoisted(() => ({
  admins: new Set<string>(),
  log: [] as Array<{ topic: string; event: string; from: string; payload: unknown }>,
  /** Clock channels wait to join (Realtime reconnecting) until `joinClocks()`. */
  holdClock: false,
  pending: [] as Array<() => void>,
  /** This phone's pings are lost on the way (seen by the others on the topic, not by the leader). */
  dropPingsOf: '',
  /** Answers take this long on the way (a slow mobile network). */
  pongDelay: 0,
  /** Added to the leader's time in its answers: the leader's clock runs this much ahead. */
  pongSkew: 0,
  /** Realtime refuses the clock topic's join (an older server without 191's policy). */
  refuseClock: false,
  /** Every send, joined or not (supabase-js posts over HTTP when not joined). */
  tries: [] as Array<{ topic: string; event: string; from: string }>,
  /** Answers that still get through (null: all); the rest are lost on the way. */
  pongBudget: null as number | null,
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
          phone.status = cb;
          const join = () => {
            phone.joined = true;
            cb('SUBSCRIBED');
          };
          if (net.refuseClock && topic.startsWith('stage-clock:')) cb('CHANNEL_ERROR');
          else if (net.holdClock && topic.startsWith('stage-clock:')) net.pending.push(join);
          else join();
          return ch;
        },
        track: async (meta: { lead?: boolean }) => {
          if (meta?.lead) net.admins.add(phone.key);
        },
        send: async (m: { event: string; payload: { from?: string } }) => {
          const from = m.payload?.from ?? phone.key;
          net.tries.push({ topic, event: m.event, from });
          if (!phone.joined || !mayBroadcast(topic, from)) return 'error';
          net.log.push({ topic, event: m.event, from, payload: m.payload });
          if (net.dropPingsOf === from && m.event === PING_EVENT) return 'ok';
          const pong = m.event !== PING_EVENT && /pong/.test(m.event);
          if (pong && net.pongBudget !== null) {
            if (net.pongBudget <= 0) return 'ok';
            net.pongBudget--;
          }
          const payload = pong && net.pongSkew ? { ...m.payload, t1: (m.payload as { t1: number }).t1 + net.pongSkew } : m.payload;
          const deliver = () => {
            for (const p of phones)
              if (p !== phone && p.topic === topic && p.joined) p.handlers.filter((h) => h.type === 'broadcast' && h.event === m.event).forEach((h) => h.cb({ payload }));
          };
          if (pong && net.pongDelay) setTimeout(deliver, net.pongDelay);
          else deliver();
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
import * as click from '@/lib/stageClick';

const { CLICK_EVENT, PING_EVENT, PONG_EVENT } = click;
/** Answers to members' pings (clock topic) have an event of their own (Codex on #283). */
const CLOCK_PONG_EVENT = (click as { CLOCK_PONG_EVENT?: string }).CLOCK_PONG_EVENT ?? 'missing';
const isPong = (e: string) => e === PONG_EVENT || e === CLOCK_PONG_EVENT;

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
  net.pongDelay = 0;
  net.pongSkew = 0;
  net.refuseClock = false;
  net.tries = [];
  net.pongBudget = null;
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
      expect(net.log.some((m) => isPong(m.event) && m.from === boss && m.topic === 'stage:event:gig-1' && (m.payload as { to?: string }).to === me)).toBe(true),
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
    expect(net.log.filter((m) => isPong(m.event)).length).toBeLessThanOrEqual(12);
  });

  it("a member can't fake another member's clock: a pong for a ping this phone never sent is ignored", async () => {
    const leader = phone(true);
    const victim = phone(false);
    const me = victim.result.current.clientId;
    const boss = leader.result.current.clientId;
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    // The victim's real measure (same clock as the leader in this test: offset ~0).
    await waitFor(() => expect(net.log.filter((m) => isPong(m.event) && (m.payload as { to?: string }).to === me).length).toBeGreaterThanOrEqual(6), {
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
    await waitFor(() => expect(net.log.some((m) => isPong(m.event) && (m.payload as { to?: string }).to === me)).toBe(true), { timeout: 3000 });
    const real = net.log.find((m) => isPong(m.event) && (m.payload as { to?: string }).to === me)!.payload as { t0: number; t1: number };
    await waitFor(() => expect(Math.abs(member.result.current.click.offset)).toBeLessThan(50), { timeout: 3000 });
    const stage = phones.find((p) => p.topic === 'stage:event:gig-1' && p.key === me)!;
    // The same t0, a far-off t1, sent later: not a fresh answer.
    act(() =>
      stage.handlers
        .filter((h) => isPong(h.event))
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
    await waitFor(() => expect(net.log.some((m) => isPong(m.event) && (m.payload as { to?: string }).to === me)).toBe(true));
  });

  it('the leader bounds its answers in all: pings in many names get a few pongs, and it forgets old names', async () => {
    const leader = phone(true);
    const boss = leader.result.current.clientId;
    const clock = phones.find((p) => p.topic === 'stage-clock:event:gig-1')!;
    act(() => {
      for (let i = 0; i < 500; i++)
        clock.handlers.filter((h) => h.event === PING_EVENT).forEach((h) => h.cb({ payload: { from: `name-${i}`, to: boss, t0: i } }));
    });
    expect(net.log.filter((m) => isPong(m.event)).length).toBeLessThanOrEqual(40);
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
    await waitFor(() => expect(net.log.some((m) => isPong(m.event) && (m.payload as { to?: string }).to === me)).toBe(true), {
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
    await waitFor(() => expect(net.log.some((m) => isPong(m.event) && (m.payload as { to?: string }).to === me)).toBe(true), {
      timeout: 3000,
    });
  });

  it("the leader's clock channel joining after its stage channel: the member's first pings go nowhere, it pings again until it has a measure (Codex on #283)", async () => {
    // Only the leader's clock channel waits (it is made while the hold is on).
    net.holdClock = true;
    const leader = phone(true);
    net.holdClock = false;
    const member = phone(false);
    const me = member.result.current.clientId;
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    // Its first round of pings is sent, and lost.
    await waitFor(() => expect(net.log.filter((m) => m.event === PING_EVENT && m.from === me).length).toBeGreaterThanOrEqual(6), { timeout: 3000 });
    expect(net.log.some((m) => isPong(m.event))).toBe(false);
    act(() => joinClocks());
    await waitFor(() => expect(net.log.some((m) => isPong(m.event) && (m.payload as { to?: string }).to === me)).toBe(true), {
      timeout: 8000,
    });
  }, 12_000);

  it('ten members starting together and one joining right after: the late one still gets a measure (Codex on #283)', async () => {
    const leader = phone(true);
    const band = Array.from({ length: 10 }, () => phone(false));
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    await new Promise((r) => setTimeout(r, 700));
    const late = phone(false);
    const me = late.result.current.clientId;
    // The leader sends its running click to whoever joins (presence join, not in this mock).
    const click = net.log.find((m) => m.event === CLICK_EVENT)!.payload;
    const stage = phones.find((p) => p.topic === 'stage:event:gig-1' && p.key === me)!;
    act(() => stage.handlers.filter((h) => h.event === CLICK_EVENT).forEach((h) => h.cb({ payload: click })));
    await waitFor(() => expect(net.log.some((m) => isPong(m.event) && (m.payload as { to?: string }).to === me)).toBe(true), {
      timeout: 9000,
    });
    expect(band.length).toBe(10);
  }, 12_000);

  it("a member's ping is answered on an event of its own: released apps, which take any answer addressed to them, never see it (Codex on #283)", async () => {
    const leader = phone(true);
    const member = phone(false);
    const me = member.result.current.clientId;
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    await waitFor(() => expect(net.log.some((m) => m.event === CLOCK_PONG_EVENT && (m.payload as { to?: string }).to === me)).toBe(true), {
      timeout: 3000,
    });
    // A member can write the clock topic in anyone's name: no answer to it goes out on the event older apps trust.
    expect(net.log.filter((m) => m.event === PONG_EVENT)).toEqual([]);
    expect(member.result.current.click.offset).toBeDefined();
  });

  it('a slow mobile network (every answer over half a second): the fastest answer still sets the clock, not none', async () => {
    net.pongDelay = 700;
    net.pongSkew = 1000;
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    // The leader's clock is 1 s ahead here: measured, the offset reads about +1000 (minus half the delay); unmeasured, 0.
    await waitFor(() => expect(member.result.current.click.offset).toBeGreaterThan(400), { timeout: 6000 });
  });

  it('the click leader showing up (presence) while the member waits between retries: it pings at once, not at the next retry (Codex on #283)', async () => {
    net.holdClock = true;
    const leader = phone(true);
    net.holdClock = false;
    const member = phone(false);
    const me = member.result.current.clientId;
    const boss = leader.result.current.clientId;
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    // Three rounds lost: the next retry is 6 s away.
    await waitFor(() => expect(net.log.filter((m) => m.event === PING_EVENT && m.from === me).length).toBeGreaterThanOrEqual(18), { timeout: 11_000 });
    await new Promise((r) => setTimeout(r, 300));
    act(() => joinClocks());
    const stage = phones.find((p) => p.topic === 'stage:event:gig-1' && p.key === me)!;
    const at = Date.now();
    act(() => stage.handlers.filter((h) => h.type === 'presence' && h.event === 'join').forEach((h) => h.cb({ key: boss, newPresences: [{ lead: true }] })));
    await waitFor(() => expect(net.log.some((m) => isPong(m.event) && (m.payload as { to?: string }).to === me)).toBe(true), { timeout: 1500 });
    expect(Date.now() - at).toBeLessThan(1500);
  }, 16_000);

  it("a leader that never answers (an older app's): after five rounds the member pings once a minute, not every 15 s (Claude on #283)", async () => {
    vi.useFakeTimers();
    try {
      const leader = phone(true);
      const member = phone(false);
      const me = member.result.current.clientId;
      net.dropPingsOf = me;
      act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(180_000);
      });
      const rounds = net.log.filter((m) => m.event === PING_EVENT && m.from === me && m.topic.startsWith('stage-clock:')).length / 6;
      // 5 quick rounds (~25 s), then one a minute: 7 or 8 in three minutes (15 s apart it would be 14).
      expect(rounds).toBeGreaterThanOrEqual(6);
      expect(rounds).toBeLessThanOrEqual(8);
    } finally {
      vi.useRealTimers();
    }
  });

  it("an admin following whose stage channel dropped (Realtime reconnecting) sends no ping there, so nothing goes over HTTP (Claude on #283)", async () => {
    vi.useFakeTimers();
    try {
      const leader = phone(true);
      const other = phone(true);
      const me = other.result.current.clientId;
      net.dropPingsOf = me; // no measure: it keeps pinging
      act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
      });
      const stagePings = () => net.tries.filter((t) => t.from === me && t.topic === 'stage:event:gig-1' && t.event === PING_EVENT);
      expect(stagePings().length).toBeGreaterThan(0);
      const stage = phones.find((p) => p.topic === 'stage:event:gig-1' && p.key === me)!;
      stage.joined = false;
      act(() => stage.status?.('CHANNEL_ERROR'));
      net.tries = [];
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(net.tries.some((t) => t.from === me && t.topic.startsWith('stage-clock:') && t.event === PING_EVENT)).toBe(true);
      expect(stagePings()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the leader's stage channel dropped (Realtime reconnecting): a ping gets no pong, so nothing goes over HTTP, and the cap isn't used up (Claude on #283)", () => {
    const leader = phone(true);
    const boss = leader.result.current.clientId;
    const clock = phones.find((p) => p.topic === 'stage-clock:event:gig-1')!;
    const stage = phones.find((p) => p.topic === 'stage:event:gig-1' && p.key === boss)!;
    stage.joined = false;
    act(() => stage.status?.('CHANNEL_ERROR'));
    net.tries = [];
    const ping = (t0: number) =>
      act(() => clock.handlers.filter((h) => h.event === PING_EVENT).forEach((h) => h.cb({ payload: { from: 'drummer', to: boss, t0 } })));
    for (let i = 0; i < 5; i++) ping(i);
    expect(net.tries.filter((t) => isPong(t.event))).toEqual([]);
    // Back in: the next ping is answered (the dropped ones used up nothing).
    stage.joined = true;
    act(() => stage.status?.('SUBSCRIBED'));
    ping(100);
    expect(net.log.filter((m) => isPong(m.event) && m.from === boss).length).toBe(1);
  });

  it("the server's \"new band key\" message on the stage topic reaches Stage's Bluetooth (191, Codex on 642676fc)", () => {
    phone(false);
    const heard: string[] = [];
    const onKey = (e: Event) => heard.push((e as CustomEvent<string>).detail);
    window.addEventListener('bw:stage-key', onKey);
    const stage = phones.find((p) => p.topic === 'stage:event:gig-1')!;
    act(() => stage.handlers.filter((h) => h.type === 'broadcast' && h.event === 'stage-key').forEach((h) => h.cb({ payload: { event_id: 'gig-1' } })));
    // Another gig's message (can't happen on this topic, but never trusted): nothing.
    act(() => stage.handlers.filter((h) => h.type === 'broadcast' && h.event === 'stage-key').forEach((h) => h.cb({ payload: { event_id: 'gig-2' } })));
    window.removeEventListener('bw:stage-key', onKey);
    expect(heard).toEqual(['gig-1']);
  });

  it('the clock topic refused (Realtime said no): nothing is sent there, so nothing goes over HTTP instead (Claude on #283)', async () => {
    net.refuseClock = true;
    const leader = phone(true);
    const member = phone(false);
    const me = member.result.current.clientId;
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    await new Promise((r) => setTimeout(r, 2_500));
    expect(net.tries.filter((t) => t.from === me && t.topic.startsWith('stage-clock:')).length).toBe(0);
  });

  it('a round that brought back answers but none usable (two slow ones) is tried again: the member gets a measure (Codex on #283)', async () => {
    net.pongDelay = 700;
    net.pongSkew = 1000;
    // Only two answers of the first round get through: too few slow ones to use.
    net.pongBudget = 2;
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    await new Promise((r) => setTimeout(r, 2500));
    expect(member.result.current.click.offset).toBe(0);
    net.pongBudget = null;
    // Measured, the offset reads about +1000 (minus half the delay).
    await waitFor(() => expect(member.result.current.click.offset).toBeGreaterThan(400), { timeout: 8000 });
  }, 14_000);

  it("an answer more than 5 s after its ping isn't used, whatever else came back (Codex on #283)", async () => {
    net.pongDelay = 5_600;
    net.pongSkew = 1000;
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.click.setOn(true, { bpm: 120, beats: 4 }));
    await new Promise((r) => setTimeout(r, 8_500));
    // Answers did come back, all too late to tell the time by.
    expect(net.log.some((m) => isPong(m.event) && (m.payload as { to?: string }).to === member.result.current.clientId)).toBe(true);
    expect(member.result.current.click.offset).toBe(0);
  }, 12_000);

  it('pings in many made-up names use up the cap, a bandmate in Stage (presence) is still answered (Claude on #283)', async () => {
    const leader = phone(true);
    const member = phone(false);
    const me = member.result.current.clientId;
    const boss = leader.result.current.clientId;
    const stage = phones.find((p) => p.topic === 'stage:event:gig-1' && p.key === boss)!;
    act(() => stage.handlers.filter((h) => h.type === 'presence' && h.event === 'join').forEach((h) => h.cb({ key: me, newPresences: [{ lead: false }] })));
    // The leader's clock channel (made first: the leader's phone opened first).
    const clock = phones.find((p) => p.topic === 'stage-clock:event:gig-1')!;
    const ping = (from: string, t0: number) => clock.handlers.filter((h) => h.event === PING_EVENT).forEach((h) => h.cb({ payload: { from, to: boss, t0 } }));
    act(() => {
      for (let i = 0; i < 60; i++) ping(`fake-${i}`, 1000 + i);
    });
    act(() => ping(me, 424242));
    await waitFor(() => expect(net.log.some((m) => isPong(m.event) && (m.payload as { to?: string; t0?: number }).to === me && (m.payload as { t0?: number }).t0 === 424242)).toBe(true), { timeout: 1000 });
    // The made-up names still get no more than the cap.
    expect(net.log.filter((m) => isPong(m.event) && String((m.payload as { to?: string }).to).startsWith('fake-')).length).toBeLessThanOrEqual(40);
  });
});
