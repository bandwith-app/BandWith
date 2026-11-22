/**
 * Date on hold (178): the rules shared by the app and the demo database,
 * with no imports so the demo client can use them.
 */

/** The notification types of a hold (178). */
export const DATE_HOLD_TYPES = ['date_hold', 'date_hold_changed', 'date_hold_released'] as const;
export const isDateHoldType = (type: string | null | undefined): boolean =>
  !!type && (DATE_HOLD_TYPES as readonly string[]).includes(type);

/**
 * Still a quote, so members don't see it (bw_event_is_quote, 111): not a
 * rehearsal, not confirmed or completed, and quote-linked or tentative.
 */
export function isQuoteStageEvent(ev: { status?: string | null; eventType?: string | null; event_type?: string | null; quoteId?: string | null; quote_id?: string | null }): boolean {
  const status = String(ev.status || '').toLowerCase();
  const type = String(ev.eventType || ev.event_type || '').toLowerCase();
  if (type === 'rehearsal' || status === 'confirmed' || status === 'completed') return false;
  return !!(ev.quoteId || ev.quote_id) || type === 'quote' || ['tentative', 'quoted', 'quote'].includes(status);
}
