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

import { repeatDates } from '@/lib/recurrence';

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

type Repeating = { date?: string | null; is_recurring?: boolean | null; recurrence_rule?: unknown; seriesDate?: string; skippedOccurrence?: boolean };

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The series opened on one of its dates (Codex #297 B1).
 *
 * Home, Calendar search and pushes only know the series row, whose date is
 * the first one. Opening it on that date made "Delete this date" take out the
 * first rehearsal instead of the one the user tapped.
 *
 * - `date` given: the series on that date.
 * - no date: the first date still on from `from` (default: the first date),
 *   null when none is left. Same steps as the Calendar's expansion: weekly
 *   (× interval), biweekly, monthly (× interval), up to `until` and `count`
 *   dates after the first.
 *
 * A later date carries `seriesDate` (the series' first date), so an edit
 * of that date does not move the series start (see eventCardPatch and the
 * wizard save). An event that does not repeat comes back as it is.
 *
 * A `date` that was deleted on its own (the "Rehearsal cancelled" push opens
 * it) comes back with `skippedOccurrence: true`: shown as cancelled, never as
 * a rehearsal still on (Claude #297 r5 minor 6).
 */
export function occurrenceOn<T extends Repeating>(event: T, date?: string | null, from?: string | null): T | null {
  const rule = event.recurrence_rule as Record<string, any> | null | undefined;
  const base = dayOf(event.date);
  if (!event.is_recurring || !rule || !DAY.test(base)) return event;
  const picked = dayOf(date);
  if (picked) {
    if (!DAY.test(picked)) return event;
    const at = picked === base ? event : { ...event, date: picked, seriesDate: base };
    return skippedDates(rule).has(picked) ? { ...at, skippedOccurrence: true } : at;
  }

  const start = dayOf(from);
  const skips = skippedDates(rule);
  const after = Number(rule.count) > 0 ? Number(rule.count) : 1100;
  const [y, m, d] = base.split('-').map(Number);
  // The same dates as every list (lib/recurrence: local noon, months counted
  // from the first date), up to `until` and `count` dates after the first.
  const days = [base, ...repeatDates(base, rule, new Date(y + 30, m - 1, d), after).map(ymd)];
  for (const day of days) {
    if ((start && day < start) || skips.has(day)) continue;
    return day === base ? event : { ...event, date: day, seriesDate: base };
  }
  return null;
}

/**
 * A rule rewritten from the cadence (wizard, overview card) on top of the
 * stored one (Codex #297 B2): the cadence keys are replaced, every other key
 * (skip_dates, until, count, keys a newer build added) stays. null (the
 * repeat turned off) stays null.
 *
 * Deleted dates come only from `stored`, never from `next` (Codex #297 M3):
 * a date is deleted or restored only through its own server step
 * (bw_skip_rehearsal_date / bw_restore_rehearsal_date), so a cadence edit
 * queued offline cannot bring back a stale list and cancel a date someone
 * restored meanwhile. updateEvent passes the server's current rule as
 * `stored`, so a replay carries the server's list.
 */
export function mergeRecurrenceRule<T extends Record<string, unknown>>(
  stored: unknown,
  next: T | null | undefined,
): (T & Record<string, unknown>) | null {
  if (!next) return null;
  const { skip_dates: _stale, ...cadence } = next as Record<string, unknown>;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return cadence as T & Record<string, unknown>;
  const { freq: _f, frequency: _fr, interval: _i, skip_dates: _s, ...rest } = stored as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...rest, ...cadence };
  const kept = skippedDates(stored);
  if (kept.size > 0) merged.skip_dates = Array.from(kept).sort();
  return merged as T & Record<string, unknown>;
}

/** weekly ×1, weekly ×2 (= biweekly), monthly ×n: the repeat a rule describes. */
const cadenceOf = (rule: unknown): string => {
  const r = (rule && typeof rule === 'object' ? rule : {}) as Record<string, unknown>;
  let freq = String(r.freq || r.frequency || '').toLowerCase();
  let every = Number(r.interval) >= 1 ? Math.floor(Number(r.interval)) : 1;
  if (freq === 'biweekly') { freq = 'weekly'; every = 2; }
  return `${freq}/${every}`;
};

/** True when both rules repeat the same way (deleted dates and other keys aside). */
export function sameCadence(a: unknown, b: unknown): boolean {
  return !!a && !!b && cadenceOf(a) === cadenceOf(b);
}

/**
 * The date to open an event on: the one asked for, else the date being
 * edited in the wizard when this is that event (cancelling an edit of one
 * date of a series reopens that exact date, Codex #297 round 3), else null
 * (navigateToEvent then opens the next date still on).
 */
export function openDateFor(
  eventId: string,
  date: string | null | undefined,
  editing: { eventId: string; date: string } | null | undefined,
): string | null {
  if (date) return date;
  return editing && editing.eventId === eventId ? editing.date : null;
}
