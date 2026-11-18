import { getSongs, getSetlists, getSetlistSongIds, type Song, type Setlist } from '@/lib/services/songs';

export interface RehearsalLibrary {
  songs: Song[];
  setlists: { setlist: Setlist; songIds: string[] }[];
}

/**
 * Songs and setlists for the rehearsal wizard. It shows titles, durations and
 * genres only, so songs come without lyrics/charts/notes, and the setlists'
 * running orders come from one ids-only query instead of one full setlist
 * (with every song's lyrics) per setlist (Supabase egress).
 */
export async function loadRehearsalLibrary(bandId: string): Promise<RehearsalLibrary> {
  const [songsRes, setlistsRes] = await Promise.all([
    getSongs(bandId, { columns: 'list' }),
    getSetlists(bandId),
  ]);
  const setlists = setlistsRes.data ?? [];
  const { data: ids } = await getSetlistSongIds(setlists.map((s) => s.id));
  return {
    songs: songsRes.data ?? [],
    setlists: setlists.map((setlist) => ({ setlist, songIds: ids.get(setlist.id) ?? [] })),
  };
}
