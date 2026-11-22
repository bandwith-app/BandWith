// Codex review #285 @ 0b5765f0 (M3, recurrence.ts:88): a date deleted on
// its own (recurrence_rule.skip_dates, #297) is never one of the app's
// dates, so it can't be opened and sent to "Add to calendar" (182 refuses
// it). Deleted dates still count toward `count`, as in 182's SQL
// (bw_calendar_next_occurrence) and the ICS (COUNT with EXDATE).
import { describe, it, expect } from 'vitest';
import { repeatDates } from '../recurrence';
import { isOccurrence, recurrenceRule } from '../deputyCalendar';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const FAR = new Date(2030, 0, 1);

describe('repeatDates leaves out deleted dates', () => {
  it('weekly: the deleted date is gone, its neighbours stay', () => {
    const got = repeatDates('2027-03-02', { frequency: 'weekly', skip_dates: ['2027-03-16'] }, FAR, 3).map(ymd);
    expect(got).toEqual(['2027-03-09', '2027-03-23']);
  });

  it('monthly from Jan 31: deleting Feb 28 keeps Mar 31 (still clamped)', () => {
    const got = repeatDates('2027-01-31', { frequency: 'monthly', skip_dates: ['2027-02-28'] }, FAR, 3).map(ymd);
    expect(got).toEqual(['2027-03-31', '2027-04-30']);
  });

  it('a deleted date counts toward count (COUNT, as the SQL and the ICS)', () => {
    const got = repeatDates('2027-03-02', { frequency: 'weekly', count: 2, skip_dates: ['2027-03-09'] } as never, FAR, 2).map(ymd);
    expect(got).toEqual(['2027-03-16']);
  });

  // Claude r7 (4): the interval cap of the ICS rule, isOccurrence and 182
  // (1-52, else 1), so every layer gives the same dates.
  it('interval: 1-52 as given, anything else is 1 (as the ICS and 182)', () => {
    const at = (interval: unknown) => repeatDates('2027-03-02', { frequency: 'weekly', interval } as never, FAR, 1).map(ymd)[0];
    expect(at(2)).toBe('2027-03-16');
    expect(at(52)).toBe('2028-02-29');
    expect(at(53)).toBe('2027-03-09');
    expect(at(0)).toBe('2027-03-09');
    expect(at(1.5)).toBe('2027-03-09');
    expect(recurrenceRule({ frequency: 'weekly', interval: 53 })).toBe('FREQ=WEEKLY;INTERVAL=1');
    expect(isOccurrence({ frequency: 'weekly', interval: 53 }, '2027-03-02', '2027-03-09')).toBe(true);
  });

  it('bad entries are ignored; no skip_dates changes nothing', () => {
    const plain = repeatDates('2027-03-02', { frequency: 'weekly' }, FAR, 3).map(ymd);
    expect(repeatDates('2027-03-02', { frequency: 'weekly', skip_dates: ['x', 7, null, '2027-3-9'] } as never, FAR, 3).map(ymd)).toEqual(plain);
    expect(plain).toEqual(['2027-03-09', '2027-03-16', '2027-03-23']);
  });
});
