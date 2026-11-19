/**
 * The analytics window (paid plans P3b, §4.3): on a plan with an
 * `analytics_days` number, analytics shows that many days back. A view
 * window, not a security boundary: the events stay readable everywhere else
 * (calendar, gig history), and nothing is deleted.
 */
import { limitFor, type Entitlements } from './plans';

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The first day analytics may show (YYYY-MM-DD, local), or null = all of it. */
export function analyticsWindowStart(ent: Entitlements | null | undefined, now: Date): string | null {
  const days = limitFor(ent, 'analytics_days');
  if (days === null) return null;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - Math.max(0, days));
  return localDate(d);
}

/** An event date (YYYY-MM-DD…) inside the window. */
export const inAnalyticsWindow = (date: string | null | undefined, start: string | null): boolean =>
  !start || (!!date && date.slice(0, 10) >= start);

/** A whole month (YYYY-MM) before the window: shown as locked. */
export const monthBeforeWindow = (yyyyMm: string, start: string | null): boolean => {
  if (!start) return false;
  const [y, m] = yyyyMm.split('-').map(Number);
  const last = new Date(y, m, 0); // last day of that month
  return localDate(last) < start;
};

/** The note is due when the window cuts into what the screen covers. */
export const windowCutsInto = (firstShownDate: string, start: string | null): boolean => !!start && start > firstShownDate;
