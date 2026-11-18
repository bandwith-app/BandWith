import { describe, it, expect, vi } from 'vitest';

const svc = vi.hoisted(() => ({
  getSongs: vi.fn(async (..._args: unknown[]) => ({ data: [{ id: 's1', title: 'A' }], error: null })),
  getSetlists: vi.fn(async (..._args: unknown[]) => ({ data: [{ id: 'sl-1', name: 'Main' }, { id: 'sl-2', name: 'Encore' }], error: null })),
  getSetlist: vi.fn(),
  getSetlistSongIds: vi.fn(async (..._args: unknown[]) => ({ data: new Map([['sl-1', ['s1', 's2']]]), error: null })),
}));
vi.mock('@/lib/services/songs', () => svc);
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { loadRehearsalLibrary } from '../rehearsalLibrary';

describe('loadRehearsalLibrary (rehearsal wizard)', () => {
  it('loads songs without lyrics and every setlist order in one query, not one full setlist each', async () => {
    const lib = await loadRehearsalLibrary('band-1');
    expect(svc.getSongs).toHaveBeenCalledWith('band-1', expect.objectContaining({ columns: 'list' }));
    expect(svc.getSetlist).not.toHaveBeenCalled();
    expect(svc.getSetlistSongIds).toHaveBeenCalledTimes(1);
    expect(svc.getSetlistSongIds).toHaveBeenCalledWith(['sl-1', 'sl-2']);
    expect(lib.songs.map((s) => s.id)).toEqual(['s1']);
    expect(lib.setlists.map((s) => [s.setlist.id, s.songIds])).toEqual([
      ['sl-1', ['s1', 's2']],
      ['sl-2', []],
    ]);
  });
});
