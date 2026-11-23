// Codex review #285 round 7 (M1, 182:717): the app's calendar stepped months
// with setMonth (Jan 31 -> Mar 3) while 182 clamps (Jan 31 -> Feb 28), so
// "Add to calendar" sent a date 182 doesn't have. The app uses #298's
// clamped recurrence (src/lib/recurrence.ts, carried byte for byte until
// #298 lands); these are the dates 182's SQL gives (PGlite checks the same
// vectors and the same function, "UI = SQL").
import { describe, it, expect } from 'vitest';
import { repeatDates } from '../recurrence';
import monthlyVectorsSrc from '../../../supabase/tests/monthly-clamp-vectors.json?raw';
import eventsViewSrc from '../../app/views/EventsView.tsx?raw';
import homeViewSrc from '../../app/views/HomeView.tsx?raw';
import appSrc from '../../app/AuthenticatedApp.tsx?raw';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const { vectors } = JSON.parse(monthlyVectorsSrc) as { vectors: { start: string; dates: string[] }[] };

describe('the app and 182 give the same monthly dates', () => {
  it('Jan 31 2027: Feb 28, Mar 31, Apr 30 ... (never Mar 3)', () => {
    const v = vectors.find((x) => x.start === '2027-01-31')!;
    const ui = repeatDates('2027-01-31', { frequency: 'monthly' }, new Date(2030, 0, 1), v.dates.length - 1).map(ymd);
    expect(ui[0]).toBe('2027-02-28');
    expect(ui).not.toContain('2027-03-03');
    expect(['2027-01-31', ...ui]).toEqual(v.dates);
  });

  it('every shared vector (29th-31st, 2027 and 2028)', () => {
    for (const { start, dates } of vectors) {
      const ui = repeatDates(start, { frequency: 'monthly' }, new Date(2030, 0, 1), dates.length - 1).map(ymd);
      expect([start, ...ui], start).toEqual(dates);
    }
  });

  it('EventsView expands repeats with repeatDates, not setMonth', () => {
    expect(eventsViewSrc).toContain("import { repeatDates } from '@/lib/recurrence';");
    expect(eventsViewSrc).not.toMatch(/cursor\.setMonth\(/);
  });

  // Codex review @ 0b5765f0 (M1): Calendar showed Feb 28, Home and the
  // dashboard lists Mar 3. One expander in the app: every surface steps
  // repeats through repeatDates, so the Jan 31 vector is the same on each.
  it.each([
    ['Calendar (EventsView)', eventsViewSrc, 2],
    ['Home (HomeView)', homeViewSrc, 1],
    ['dashboard + upcoming rehearsals (AuthenticatedApp)', appSrc, 2],
  ])('%s: no stepping of its own, repeatDates at every expansion', (_name, src, n) => {
    expect(src).not.toMatch(/\.setMonth\(\s*cursor\.getMonth\(\)/);
    expect(src).not.toMatch(/cursor\.setDate\(\s*cursor\.getDate\(\)\s*\+\s*(7|14)/);
    expect((src.match(/repeatDates\(/g) ?? []).length).toBe(n);
  });
});
