import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { nextSeq, type StageLiveState } from '@/lib/stageLive';

/**
 * Review of #280: Bluetooth states can be made by anyone with the band key.
 * One with a huge seq must not freeze a member, nor hold back the live
 * channel (where only admins can send).
 */
type Handler = { type: string; event: string; cb: (msg: unknown) => void };
const chan = vi.hoisted(() => ({ handlers: [] as Handler[] }));
vi.mock('@/lib/supabase', () => {
  const ch = {
    on(type: string, filter: { event: string }, cb: (msg: unknown) => void) {
      chan.handlers.push({ type, event: filter.event, cb });
      return ch;
    },
    subscribe: (cb?: (s: string) => void) => {
      cb?.('SUBSCRIBED');
      return ch;
    },
    track: async () => {},
    send: async () => {},
  };
  return { supabase: { channel: () => ch, removeChannel: async () => {} } };
});
const emit = (type: string, event: string, msg: unknown) =>
  chan.handlers.filter((h) => h.type === type && h.event === event).forEach((h) => h.cb(msg));
const ble = vi.hoisted(() => ({ onState: null as null | ((s: StageLiveState) => void) }));
vi.mock('../useStageBle', () => ({
  useStageBle: (o: { onState: (s: StageLiveState) => void }) => {
    ble.onState = o.onState;
    return { status: 'connected', publish: () => {}, burst: () => {}, clock: null, followers: 0, fix: () => {} };
  },
}));
vi.mock('@/lib/services/songs', () => ({ saveSetlistOrder: vi.fn(async () => ({ error: null })) }));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: async () => {} }));

import { useStageLive } from '../useStageLive';

const SONGS = [
  { id: 'row-1', songId: 'song-1', setNumber: 1 },
  { id: 'row-2', songId: 'song-2', setNumber: 1 },
  { id: 'row-3', songId: 'song-3', setNumber: 1 },
];
const phone = () => renderHook(() => useStageLive({ eventId: 'gig-1', setlistId: 'list-1', songs: SONGS, open: true, isLeader: false }));
const now = () => nextSeq(null);
const live = (state: StageLiveState) => act(() => emit('broadcast', 'state', { payload: state }));
const bt = (state: StageLiveState) => act(() => ble.onState!(state));

beforeEach(() => {
  chan.handlers = [];
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

  it('while a leader is on the live channel, Bluetooth states are not taken', () => {
    const m = phone();
    act(() => emit('presence', 'join', { key: 'admin', newPresences: [{ lead: true }] }));
    bt({ seq: now() + 100, from: 'x', songId: 'row-3', order: null });
    expect(m.result.current.currentId).not.toBe('row-3');
    // The leader leaves the channel (no signal): Bluetooth takes over.
    act(() => emit('presence', 'leave', { key: 'admin' }));
    bt({ seq: now() + 100, from: 'a', songId: 'row-3', order: null });
    expect(m.result.current.currentId).toBe('row-3');
  });
});
