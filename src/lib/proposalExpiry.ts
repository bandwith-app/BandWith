/**
 * When a member's rehearsal proposal (status 'proposed') lapses.
 *
 * A proposal names weekdays ("Mon", "Thu"), not dates. They mean the coming
 * week: the next of each weekday after the day it was sent (a "Tue" sent on
 * a Tuesday is the Tuesday after). The proposal is open until the last of
 * those days; with no day picked, for the 7 days after it was sent (members
 * send one a week). After that it is gone from every board, and the server
 * marks it 'expired' (migration 123, same rule, in UTC).
 */

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The last day (YYYY-MM-DD, local) a proposal sent at `createdAt` is open. */
export function proposalLastDay(createdAt: string | Date, preferredDays?: string[] | null): string | null {
  const sent = new Date(createdAt);
  if (isNaN(sent.getTime())) return null;
  const from = sent.getDay();
  const offsets = (preferredDays || [])
    .map((d) => WEEKDAYS.indexOf(String(d).trim().slice(0, 3).toLowerCase()))
    .filter((dow) => dow >= 0)
    // 1..7 days later: the same weekday means next week's.
    .map((dow) => ((dow - from + 6) % 7) + 1);
  const last = new Date(sent.getFullYear(), sent.getMonth(), sent.getDate() + (offsets.length ? Math.max(...offsets) : 7));
  return localDate(last);
}

/** A proposal no admin acted on whose last day has passed. Polls never expire here. */
export function isProposalExpired(
  poll: { status?: string | null; created_at?: string | null; preferred_days?: string[] | null },
  now: Date = new Date(),
): boolean {
  if (poll.status !== 'proposed' || !poll.created_at) return false;
  const last = proposalLastDay(poll.created_at, poll.preferred_days);
  return !!last && localDate(now) > last;
}
