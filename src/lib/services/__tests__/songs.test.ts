import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = { table: string; op: string; payload?: any; filters: [string, any][] };
type Handler = (call: Call) => { data?: any; error?: any; count?: number | null };

const calls: Call[] = [];
let handler: Handler = () => ({ data: null, error: null });

/** Minimal chainable stand-in for the PostgREST builder: records each query. */
const builder = (table: string) => {
  const call: Call = { table, op: 'select', filters: [] };
  const b: any = {
    select: () => b,
    insert: (v: any) => ((call.op = 'insert'), (call.payload = v), b),
    update: (v: any) => ((call.op = 'update'), (call.payload = v), b),
    delete: () => ((call.op = 'delete'), b),
    eq: (c: string, v: any) => (call.filters.push([c, v]), b),
    is: (c: string, v: any) => (call.filters.push([`${c}:is`, v]), b),
    order: () => b,
    single: () => b,
    maybeSingle: () => b,
    then: (res: any, rej: any) => {
      calls.push(call);
      const out = handler(call);
      return Promise.resolve({ data: out.data ?? null, error: out.error ?? null, count: out.count ?? null }).then(res, rej);
    },
  };
  return b;
};

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (t: string) => builder(t), rpc: vi.fn() },
  getSafeUser: async () => ({ data: { user: { id: 'user-1' } } }),
}));

import { createSetlist, replaceSetlistSongs, addSongToSetlist, saveSongLyricsIfUnchanged, setlistMatches } from '../songs';
import { supabase } from '@/lib/supabase';

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
/** A database without 188: PostgREST can't find the function. */
const noFunction = () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });

beforeEach(() => {
  calls.length = 0;
  handler = () => ({ data: null, error: null });
  rpc.mockReset().mockImplementation(noFunction);
});

describe('replaceSetlistSongs, one transaction (188, audit 09 #3)', () => {
  it('saves the name, the songs and the count in one call and never deletes rows itself', async () => {
    rpc.mockImplementation(() =>
      Promise.resolve({ data: { song_count: 2, previous: [{ song_id: 'a', set_number: 1, position: 1 }] }, error: null })
    );
    const { error, previous } = await replaceSetlistSongs(
      'sl',
      [{ song_id: 'a', set_number: 1 }, { song_id: 'b', set_number: 2, notes: null }],
      { name: ' Rooftop Session ' }
    );
    expect(error).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('bw_save_setlist_songs', {
      p_setlist_id: 'sl',
      p_songs: [{ song_id: 'a', set_number: 1 }, { song_id: 'b', set_number: 2, notes: null }],
      p_name: 'Rooftop Session',
    });
    expect(previous).toEqual([{ song_id: 'a', set_number: 1, position: 1 }]);
    expect(calls.filter((c) => c.table === 'setlist_songs' && c.op !== 'select')).toEqual([]);
  });

  it('a save that fails on the server leaves the rows alone (no delete from the app)', async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement' } }));
    const { error } = await replaceSetlistSongs('sl', ['b']);
    expect(error).toMatchObject({ message: 'canceling statement' });
    expect(calls.some((c) => c.table === 'setlist_songs' && c.op === 'delete')).toBe(false);
  });

  it('before 188 is on the server: the old step-by-step save, the name last with the count', async () => {
    const { error } = await replaceSetlistSongs('sl', ['a'], { name: 'Gig' });
    expect(error).toBeNull();
    const writes = calls.filter((c) => c.op !== 'select').map((c) => `${c.table}.${c.op}`);
    expect(writes).toEqual(['setlist_songs.delete', 'setlist_songs.insert', 'setlists.update']);
    expect(calls.find((c) => c.table === 'setlists' && c.op === 'update')?.payload).toEqual({ song_count: 1, name: 'Gig' });
  });

  // Round 3 (Codex MINOR): the rename committed before the songs, so a failed
  // save still left the new name.
  it('before 188: songs that fail to save leave the name as it was', async () => {
    handler = (c) => (c.table === 'setlist_songs' && c.op === 'insert' ? { error: { message: 'boom' } } : {});
    const { error } = await replaceSetlistSongs('sl', ['a'], { name: 'Gig' });
    expect(error).toMatchObject({ message: 'boom' });
    expect(calls.some((c) => c.table === 'setlists' && c.op === 'update')).toBe(false);
  });
});

// Round 3 (Claude M5): two admins saving the same setlist. The save carries
// the setlist as the editor loaded it; changed meanwhile → a conflict, nothing written.
describe('replaceSetlistSongs: only over the setlist as loaded', () => {
  const expected = { name: 'Rooftop Session', songs: [{ song_id: 'a', set_number: 1 }] };

  it('sends what was loaded and reports the conflict the server found', async () => {
    const current = { name: 'Rooftop Session', songs: [{ song_id: 'a', set_number: 1 }, { song_id: 'z', set_number: 1 }] };
    rpc.mockImplementation(() => Promise.resolve({ data: { saved: false, conflict: true, current }, error: null }));
    const res = await replaceSetlistSongs('sl', ['b'], { name: 'Gig', expected });
    expect(rpc).toHaveBeenCalledWith('bw_save_setlist_songs', {
      p_setlist_id: 'sl',
      p_songs: [{ song_id: 'b', set_number: 1 }],
      p_name: 'Gig',
      p_expected: expected,
    });
    expect(res).toEqual({ error: null, conflict: current });
  });

  it('before 188: changed meanwhile → a conflict and no write', async () => {
    handler = (c) => {
      if (c.table === 'setlist_songs' && c.op === 'select')
        return { data: [
          { id: 'r1', setlist_id: 'sl', song_id: 'a', position: 1, set_number: 1, notes: null },
          { id: 'r9', setlist_id: 'sl', song_id: 'z', position: 2, set_number: 1, notes: null },
        ] };
      if (c.table === 'setlists' && c.op === 'select') return { data: { name: 'Rooftop Session' } };
      return {};
    };
    const res = await replaceSetlistSongs('sl', ['b'], { name: 'Gig', expected });
    // What is stored now, row by row (Codex r6 B6), as 188 returns it.
    expect(res.conflict).toEqual({
      name: 'Rooftop Session',
      songs: [
        { id: 'r1', song_id: 'a', set_number: 1, vocal_parts: null },
        { id: 'r9', song_id: 'z', set_number: 1, vocal_parts: null },
      ],
    });
    expect(calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  // Round 7 (Codex r6 B6): like 188, an expected row id or singer that changed is a conflict.
  it('setlistMatches: row ids and singers count when expected has them', () => {
    const stored = { name: 'N', songs: [{ id: 'r1', song_id: 'a', set_number: 1, vocal_parts: { lead: ['u1'] } }] };
    expect(setlistMatches(stored, { name: 'N', songs: [{ song_id: 'a', set_number: 1 }] })).toBe(true);
    expect(setlistMatches(stored, { name: 'N', songs: [{ id: 'r1', song_id: 'a', set_number: 1 }] })).toBe(true);
    expect(setlistMatches(stored, { name: 'N', songs: [{ id: 'r2', song_id: 'a', set_number: 1 }] })).toBe(false);
    expect(setlistMatches(stored, { name: 'N', songs: [{ song_id: 'a', set_number: 1, vocal_parts: { lead: ['u2'] } }] })).toBe(false);
    expect(setlistMatches(stored, { name: 'N', songs: [{ song_id: 'a', set_number: 1, vocal_parts: { lead: ['u1'] } }] })).toBe(true);
    expect(setlistMatches({ name: 'N', songs: [{ song_id: 'a', set_number: 1, vocal_parts: {} }] }, { name: 'N', songs: [{ song_id: 'a', set_number: 1, vocal_parts: null }] })).toBe(true);
  });

  it('a save hands back the rows as saved, with the new row’s id', async () => {
    const rows = [{ id: 'r1', song_id: 'a', set_number: 1, position: 1 }, { id: 'n1', song_id: 'b', set_number: 1, position: 2 }];
    rpc.mockImplementation(() => Promise.resolve({ data: { saved: true, previous: [], song_count: 2, rows }, error: null }));
    const res = await replaceSetlistSongs('sl', [{ id: 'r1', song_id: 'a' }, 'b']);
    expect(res.rows).toEqual(rows);
  });
});

describe('replaceSetlistSongs, before 188 (step by step)', () => {
  it('keeps set numbers and existing notes, and still accepts plain ids', async () => {
    handler = (c) =>
      c.table === 'setlist_songs' && c.op === 'select'
        ? { data: [{ id: 'r1', setlist_id: 'sl', song_id: 'a', position: 1, set_number: 1, notes: 'segue' }] }
        : {};

    const { error } = await replaceSetlistSongs('sl', [
      { song_id: 'a', set_number: 1 },
      { song_id: 'b', set_number: 2 },
      'c',
    ]);
    expect(error).toBeNull();
    const insert = calls.find((c) => c.table === 'setlist_songs' && c.op === 'insert');
    expect(insert?.payload).toEqual([
      { id: 'r1', setlist_id: 'sl', song_id: 'a', position: 1, set_number: 1, notes: 'segue' },
      { setlist_id: 'sl', song_id: 'b', position: 2, set_number: 2, notes: null },
      { setlist_id: 'sl', song_id: 'c', position: 3, set_number: 1, notes: null },
    ]);
    expect(calls.find((c) => c.table === 'setlists' && c.op === 'update')?.payload).toEqual({ song_count: 3 });
  });

  it('puts the previous rows back when the insert fails', async () => {
    const previous = [{ id: 'r1', setlist_id: 'sl', song_id: 'a', position: 1, set_number: 2, notes: null }];
    let inserts = 0;
    handler = (c) => {
      if (c.table === 'setlist_songs' && c.op === 'select') return { data: previous };
      if (c.table === 'setlist_songs' && c.op === 'insert') {
        inserts += 1;
        return inserts === 1 ? { error: { message: 'boom' } } : {};
      }
      return {};
    };

    const { error } = await replaceSetlistSongs('sl', ['b']);
    expect(error).toMatchObject({ message: 'boom' });
    const restore = calls.filter((c) => c.table === 'setlist_songs' && c.op === 'insert')[1];
    expect(restore?.payload).toEqual(previous);
    expect(calls.some((c) => c.table === 'setlists' && c.op === 'update')).toBe(false);
  });
});

describe('replaceSetlistSongs, before 188: who sings what survives (round 2, Codex B4)', () => {
  const stored = [
    { id: 'r1', setlist_id: 'sl', song_id: 'a', position: 1, set_number: 1, notes: 'segue', vocal_parts: { lead: ['u-ana'] } },
    { id: 'r2', setlist_id: 'sl', song_id: 'b', position: 2, set_number: 1, notes: null, vocal_parts: { bv: ['u-joe'] } },
  ];

  it('a rename with the same songs rewrites no rows', async () => {
    handler = (c) => (c.table === 'setlist_songs' && c.op === 'select' ? { data: stored } : {});
    const { error } = await replaceSetlistSongs('sl', [{ song_id: 'a', set_number: 1 }, { song_id: 'b', set_number: 1 }], { name: 'Gig' });
    expect(error).toBeNull();
    expect(calls.filter((c) => c.table === 'setlist_songs' && c.op !== 'select')).toEqual([]);
  });

  it('a new order keeps each row id and its vocal_parts', async () => {
    handler = (c) => (c.table === 'setlist_songs' && c.op === 'select' ? { data: stored } : {});
    const { error } = await replaceSetlistSongs('sl', ['b', 'a', 'c']);
    expect(error).toBeNull();
    const insert = calls.find((c) => c.table === 'setlist_songs' && c.op === 'insert');
    expect(insert?.payload).toEqual([
      { id: 'r2', setlist_id: 'sl', song_id: 'b', position: 1, set_number: 1, notes: null, vocal_parts: { bv: ['u-joe'] } },
      { id: 'r1', setlist_id: 'sl', song_id: 'a', position: 2, set_number: 1, notes: 'segue', vocal_parts: { lead: ['u-ana'] } },
      { setlist_id: 'sl', song_id: 'c', position: 3, set_number: 1, notes: null, vocal_parts: null },
    ]);
  });
});

describe('replaceSetlistSongs, before 188: the same song twice swapped by row id (round 5, Codex B4)', () => {
  it('each entry naming its row keeps it, with its own singers', async () => {
    const twice = [
      { id: 'r1', setlist_id: 'sl', song_id: 'a', position: 1, set_number: 1, notes: null, vocal_parts: { bv: ['u-joe'] } },
      { id: 'r9', setlist_id: 'sl', song_id: 'a', position: 2, set_number: 1, notes: null, vocal_parts: { lead: ['u-ana'] } },
    ];
    handler = (c) => (c.table === 'setlist_songs' && c.op === 'select' ? { data: twice } : {});
    const { error } = await replaceSetlistSongs('sl', [{ id: 'r9', song_id: 'a' }, { id: 'r1', song_id: 'a' }]);
    expect(error).toBeNull();
    const insert = calls.find((c) => c.table === 'setlist_songs' && c.op === 'insert');
    expect((insert?.payload as Array<{ id: string; position: number }>).map((r) => [r.id, r.position])).toEqual([['r9', 1], ['r1', 2]]);
  });
});

describe('saveSongLyricsIfUnchanged, before 189 (round 2, Codex B2)', () => {
  it('the write itself only lands on the version it compared', async () => {
    let reads = 0;
    handler = (c) => {
      if (c.table === 'songs' && c.op === 'select') {
        reads += 1;
        return reads === 1
          ? { data: { lyrics: 'Verse 1', updated_at: '2026-11-20T10:00:00.123456+00:00' } }
          : { data: { lyrics: 'Verse 1\n\nVerse 2', updated_at: '2026-11-20T10:00:01.5+00:00' } };
      }
      // Another admin saved a verse between the read and this write: no row matches.
      if (c.table === 'songs' && c.op === 'update') return { data: [] };
      return {};
    };
    const res = await saveSongLyricsIfUnchanged('s1', '[C]Verse 1', 'Verse 1');
    const update = calls.find((c) => c.table === 'songs' && c.op === 'update');
    expect(update?.filters).toContainEqual(['updated_at', '2026-11-20T10:00:00.123456+00:00']);
    expect(res).toEqual({ error: null, conflict: 'Verse 1\n\nVerse 2' });
  });

  it('no one else saved: written, no conflict', async () => {
    handler = (c) => {
      if (c.table === 'songs' && c.op === 'select') return { data: { lyrics: 'Verse 1', updated_at: '2026-11-20T10:00:00+00:00' } };
      if (c.table === 'songs' && c.op === 'update') return { data: [{ id: 's1' }] };
      return {};
    };
    const res = await saveSongLyricsIfUnchanged('s1', '[C]Verse 1', 'Verse 1');
    expect(res).toEqual({ error: null });
  });
});

// Round 3 (Codex B3): Transpose saves lyrics, key and chart in one request.
describe('saveSongLyricsIfUnchanged with other song fields', () => {
  it('sends them with the lyrics, in the same call (189 p_fields)', async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: { saved: true }, error: null }));
    await saveSongLyricsIfUnchanged('s1', '[D]Hi', '[C]Hi', { key: 'D', chord_chart: null });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('bw_save_song_lyrics', { p_song_id: 's1', p_lyrics: '[D]Hi', p_expected: '[C]Hi', p_fields: { key: 'D', chord_chart: null } });
  });

  it('before 189: one update carries the lyrics and the fields', async () => {
    handler = (c) => {
      if (c.table === 'songs' && c.op === 'select') return { data: { lyrics: '[C]Hi', updated_at: 't1' } };
      if (c.table === 'songs' && c.op === 'update') return { data: [{ id: 's1' }] };
      return {};
    };
    expect(await saveSongLyricsIfUnchanged('s1', '[D]Hi', '[C]Hi', { key: 'D' })).toEqual({ error: null });
    const updates = calls.filter((c) => c.table === 'songs' && c.op === 'update');
    expect(updates.map((u) => u.payload)).toEqual([{ key: 'D', lyrics: '[D]Hi' }]);
  });
});

describe('createSetlist', () => {
  it('fails and removes the new setlist when its songs cannot be added', async () => {
    handler = (c) => {
      if (c.table === 'setlists' && c.op === 'insert') return { data: { id: 'new-sl', name: 'Gig' } };
      if (c.table === 'setlist_songs' && c.op === 'insert') return { error: { message: 'denied' } };
      return {};
    };

    const { data, error } = await createSetlist({ band_id: 'band', name: 'Gig' }, [{ song_id: 'a', position: 0 }]);
    expect(data).toBeNull();
    expect(error).toMatchObject({ message: 'denied' });
    const del = calls.find((c) => c.table === 'setlists' && c.op === 'delete');
    expect(del?.filters).toContainEqual(['id', 'new-sl']);
  });
});

describe('addSongToSetlist', () => {
  it('recounts songs with a query instead of the missing RPC', async () => {
    handler = (c) => {
      if (c.table === 'setlist_songs' && c.op === 'insert') return { data: { id: 'r1' } };
      if (c.table === 'setlist_songs' && c.op === 'select') return { count: 4 };
      return {};
    };
    const { error } = await addSongToSetlist('sl', 'a', 4);
    expect(error).toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(calls.find((c) => c.table === 'setlists' && c.op === 'update')?.payload).toEqual({ song_count: 4 });
  });
});
