/**
 * Dates taken out of a repeating rehearsal (audit 05 #4).
 *
 * "Delete this date" on one occurrence of a weekly rehearsal must not delete
 * the series row (that cascades to every session record and rehearsal note
 * of earlier dates). The date is kept in the rule instead:
 *
 *   events.recurrence_rule = { frequency, interval, …, skip_dates: ['YYYY-MM-DD', …] }
 *
 * Every place that expands a series into dates leaves these out, the first
 * date included. recurrence_rule is a column members can already read, so no
 * new grant is needed; older builds ignore the key and still show the date.
 */

type RuleLike = { skip_dates?: unknown } | null | undefined;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const dayOf = (date: string | null | undefined): string => {
  const d = (date || '').trim();
  return d.includes('T') ? d.split('T')[0] : d;
};

/** The dates skipped in `rule`, as YYYY-MM-DD. */
export function skippedDates(rule: unknown): Set<string> {
  const list = (rule as RuleLike)?.skip_dates;
  return new Set(Array.isArray(list) ? list.filter((d): d is string => typeof d === 'string' && DAY.test(d)) : []);
}

/** True when `date` of this repeating rehearsal was deleted on its own. */
export function isSkippedOccurrence(
  event: { is_recurring?: boolean | null; recurrence_rule?: unknown } | null | undefined,
  date: string | null | undefined,
): boolean {
  if (!event?.recurrence_rule) return false;
  const day = dayOf(date);
  return !!day && skippedDates(event.recurrence_rule).has(day);
}

/** The rule with `date` skipped (kept sorted, no duplicates). */
export function withSkippedDate<T extends object>(rule: T, date: string): T & { skip_dates: string[] } {
  const day = dayOf(date);
  const all = skippedDates(rule);
  if (DAY.test(day)) all.add(day);
  return { ...rule, skip_dates: Array.from(all).sort() };
}
