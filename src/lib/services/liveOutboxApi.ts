/**
 * Sending the changes kept on this phone (liveOutbox.ts) once back online.
 * Each one is safe to send twice; one the server no longer accepts is
 * reported as an error and dropped by the flush.
 */
import { supabase } from '../supabase';
import { diffSetlist } from '../setlistChanges';
import { queueLiveOp, type LiveOp, type LiveOutboxApi, type OrderRow } from '../liveOutbox';
import { isOfflineError } from '../offline/networkErrors';
import { sessionUserId } from '../sessionUser';
import { saveSetlistOrder } from './songs';
import { notifySetlistSaved } from './setlistNotify';
import { notifyPersonalChanged } from './personalLayer';
import { notifySuggestionsChanged } from './songSuggestions';

/** Same as useStageLive's: the gig behind reloads its setlist in the new order. */
const SETLIST_ORDER_SAVED = 'bw:setlist-order-saved';

const isDuplicate = (e: unknown) => (e as { code?: string } | null)?.code === '23505';

export const liveOutboxApi: LiveOutboxApi = {
  async note(op) {
    const row = { song_id: op.songId, anchor: op.anchor, body: op.body };
    // Written offline: create it with its own id (again is harmless). An
    // edit: only if the note is still there (deleted on another device: nothing).
    const { error } = op.isNew
      ? await supabase.from('song_personal_notes').upsert({ id: op.id, ...row }, { onConflict: 'id' })
      : await supabase.from('song_personal_notes').update({ body: op.body, anchor: op.anchor }).eq('id', op.id);
    if (!error) notifyPersonalChanged(op.songId);
    return { error };
  },

  async noteDelete(op) {
    const { error } = await supabase.from('song_personal_notes').delete().eq('id', op.id);
    if (!error) notifyPersonalChanged(op.songId);
    return { error };
  },

  async suggestion(op) {
    const { error } = await supabase.from('song_suggestions').insert({ id: op.id, ...op.row });
    if (error && !isDuplicate(error)) return { error };
    notifySuggestionsChanged();
    return { error: null };
  },

  async order(op: Extract<LiveOp, { kind: 'order' }>) {
    // Someone changed the setlist meanwhile (added or removed songs): this
    // order no longer fits it and would bring removed songs back.
    const { data, error } = await supabase.from('setlist_songs').select('id').eq('setlist_id', op.setlistId);
    if (error) return { error };
    const now = new Set(((data as { id: string }[] | null) ?? []).map((r) => r.id));
    if (now.size !== op.rows.length || op.rows.some((r) => !now.has(r.id))) {
      return { error: new Error('The setlist changed meanwhile.') };
    }
    const res = await saveSetlistOrder(op.rows);
    if (res.error) return res;
    void notifySetlistSaved({
      setlistId: op.setlistId,
      eventId: op.eventId,
      change: diffSetlist(op.before, op.rows.map((r) => ({ songId: r.song_id, setNumber: r.set_number }))),
    });
    try {
      window.dispatchEvent(new CustomEvent(SETLIST_ORDER_SAVED, { detail: { setlistId: op.setlistId } }));
    } catch {
      /* no window */
    }
    return { error: null };
  },
};

/**
 * Stage: the leader's new order could not be saved. With no signal it stays
 * (on screen, over Bluetooth) and is saved when back online: true. Any other
 * failure: false (the caller goes back to the saved order).
 */
export async function keepOrderOffline(
  error: unknown,
  order: { setlistId: string; eventId?: string; rows: OrderRow[]; before: { songId: string; setNumber?: number }[] },
): Promise<boolean> {
  if (!isOfflineError(error)) return false;
  const me = await sessionUserId();
  if (!me) return false;
  queueLiveOp(me, { kind: 'order', ...order });
  return true;
}
