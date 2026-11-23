import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Audit 05 #4: one date of a repeating rehearsal is skipped, the series row stays. */
const db = vi.hoisted(() => ({
  rule: { frequency: 'weekly', interval: 1, skip_dates: ['2099-12-05'] } as Record<string, unknown> | null,
  recurring: true,
  updates: [] as unknown[],
  deletes: 0,
}));

vi.mock('@/lib/supabase', () => {
  const from = () => {
    let op = 'select';
    let payload: unknown;
    const q: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (res: (v: unknown) => void) => {
            if (op === 'update') db.updates.push(payload);
            return res({ data: op === 'update' ? [{ id: 'ev' }] : null, error: null });
          };
        }
        if (prop === 'maybeSingle') return async () => ({ data: { id: 'ev', is_recurring: db.recurring, recurrence_rule: db.rule }, error: null });
        return (arg?: unknown) => {
          if (prop === 'update') { op = 'update'; payload = arg; }
          if (prop === 'delete') { op = 'delete'; db.deletes++; }
          return q;
        };
      },
    });
    return q;
  };
  // Before 195: no one-step call, the read-then-write runs.
  const rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
  return { supabase: { from, rpc } };
});

import { isSkippedOccurrence, skippedDates, withSkippedDate } from '../recurrenceSkips';
import { skipRehearsalDate } from '../services/rehearsalSkip';

beforeEach(() => {
  db.rule = { frequency: 'weekly', interval: 1, skip_dates: ['2099-12-05'] };
  db.recurring = true;
  db.updates.length = 0;
  db.deletes = 0;
});

describe('skipped dates of a repeating rehearsal', () => {
  it('reads, adds and checks skipped dates', () => {
    const ev = { is_recurring: true, recurrence_rule: withSkippedDate({ frequency: 'weekly' }, '2099-12-19T20:00:00') };
    expect(ev.recurrence_rule).toEqual({ frequency: 'weekly', skip_dates: ['2099-12-19'] });
    expect(isSkippedOccurrence(ev, '2099-12-19')).toBe(true);
    expect(isSkippedOccurrence(ev, '2099-12-26')).toBe(false);
    expect(isSkippedOccurrence({ is_recurring: true, recurrence_rule: null }, '2099-12-19')).toBe(false);
    expect(skippedDates({ skip_dates: ['bad', 3, '2099-01-01'] })).toEqual(new Set(['2099-01-01']));
  });

  it('saves the date into the stored rule, keeping dates skipped before, and never deletes the event', async () => {
    const { error } = await skipRehearsalDate('ev', '2099-12-19');
    expect(error).toBeNull();
    expect(db.deletes).toBe(0);
    expect(db.updates).toEqual([{ recurrence_rule: { frequency: 'weekly', interval: 1, skip_dates: ['2099-12-05', '2099-12-19'] } }]);
  });

  it('refuses when the rehearsal no longer repeats', async () => {
    db.recurring = false;
    const { error } = await skipRehearsalDate('ev', '2099-12-19');
    expect(error).toBeTruthy();
    expect(db.updates).toEqual([]);
  });
});

import eventsViewSrc from '@/app/views/EventsView.tsx?raw';
import homeViewSrc from '@/app/views/HomeView.tsx?raw';
import appSrc from '@/app/AuthenticatedApp.tsx?raw';

describe('every list that expands a series leaves skipped dates out', () => {
  it('Calendar (month and list), Home and the app lists', () => {
    const count = (src: string) => (src.match(/isSkippedOccurrence\(/g) || []).length;
    // first date + later dates in each expansion
    expect(count(eventsViewSrc)).toBeGreaterThanOrEqual(3);
    expect(count(homeViewSrc)).toBeGreaterThanOrEqual(2);
    expect(count(appSrc)).toBeGreaterThanOrEqual(4);
  });
});

/**
 * Codex #297 B4: the calendar feeds (#285, supabase/functions/_shared/
 * deputy-calendar.ts and 182) write one EXDATE per entry of
 * recurrence_rule.skip_dates and match each entry as a 'YYYY-MM-DD' string.
 * A date deleted here is stored in exactly that key and form: the local day
 * of the occurrence, never a timestamp or a UTC day.
 */
const FEED = import.meta.glob(['/supabase/functions/_shared/deputy-calendar.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const feedSrc = FEED['/supabase/functions/_shared/deputy-calendar.ts'] ?? '';
const FEED_DAY = /^\d{4}-\d{2}-\d{2}$/;

describe('a deleted date is what the calendar feed reads (Codex #297 B4)', () => {
  it('stored under recurrence_rule.skip_dates as the local YYYY-MM-DD of the occurrence', async () => {
    const { withSkippedDate } = await import('../recurrenceSkips');
    const rule = withSkippedDate({ frequency: 'weekly', interval: 1 }, '2099-12-08T23:30:00');
    expect(rule.skip_dates).toEqual(['2099-12-08']);
    expect(rule.skip_dates.every((d) => FEED_DAY.test(d))).toBe(true);
  });

  it.skipIf(!/skip_dates/.test(feedSrc))('the feed builder reads that key with that form (#285 merged)', () => {
    expect(feedSrc).toMatch(/skip_dates/);
    expect(feedSrc).toContain('/^\\d{4}-\\d{2}-\\d{2}$/');
    expect(feedSrc).toMatch(/EXDATE/);
  });
});
