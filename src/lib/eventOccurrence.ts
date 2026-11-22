/**
 * One date of a repeating rehearsal as the calendar opens it: the series'
 * row with that date and its own id (`<id>-occ-<date>`, as EventsView makes
 * them). Home's Upcoming list opens later dates by id only, and the detail
 * (its "Add to calendar", notes, live pack) then took the series' first date
 * (review of #285, round 3).
 */
export function atOccurrence<T extends { id?: unknown; date?: unknown }>(event: T, occurrence: string | null | undefined): T {
  if (!occurrence || !/^\d{4}-\d{2}-\d{2}$/.test(occurrence)) return event;
  const first = typeof event.date === 'string' ? event.date.slice(0, 10) : null;
  if (first === occurrence) return event;
  return { ...event, date: occurrence, id: `${String(event.id)}-occ-${occurrence}` };
}

/** The date a list row stands for, when it is a later date of a series (`-occ-` id). */
export function occurrenceOf(row: { id?: unknown; date?: unknown; event_date?: unknown }): string | undefined {
  const id = typeof row.id === 'string' ? row.id : '';
  const m = /-occ-(\d{4}-\d{2}-\d{2})$/.exec(id);
  return m ? m[1] : undefined;
}
