import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Round 6 (Claude r5 M5): the leader's new order online was a plain upsert of
// every row by id, so a row another admin had just removed came back. Now it
// is one save (188) over the order it was made on: changed meanwhile, nothing
// is written. Made-up setlist (Brooklyn gig).

type Row = { id: string; song_id: string; position: number; set_number: number };
const db = vi.hoisted(() => ({ rows: [] as Row[], upserts: 0, rpcs: [] as unknown[] }));
vi.mock('@/lib/supabase', () => {
  const order = (rows: Row[]) => [...rows].sort((a, b) => a.set_number - b.set_number || a.position - b.position);
  return {
    supabase: {
      from: () => {
        const b: any = {
          upsert: () => {
            db.upserts++;
            return b;
          },
          select: () => Promise.resolve({ data: db.rows.map((r) => ({ id: r.id })), error: null }),
        };
        return b;
      },
      // bw_save_setlist_songs (188): written only while the setlist is still `p_expected`.
      // Per place: song and set, and the row when the entry names it (188).
      rpc: vi.fn(async (_fn: string, args: { p_songs: { id?: string; song_id: string; set_number: number }[]; p_expected?: { songs: { id?: string; song_id: string; set_number: number }[] } }) => {
        db.rpcs.push(args);
        const now = order(db.rows).map((r) => ({ id: r.id, song_id: r.song_id, set_number: r.set_number }));
        const want = args.p_expected?.songs;
        if (want && (want.length !== now.length || want.some((w, i) => w.song_id !== now[i].song_id || w.set_number !== now[i].set_number || (!!w.id && w.id !== now[i].id)))) {
          return { data: { saved: false, conflict: true, current: { name: 'Brooklyn', songs: now } }, error: null };
        }
        db.rows = args.p_songs.map((s, i) => ({ id: s.id ?? `new-${i}`, song_id: s.song_id, position: i + 1, set_number: s.set_number }));
        return { data: { saved: true, previous: [] }, error: null };
      }),
      channel: vi.fn(),
      removeChannel: vi.fn(),
    },
  };
});
vi.mock('@/lib/sessionUser', () => ({ sessionUserId: async () => 'u-admin' }));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: vi.fn() }));
vi.mock('../useStageBle', () => ({ useStageBle: () => ({ publish: vi.fn(), burst: vi.fn(), status: 'off', followers: 0, fix: vi.fn() }) }));

import { useStageLive } from '../useStageLive';

const songs = [
  { id: 'r1', songId: 'a', setNumber: 1 },
  { id: 'r2', songId: 'b', setNumber: 1 },
  { id: 'r3', songId: 'c', setNumber: 1 },
];

beforeEach(() => {
  db.rows = songs.map((s, i) => ({ id: s.id, song_id: s.songId, position: i + 1, set_number: 1 }));
  db.upserts = 0;
  db.rpcs = [];
});

describe('Stage mode: the leader reorders online', () => {
  it('a song another admin removed meanwhile does not come back; nothing is written', async () => {
    const { result } = renderHook(() => useStageLive({ setlistId: 'sl', songs, open: false, isLeader: true }));
    // Another admin removes "b" (row r2) while the leader still shows it.
    db.rows = db.rows.filter((r) => r.id !== 'r2');
    act(() => result.current.move(2, 0));
    await waitFor(() => expect(result.current.saveState).toBe('error'), { timeout: 3000 });
    expect(db.upserts).toBe(0);
    expect(db.rows.map((r) => r.id)).toEqual(['r1', 'r3']);
    expect(db.rpcs[0]).toMatchObject({ p_setlist_id: 'sl', p_expected: { songs: [{ song_id: 'a' }, { song_id: 'b' }, { song_id: 'c' }] } });
  });

  it('nothing changed meanwhile: saved in one save, each row keeps its id', async () => {
    const { result } = renderHook(() => useStageLive({ setlistId: 'sl', songs, open: false, isLeader: true }));
    act(() => result.current.move(2, 0));
    await waitFor(() => expect(result.current.saveState).toBe('saved'), { timeout: 3000 });
    expect(db.upserts).toBe(0);
    expect(db.rows.map((r) => r.id)).toEqual(['r3', 'r1', 'r2']);
  });

  // Round 7 (Codex r6 B6): the order it was made on is checked row by row:
  // the same songs in the same places but other rows (moved meanwhile) is a change.
  it('rows moved meanwhile (same songs, other rows): nothing is written', async () => {
    const { result } = renderHook(() => useStageLive({ setlistId: 'sl', songs, open: false, isLeader: true }));
    db.rows = [
      { id: 'r2', song_id: 'a', position: 1, set_number: 1 },
      { id: 'r1', song_id: 'b', position: 2, set_number: 1 },
      { id: 'r3', song_id: 'c', position: 3, set_number: 1 },
    ];
    act(() => result.current.move(2, 0));
    await waitFor(() => expect(result.current.saveState).toBe('error'), { timeout: 3000 });
    expect(db.rows.map((r) => r.id)).toEqual(['r2', 'r1', 'r3']);
    expect(db.rpcs[0]).toMatchObject({ p_expected: { songs: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }] } });
  });
});
