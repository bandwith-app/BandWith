/**
 * Claude #297 round 4: moving the whole of a monthly series from one of its
 * dates. The date shown may be clamped (Apr 30 of a series on the 31st):
 * the new start takes its day of the month from the date picked, so the
 * moved date is one of the new series' repeats (#298's shared vectors).
 */
import { describe, it, expect } from 'vitest';
import { MONTHLY_VECTORS } from './recurrence.monthly.test';
import { monthlyOccurrence } from '../recurrence';
import { occurrenceStart } from '../eventOverviewEdit';
import { syncOpenEvent } from '../openEventSync';

const monthly = { frequency: 'monthly', interval: 1 };

describe('a monthly series moved from one of its dates', () => {
  it('Jan 31 series, its Apr 30 moved to Apr 29: the series starts Jan 29', () => {
    expect(MONTHLY_VECTORS['2027-01-31'][3]).toBe('2027-04-30');
    const start = occurrenceStart({ date: '2027-04-30', seriesDate: '2027-01-31', recurrence_rule: monthly }, '2027-04-29', true, 'series');
    expect(start).toBe('2027-01-29');
    expect(MONTHLY_VECTORS['2027-01-29'][3]).toBe('2027-04-29');
  });

  it('a series on the 30th, its Feb 28 moved to Feb 27, 2027: the series starts Jan 27', () => {
    expect(MONTHLY_VECTORS['2027-01-30'][1]).toBe('2027-02-28');
    const start = occurrenceStart({ date: '2027-02-28', seriesDate: '2027-01-30', recurrence_rule: monthly }, '2027-02-27', true, 'series');
    expect(start).toBe('2027-01-27');
    expect(monthlyOccurrence(start!, 1)).toBe('2027-02-27');
  });

  it('every vector date moved to the 28th of its month makes a series that has that date', () => {
    for (const [series, dates] of Object.entries(MONTHLY_VECTORS)) {
      dates.forEach((d, k) => {
        if (k === 0 || d.endsWith('-28')) return; // already on the 28th: nothing moves
        const to = `${d.slice(0, 7)}-28`;
        const start = occurrenceStart({ date: d, seriesDate: series, recurrence_rule: monthly }, to, true, 'series');
        expect(monthlyOccurrence(start!, k), `${series} #${k}`).toBe(to);
      });
    }
  });

  // Codex #297 r7 M1: the series takes the moved date's day of the month,
  // clamped in each month. A start month too short for that day (Feb for the
  // 31st) can't carry it (lib/recurrence repeats the start's day), so the
  // series starts at its first month that has the day.
  it('a series from Feb 28, its Mar 28 moved to Mar 31 for the whole series: on the 31st from March', () => {
    const start = occurrenceStart({ date: '2027-03-28', seriesDate: '2027-02-28', recurrence_rule: monthly }, '2027-03-31', true, 'series');
    expect(start).toBe('2027-03-31');
    expect([0, 1, 2, 3].map((k) => monthlyOccurrence(start!, k))).toEqual(['2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30']);
  });

  it('a series from Jan 28, its Mar 28 moved to Mar 31: Jan 31, Feb 28 (clamped), Mar 31, Apr 30', () => {
    const start = occurrenceStart({ date: '2027-03-28', seriesDate: '2027-01-28', recurrence_rule: monthly }, '2027-03-31', true, 'series');
    expect(start).toBe('2027-01-31');
    expect([0, 1, 2, 3].map((k) => monthlyOccurrence(start!, k))).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  });

  it('a series on the 31st, its Mar 31 moved to Mar 30: on the 30th, Feb 28 clamped', () => {
    const start = occurrenceStart({ date: '2027-03-31', seriesDate: '2027-01-31', recurrence_rule: monthly }, '2027-03-30', true, 'series');
    expect(start).toBe('2027-01-30');
    expect([0, 1, 2, 3].map((k) => monthlyOccurrence(start!, k))).toEqual(['2027-01-30', '2027-02-28', '2027-03-30', '2027-04-30']);
  });

  it('every 2 months from Feb 28, its Apr 28 moved to Apr 30: on the 30th from April', () => {
    const rule = { frequency: 'monthly', interval: 2 };
    const start = occurrenceStart({ date: '2027-04-28', seriesDate: '2027-02-28', recurrence_rule: rule }, '2027-04-30', true, 'series');
    expect(start).toBe('2027-04-30');
  });

  it('weekly still moves by the same days', () => {
    expect(occurrenceStart({ date: '2099-12-08', seriesDate: '2099-12-01', recurrence_rule: { frequency: 'weekly' } }, '2099-12-09', true, 'series')).toBe('2099-12-02');
  });

  it('an open date of a monthly series follows the series to the same repeat', () => {
    const base = { title: 'Monthly jam', is_recurring: true, recurrence_rule: monthly };
    const open = { ...base, date: '2027-04-30', seriesDate: '2027-01-31' };
    const seen = JSON.stringify({ ...base, date: '2027-01-31' });
    const { next } = syncOpenEvent(open, { ...base, date: '2027-01-29' }, seen);
    expect(next).toMatchObject({ date: '2027-04-29', seriesDate: '2027-01-29' });
  });
});
