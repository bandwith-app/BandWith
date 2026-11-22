import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * A tiny stand-in for the Supabase stage channel: every hook instance is a
 * phone; a broadcast reaches the others (self: false), presence joins are
 * announced.
 */
type Handler = { type: string; event: string; cb: (msg: unknown) => void };
const phones: { key: string; handlers: Handler[] }[] = [];
const bus = {
  send(from: string, event: string, payload: unknown) {
    for (const p of phones) if (p.key !== from) p.handlers.filter((h) => h.type === 'broadcast' && h.event === event).forEach((h) => h.cb({ payload }));
  },
};
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (_topic: string, opts: { config: { presence: { key: string } } }) => {
      const phone = { key: opts.config.presence.key, handlers: [] as Handler[] };
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
          for (const p of phones)
            if (p.key !== phone.key) p.handlers.filter((h) => h.type === 'presence' && h.event === 'join').forEach((h) => h.cb({ key: phone.key, newPresences: [{}] }));
        },
        send: async (m: { event: string; payload: unknown }) => bus.send(phone.key, m.event, m.payload),
        __phone: phone,
      };
      return ch;
    },
    removeChannel: async (ch: { __phone: { key: string } }) => {
      const i = phones.findIndex((p) => p.key === ch.__phone.key);
      if (i >= 0) phones.splice(i, 1);
    },
  },
}));
vi.mock('../useStageBle', () => ({ useStageBle: () => ({ status: 'off', publish: () => {} }) }));
vi.mock('@/lib/services/songs', () => ({ saveSetlistOrder: async () => ({ error: null }) }));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: async () => {} }));

import { useStageLive } from '../useStageLive';
import { startPlayhead, holdSection, buildTimeline } from '@/lib/playhead';

const SONGS = [
  { id: 'row-1', songId: 'song-1' },
  { id: 'row-2', songId: 'song-2' },
];
const phone = (isLeader: boolean) =>
  renderHook(() => useStageLive({ eventId: 'gig-1', setlistId: 'list-1', songs: SONGS, open: true, isLeader }));

const tl = buildTimeline({ chart: { v: 1, source: 'ireal', title: 'x', time: '4/4', sections: [{ label: 'A', bars: [{ chords: ['C'] }, { chords: ['G'] }] }] } })!;

beforeEach(() => {
  phones.length = 0;
});

describe('useStageLive: the playhead on every phone', () => {
  it("the leader's start reaches the band; Hold and Stop too", () => {
    const leader = phone(true);
    const member = phone(false);
    const start = startPlayhead({ from: 'x', songId: 'row-1', bpm: 120, startAt: Date.now() + 1500 });
    act(() => leader.result.current.playhead.set(start));
    expect(leader.result.current.playhead.mine).toBe(true);
    expect(member.result.current.playhead.state).toMatchObject({ on: true, bpm: 120, bar: 0, songId: 'row-1' });
    expect(member.result.current.playhead.mine).toBe(false);

    act(() => leader.result.current.playhead.set(holdSection(leader.result.current.playhead.state!, Date.now() + 2000, tl)));
    expect(member.result.current.playhead.state?.hold).toEqual([0, 1]);

    // Another song stops it for everyone.
    act(() => leader.result.current.select(1));
    expect(member.result.current.playhead.state?.on).toBe(false);
  });

  it("a member's own playhead stays on their phone; an older state is ignored", () => {
    const leader = phone(true);
    const member = phone(false);
    const start = startPlayhead({ from: 'x', songId: 'row-1', bpm: 100, startAt: Date.now() });
    act(() => member.result.current.playhead.set(start));
    expect(leader.result.current.playhead.state).toBeNull();
    const newer = { ...start, seq: start.seq + 5 };
    act(() => leader.result.current.playhead.set(newer));
    act(() => leader.result.current.playhead.set({ ...newer, seq: start.seq + 1, bpm: 60 }));
    // The second (older seq) never replaces the newer one on the member's phone.
    expect(member.result.current.playhead.state?.bpm).toBe(100);
  });

  it('a phone that opens Stage late gets the running playhead', () => {
    const leader = phone(true);
    act(() => leader.result.current.playhead.set(startPlayhead({ from: 'x', songId: 'row-1', bpm: 90, startAt: Date.now() })));
    const late = phone(false);
    expect(late.result.current.playhead.state).toMatchObject({ on: true, bpm: 90 });
  });

  it("closing the leader's Stage stops the playhead on the others", () => {
    const leader = phone(true);
    const member = phone(false);
    act(() => leader.result.current.playhead.set(startPlayhead({ from: 'x', songId: 'row-1', bpm: 90, startAt: Date.now() })));
    leader.unmount();
    expect(member.result.current.playhead.state?.on).toBe(false);
  });
});
