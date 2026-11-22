import { replaceSetlistSongs } from './songs';

/**
 * The gig's setlist as the wizard loaded it: which setlist, its songs in play
 * order (with row ids). `id: null`: the gig had no setlist when it was opened.
 */
export type LoadedGigSetlist = { id: string | null; songs: { song_id: string; set_number: number; id?: string }[] };

/** The setlist changed since it was loaded: nothing was written. */
export class SetlistConflictError extends Error {
  code = 'BW_SETLIST_CONFLICT';
  constructor() {
    super('Someone else changed this setlist while you were editing.');
  }
}

/**
 * The gig wizard's save over the gig's existing setlist (online and the
 * offline replay). It keeps the setlist's own name, and with what the wizard
 * loaded it is written only while the setlist is still that (188): a newer
 * setlist from someone else is never overwritten.
 */
export async function saveExistingGigSetlist(
  setlistId: string,
  songs: { song_id: string; set_number: number }[],
  loaded?: LoadedGigSetlist | null
) {
  // The gig now links another setlist than the one loaded: A is never
  // written over B (Codex review #292 round 6). The gig had none when the
  // wizard opened and has one now (someone else's): the same (round 7, B3).
  // Nothing written.
  if (loaded && loaded.id !== setlistId) throw new SetlistConflictError();
  const expected = loaded ? { songs: loaded.songs } : undefined;
  const res = await replaceSetlistSongs(setlistId, songs, expected ? { expected } : undefined);
  if (res.error) throw res.error;
  if (res.conflict) throw new SetlistConflictError();
  return res.previous ?? [];
}
