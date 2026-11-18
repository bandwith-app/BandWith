import { describe, it, expect, vi, beforeEach } from 'vitest';

// Records every query the service builds: table, select string and filters.
const calls = vi.hoisted(() => ({ list: [] as { table: string; select: string; filters: unknown[][] }[], rows: [] as unknown[] }));
vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const entry = { table, select: '', filters: [] as unknown[][] };
    calls.list.push(entry);
    const q: Record<string, unknown> = {};
    for (const m of ['eq', 'in', 'or', 'order', 'limit']) {
      q[m] = (...args: unknown[]) => { entry.filters.push([m, ...args]); return q; };
    }
    q.select = (s: string) => { entry.select = s; return q; };
    q.then = (resolve: (v: unknown) => void) => resolve({ data: calls.rows, error: null });
    return q;
  };
  return { supabase: { from }, getSafeUser: vi.fn() };
});

import { getSongs, getSetlistSongIds, SONG_LIST_COLUMNS } from '../songs';

const HEAVY = ['lyrics', 'chord_chart', 'notes'];
const cols = (select: string) => select.split(',').map((c) => c.trim());

beforeEach(() => {
  calls.list.length = 0;
  calls.rows = [];
});

describe('song lists download only the columns they show', () => {
  it('list columns leave out lyrics, chord charts and notes', () => {
    for (const heavy of HEAVY) expect(cols(SONG_LIST_COLUMNS)).not.toContain(heavy);
    for (const needed of ['id', 'band_id', 'title', 'artist', 'duration_seconds', 'genre', 'category', 'status', 'priority']) {
      expect(cols(SONG_LIST_COLUMNS)).toContain(needed);
    }
  });

  it("getSongs(..., { columns: 'list' }) selects the list columns", async () => {
    await getSongs('band-1', { columns: 'list' });
    expect(calls.list[0].table).toBe('songs');
    expect(calls.list[0].select).toBe(SONG_LIST_COLUMNS);
  });

  it('getSongs keeps every column by default (editor and reader need lyrics)', async () => {
    await getSongs('band-1');
    expect(calls.list[0].select).toBe('*');
  });
});

describe('getSetlistSongIds', () => {
  it('reads the song ids of many setlists in one small query, in running order', async () => {
    calls.rows = [
      { setlist_id: 'a', song_id: 's1' },
      { setlist_id: 'b', song_id: 's3' },
      { setlist_id: 'a', song_id: 's2' },
    ];
    const { data, error } = await getSetlistSongIds(['a', 'b']);
    expect(error).toBeNull();
    expect(calls.list).toHaveLength(1);
    expect(calls.list[0].table).toBe('setlist_songs');
    for (const heavy of [...HEAVY, '*']) expect(calls.list[0].select).not.toContain(heavy);
    expect(calls.list[0].filters).toContainEqual(['in', 'setlist_id', ['a', 'b']]);
    expect(data.get('a')).toEqual(['s1', 's2']);
    expect(data.get('b')).toEqual(['s3']);
  });

  it('asks nothing when there are no setlists', async () => {
    const { data } = await getSetlistSongIds([]);
    expect(calls.list).toHaveLength(0);
    expect(data.size).toBe(0);
  });
});
