/**
 * "Delete this date" on a repeating rehearsal (audit 05 #4): the date is
 * added to recurrence_rule.skip_dates (lib/recurrenceSkips). The series row,
 * its session records and rehearsal notes of other dates stay.
 */
import { supabase } from '@/lib/supabase';
import { t } from '@/lib/i18n';
import { withSkippedDate } from '@/lib/recurrenceSkips';

export async function skipRehearsalDate(eventId: string, date: string): Promise<{ error: Error | null }> {
  // The rule as stored now, so a date another admin just skipped is kept.
  const { data: ev, error: readErr } = await supabase
    .from('events')
    .select('id, is_recurring, recurrence_rule')
    .eq('id', eventId)
    .maybeSingle();
  if (readErr) return { error: readErr as unknown as Error };
  const rule = (ev as { is_recurring?: boolean; recurrence_rule?: Record<string, unknown> | null } | null)?.recurrence_rule;
  if (!ev || !(ev as { is_recurring?: boolean }).is_recurring || !rule || typeof rule !== 'object') {
    return { error: new Error(t('This rehearsal does not repeat any more. Reload and try again.')) };
  }
  const { data: saved, error } = await supabase
    .from('events')
    .update({ recurrence_rule: withSkippedDate(rule, date) })
    .eq('id', eventId)
    .select('id');
  if (error) return { error: error as unknown as Error };
  if (!saved?.length) return { error: new Error(t('Only band admins can delete this event.')) };
  return { error: null };
}
