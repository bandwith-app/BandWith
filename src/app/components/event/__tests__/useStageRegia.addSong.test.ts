import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Round 6 (main session): a song added on the Regia was saved with a plain
// upsert of every row the device still showed, so a song another admin had
// just removed came back. Now the new order is one guarded save (188, row
// ids, `expected`): changed meanwhile, nothing but the added song is written.
// Made-up setlist (Brooklyn gig).

type Row = { id: string; setlist_id: string; song_id: string; position: number; set_number: number };
const db = vi.hoisted(() => ({ rows: [] as Row[], upserts: 0, n: 0 }));
vi.mock('@/lib/supabase', () => {
  const order = (rows: Row[]) => [...rows].sort((a, b) => a.set_number - b.set_number || a.position - b.position);
  const from = (table: string) => {
    let insert: Omit<Row, 'id'> | null = null;
    const b: any = {
      insert: (v: Omit<Row, 'id'>) => ((insert = v), b),
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
      rpc: vi.fn(async (_fn: string, args: { p_setlist_id: string; p_songs: { id?: string; song_id: string; set_number: number }[]; p_expected?: { songs: { song_id: string; set_number: number }[] } }) => {
        const now = order(db.rows).map((r) => ({ song_id: r.song_id, set_number: r.set_number }));
        if (args.p_expected && JSON.stringify(args.p_expected.songs) !== JSON.stringify(now)) {
          return { data: { saved: false, conflict: true, current: { name: 'Brooklyn', songs: now } }, error: null };
        }
        db.rows = args.p_songs.map((s, i) => ({ id: s.id ?? `x-${i}`, setlist_id: args.p_setlist_id, song_id: s.song_id, position: i + 1, set_number: s.set_number }));
        return { data: { saved: true, previous: [] }, error: null };
      }),
    },
    getSafeUser: async () => ({ data: { user: { id: 'u-admin' } } }),
  };
});
vi.mock('@/lib/regiaAudio', async () => ({
  audioFailureFor: (await vi.importActual<typeof import('@/lib/regiaAudio')>('@/lib/regiaAudio')).audioFailureFor,
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

const setup = () =>
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
      songs: SONGS,
      currentId: 'r1',
      select: vi.fn(),
      jumpTo: vi.fn(),
      createPlayer: player,
    }),
  );

beforeEach(() => {
  localStorage.clear();
  db.rows = SONGS.map((s, i) => ({ id: s.id!, setlist_id: 'sl', song_id: s.songId!, position: i + 1, set_number: 1 }));
  db.upserts = 0;
  db.n = 0;
});

describe('Regia: a song off the setlist added on stage', () => {
  it('a song another admin removed meanwhile does not come back', async () => {
    const { result } = setup();
    act(() => result.current.turnOn());
    // Another device removes "b" (row r2); this one still shows it.
    db.rows = db.rows.filter((r) => r.id !== 'r2');
    await act(async () => {
      await result.current.playExtra({ id: 'd', title: 'Juicy', audio: 'sb://song-files/b/audio/d.mp3' });
    });
    await waitFor(() => expect(db.rows.some((r) => r.song_id === 'd')).toBe(true));
    await new Promise((r) => setTimeout(r, 30));
    expect(db.upserts).toBe(0);
    expect(db.rows.map((r) => r.song_id)).not.toContain('b');
    expect(db.rows.map((r) => r.id).sort()).toEqual(['new-1', 'r1', 'r3']);
  });

  it('nothing changed meanwhile: the song goes right after the current one, rows keep their ids', async () => {
    const { result } = setup();
    act(() => result.current.turnOn());
    await act(async () => {
      await result.current.playExtra({ id: 'd', title: 'Juicy', audio: 'sb://song-files/b/audio/d.mp3' });
    });
    await waitFor(() => expect(db.rows.map((r) => r.id)).toEqual(['r1', 'new-1', 'r2', 'r3']));
    expect(db.upserts).toBe(0);
  });
});
