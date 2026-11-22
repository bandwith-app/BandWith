import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * Realtime as it really authorises (audit #9): a channel's broadcast write is
 * decided once, from its topic, never from the event. On "stage:event:<id>"
 * only admins may broadcast (085); on "stage-clock:event:<id>" every band
 * member may (191). A broadcast nobody may send is dropped.
 */
type Handler = { type: string; event: string; cb: (msg: unknown) => void };
type Phone = { topic: string; key: string; handlers: Handler[] };
const net = vi.hoisted(() => ({ admins: new Set<string>(), log: [] as Array<{ topic: string; event: string; from: string; payload: unknown }> }));
const phones: Phone[] = [];
const mayBroadcast = (topic: string, key: string) =>
  topic.startsWith('stage-clock:event:') ? true : topic.startsWith('stage:event:') ? net.admins.has(key) : false;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (topic: string, opts: { config: { presence?: { key: string } } }) => {
      const phone: Phone = { topic, key: opts.config.presence?.key ?? `anon-${phones.length}`, handlers: [] };
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
        track: async (meta: { lead?: boolean }) => {
          if (meta?.lead) net.admins.add(phone.key);
        },
        send: async (m: { event: string; payload: { from?: string } }) => {
          const from = m.payload?.from ?? phone.key;
          if (!mayBroadcast(topic, from)) return 'error';
          net.log.push({ topic, event: m.event, from, payload: m.payload });
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
});
