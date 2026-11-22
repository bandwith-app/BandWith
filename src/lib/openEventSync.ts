import { monthlyOccurrence } from '@/lib/recurrence';

/**
 * Keeps an open event detail in step with the events list.
 *
 * The detail holds a copy of the event taken when it was opened. When the
 * list later brings a different version of that event (someone saved it,
 * realtime refetch), the copy takes the new values. A version the detail has
 * already seen is ignored, so optimistic changes made in the detail are not
 * undone by a list that has not caught up yet.
 */
export interface OpenEventSync<T> {
  /** The detail's event, updated or unchanged (same object when unchanged). */
  next: T | null;
  /** Signature of the list version now seen for the open event. */
  seen: string | null;
}

export function syncOpenEvent<T extends object>(
  open: T | null,
  fresh: Partial<T> | undefined,
  seen: string | null,
): OpenEventSync<T> {
  if (!open || !fresh) return { next: open, seen };
  const sig = JSON.stringify(fresh);
  // First version seen since the detail opened: remember it, change nothing.
  if (seen === null || sig === seen) return { next: open, seen: sig };
  const next = { ...open, ...fresh };
  // One date of a repeating rehearsal (opened from Home or the Calendar on a
  // later date): the list only has the series, whose date is the first one.
  // Keep the date on screen while it still repeats (Codex #297 B1). When the
  // series itself moved, that date and the series start move with it, so a
  // later rename never writes the old start back (round 3).
  const o = open as { date?: unknown; seriesDate?: unknown };
  const f = fresh as { date?: unknown; is_recurring?: unknown; recurrence_rule?: unknown };
  let seenDate: unknown;
  try { seenDate = (JSON.parse(seen) as { date?: unknown })?.date; } catch { seenDate = undefined; }
  const occurrence = typeof o.seriesDate === 'string' || (seenDate !== undefined && o.date !== seenDate);
  if (f.is_recurring && f.recurrence_rule && typeof o.date === 'string' && occurrence) {
    const from = typeof o.seriesDate === 'string' ? o.seriesDate : typeof seenDate === 'string' ? seenDate : null;
    const to = typeof f.date === 'string' ? f.date : null;
    const shift = from && to ? daysBetween(from, to) : 0;
    // Monthly: the same repeat of the moved series (#298's rule), so a date
    // shown on the 30th of a series moved from the 31st to the 29th lands on
    // the 29th, not the 29th minus a day (Claude #297 round 4).
    const rule = f.recurrence_rule as { freq?: unknown; frequency?: unknown };
    const monthly = String(rule?.freq || rule?.frequency || '').toLowerCase() === 'monthly';
    (next as { date?: unknown }).date = !shift
      ? o.date
      : monthly && from && to
        ? monthlyOccurrence(to, monthIndex(o.date) - monthIndex(from)) ?? addDays(o.date, shift)
        : addDays(o.date, shift);
    if (to) (next as { seriesDate?: unknown }).seriesDate = to.slice(0, 10);
  }
  return { next, seen: sig };
}

const monthIndex = (ymd: string) => Number(ymd.slice(0, 4)) * 12 + Number(ymd.slice(5, 7)) - 1;
const DAY_MS = 86_400_000;
const localNoon = (ymd: string) => {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
const daysBetween = (a: string, b: string) => Math.round((localNoon(b).getTime() - localNoon(a).getTime()) / DAY_MS);
const addDays = (ymd: string, n: number) => {
  const t = localNoon(ymd);
  t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
