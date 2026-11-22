import { describe, it, expect, vi, beforeEach } from 'vitest';

// Claude review of #295: deleting a song (or replacing its file, or a
// rejected suggestion) removed the stored files even when another song
// links the same one. Codex review of 02405d5c: a check and a delete as two
// requests let another admin link the file in between. The app now deletes
// only files the server claimed for it (bw_song_files_claim_delete: no link
// while claimed), then closes the claim; if it can't claim, it keeps them.
const m = vi.hoisted(() => ({
  claimable: [] as string[] | null,
  removeError: null as null | { message: string },
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
      rpc: vi.fn(async (fn: string, args: { p_refs?: string[] }) => {
        m.rpcs.push({ fn, args });
        if (fn === 'bw_song_files_claim_delete') {
          if (m.claimable === null) return { data: null, error: { message: 'Could not find the function', code: 'PGRST202' } };
          return { data: (args.p_refs || []).filter((r) => m.claimable!.includes(r)), error: null };
        }
        if (fn === 'bw_song_files_removed') return { data: (args.p_refs || []).length, error: null };
        return { data: null, error: { message: `unexpected rpc ${fn}` } };
      }),
      storage: { from: () => ({ remove: async (p: string[]) => (m.removed.push(p), { data: [], error: m.removeError }) }) },
    },
  };
});

import { removeSongFiles } from '../songFiles';
import { deleteSong } from '../songs';

const O = 'sb://song-files/band-1/audio/o-band-take.mp3';
const U = 'sb://song-files/band-1/suggestions/member-1/audio/u-own.mp3';
const calls = (fn: string) => m.rpcs.filter((r) => r.fn === fn).map((r) => r.args);

beforeEach(() => {
  m.claimable = [];
  m.removeError = null;
  m.removed = [];
  m.rpcs = [];
});

describe('removing song files', () => {
  it('deletes only what it claimed, then closes the claim', async () => {
    m.claimable = [U];
    await removeSongFiles([O, U, null, 'https://example.com/x.mp3']);
    expect(calls('bw_song_files_claim_delete')).toEqual([{ p_refs: [O, U] }]);
    expect(m.removed).toEqual([['band-1/suggestions/member-1/audio/u-own.mp3']]);
    expect(calls('bw_song_files_removed')).toEqual([{ p_refs: [U] }]);
    expect(m.rpcs.some((r) => r.fn === 'bw_song_files_unused')).toBe(false);
  });

  it('a failed delete leaves the claim to lapse (no "removed")', async () => {
    m.claimable = [U];
    m.removeError = { message: 'Storage unavailable' };
    await removeSongFiles([U]);
    expect(calls('bw_song_files_removed')).toEqual([]);
  });

  it('removes nothing when it cannot claim', async () => {
    m.claimable = null;
    await removeSongFiles([O, U]);
    expect(m.removed).toEqual([]);
  });

  it('deleting a song leaves a recording another song uses', async () => {
    m.songRow = { audio_url: O, chart_url: null };
    m.claimable = [];
    expect((await deleteSong('song-2')).error).toBeNull();
    expect(m.removed).toEqual([]);
  });
});
