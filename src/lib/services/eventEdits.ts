/**
 * Saves made from a gig's or rehearsal's overview (one card at a time).
 * Same writes and notifications as the Edit page (handleEventCreate):
 *  - the event row through updateEvent: the database trigger tells the
 *    lineup about a new date, time, load-in / soundcheck or venue;
 *  - the lineup as a diff (everyone keeps their RSVP), with the invite to
 *    who was added and the "taken off the lineup" notice to who was removed;
 *  - the to-dos through syncEventTasks.
 * Offline, the change is queued like the Edit page's (update_event).
 */
import { supabase } from '@/lib/supabase';
import { updateEvent } from './events';
import { saveEventLineup, type LineupRow } from './eventMemberMoney';
import { notifyEventMembersCreated, notifyEventMembersRemoved } from './notifications';
import { syncEventTasks, withTaskClientIds, type EventTaskDraft } from './eventTasks';
import { enqueueMutation } from '@/lib/offline/syncQueue';
import { isOfflineError } from '@/lib/offline/networkErrors';
import { lineupDiff, type QueuedEventExtras } from '@/lib/offline/eventExtras';

export type EditSaveResult = { error: Error | null; offline?: boolean };

const offlineNow = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Queues the change for the next sync (an update needs a field: the title, unchanged, when only extras changed). */
async function queueEdit(eventId: string, updates: Record<string, unknown>, title: string, extras?: QueuedEventExtras): Promise<EditSaveResult> {
  const fields = Object.keys(updates).length > 0 ? updates : { title };
  await enqueueMutation('update_event', {
    eventId,
    updates: { ...fields, _isPendingSync: true },
    ...(extras && Object.keys(extras).length > 0 ? { extras } : {}),
  });
  return { error: null, offline: true };
}

/** The event row: one card's fields. */
export async function saveEventFields(eventId: string, patch: Record<string, unknown>, title: string): Promise<EditSaveResult> {
  if (offlineNow()) return queueEdit(eventId, patch, title);
  const { error } = await updateEvent(eventId, patch as any);
  if (error && isOfflineError(error)) return queueEdit(eventId, patch, title);
  return { error };
}

export interface LineupEditContext {
  eventId: string;
  bandId: string;
  /** events.event_type ('rehearsal', 'wedding'…): the invitation's wording. */
  eventType: string;
  title: string;
  date: string;
  time: string;
  venue?: string;
  actorId: string;
  actorName: string;
  feeTbd?: boolean;
}

/**
 * The lineup (and, for a gig, the fee that follows it). `wanted` is the
 * whole lineup after the edit, with roles and fees; new people get
 * `status` (pending, or confirmed for the admin who edits). An empty list
 * takes everyone off.
 */
export async function saveLineupEdit(
  ctx: LineupEditContext,
  wanted: LineupRow[],
  eventPatch: Record<string, unknown> | null,
): Promise<EditSaveResult & { added: string[]; removed: string[] }> {
  const none = { added: [] as string[], removed: [] as string[] };
  if (offlineNow()) return { ...(await queueEdit(ctx.eventId, eventPatch || {}, ctx.title, { lineup: wanted })), ...none };

  const { data: existingRows, error: readErr } = await supabase
    .from('event_members')
    .select('user_id, status, role')
    .eq('event_id', ctx.eventId);
  if (readErr) {
    if (isOfflineError(readErr)) return { ...(await queueEdit(ctx.eventId, eventPatch || {}, ctx.title, { lineup: wanted })), ...none };
    return { error: new Error(readErr.message), ...none };
  }
  const existing = (existingRows || []) as { user_id: string; status?: string | null; role?: string | null }[];
  const statusOf = new Map(existing.map((r) => [r.user_id, r.status]));
  const roleOf = new Map(existing.map((r) => [r.user_id, r.role ?? null]));
  const diff = lineupDiff(existing, wanted);
  const removed = diff.removed;
  // No role given: the one already on the lineup stays.
  const rows = diff.rows.map((r) => (r.role === undefined ? { ...r, role: roleOf.get(r.user_id) ?? null } : r));

  if (removed.length > 0) {
    const { error } = await supabase.from('event_members').delete().eq('event_id', ctx.eventId).in('user_id', removed);
    if (error) return { error: new Error(error.message), ...none };
  }
  const { error: upErr } = await saveEventLineup(ctx.eventId, rows);
  if (upErr) return { error: upErr, ...none };

  if (eventPatch && Object.keys(eventPatch).length > 0) {
    const { error } = await updateEvent(ctx.eventId, eventPatch as any);
    if (error) return { error, ...none };
  }

  // Told as on the Edit page: not the admin who edits, not who had declined.
  const added = rows.map((r) => r.user_id).filter((id) => !statusOf.has(id) && id !== ctx.actorId);
  const removedTold = removed.filter((id) => id !== ctx.actorId && statusOf.get(id) !== 'declined');
  try {
    if (added.length > 0) {
      const memberFees: Record<string, number> = {};
      wanted.forEach((r) => {
        if (r.fee) memberFees[r.user_id] = Number(r.fee) || 0;
      });
      await notifyEventMembersCreated(ctx.bandId, ctx.eventId, ctx.title || 'Event', ctx.date, ctx.time || '20:00', ctx.eventType, ctx.actorId, ctx.actorName, added, {
        venue: ctx.venue,
        memberFees,
        feeTbd: !!ctx.feeTbd,
      });
    }
    if (removedTold.length > 0) {
      await notifyEventMembersRemoved(ctx.bandId, ctx.eventId, ctx.title || 'Event', ctx.date, ctx.eventType, ctx.actorId, ctx.actorName, removedTold);
    }
  } catch (err) {
    console.error('Notify error:', err);
  }
  return { error: null, added, removed };
}

/** The to-dos: renamed, removed and new ones (syncEventTasks). */
export async function saveTasksEdit(
  eventId: string,
  drafts: EventTaskDraft[],
  eventDate: string | null,
  originalIds: string[],
  title: string,
): Promise<EditSaveResult> {
  // Ids of new to-dos chosen now, so the queue keeps the ones a cut-off try sent.
  withTaskClientIds(drafts);
  const queue = () => queueEdit(eventId, {}, title, { tasks: { drafts, originalIds, eventDate } });
  if (offlineNow()) return queue();
  const { error } = await syncEventTasks(eventId, drafts, eventDate, originalIds);
  if (error && isOfflineError(error)) return queue();
  return { error };
}
