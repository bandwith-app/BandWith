import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { StageLiveState } from '@/lib/stageLive';

/**
 * Codex on #288: a band-key state (an older app, or a member posing as one)
 * at seq 9, then the admins' signed state at seq 4 (its clock is behind).
 * Unless a signed state counts as trusted, the signed song is dropped as "not newer".
 */
vi.mock('@/lib/supabase', () => {
  const ch = {
    on: () => ch,
    subscribe: (cb?: (s: string) => void) => {
      cb?.('SUBSCRIBED');
      return ch;
    },
    track: async () => {},
    send: async () => {},
  };
  return { supabase: { channel: () => ch, removeChannel: async () => {} } };
});
const ble = vi.hoisted(() => ({ onState: null as null | ((s: StageLiveState, signed?: boolean) => void) }));
vi.mock('../useStageBle', () => ({
  useStageBle: (o: { onState: (s: StageLiveState, signed?: boolean) => void }) => {
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
];

describe('useStageLive: a signed leader after a band-key one (Codex on #288)', () => {
  it("the signed leader's song applies even with a lower seq (it comes as signed)", async () => {
    const m = renderHook(() => useStageLive({ eventId: 'gig-1', setlistId: 'list-1', songs: SONGS, open: true, isLeader: false }));
    act(() => ble.onState!({ seq: 9, from: 'impostor', songId: 'row-1', order: null }));
    await waitFor(() => expect(m.result.current.currentId).toBe('row-1'));
    act(() => ble.onState!({ seq: 4, from: 'admin', songId: 'row-2', order: null }, true));
    await waitFor(() => expect(m.result.current.currentId).toBe('row-2'));
    // And on from there: the admin's next state applies, an older one doesn't.
    act(() => ble.onState!({ seq: 3, from: 'admin', songId: 'row-1', order: null }));
    expect(m.result.current.currentId).toBe('row-2');
  });

  it('band-key states among themselves: an older one is still dropped', async () => {
    const m = renderHook(() => useStageLive({ eventId: 'gig-1', setlistId: 'list-1', songs: SONGS, open: true, isLeader: false }));
    act(() => ble.onState!({ seq: 9, from: 'a', songId: 'row-2', order: null }));
    act(() => ble.onState!({ seq: 4, from: 'a', songId: 'row-1', order: null }));
    await waitFor(() => expect(m.result.current.currentId).toBe('row-2'));
  });
});
