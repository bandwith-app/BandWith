import { describe, it, expect, vi, beforeEach } from 'vitest';

// Claude review of #295: deleting a song (or replacing its file, or a
// rejected suggestion) removed the stored files even when another song
// links the same one. The app now removes only what the server says nothing
// uses (bw_song_files_unused, 197); if it can't ask, it removes nothing.
const m = vi.hoisted(() => ({
  unused: [] as string[] | null,
  removed: [] as string[][],
  rpcs: [] as Array<{ fn: string; args: unknown }>,
  songRow: { audio_url: null as string | null, chart_url: null as string | null },
}));
vi.mock('@/lib/supabase', () => {
  const songs = {
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.songRow, error: null }) }) }),
    delete: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 'song-2' }], error: null }) }) }),
  };
  return {
    supabase: {
      from: () => songs,
      rpc: vi.fn(async (fn: string, args: unknown) => {
        m.rpcs.push({ fn, args });
        if (fn !== 'bw_song_files_unused') return { data: null, error: null };
        return m.unused === null ? { data: null, error: { message: 'Could not find the function', code: 'PGRST202' } } : { data: m.unused, error: null };
      }),
      storage: { from: () => ({ remove: async (p: string[]) => (m.removed.push(p), { data: [], error: null }) }) },
    },
  };
});

import { removeSongFiles } from '../songFiles';
import { deleteSong } from '../songs';

const O = 'sb://song-files/band-1/audio/o-band-take.mp3';
const U = 'sb://song-files/band-1/suggestions/member-1/audio/u-own.mp3';

beforeEach(() => {
  m.unused = [];
  m.removed = [];
  m.rpcs = [];
});

describe('removing song files', () => {
  it('keeps a file another song still uses', async () => {
    m.unused = [U];
    await removeSongFiles([O, U, null, 'https://example.com/x.mp3']);
    expect(m.rpcs.find((r) => r.fn === 'bw_song_files_unused')?.args).toEqual({ p_refs: [O, U] });
    expect(m.removed).toEqual([['band-1/suggestions/member-1/audio/u-own.mp3']]);
  });

  it('removes nothing when it cannot ask the server', async () => {
    m.unused = null;
    await removeSongFiles([O, U]);
    expect(m.removed).toEqual([]);
  });

  it('deleting a song leaves a recording another song uses', async () => {
    m.songRow = { audio_url: O, chart_url: null };
    m.unused = [];
    expect((await deleteSong('song-2')).error).toBeNull();
    expect(m.removed).toEqual([]);
  });
});
