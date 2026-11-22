import { describe, it, expect } from 'vitest';
import { repeatDates } from '../recurrence';
import eventsView from '@/app/views/EventsView.tsx?raw';
import homeView from '@/app/views/HomeView.tsx?raw';
import app from '@/app/AuthenticatedApp.tsx?raw';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const far = new Date(2030, 0, 1);

describe('repeatDates (recurring rehearsals)', () => {
  it('monthly from Jan 31 keeps the 31st, on the last day of shorter months', () => {
    const got = repeatDates('2027-01-31', { frequency: 'monthly', interval: 1 }, far, 5).map(ymd);
    expect(got).toEqual(['2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30']);
  });

  it('a leap year gives Feb 29', () => {
    expect(repeatDates('2028-01-31', { freq: 'monthly' }, far, 2).map(ymd)).toEqual(['2028-02-29', '2028-03-31']);
  });

  it('every two months from Dec 31 crosses the year and keeps the day', () => {
    const got = repeatDates('2026-12-31', { frequency: 'monthly', interval: 2 }, far, 4).map(ymd);
    expect(got).toEqual(['2027-02-28', '2027-04-30', '2027-06-30', '2027-08-31']);
  });

  it('the 30th stays the 30th after February', () => {
    expect(repeatDates('2027-01-30', { frequency: 'monthly' }, far, 3).map(ymd)).toEqual([
      '2027-02-28',
      '2027-03-30',
      '2027-04-30',
    ]);
  });

  it('weekly and biweekly step by days, across month ends', () => {
    expect(repeatDates('2027-01-28', { frequency: 'weekly' }, far, 2).map(ymd)).toEqual(['2027-02-04', '2027-02-11']);
    expect(repeatDates('2027-01-28', { frequency: 'weekly', interval: 2 }, far, 2).map(ymd)).toEqual(['2027-02-11', '2027-02-25']);
    expect(repeatDates('2027-01-28', { freq: 'biweekly' }, far, 2).map(ymd)).toEqual(['2027-02-11', '2027-02-25']);
  });

  it('stops at until and at the count; unknown rules give nothing', () => {
    expect(repeatDates('2027-01-31', { frequency: 'monthly' }, new Date(2027, 3, 1), 24).map(ymd)).toEqual([
      '2027-02-28',
      '2027-03-31',
    ]);
    expect(repeatDates('2027-01-31', { frequency: 'monthly' }, far, 1).map(ymd)).toEqual(['2027-02-28']);
    expect(repeatDates('2027-01-31', { frequency: 'yearly' }, far, 5)).toEqual([]);
    expect(repeatDates('not a date', { frequency: 'monthly' }, far, 5)).toEqual([]);
  });

  it('`until` is a calendar date and counts, whatever the time zone (until = new Date(rule.until))', () => {
    const rule = { frequency: 'weekly', until: '2027-01-21' };
    expect(repeatDates('2027-01-07', rule, new Date(rule.until), 24).map(ymd)).toEqual(['2027-01-14', '2027-01-21']);
    // A local-midnight cutoff (the default "until the end of that month") includes its own day too.
    expect(repeatDates('2027-01-07', { frequency: 'weekly' }, new Date(2027, 0, 21), 24).map(ymd)).toEqual([
      '2027-01-14',
      '2027-01-21',
    ]);
  });

  it('occurrences fall at local noon, so a date never shifts with the time zone', () => {
    const [d] = repeatDates('2027-01-31', { frequency: 'monthly' }, far, 1);
    expect(d.getHours()).toBe(12);
  });

  it('every calendar expansion uses it (no month stepping from the previous date)', () => {
    for (const src of [eventsView, homeView, app]) {
      expect(src).not.toMatch(/cursor\.setMonth\(/);
      expect(src).toContain('repeatDates(');
    }
  });
});
