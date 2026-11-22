import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Round 6 (main session): a song added on the Regia was saved with a plain
// upsert of every row the device still showed, so a song another admin had
// just removed came back. Round 7 (Claude r6): adding it is one guarded save
// (188, row ids, `expected`): changed meanwhile, nothing is written at all,
// the setlist reloads and the picker opens again; saved, the new row's id
// comes back from 188 and only then everyone jumps to it.
// Made-up setlist (Brooklyn gig).

type Row = { id: string; setlist_id: string; song_id: string; position: number; set_number: number };
const db = vi.hoisted(() => ({ rows: [] as Row[], upserts: 0, inserts: 0, n: 0 }));
vi.mock('@/lib/supabase', () => {
  const order = (rows: Row[]) => [...rows].sort((a, b) => a.set_number - b.set_number || a.position - b.position);
  const from = (table: string) => {
    let insert: Omit<Row, 'id'> | null = null;
    const b: any = {
      insert: (v: Omit<Row, 'id'>) => ((insert = v), db.inserts++, b),
      upsert: (rows: Row[]) => {
        db.upserts++;
        for (const r of rows) {
          const i = db.rows.findIndex((x) => x.id === r.id);
          if (i >= 0) db.rows[i] = { ...db.rows[i], ...r };
          else db.rows.push(r);
        }
        return b;
      },
      update: () => b,
      eq: () => b,
      select: () => b,
      single: async () => {
        const row = { id: `new-${++db.n}`, ...insert! };
        db.rows.push(row);
        return { data: row, error: null };
      },
      then: (res: any, rej: any) =>
        Promise.resolve(table === 'setlist_songs' ? { data: db.rows.map((r) => ({ id: r.id })), error: null, count: db.rows.length } : { data: null, error: null }).then(res, rej),
    };
    return b;
  };
  return {
    supabase: {
      from,
      // bw_save_setlist_songs (188): written only while the setlist is still `p_expected`.
      rpc: vi.fn(async (_fn: string, args: { p_setlist_id: string; p_songs: { id?: string; song_id: string; set_number: number }[]; p_expected?: { songs: { id?: string; song_id: string; set_number: number }[] } }) => {
        const now = order(db.rows).map((r) => ({ id: r.id, song_id: r.song_id, set_number: r.set_number }));
        const want = args.p_expected?.songs;
        const differs = !!want && (want.length !== now.length || want.some((w, i) => w.song_id !== now[i].song_id || w.set_number !== now[i].set_number || (!!w.id && w.id !== now[i].id)));
        if (differs) return { data: { saved: false, conflict: true, current: { name: 'Brooklyn', songs: now } }, error: null };
        db.rows = args.p_songs.map((s, i) => ({ id: s.id ?? `new-${++db.n}`, setlist_id: args.p_setlist_id, song_id: s.song_id, position: i + 1, set_number: s.set_number }));
        return { data: { saved: true, previous: [], rows: order(db.rows).map(({ id, song_id, set_number, position }) => ({ id, song_id, set_number, position })) }, error: null };
      }),
    },
    getSafeUser: async () => ({ data: { user: { id: 'u-admin' } } }),
  };
});
vi.mock('@/lib/regiaAudio', async () => ({
  audioFailureFor: (await vi.importActual<typeof import('@/lib/regiaAudio')>('@/lib/regiaAudio')).audioFailureFor,
  // #296: useAudioDownloads binds each pass to the sign-in it is asked under (as in useStageRegia.test.ts).
  audioSession: () => () => true,
  cachedAudio: async () => new Set(),
  downloadAudio: async () => ({ ok: true }),
  playableUrl: async (ref: string) => ({ url: `local:${ref}`, local: true }),
  createRegiaPlayer: () => {
    throw new Error('the real player is never used in tests');
  },
}));
vi.mock('@/lib/audioPlayer', () => ({ stopPlayer: () => {} }));

import { useStageRegia, type RegiaSong } from '../useStageRegia';
import type { StageRegiaBridge } from '../useStageLive';
import type { RegiaPlayer } from '@/lib/regiaAudio';

const player = (): RegiaPlayer => {
  let snap = { status: 'idle', positionMs: 0, durationMs: null } as ReturnType<RegiaPlayer['snapshot']>;
  return {
    load: async () => ((snap = { ...snap, status: 'ready' }), true),
    play: async () => ((snap = { ...snap, status: 'playing' }), true),
    pause: () => {},
    // #296: RegiaPlayer.unload (the take is let go when its song leaves).
    unload: () => {
      snap = { status: 'idle', positionMs: 0, durationMs: null } as typeof snap;
    },
    stop: async () => {},
    snapshot: () => snap,
    subscribe: () => () => {},
    dispose: () => {},
  } as RegiaPlayer;
};

const SONGS: RegiaSong[] = [
  { id: 'r1', songId: 'a', setNumber: 1, title: 'Empire State of Mind' },
  { id: 'r2', songId: 'b', setNumber: 1, title: 'New York, New York' },
  { id: 'r3', songId: 'c', setNumber: 1, title: 'Brooklyn Bridge' },
];

const jumpTo = vi.fn();
const clearPendingOrder = vi.fn();
// useStageLive's pending order save (ids of the last move not saved yet).
const pending = { ids: null as string[] | null };
const pendingOrder = () => pending.ids;
const setup = (live: RegiaSong[] = SONGS, stored?: RegiaSong[]) =>
  renderHook(() =>
    useStageRegia({
      eventId: 'gig-1',
      setlistId: 'sl',
      open: true,
      isAdmin: true,
      myName: 'Ana',
      clientId: 'me',
      send: vi.fn(),
      bridge: { current: {} } as { current: StageRegiaBridge },
      songs: live,
      ...(stored ? { savedSongs: stored, clearPendingOrder, pendingOrder } : {}),
      currentId: 'r1',
      select: vi.fn(),
      jumpTo,
      createPlayer: player,
    }),
  );

beforeEach(() => {
  localStorage.clear();
  db.rows = SONGS.map((s, i) => ({ id: s.id!, setlist_id: 'sl', song_id: s.songId!, position: i + 1, set_number: 1 }));
  db.upserts = 0;
  db.inserts = 0;
  db.n = 0;
  jumpTo.mockClear();
  clearPendingOrder.mockClear();
  pending.ids = null;
});

describe('Regia: a song off the setlist added on stage', () => {
  it('a song another admin removed meanwhile does not come back, nothing is written, pick again', async () => {
    const { result } = setup();
    act(() => result.current.turnOn());
    // Another device removes "b" (row r2); this one still shows it.
    db.rows = db.rows.filter((r) => r.id !== 'r2');
    let out: unknown;
    await act(async () => {
      out = await result.current.playExtra({ id: 'd', title: 'Juicy', audio: 'sb://song-files/b/audio/d.mp3' });
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(out).toBe('changed');
    expect(result.current.error).toEqual({ kind: 'changed' });
    expect(db.upserts + db.inserts).toBe(0);
    expect(db.rows.map((r) => r.id)).toEqual(['r1', 'r3']);
    expect(jumpTo).not.toHaveBeenCalled();
  });

  it('nothing changed meanwhile: one save, the song right after the current one, everyone jumps to its new row', async () => {
    const { result } = setup();
    act(() => result.current.turnOn());
    await act(async () => {
      await result.current.playExtra({ id: 'd', title: 'Juicy', audio: 'sb://song-files/b/audio/d.mp3' });
    });
    expect(db.rows.map((r) => r.id)).toEqual(['r1', 'new-1', 'r2', 'r3']);
    expect(db.upserts + db.inserts).toBe(0);
    expect(jumpTo).toHaveBeenCalledWith('new-1', ['r1', 'new-1', 'r2', 'r3'], expect.any(Array));
  });

  it('the same song twice, swapped meanwhile by another admin, is a change (row ids are checked)', async () => {
    const { result } = setup();
    act(() => result.current.turnOn());
    // Same songs in the same places, but other rows there (moved on another device).
    db.rows = [
      { id: 'r3', setlist_id: 'sl', song_id: 'a', position: 1, set_number: 1 },
      { id: 'r2', setlist_id: 'sl', song_id: 'b', position: 2, set_number: 1 },
      { id: 'r1', setlist_id: 'sl', song_id: 'c', position: 3, set_number: 1 },
    ];
    let out: unknown;
    await act(async () => {
      out = await result.current.playExtra({ id: 'd', title: 'Juicy', audio: null });
    });
    expect(out).toBe('changed');
    expect(db.rows.map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
  });

  // Round 8 (Claude r7): `expected` is the stored order, not the one on
  // screen. A move here not saved yet (or an order that came over Bluetooth
  // offline) made every add a "changed", reload, picker again, forever.
  it('a move on this device not saved yet: the add saves in the live order and the pending order save is dropped', async () => {
    const live = [SONGS[1], SONGS[0], SONGS[2]];
    const { result } = setup(live, SONGS);
    act(() => result.current.turnOn());
    let out: unknown;
    await act(async () => {
      out = await result.current.playExtra({ id: 'd', title: 'Juicy', audio: 'sb://song-files/b/audio/d.mp3' });
    });
    expect(out).not.toBe('changed');
    expect(result.current.error).toBeNull();
    expect(db.rows.map((r) => r.id)).toEqual(['r2', 'r1', 'new-1', 'r3']);
    expect(jumpTo).toHaveBeenCalledWith('new-1', ['r2', 'r1', 'new-1', 'r3'], expect.any(Array));
    expect(clearPendingOrder).toHaveBeenCalledTimes(1);
  });

  // Round 9 (Claude r8 nit): the pending order was dropped after the save's
  // await, so a move made while the add was in flight was lost too.
  it('a move made while the add is in flight survives: only the order pending when the add started is dropped', async () => {
    const live = [SONGS[1], SONGS[0], SONGS[2]];
    const before = ['r2', 'r1', 'r3'];
    pending.ids = before;
    const { supabase } = await import('@/lib/supabase');
    const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
    const real = rpc.getMockImplementation() as (...a: unknown[]) => unknown;
    rpc.mockImplementationOnce(async (...a: unknown[]) => {
      pending.ids = ['r3', 'r2', 'r1']; // the leader moves a song meanwhile
      return real(...a);
    });
    const { result } = setup(live, SONGS);
    act(() => result.current.turnOn());
    await act(async () => {
      await result.current.playExtra({ id: 'd', title: 'Juicy', audio: 'sb://song-files/b/audio/d.mp3' });
    });
    expect(clearPendingOrder).toHaveBeenCalledTimes(1);
    expect(clearPendingOrder.mock.calls[0][0]).toBe(before);
  });

  it('changed meanwhile on another device, with a local move too: still a change, the pending order is kept', async () => {
    const live = [SONGS[1], SONGS[0], SONGS[2]];
    const { result } = setup(live, SONGS);
    act(() => result.current.turnOn());
    db.rows = db.rows.filter((r) => r.id !== 'r3');
    let out: unknown;
    await act(async () => {
      out = await result.current.playExtra({ id: 'd', title: 'Juicy', audio: null });
    });
    expect(out).toBe('changed');
    expect(db.rows.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(clearPendingOrder).not.toHaveBeenCalled();
  });
});
