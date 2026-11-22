import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const replaceSetlistSongs = vi.fn();
const createSetlist = vi.fn();
vi.mock('@/lib/services/songs', () => ({
  replaceSetlistSongs: (...a: unknown[]) => replaceSetlistSongs(...a),
  createSetlist: (...a: unknown[]) => createSetlist(...a),
  getSetlist: vi.fn(),
  getSetlists: vi.fn(),
}));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: vi.fn() }));
vi.mock('@/lib/haptics', () => ({ haptic: { confirm: vi.fn() } }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) },
}));

import { useGigSetlistDraft } from '../GigSetlistEditor';

// Audit review (Claude MINOR 9): the gig's own setlist editor saved without
// `expected`, so a save over someone else's newer setlist overwrote it.
const songs = [
  { id: 'r1', songId: 'A', setNumber: 1, title: 'Autumn Leaves' },
  { id: 'r2', songId: 'B', setNumber: 1, title: 'Blue Bossa' },
  { id: 'r3', songId: 'A', setNumber: 3, title: 'Autumn Leaves' },
];

describe('useGigSetlistDraft save', () => {
  beforeEach(() => {
    replaceSetlistSongs.mockReset();
    createSetlist.mockReset();
  });

  it('sends the setlist as it was loaded (stored set numbers) as expected', async () => {
    replaceSetlistSongs.mockResolvedValue({ error: null, previous: [] });
    const onSaved = vi.fn();
    const { result } = renderHook(() => useGigSetlistDraft({ songs, setlistId: 'sl-1', eventId: 'e1', bandId: 'b1', onSaved }));
    act(() => result.current.reorder('set-1', [...result.current.sets[0].songs].reverse()));
    let ok = false;
    await act(async () => { ok = await result.current.save(); });
    expect(ok).toBe(true);
    expect(replaceSetlistSongs).toHaveBeenCalledTimes(1);
    const [, rows, opts] = replaceSetlistSongs.mock.calls[0];
    // Each loaded song names its row (Codex 11-22), in the new order and sets.
    expect(rows).toEqual([
      { id: 'r2', song_id: 'B', set_number: 1 }, { id: 'r1', song_id: 'A', set_number: 1 }, { id: 'r3', song_id: 'A', set_number: 2 },
    ]);
    // Row by row (188 checks the row ids, Codex r6 B6).
    expect(opts).toEqual({ expected: { songs: [
      { id: 'r1', song_id: 'A', set_number: 1 }, { id: 'r2', song_id: 'B', set_number: 1 }, { id: 'r3', song_id: 'A', set_number: 3 },
    ] } });
  });

  // Codex 11-22: the rows went without ids, so 188 matched them by occurrence:
  // the same song twice with the first one removed gave the survivor the
  // first one's row (its singers and notes). The survivor names its own row.
  it('the same song twice, the first removed: the one left keeps its own row id', async () => {
    replaceSetlistSongs.mockResolvedValue({ error: null, previous: [] });
    const twice = [
      { id: 'r1', songId: 'A', setNumber: 1, title: 'Autumn Leaves' },
      { id: 'r2', songId: 'B', setNumber: 1, title: 'Blue Bossa' },
      { id: 'r3', songId: 'A', setNumber: 1, title: 'Autumn Leaves' },
    ];
    const { result } = renderHook(() => useGigSetlistDraft({ songs: twice, setlistId: 'sl-1', eventId: 'e1', bandId: 'b1', onSaved: vi.fn() }));
    act(() => result.current.remove('set-1', 'row-r1'));
    // A song picked now has no row yet.
    act(() => result.current.add('set-1', [{ id: 'C', title: 'Take the A Train', artist: 'Duke Ellington' }]));
    let ok = false;
    await act(async () => { ok = await result.current.save(); });
    expect(ok).toBe(true);
    const [, rows] = replaceSetlistSongs.mock.calls[0];
    expect(rows).toEqual([
      { id: 'r2', song_id: 'B', set_number: 1 }, { id: 'r3', song_id: 'A', set_number: 1 }, { song_id: 'C', set_number: 1 },
    ]);
  });

  it('a gig with no setlist yet: the new setlist gets new rows, no ids', async () => {
    createSetlist.mockResolvedValue({ data: { id: 'sl-new' }, error: null });
    const { result } = renderHook(() => useGigSetlistDraft({ songs: [], setlistId: null, eventId: 'e1', bandId: 'b1', onSaved: vi.fn() }));
    // A template's songs, here still carrying the rows they were read from.
    act(() => result.current.load([{ id: 'other-row', songId: 'A', setNumber: 1, title: 'Autumn Leaves' }]));
    let ok = false;
    await act(async () => { ok = await result.current.save(); });
    expect(ok).toBe(true);
    expect(replaceSetlistSongs).not.toHaveBeenCalled();
    expect(createSetlist.mock.calls[0][1]).toEqual([{ song_id: 'A', set_number: 1, position: 1 }]);
  });

  it('a conflict keeps the draft and says so', async () => {
    replaceSetlistSongs.mockResolvedValue({ error: null, conflict: { name: 'x', songs: [] } });
    const onSaved = vi.fn();
    const { result } = renderHook(() => useGigSetlistDraft({ songs, setlistId: 'sl-1', eventId: 'e1', bandId: 'b1', onSaved }));
    act(() => result.current.remove('set-1', result.current.sets[0].songs[0].uid));
    let ok = true;
    await act(async () => { ok = await result.current.save(); });
    expect(ok).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(true);
    expect(result.current.error).toMatch(/Someone else changed this setlist/);
  });
});
