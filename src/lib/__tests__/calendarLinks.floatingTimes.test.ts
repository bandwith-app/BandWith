// Claude r7 (1): the calendar files are floating (wall-clock times, no
// TZID), so building them must not go through the device's time zone. With
// local Date math a phone in New York wrote DTEND 0130 for a 23:30 show on
// the night the clocks go back (the server, in UTC, writes 0230), and moved
// a 02:30 load-in on the night they go forward to 0330.
// Node reads TZ again when it changes, so every Date below is New York's.
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'America/New_York';
import { describe, it, expect } from 'vitest';
import { gigEvent, googleCalendarUrl, isOccurrence, monthlyDate } from '../deputyCalendar';

const L = { loadIn: 'Load-in', soundcheck: 'Soundcheck', show: 'Show', role: 'Role', rehearsal: 'Rehearsal' };
const NOW = new Date(Date.UTC(2026, 10, 22));
const lines = (g: Parameters<typeof gigEvent>[0], opts: Parameters<typeof gigEvent>[3] = {}) =>
  gigEvent(g, L, 'event-1', { now: NOW, ...opts });

describe('floating times on a device in New York', () => {
  it('the test runs in New York time (DST on 14 Mar and 7 Nov 2027)', () => {
    expect(new Date(2027, 2, 14, 2, 30).getHours()).toBe(3); // 02:30 doesn't exist there
  });

  it('23:30 on Nov 6 2027 with no end: DTEND 02:30 the next day, as the server writes', () => {
    const l = lines({ title: 'Late show', bandName: 'Velvet Static', date: '2027-11-06', start: '23:30' });
    expect(l).toContain('DTSTART:20271106T233000');
    expect(l).toContain('DTEND:20271107T023000');
  });

  it('02:30 load-in on Mar 14 2027 stays 02:30 (start and Google link)', () => {
    const g = { title: 'Early load-in', bandName: 'Velvet Static', date: '2027-03-14', loadIn: '02:30', start: '04:00', end: '06:00' };
    const l = lines(g);
    expect(l).toContain('DTSTART:20270314T023000');
    expect(l).toContain('DTEND:20270314T060000');
    expect(decodeURIComponent(googleCalendarUrl(g, L))).toContain('dates=20270314T023000/20270314T060000');
  });

  it('a series EXDATE after the change keeps the local start time; dates of the series are unchanged', () => {
    const l = lines(
      { title: 'Weekly', bandName: 'Velvet Static', kind: 'rehearsal', date: '2027-03-09', start: '02:30', end: '04:00' },
      { rrule: 'FREQ=WEEKLY;INTERVAL=1', exdates: ['2027-03-14', '2027-03-16'] },
    );
    expect(l).toContain('EXDATE:20270314T023000');
    expect(l).toContain('EXDATE:20270316T023000');
    expect(monthlyDate('2027-01-31', 1)).toBe('2027-02-28');
    expect(isOccurrence({ frequency: 'weekly' }, '2027-03-09', '2027-03-16')).toBe(true);
    expect(isOccurrence({ frequency: 'weekly' }, '2027-10-31', '2027-11-07')).toBe(true);
  });
});
