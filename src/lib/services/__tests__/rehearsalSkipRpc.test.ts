import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Codex #297 B3: "Delete this date" is one server step (195,
 * bw_skip_rehearsal_date) so two admins skipping different dates at once
 * both keep theirs. A database without 195 (or the demo) falls back to the
 * read-then-write. Coordinator round 2: a date with no band or no date is
 * refused; the series is never deleted from this path.
 */
const db = vi.hoisted(() => ({
  rpc: [] as { fn: string; args: unknown }[],
  rpcAnswer: { data: null as unknown, error: null as unknown },
  from: [] as string[],
  updates: [] as unknown[],
  deletes: 0,
  rule: { frequency: 'weekly' } as Record<string, unknown>,
}));

// The device's zone goes with every date action (Codex #297 r8).
vi.mock('@/lib/deviceTimeZone', () => ({ deviceTimeZone: () => 'America/New_York' }));
vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    db.from.push(table);
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
        if (prop === 'maybeSingle') return async () => ({ data: { id: 'ev', is_recurring: true, recurrence_rule: db.rule }, error: null });
        return (arg?: unknown) => {
          if (prop === 'update') { op = 'update'; payload = arg; }
          if (prop === 'delete') { op = 'delete'; db.deletes++; }
          return q;
        };
      },
    });
    return q;
  };
  const rpc = async (fn: string, args: unknown) => {
    db.rpc.push({ fn, args });
    return db.rpcAnswer;
  };
  return { supabase: { from, rpc } };
});

import * as skip from '../rehearsalSkip';
const { skipRehearsalDate, deleteRehearsalDate } = skip;

beforeEach(() => {
  db.rpc.length = 0;
  db.from.length = 0;
  db.updates.length = 0;
  db.deletes = 0;
  db.rule = { frequency: 'weekly' };
  db.rpcAnswer = { data: { skip_dates: ['2099-12-19'] }, error: null };
});

describe('skipping one rehearsal date on the server', () => {
  it('uses the one-step server call and writes nothing itself', async () => {
    const { error } = await skipRehearsalDate('ev', '2099-12-19T20:00:00');
    expect(error).toBeNull();
    expect(db.rpc).toEqual([{ fn: 'bw_skip_rehearsal_date', args: { p_event_id: 'ev', p_date: '2099-12-19', p_tz: 'America/New_York' } }]);
    expect(db.from).toEqual([]);
  });

  it('falls back to read-then-write when 195 is not there', async () => {
    db.rpcAnswer = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    const { error } = await skipRehearsalDate('ev', '2099-12-19');
    expect(error).toBeNull();
    expect(db.updates).toEqual([{ recurrence_rule: { frequency: 'weekly', skip_dates: ['2099-12-19'] } }]);
  });

  it('falls back when the call gives no answer (demo)', async () => {
    db.rpcAnswer = { data: null, error: null };
    const { error } = await skipRehearsalDate('ev', '2099-12-19');
    expect(error).toBeNull();
    expect(db.updates).toHaveLength(1);
  });

  it('a refusal from the server is shown, not retried the old way', async () => {
    db.rpcAnswer = { data: null, error: { code: '42501', message: 'Only band admins can delete this event' } };
    const { error } = await skipRehearsalDate('ev', '2099-12-19');
    expect(error?.message).toBe('Only band admins can delete this event.');
    expect(db.updates).toEqual([]);
  });
});

describe('Delete this date with a missing band or date', () => {
  it('is refused with a message: no server call, nothing deleted', async () => {
    for (const ev of [
      { eventId: 'ev', band_id: undefined, date: '2099-12-19' },
      { eventId: 'ev', band_id: 'b1', date: '' },
      { eventId: 'ev', band_id: 'b1', date: undefined },
    ]) {
      const { error } = await deleteRehearsalDate(ev);
      expect(error?.message).toBe("This date can't be deleted on its own. Reload and try again.");
    }
    expect(db.rpc).toEqual([]);
    expect(db.from).toEqual([]);
    expect(db.deletes).toBe(0);
  });

  it('with both, skips that date', async () => {
    const { error } = await deleteRehearsalDate({ eventId: 'ev', band_id: 'b1', date: '2099-12-19' });
    expect(error).toBeNull();
    expect(db.rpc).toHaveLength(1);
  });
});

import appSrc from '@/app/AuthenticatedApp.tsx?raw';

describe('the app never falls through to deleting the series', () => {
  it("scope 'date' always returns after deleteRehearsalDate", () => {
    const start = appSrc.indexOf('const handleEventDelete = async');
    const body = appSrc.slice(start, start + 1200);
    expect(body).toMatch(/if \(scope === 'date'\) \{[\s\S]*?deleteRehearsalDate\(selectedEvent\)[\s\S]*?return;\s*\}/);
  });
});

describe('a deleted date back in the series (Claude #297 r5 minor 5)', () => {
  it('195: one server step, nothing written by the app', async () => {
    db.rpcAnswer = { data: { event_id: 'ev', skip_dates: ['2099-12-26'] }, error: null };
    const out = await skip.restoreRehearsalDate('ev', '2099-12-19T20:00:00');
    expect(out).toEqual({ error: null, skipDates: ['2099-12-26'] });
    expect(db.rpc).toEqual([{ fn: 'bw_restore_rehearsal_date', args: { p_event_id: 'ev', p_date: '2099-12-19', p_tz: 'America/New_York' } }]);
    expect(db.updates).toEqual([]);
  });

  it('before 195: the stored rule without that date, the other deleted dates kept', async () => {
    db.rpcAnswer = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    db.rule = { frequency: 'weekly', until: '2100-01-01', skip_dates: ['2099-12-19', '2099-12-26'] };
    const out = await skip.restoreRehearsalDate('ev', '2099-12-19');
    expect(out.error).toBeNull();
    expect(db.updates).toEqual([{ recurrence_rule: { frequency: 'weekly', until: '2100-01-01', skip_dates: ['2099-12-26'] } }]);
  });

  it('a member is told only admins can', async () => {
    db.rpcAnswer = { data: null, error: { code: '42501', message: 'Only band admins' } };
    const out = await skip.restoreRehearsalDate('ev', '2099-12-19');
    expect(out.error?.message).toMatch(/admins/);
    expect(db.updates).toEqual([]);
  });

  it('needs the event and a date', async () => {
    const out = await skip.restoreRehearsalDate('ev', '');
    expect(out.error).toBeTruthy();
    expect(db.rpc).toEqual([]);
  });
});

describe('Codex #297 r7: the server refuses a date (B3) or a quote (B1)', () => {
  it('a date the series no longer has (another admin moved it): says so, writes nothing', async () => {
    db.rpcAnswer = { data: null, error: { code: '22023', hint: 'bw:not_a_date', message: "This date is not one of the rehearsal's dates" } };
    const { error } = await skipRehearsalDate('ev', '2099-12-14');
    expect(error?.message).toBe('This date is no longer part of the series. Reload and try again.');
    expect(db.updates).toHaveLength(0);
  });

  it('a quote: its own message, writes nothing', async () => {
    db.rpcAnswer = { data: null, error: { code: '22023', hint: 'bw:is_quote', message: 'A quote has no single dates to delete' } };
    const { error } = await skipRehearsalDate('ev', '2099-12-14');
    expect(error?.message).toBe("A quote's dates can't be deleted or moved one by one.");
    expect(db.updates).toHaveLength(0);
  });
});
