/**
 * Which calendar events a user may see, by their role in each event's band.
 *
 * One rule for the calendar and its search, so search never finds something
 * the calendar hides:
 * - own personal gigs (no band, created by the user): always;
 * - band events where the user is a member (not an admin): only those they
 *   are on and haven't declined;
 * - band events where the user is an admin: all, except ones they declined;
 * - quotes (unconverted, tentative): admins of that band only.
 */

export interface VisibilityEvent {
  eventId?: string;
  band_id?: string | null;
  createdBy?: string;
  status?: string;
  eventType?: string;
}

export interface VisibilityContext {
  userId?: string | null;
  /** Lineup of an event, by event id. */
  membersOf: (eventId: string) => ReadonlyArray<{ userId: string; status?: string }>;
  /** Role in an event's band (events come from every band). */
  isAdminOfBand: (bandId?: string | null) => boolean;
}

export function isQuoteEvent(e: VisibilityEvent): boolean {
  const s = String(e.status || '');
  return s === 'QUOTE' || s === 'QUOTED' || e.eventType === 'quote';
}

export function canSeeEvent(e: VisibilityEvent, ctx: VisibilityContext): boolean {
  const admin = ctx.isAdminOfBand(e.band_id);
  // Members never see unconverted quotes.
  if (!admin && isQuoteEvent(e)) return false;
  if (!ctx.userId) return true;
  if (!e.band_id && e.createdBy === ctx.userId) return true;
  if (!e.eventId) return true; // no UUID key (pending sync), can't filter
  const mine = ctx.membersOf(e.eventId).find((m) => m.userId === ctx.userId);
  if (!admin) return !!mine && mine.status !== 'declined';
  return !mine || mine.status !== 'declined';
}

/** `events` this user may see (see canSeeEvent). */
export function visibleEventsFor<T extends VisibilityEvent>(events: T[], ctx: VisibilityContext): T[] {
  return events.filter((e) => canSeeEvent(e, ctx));
}

export interface WarningEvent {
  eventType?: string;
  status?: string;
  location?: string;
  date?: string;
  price?: string;
}

/**
 * Card warnings ("Missing venue", "Missing date", "Missing fee"), as English
 * keys for t(). The band fee is private to admins, so "Missing fee" is only
 * for people who manage the event (`managesFee`): members never see it.
 */
export function eventWarningKeys(event: WarningEvent, managesFee: boolean): string[] {
  const warnings: string[] = [];
  const type = event.eventType?.toLowerCase() || event.status?.toLowerCase();
  if (!event.location || event.location === 'TBD') warnings.push('Missing venue');
  if (!event.date) warnings.push('Missing date');
  if (managesFee && type !== 'rehearsal' && (!event.price || event.price === '0')) warnings.push('Missing fee');
  return warnings;
}
