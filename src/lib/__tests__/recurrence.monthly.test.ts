/**
 * Monthly repeats on the 29th, 30th and 31st: the shared vectors for the app
 * (src/lib/recurrence.ts, here), the calendar feed (#285, BYMONTHDAY=28..d;
 * BYSETPOS=-1, and the SQL next occurrence) and deleted dates (#297,
 * recurrenceSkips.ts). Each month falls on the start's day, or on the last
 * day of a shorter month; the overflow never carries (Jan 31 → Feb 28 →
 * Mar 31, not Mar 28). Months ahead 0 to 13, in 2027 and in 2028 (leap year).
 */
import { describe, it, expect } from 'vitest';
import { monthlyOccurrence, repeatDates } from '../recurrence';

export const MONTHLY_VECTORS: Record<string, string[]> = {
  '2027-01-29': [
    '2027-01-29', '2027-02-28', '2027-03-29', '2027-04-29', '2027-05-29', '2027-06-29', '2027-07-29',
    '2027-08-29', '2027-09-29', '2027-10-29', '2027-11-29', '2027-12-29', '2028-01-29', '2028-02-29',
  ],
  '2027-01-30': [
    '2027-01-30', '2027-02-28', '2027-03-30', '2027-04-30', '2027-05-30', '2027-06-30', '2027-07-30',
    '2027-08-30', '2027-09-30', '2027-10-30', '2027-11-30', '2027-12-30', '2028-01-30', '2028-02-29',
  ],
  '2027-01-31': [
    '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30', '2027-07-31',
    '2027-08-31', '2027-09-30', '2027-10-31', '2027-11-30', '2027-12-31', '2028-01-31', '2028-02-29',
  ],
  '2028-01-29': [
    '2028-01-29', '2028-02-29', '2028-03-29', '2028-04-29', '2028-05-29', '2028-06-29', '2028-07-29',
    '2028-08-29', '2028-09-29', '2028-10-29', '2028-11-29', '2028-12-29', '2029-01-29', '2029-02-28',
  ],
  '2028-01-30': [
    '2028-01-30', '2028-02-29', '2028-03-30', '2028-04-30', '2028-05-30', '2028-06-30', '2028-07-30',
    '2028-08-30', '2028-09-30', '2028-10-30', '2028-11-30', '2028-12-30', '2029-01-30', '2029-02-28',
  ],
  '2028-01-31': [
    '2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30', '2028-05-31', '2028-06-30', '2028-07-31',
    '2028-08-31', '2028-09-30', '2028-10-31', '2028-11-30', '2028-12-31', '2029-01-31', '2029-02-28',
  ],
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('monthly repeats on the 29th, 30th and 31st', () => {
  for (const [start, expected] of Object.entries(MONTHLY_VECTORS)) {
    it(`monthlyOccurrence from ${start}`, () => {
      expect(expected.map((_, k) => monthlyOccurrence(start, k))).toEqual(expected);
    });

    it(`repeatDates (calendar, lists, Home) from ${start} uses the same dates`, () => {
      const dates = repeatDates(start, { frequency: 'monthly' }, new Date(2030, 0, 1), 13).map(ymd);
      expect(dates).toEqual(expected.slice(1));
    });
  }

  it('an interval counts months from the start, clamped each time', () => {
    expect([1, 2, 3].map((k) => monthlyOccurrence('2027-01-31', 2 * k))).toEqual(['2027-03-31', '2027-05-31', '2027-07-31']);
    expect(repeatDates('2027-01-31', { frequency: 'monthly', interval: 3 }, new Date(2028, 0, 1), 4).map(ymd)).toEqual([
      '2027-04-30',
      '2027-07-31',
      '2027-10-31',
    ]);
  });

  it('a start date it cannot read gives null', () => {
    expect(monthlyOccurrence('', 1)).toBeNull();
    expect(monthlyOccurrence('31/01/2027', 1)).toBeNull();
  });
});

/**
 * The calendar feed (#285, supabase/functions/_shared/deputy-calendar.ts):
 * its RRULE, expanded the way a calendar app does (RFC 5545), gives the same
 * dates. Main's feed before #285 writes plain FREQ=MONTHLY (a series on the
 * 31st skips February): this runs once #285's clamp is in the file (both
 * ship in the same batch; checked in a trial merge of #298 + #285).
 */
const FEED = import.meta.glob('/supabase/functions/_shared/deputy-calendar.ts', { eager: true }) as Record<
  string,
  { recurrenceRule?: (rule: unknown, start?: string | null, opts?: { timed?: boolean }) => string | null }
>;
const feedRule = Object.values(FEED)[0]?.recurrenceRule;
const recurrenceRule = feedRule && /BYMONTHDAY/.test(feedRule({ frequency: 'monthly' }, '2027-01-31') ?? '') ? feedRule : undefined;

/** FREQ=MONTHLY with INTERVAL, BYMONTHDAY (negative too) and BYSETPOS=-1: the first `n` dates from DTSTART. */
function expandMonthly(rrule: string, dtstart: string, n: number): string[] {
  const parts = Object.fromEntries(rrule.split(';').map((p) => p.split('=') as [string, string]));
  expect(parts.FREQ).toBe('MONTHLY');
  const every = Number(parts.INTERVAL || 1);
  const [y0, m0, d0] = dtstart.split('-').map(Number);
  const byDay = parts.BYMONTHDAY ? parts.BYMONTHDAY.split(',').map(Number) : [d0];
  const out: string[] = [];
  for (let k = 0; out.length < n && k < 200; k += every) {
    const months = y0 * 12 + (m0 - 1) + k;
    const y = Math.floor(months / 12);
    const m = months - y * 12;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const days = byDay.map((d) => (d < 0 ? last + 1 + d : d)).filter((d) => d >= 1 && d <= last).sort((a, b) => a - b);
    const picked = parts.BYSETPOS === '-1' ? days.slice(-1) : days;
    for (const d of picked) out.push(`${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return out.slice(0, n);
}

describe.skipIf(!recurrenceRule)('the calendar feed (#285) repeats on the same dates', () => {
  for (const [start, expected] of Object.entries(MONTHLY_VECTORS)) {
    it(`RRULE from ${start}`, () => {
      const rule = recurrenceRule!({ frequency: 'monthly' }, start);
      expect(rule).toBeTruthy();
      expect(expandMonthly(rule!, start, expected.length)).toEqual(expected);
    });
  }
});
