/**
 * Sending the changes kept on this phone (liveOutbox.ts) once back online.
 * Each one is safe to send twice; one the server no longer accepts (or that
 * matched no row) is reported as an error, never as sent. Every change is
 * written as the outbox owner only: named in the row where RLS checks it, and
 * the session checked right before the request.
 */
import { supabase } from '../supabase';
import { diffSetlist } from '../setlistChanges';
import { queueLiveOp, type LiveOp, type LiveOutboxApi, type OrderRow } from '../liveOutbox';
import { isOfflineError } from '../offline/networkErrors';
import { sessionUserId } from '../sessionUser';
import { replaceSetlistSongs } from './songs';
import { notifySetlistSaved } from './setlistNotify';
import { notifyPersonalChanged } from './personalLayer';
import { notifySuggestionsChanged } from './songSuggestions';

/** Same as useStageLive's: the gig behind reloads its setlist in the new order. */
const SETLIST_ORDER_SAVED = 'bw:setlist-order-saved';

const isDuplicate = (e: unknown) => (e as { code?: string } | null)?.code === '23505';
/** Matched no row (RLS, another session, gone): not done. */
const noRow = (data: unknown) =>
  Array.isArray(data) && data.length > 0 ? null : Object.assign(new Error('Nothing was saved.'), { code: 'PGRST116' });
const notOwner = async (userId: string) =>
  (await sessionUserId()) === userId ? null : Object.assign(new Error('Signed in as someone else.'), { code: '42501' });

export const liveOutboxApi: LiveOutboxApi = {
  // A note is the outbox owner's: named in the row (RLS user_id = auth.uid()
  // refuses any other session), and edits and deletes match only their notes.
  async isSessionUser(userId) {
    return (await sessionUserId()) === userId;
  },

  async note(op, userId) {
    const row = { song_id: op.songId, anchor: op.anchor, body: op.body, user_id: userId };
    // Written offline: create it with its own id (again is harmless). An
    // edit: only if the note is still there (deleted on another device: nothing).
    const { data, error: writeError } = op.isNew
      ? await supabase.from('song_personal_notes').upsert({ id: op.id, ...row }, { onConflict: 'id' }).select('id')
      : await supabase.from('song_personal_notes').update({ body: op.body, anchor: op.anchor }).eq('id', op.id).eq('user_id', userId).select('id');
    const error = writeError ?? noRow(data);
    if (!error) notifyPersonalChanged(op.songId);
    return { error };
  },

  async noteDelete(op, userId) {
    const { data, error: writeError } = await supabase.from('song_personal_notes').delete().eq('id', op.id).eq('user_id', userId).select('id');
    if (writeError) return { error: writeError };
    // No row, with its owner signed in: the note is already gone (a delete
    // sent again after its answer was lost). Another session: not done.
    if (noRow(data)) {
      const other = await notOwner(userId);
      if (other) return { error: other };
    }
    notifyPersonalChanged(op.songId);
    return { error: null };
  },

  async suggestion(op, userId) {
    // created_by: the owner (RLS refuses it from any other session).
    const { error } = await supabase.from('song_suggestions').insert({ ...op.row, id: op.id, created_by: userId });
    if (error && !isDuplicate(error)) return { error };
    notifySuggestionsChanged();
    return { error: null };
  },

  async order(op: Extract<LiveOp, { kind: 'order' }>, userId) {
    const other = await notOwner(userId);
    if (other) return { error: other };
    // One save (188), only over the order this one was made on: someone
    // changed the setlist meanwhile (songs added, removed, moved), nothing
    // is written and no removed song comes back. Rows keep their ids.
    const inOrder = [...op.rows].sort((a, b) => (a.set_number ?? 1) - (b.set_number ?? 1) || a.position - b.position);
    const res = await replaceSetlistSongs(
      op.setlistId,
      // Each entry names its row: the same song twice keeps each row's singers.
      inOrder.map((r) => ({ id: r.id, song_id: r.song_id, set_number: r.set_number })),
      { expected: { songs: op.before.map((b) => ({ ...(b.id ? { id: b.id } : {}), song_id: b.songId, set_number: b.setNumber ?? 1 })) } },
    );
    if (res.error) return { error: res.error };
    // "Changed meanwhile" into exactly this order: sent before, its answer
    // lost. Anything else: refused for good, nothing written.
    const now = res.conflict?.songs;
    if (
      now &&
      now.length === inOrder.length &&
      inOrder.every((r, i) => r.song_id === now[i].song_id && (r.set_number ?? 1) === (now[i].set_number ?? 1) && (!now[i].id || now[i].id === r.id))
    )
      return { error: null };
    if (res.conflict) return { error: Object.assign(new Error('The setlist changed meanwhile.'), { code: 'BW_SETLIST_CONFLICT' }) };
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
 * failure: false (the caller goes back to the saved order). `owner`: who made
 * it; queued only while that account is still the one signed in (re-read now).
 */
export async function keepOrderOffline(
  error: unknown,
  order: { setlistId: string; eventId?: string; rows: OrderRow[]; before: { songId: string; setNumber?: number; id?: string }[] },
  owner?: string | null,
): Promise<boolean> {
  if (!isOfflineError(error)) return false;
  const me = await sessionUserId();
  if (!me || (owner !== undefined && owner !== me)) return false;
  queueLiveOp(me, { kind: 'order', ...order });
  return true;
}
