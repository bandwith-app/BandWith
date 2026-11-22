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
});
