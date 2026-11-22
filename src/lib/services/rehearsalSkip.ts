/**
 * "Delete this date" on a repeating rehearsal (audit 05 #4): the date is
 * added to recurrence_rule.skip_dates (lib/recurrenceSkips). The series row,
 * its session records and rehearsal notes of other dates stay.
 *
 * One server step (195, bw_skip_rehearsal_date) locks the row and appends the
 * date, so two admins skipping different dates at once both keep theirs
 * (Codex #297 B3). A database without 195, or the demo, gets the
 * read-then-write below.
 */
import { supabase } from '@/lib/supabase';
import { t } from '@/lib/i18n';
import { skippedDates, withSkippedDate } from '@/lib/recurrenceSkips';
import { createEvent } from './events';
import { createSetlist } from './songs';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (date: string | null | undefined) => {
  const d = (date || '').trim();
  return d.includes('T') ? d.split('T')[0] : d;
};

type RpcError = { code?: string; message?: string } | null | undefined;
const isMissingRpc = (err: RpcError): boolean =>
  !!err && (err.code === 'PGRST202' || err.code === '42883' || /could not find the function/i.test(err.message || ''));

const notRepeating = () => new Error(t('This rehearsal does not repeat any more. Reload and try again.'));
const notAdmin = () => new Error(t('Only band admins can delete this event.'));

/**
 * The move's own refusals (195, HINT bw:…): the date on screen is not one of
 * the series any more, was deleted already, or the new date is in the past
 * (Claude #297 r5 minor 4).
 */
const moveRefusal = (err: RpcError & { hint?: string | null }): Error | null => {
  switch (err?.hint) {
    case 'bw:not_a_date': return new Error(t('This date is no longer part of the series. Reload and try again.'));
    case 'bw:date_deleted': return new Error(t('This date was already deleted. Reload and try again.'));
    case 'bw:date_past': return new Error(t('The new date is in the past. Pick today or a later date.'));
    default: return null;
  }
};

/**
 * Columns the move never takes from the form: who and what the event is,
 * the recurrence and the date, the links (195 drops the same ones).
 */
const NOT_EDITABLE = new Set([
  'id', 'band_id', 'created_by', 'created_at', 'updated_at', 'is_recurring', 'recurrence_rule', 'event_date', 'date',
  'parent_event_id', 'quote_id', 'setlist_id', 'status', 'event_type',
]);
const editedColumns = (fields: Record<string, unknown> | undefined): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (NOT_EDITABLE.has(k) || k.startsWith('_') || v === undefined || typeof v === 'function') continue;
    out[k] = v;
  }
  return out;
};

/**
 * The date on screen of a repeating rehearsal. Refused, with a message, when
 * the band or the date is missing: this path never deletes the series.
 */
export async function deleteRehearsalDate(event: {
  eventId?: string | null;
  band_id?: string | null;
  date?: string | null;
}): Promise<{ error: Error | null }> {
  const day = dayOf(event.date);
  if (!event.eventId || !event.band_id || !DAY.test(day)) {
    return { error: new Error(t("This date can't be deleted on its own. Reload and try again.")) };
  }
  return skipRehearsalDate(event.eventId, day);
}

export async function skipRehearsalDate(eventId: string, date: string): Promise<{ error: Error | null }> {
  const day = dayOf(date);
  const { data, error } = await supabase.rpc('bw_skip_rehearsal_date', { p_event_id: eventId, p_date: day });
  if (error && !isMissingRpc(error as RpcError)) {
    const code = (error as RpcError)?.code;
    if (code === '42501') return { error: notAdmin() };
    if (code === '22023') return { error: notRepeating() };
    return { error: error as unknown as Error };
  }
  // An answer from 195: done.
  if (!error && data && typeof data === 'object' && Array.isArray((data as { skip_dates?: unknown }).skip_dates)) {
    return { error: null };
  }

  // No 195 (or no answer): the rule as stored now, so a date another admin
  // just skipped is kept.
  const { data: ev, error: readErr } = await supabase
    .from('events')
    .select('id, is_recurring, recurrence_rule')
    .eq('id', eventId)
    .maybeSingle();
  if (readErr) return { error: readErr as unknown as Error };
  const rule = (ev as { is_recurring?: boolean; recurrence_rule?: Record<string, unknown> | null } | null)?.recurrence_rule;
  if (!ev || !(ev as { is_recurring?: boolean }).is_recurring || !rule || typeof rule !== 'object') {
    return { error: notRepeating() };
  }
  const { data: saved, error: saveErr } = await supabase
    .from('events')
    .update({ recurrence_rule: withSkippedDate(rule, day) })
    .eq('id', eventId)
    .select('id');
  if (saveErr) return { error: saveErr as unknown as Error };
  if (!saved?.length) return { error: notAdmin() };
  return { error: null };
}

/**
 * A deleted date back in the series (Claude #297 r5 minor 5): the undo right
 * after "Delete this date", and Restore in the series' "Deleted dates".
 * With 195 only bw_restore_rehearsal_date can take a date out of skip_dates
 * (the keep-skip trigger refuses any other write); before 195 the rule is
 * written without it. Returns the dates still deleted.
 */
export async function restoreRehearsalDate(eventId: string | null | undefined, date: string | null | undefined): Promise<{ error: Error | null; skipDates?: string[] }> {
  const day = dayOf(date);
  if (!eventId || !DAY.test(day)) return { error: new Error(t("This date can't be restored. Reload and try again.")) };
  const { data, error } = await supabase.rpc('bw_restore_rehearsal_date', { p_event_id: eventId, p_date: day });
  if (error && !isMissingRpc(error as RpcError)) {
    const code = (error as RpcError)?.code;
    if (code === '42501') return { error: new Error(t('Only band admins can restore a date.')) };
    if (code === '22023') return { error: notRepeating() };
    return { error: error as unknown as Error };
  }
  const listed = (data as { skip_dates?: unknown } | null)?.skip_dates;
  if (!error && Array.isArray(listed)) return { error: null, skipDates: listed.filter((d): d is string => typeof d === 'string') };

  const { data: ev, error: readErr } = await supabase
    .from('events')
    .select('id, is_recurring, recurrence_rule')
    .eq('id', eventId)
    .maybeSingle();
  if (readErr) return { error: readErr as unknown as Error };
  const rule = (ev as { recurrence_rule?: Record<string, unknown> | null } | null)?.recurrence_rule;
  if (!ev || !rule || typeof rule !== 'object') return { error: notRepeating() };
  const rest = Array.from(skippedDates(rule)).filter((d) => d !== day).sort();
  const { data: saved, error: saveErr } = await supabase
    .from('events')
    .update({ recurrence_rule: { ...rule, skip_dates: rest } })
    .eq('id', eventId)
    .select('id');
  if (saveErr) return { error: saveErr as unknown as Error };
  if (!saved?.length) return { error: new Error(t('Only band admins can restore a date.')) };
  return { error: null, skipDates: rest };
}

const newRequestId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

/**
 * A new date for one date of a series, "Only this date" (Claude / Codex #297
 * round 3). With 195: one server step (bw_move_rehearsal_date) locks the
 * series, copies it as a one-off on the new date (every column but the
 * recurrence and the date, so the studio cost and the setlist too; the
 * lineup; rider & stage) and skips the old date, in one transaction. The
 * request id (`clientId`, kept by the sheet while it is open) is the new
 * event's id: a retry creates nothing more.
 * `fields` are the other columns edited in the wizard (venue, notes, fee…):
 * written with the copy, so there is one write and one notice listing what
 * changed, and no second update (Claude #297 r5 minor 2). The setlist is a
 * copy of the series' one, so editing it here leaves the series' alone
 * (minor 1).
 * Without 195 (or in the demo): the step-by-step copy below.
 */
export async function moveRehearsalDateOnly(
  event: { eventId?: string | null; band_id?: string | null; date?: string | null; seriesDate?: string | null },
  values: { title: string; date: string; startTime: string; endTime: string; clientId?: string; fields?: Record<string, unknown> },
): Promise<{ error: Error | null; eventId?: string }> {
  const from = dayOf(event.date);
  const to = dayOf(values.date);
  if (!event.eventId || !event.band_id || !DAY.test(from) || !DAY.test(to)) {
    return { error: new Error(t("This date can't be deleted on its own. Reload and try again.")) };
  }
  const edited = editedColumns(values.fields);
  const { data, error } = await supabase.rpc('bw_move_rehearsal_date', {
    p_event_id: event.eventId,
    p_date: from,
    p_new_date: to,
    p_fields: { ...edited, title: values.title.trim(), start_time: values.startTime || null, end_time: values.endTime || null },
    p_client_id: values.clientId || newRequestId(),
  });
  if (error && !isMissingRpc(error as RpcError)) {
    const code = (error as RpcError)?.code;
    if (code === '42501') return { error: notAdmin() };
    if (code === '22023') return { error: moveRefusal(error as RpcError & { hint?: string }) ?? notRepeating() };
    return { error: error as unknown as Error };
  }
  if (!error && data && typeof data === 'object' && typeof (data as { event_id?: unknown }).event_id === 'string') {
    return { error: null, eventId: (data as { event_id: string }).event_id };
  }

  // No 195: the public columns the app may read (081), then the old date out.
  const { data: series, error: readErr } = await supabase
    .from('events')
    .select('id, band_id, title, event_type, status, venue, venue_name, venue_address, venue_city, venue_country, notes, indoor_outdoor, dress_code, setlist_id, load_in_time, soundcheck_time, is_recurring, recurrence_rule')
    .eq('id', event.eventId)
    .maybeSingle();
  if (readErr) return { error: readErr as unknown as Error };
  const row = series as Record<string, any> | null;
  if (!row?.is_recurring) return { error: notRepeating() };
  const { data: people, error: peopleErr } = await supabase
    .from('event_members')
    .select('user_id, role, status')
    .eq('event_id', event.eventId);
  if (peopleErr) return { error: peopleErr as unknown as Error };

  // Its own copy of the setlist: the wizard may edit it next (minor 1).
  let setlistId: string | null = null;
  if (row.setlist_id) {
    const [{ data: sl }, { data: songs, error: songsErr }] = await Promise.all([
      supabase.from('setlists').select('name').eq('id', row.setlist_id).maybeSingle(),
      supabase.from('setlist_songs').select('song_id, position, set_number, notes').eq('setlist_id', row.setlist_id),
    ]);
    if (songsErr) return { error: songsErr as unknown as Error };
    const { data: copy, error: copyErr } = await createSetlist(
      { band_id: row.band_id, name: (sl as { name?: string } | null)?.name || t('Rehearsal setlist') },
      ((songs || []) as { song_id: string; position: number; set_number?: number | null; notes?: string | null }[])
        .map((x) => ({ song_id: x.song_id, position: x.position, set_number: x.set_number ?? 1, ...(x.notes ? { notes: x.notes } : {}) })),
    );
    if (copyErr || !copy?.id) return { error: copyErr || new Error(t('Save failed: {error}', { error: 'setlist' })) };
    setlistId = copy.id;
  }

  const { data: created, error: createErr } = await createEvent(
    {
      ...(values.clientId ? { id: values.clientId } : {}),
      band_id: row.band_id,
      event_type: row.event_type || 'rehearsal',
      status: row.status || 'confirmed',
      event_date: to,
      venue: row.venue ?? row.venue_name ?? null,
      venue_name: row.venue_name ?? row.venue ?? null,
      venue_address: row.venue_address ?? null,
      venue_city: row.venue_city ?? null,
      venue_country: row.venue_country ?? null,
      notes: row.notes ?? null,
      indoor_outdoor: row.indoor_outdoor ?? null,
      dress_code: row.dress_code ?? null,
      setlist_id: setlistId,
      load_in_time: row.load_in_time ?? null,
      soundcheck_time: row.soundcheck_time ?? null,
      ...edited,
      title: values.title.trim() || row.title,
      start_time: values.startTime || null,
      end_time: values.endTime || null,
      parent_event_id: event.eventId,
      is_recurring: false,
      recurrence_rule: null,
    } as any,
    ((people || []) as { user_id: string; role?: string | null; status?: string | null }[]).map((m) => ({
      user_id: m.user_id,
      role: m.role ?? undefined,
      status: m.status ?? undefined,
    })),
  );
  if (createErr) return { error: createErr };
  const skipped = await skipRehearsalDate(event.eventId, from);
  return skipped.error ? skipped : { error: null, eventId: (created as { id?: string } | null)?.id ?? values.clientId };
}
