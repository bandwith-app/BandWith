import { supabase } from '@/lib/supabase';
import { hasSetlistChange, type SetlistChange, type SongField } from '@/lib/setlistChanges';

/**
 * The one notification after a setlist or song is saved (migration 107):
 * the server writes "2 songs moved, 1 added" in each person's language and
 * pushes it. With an event: that gig's lineup; without: the whole band.
 * Never throws: the save already worked, a lost notification isn't worth an
 * error on screen.
 */
export async function notifySetlistSaved(opts: {
  setlistId: string;
  eventId?: string | null;
  change: SetlistChange | null;
  renamed?: boolean;
}): Promise<void> {
  const { setlistId, eventId, change, renamed } = opts;
  if (!setlistId || (!hasSetlistChange(change) && !renamed)) return;
  try {
    const { error } = await supabase.rpc('bw_notify_setlist_saved', {
      p_setlist_id: setlistId,
      p_event_id: eventId || null,
      p_moved: change?.moved ?? 0,
      p_added: change?.added ?? 0,
      p_removed: change?.removed ?? 0,
      p_renamed: !!renamed,
    });
    if (error) console.warn('Setlist notification not sent:', error.message);
  } catch (err) {
    console.warn('Setlist notification not sent:', err);
  }
}

/** "Song updated · Superstition — Ana changed: key, tempo." to the band. */
export async function notifySongUpdated(songId: string, fields: SongField[]): Promise<void> {
  if (!songId) return;
  try {
    const { error } = await supabase.rpc('bw_notify_song_updated', { p_song_id: songId, p_fields: fields });
    if (error) console.warn('Song notification not sent:', error.message);
  } catch (err) {
    console.warn('Song notification not sent:', err);
  }
}
