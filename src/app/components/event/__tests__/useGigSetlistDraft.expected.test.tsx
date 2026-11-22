import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const replaceSetlistSongs = vi.fn();
vi.mock('@/lib/services/songs', () => ({
  replaceSetlistSongs: (...a: unknown[]) => replaceSetlistSongs(...a),
  createSetlist: vi.fn(),
  getSetlist: vi.fn(),
  getSetlists: vi.fn(),
}));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: vi.fn() }));
vi.mock('@/lib/haptics', () => ({ haptic: { confirm: vi.fn() } }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { useGigSetlistDraft } from '../GigSetlistEditor';

// Audit review (Claude MINOR 9): the gig's own setlist editor saved without
// `expected`, so a save over someone else's newer setlist overwrote it.
const songs = [
  { id: 'r1', songId: 'A', setNumber: 1, title: 'Autumn Leaves' },
  { id: 'r2', songId: 'B', setNumber: 1, title: 'Blue Bossa' },
  { id: 'r3', songId: 'A', setNumber: 3, title: 'Autumn Leaves' },
];

describe('useGigSetlistDraft save', () => {
  beforeEach(() => replaceSetlistSongs.mockReset());

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
    expect(rows).toEqual([
      { song_id: 'B', set_number: 1 }, { song_id: 'A', set_number: 1 }, { song_id: 'A', set_number: 2 },
    ]);
    expect(opts).toEqual({ expected: { songs: [
      { song_id: 'A', set_number: 1 }, { song_id: 'B', set_number: 1 }, { song_id: 'A', set_number: 3 },
    ] } });
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
