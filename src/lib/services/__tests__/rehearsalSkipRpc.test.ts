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
}));

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
        if (prop === 'maybeSingle') return async () => ({ data: { id: 'ev', is_recurring: true, recurrence_rule: { frequency: 'weekly' } }, error: null });
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

import { skipRehearsalDate, deleteRehearsalDate } from '../rehearsalSkip';

beforeEach(() => {
  db.rpc.length = 0;
  db.from.length = 0;
  db.updates.length = 0;
  db.deletes = 0;
  db.rpcAnswer = { data: { skip_dates: ['2099-12-19'] }, error: null };
});

describe('skipping one rehearsal date on the server', () => {
  it('uses the one-step server call and writes nothing itself', async () => {
    const { error } = await skipRehearsalDate('ev', '2099-12-19T20:00:00');
    expect(error).toBeNull();
    expect(db.rpc).toEqual([{ fn: 'bw_skip_rehearsal_date', args: { p_event_id: 'ev', p_date: '2099-12-19' } }]);
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
