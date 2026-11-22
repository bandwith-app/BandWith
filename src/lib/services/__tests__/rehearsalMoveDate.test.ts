import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Claude #297 round 3: a new date for one later date of a series, "Only this
 * date": the series loses that date and a one-off rehearsal with the same
 * details and people takes the new date. The series row is never moved.
 */
const db = vi.hoisted(() => ({
  rpc: [] as { fn: string; args: any }[],
  updates: [] as unknown[],
  created: [] as { ev: any; members: any }[],
  moveRpc: { data: { event_id: 'req-1', series_id: 'ev', skip_dates: ['2099-12-08'] }, error: null } as { data: any; error: any },
}));

vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    let op = 'select';
    const q: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (res: (v: unknown) => void) => {
            if (table === 'event_members') return res({ data: [{ user_id: 'u1', role: 'Bass', status: 'confirmed' }, { user_id: 'u2', role: null, status: 'pending' }], error: null });
            return res({ data: [], error: null });
          };
        }
        if (prop === 'maybeSingle') return async () => ({
          data: { id: 'ev', band_id: 'b1', title: 'Weekly', event_type: 'rehearsal', status: 'confirmed', venue_name: 'Studio 4', venue_address: '12 Bond St', venue_city: 'Brooklyn', notes: 'Bring charts', setlist_id: 'sl-1', is_recurring: true, recurrence_rule: { frequency: 'weekly' } },
          error: null,
        });
        return (arg?: unknown) => {
          if (prop === 'update') { op = 'update'; db.updates.push(arg); }
          return q;
        };
      },
    });
    return q;
  };
  const rpc = async (fn: string, args: any) => {
    db.rpc.push({ fn, args });
    if (fn === 'bw_move_rehearsal_date') return db.moveRpc;
    return { data: { skip_dates: [args.p_date] }, error: null };
  };
  return { supabase: { from, rpc } };
});
vi.mock('../events', () => ({
  createEvent: async (ev: any, members: any) => {
    db.created.push({ ev, members });
    return { data: { id: 'new', ...ev }, error: null };
  },
}));

import { moveRehearsalDateOnly } from '../rehearsalSkip';

beforeEach(() => {
  db.rpc.length = 0;
  db.updates.length = 0;
  db.created.length = 0;
  db.moveRpc = { data: { event_id: 'req-1', series_id: 'ev', skip_dates: ['2099-12-08'] }, error: null };
});

describe('Only this date (Codex #297 round 3 B2 B3)', () => {
  it('is one server step with the request id: no copy made by the app, no separate skip', async () => {
    const { error } = await moveRehearsalDateOnly(
      { eventId: 'ev', band_id: 'b1', date: '2099-12-08', seriesDate: '2099-12-01' },
      { title: 'Weekly', date: '2099-12-10', startTime: '19:00', endTime: '22:00', clientId: 'req-1' },
    );
    expect(error).toBeNull();
    expect(db.rpc).toEqual([{
      fn: 'bw_move_rehearsal_date',
      args: { p_event_id: 'ev', p_date: '2099-12-08', p_new_date: '2099-12-10', p_fields: { title: 'Weekly', start_time: '19:00', end_time: '22:00' }, p_client_id: 'req-1' },
    }]);
    expect(db.created).toEqual([]);
    expect(db.updates).toEqual([]);
  });

  it('a member is told only admins can, nothing else runs', async () => {
    db.moveRpc = { data: null, error: { code: '42501', message: 'Only band admins' } };
    const { error } = await moveRehearsalDateOnly({ eventId: 'ev', band_id: 'b1', date: '2099-12-08' }, { title: 'x', date: '2099-12-10', startTime: '19:00', endTime: '', clientId: 'r' });
    expect(error?.message).toMatch(/admins/);
    expect(db.created).toEqual([]);
    expect(db.rpc.map((r) => r.fn)).toEqual(['bw_move_rehearsal_date']);
  });

  it('without 195: copies the series (setlist too) with the same people, then takes the old date out', async () => {
    db.moveRpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    const { error } = await moveRehearsalDateOnly(
      { eventId: 'ev', band_id: 'b1', date: '2099-12-08', seriesDate: '2099-12-01' },
      { title: 'Weekly', date: '2099-12-10', startTime: '19:00', endTime: '22:00' },
    );
    expect(error).toBeNull();
    expect(db.created).toHaveLength(1);
    expect(db.created[0].ev).toMatchObject({
      band_id: 'b1', event_type: 'rehearsal', event_date: '2099-12-10', start_time: '19:00', end_time: '22:00',
      venue_name: 'Studio 4', notes: 'Bring charts', setlist_id: 'sl-1', parent_event_id: 'ev', is_recurring: false, recurrence_rule: null,
    });
    expect(db.created[0].members).toEqual([{ user_id: 'u1', role: 'Bass', status: 'confirmed' }, { user_id: 'u2', role: undefined, status: 'pending' }]);
    expect(db.rpc.map((r) => r.fn)).toEqual(['bw_move_rehearsal_date', 'bw_skip_rehearsal_date']);
    expect(db.updates).toEqual([]); // the series row is not moved
  });

  // Claude #297 round 4: the wizard saves its other changes on the one-off.
  it("says which event the one-off is: the server's, or the request id without 195", async () => {
    const viaRpc = await moveRehearsalDateOnly({ eventId: 'ev', band_id: 'b1', date: '2099-12-08' }, { title: 'W', date: '2099-12-10', startTime: '19:00', endTime: '', clientId: 'req-1' });
    expect(viaRpc).toEqual({ error: null, eventId: 'req-1' });
    db.moveRpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    const viaCopy = await moveRehearsalDateOnly({ eventId: 'ev', band_id: 'b1', date: '2099-12-08' }, { title: 'W', date: '2099-12-10', startTime: '19:00', endTime: '', clientId: 'req-2' });
    expect(viaCopy.error).toBeNull();
    expect(db.created[0].ev.id).toBe('req-2'); // a retry creates nothing more
    expect(viaCopy.eventId).toBe('req-2');
  });

  it('needs the band and both dates', async () => {
    const { error } = await moveRehearsalDateOnly({ eventId: 'ev', band_id: null, date: '2099-12-08' }, { title: 'x', date: '2099-12-10', startTime: '19:00', endTime: '' });
    expect(error).toBeTruthy();
    expect(db.created).toEqual([]);
    expect(db.rpc).toEqual([]);
  });
});
