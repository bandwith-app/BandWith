/**
 * `until` in a time zone west of Greenwich (New York) and far east of it
 * (Auckland): "2027-01-21" keeps the rehearsal of January 21. The zone is
 * switched for this file only (Node applies a new TZ at once).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { repeatDates } from '../recurrence';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const was = env.TZ;
afterAll(() => {
  if (was === undefined) delete env.TZ;
  else env.TZ = was;
});

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

for (const zone of ['America/New_York', 'Pacific/Auckland', 'UTC']) {
  describe(`recurrence in ${zone}`, () => {
    it('the until day is included (until = new Date(rule.until), as the screens pass it)', () => {
      env.TZ = zone;
      // The zone took effect: New York is behind UTC in January, Auckland ahead.
      const offset = new Date(2027, 0, 21).getTimezoneOffset();
      expect(zone === 'America/New_York' ? offset > 0 : zone === 'UTC' ? offset === 0 : offset < 0).toBe(true);
      const rule = { frequency: 'weekly', until: '2027-01-21' };
      expect(repeatDates('2027-01-07', rule, new Date(rule.until), 24).map(ymd)).toEqual(['2027-01-14', '2027-01-21']);
      const monthly = { frequency: 'monthly', until: '2027-04-30' };
      expect(repeatDates('2027-01-31', monthly, new Date(monthly.until), 24).map(ymd)).toEqual([
        '2027-02-28',
        '2027-03-31',
        '2027-04-30',
      ]);
    });
  });
}
