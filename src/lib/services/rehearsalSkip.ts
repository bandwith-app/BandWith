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
import { withSkippedDate } from '@/lib/recurrenceSkips';

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
