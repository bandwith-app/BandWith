/**
 * Song files for the stage manager, downloaded before the gig: the days
 * before a gig, with internet, an admin's phone fetches the audio of its
 * setlist, so Stage mode plays it at a venue with no signal.
 */

/** Today up to this many days ahead. */
export const PREFETCH_DAYS = 3;

const dayNumber = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000);
};

/** YYYY-MM-DD of this device's today. */
export const localToday = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** The gig is today or within PREFETCH_DAYS. */
export function inPrefetchWindow(date: string | undefined, today: string, days = PREFETCH_DAYS): boolean {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return false;
  const diff = dayNumber(date.slice(0, 10)) - dayNumber(today);
  return diff >= 0 && diff <= days;
}

export interface PrefetchEvent {
  setlistId?: string;
  date: string;
  status?: string;
  eventType?: string;
  band_id?: string;
}

/** Setlists to pre-download: confirmed band gigs in the window, where I can be the stage manager (admin). */
export function prefetchSetlistIds(events: PrefetchEvent[], isAdmin: (bandId?: string) => boolean, today: string, days = PREFETCH_DAYS): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (!e.setlistId || !e.band_id || !isAdmin(e.band_id)) continue;
    if (e.status !== 'CONFIRMED' || e.eventType === 'rehearsal' || e.eventType === 'quote') continue;
    if (!inPrefetchWindow(e.date, today, days)) continue;
    if (!out.includes(e.setlistId)) out.push(e.setlistId);
  }
  return out;
}
