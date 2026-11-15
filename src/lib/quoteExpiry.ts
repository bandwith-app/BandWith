/**
 * When a quote has expired, as the client's quote page shows it (099:
 * expired once valid_until is more than a day past, so a client in another
 * time zone still has the last day). The status in the database stays as it
 * is (nothing writes "expired"): this is for showing it in the app.
 * Only quotes out with the client (sent, viewed, discussing) expire: a draft
 * was never sent, and accepted / declined ones are settled.
 */
import { parseLocalDate, toLocalDateString, todayLocal } from '@/lib/dates';

const OPEN = new Set(['sent', 'viewed', 'negotiating']);

export function isQuoteExpired(
  status: string | null | undefined,
  validUntil: string | null | undefined,
  today: string = todayLocal(),
): boolean {
  const s = String(status || '').toLowerCase();
  if (s === 'expired') return true;
  if (!OPEN.has(s) || !validUntil) return false;
  const until = String(validUntil).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return false;
  const lastDay = parseLocalDate(until);
  lastDay.setDate(lastDay.getDate() + 1);
  return toLocalDateString(lastDay) < today;
}

/** The status to show: EXPIRED for an open quote past its date, else its own (app statuses are upper case). */
export function shownQuoteStatus<S extends string>(status: S, validUntil: string | null | undefined, today?: string): S | 'EXPIRED' {
  return isQuoteExpired(status, validUntil, today) ? 'EXPIRED' : status;
}
