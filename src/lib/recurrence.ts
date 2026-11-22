/**
 * Repeating rehearsals (events.recurrence_rule: weekly / biweekly / monthly,
 * with an interval), expanded into dates for the calendar, the lists and Home.
 *
 * Every repeat is counted from the first date, never from the previous one:
 * a monthly rehearsal on the 31st falls on the last day of a shorter month
 * (Feb 28, Apr 30) and goes back to the 31st when the month has one. Stepping
 * a Date month by month let February's overflow (Feb 31 → Mar 3) move every
 * later month too.
 */

export interface RepeatRule {
  freq?: string;
  frequency?: string;
  interval?: number;
  /** Last day (YYYY-MM-DD), included. */
  until?: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The monthly repeat `monthsAhead` months after `startYmd` (YYYY-MM-DD), as
 * YYYY-MM-DD: the start's day, or the last day of a shorter month. Counted
 * from the start, so the overflow never carries: Jan 31 → Feb 28 → Mar 31.
 * The one rule for the app, the calendar feed (#285) and deleted dates
 * (#297); shared vectors in __tests__/recurrence.monthly.test.ts. Null if
 * the start can't be read.
 */
export function monthlyOccurrence(startYmd: string, monthsAhead: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((startYmd || '').slice(0, 10));
  if (!m || !Number.isInteger(monthsAhead)) return null;
  const months = Number(m[1]) * 12 + Number(m[2]) - 1 + monthsAhead;
  const year = Math.floor(months / 12);
  const month = months - year * 12; // 0-11
  // Day 0 of the next month is the last day of this one (UTC: no time zone in it).
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${pad(month + 1)}-${pad(Math.min(Number(m[3]), last))}`;
}


/**
 * The repeats after `startYmd` (YYYY-MM-DD; the first date itself is not
 * included), up to `until` and at most `maxCount`, as local-noon Dates (noon,
 * so a daylight-saving change never moves the day). Unknown rules: none.
 *
 * The cut-off day is included, to its last minute in local time: `rule.until`
 * as written ("2027-01-21" is that local day, not its UTC midnight, which is
 * the day before west of Greenwich and before noon everywhere), else the
 * local day of `until`.
 */
export function repeatDates(startYmd: string, rule: RepeatRule, until: Date, maxCount: number): Date[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startYmd || '');
  if (!m) return [];
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const freq = String(rule?.freq || rule?.frequency || '').toLowerCase();
  const n = Number(rule?.interval);
  const every = Number.isInteger(n) && n >= 1 ? n : 1;

  const nth = (k: number): Date | null => {
    if (freq === 'weekly') return new Date(year, month, day + 7 * every * k, 12, 0, 0);
    if (freq === 'biweekly') return new Date(year, month, day + 14 * k, 12, 0, 0);
    if (freq === 'monthly') {
      const on = monthlyOccurrence(startYmd, every * k);
      if (!on) return null;
      const [y, mo, d] = on.split('-').map(Number);
      return new Date(y, mo - 1, d, 12, 0, 0);
    }
    return null;
  };

  // The cut-off: the end of that day, local time.
  const written = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof rule?.until === 'string' ? rule.until : '');
  const day0 = written
    ? new Date(Number(written[1]), Number(written[2]) - 1, Number(written[3]))
    : until instanceof Date && !Number.isNaN(until.getTime())
      ? until
      : null;
  if (!day0) return [];
  const endOfDay = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate(), 23, 59, 59, 999);

  const out: Date[] = [];
  for (let k = 1; out.length < maxCount; k++) {
    const d = nth(k);
    if (!d || d > endOfDay) break;
    out.push(d);
  }
  return out;
}
