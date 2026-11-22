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
  // Keep the date on screen while it still repeats (Codex #297 B1).
  const o = open as { date?: unknown };
  const f = fresh as { date?: unknown; is_recurring?: unknown; recurrence_rule?: unknown };
  let seenDate: unknown;
  try { seenDate = (JSON.parse(seen) as { date?: unknown })?.date; } catch { seenDate = undefined; }
  if (f.is_recurring && f.recurrence_rule && o.date && seenDate !== undefined && o.date !== seenDate) {
    (next as { date?: unknown }).date = o.date;
  }
  return { next, seen: sig };
}
