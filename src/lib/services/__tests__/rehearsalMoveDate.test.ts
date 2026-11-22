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
  // Codex #297 B1 / B3 (before 195).
  setlistBand: 'b1',
  existing: null as null | { id: string; parent_event_id: string },
  existingAfterCreate: null as null | { id: string; parent_event_id: string },
  createError: null as null | { code: string; message: string },
  deletes: [] as { table: string; id: unknown }[],
}));

// The device's zone goes with every date action (Codex #297 r8).
vi.mock('@/lib/deviceTimeZone', () => ({ deviceTimeZone: () => 'America/New_York' }));
vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    let op = 'select';
    const filters: Record<string, unknown> = {};
    const q: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (res: (v: unknown) => void) => {
            if (op === 'delete') { db.deletes.push({ table, id: filters.id }); return res({ data: null, error: null }); }
            if (table === 'event_members') return res({ data: [{ user_id: 'u1', role: 'Bass', status: 'confirmed' }, { user_id: 'u2', role: null, status: 'pending' }], error: null });
            if (table === 'setlist_songs') return res({ data: [{ song_id: 's1', position: 0, set_number: 1, notes: null }, { song_id: 's2', position: 1, set_number: 1, notes: 'capo 2' }], error: null });
            return res({ data: [], error: null });
          };
        }
        if (prop === 'maybeSingle' && table === 'setlists') return async () => ({ data: { name: 'Weekly setlist', band_id: db.setlistBand }, error: null });
        if (prop === 'maybeSingle' && table === 'events' && filters.id && filters.id !== 'ev') {
          return async () => ({ data: db.created.length ? db.existingAfterCreate : db.existing, error: null });
        }
        if (prop === 'maybeSingle') return async () => ({
          data: { id: 'ev', band_id: 'b1', title: 'Weekly', event_type: 'rehearsal', status: 'confirmed', venue_name: 'Studio 4', venue_address: '12 Bond St', venue_city: 'Brooklyn', notes: 'Bring charts', setlist_id: 'sl-1', is_recurring: true, recurrence_rule: { frequency: 'weekly' } },
          error: null,
        });
        return (arg?: unknown, val?: unknown) => {
          if (prop === 'update') { op = 'update'; db.updates.push(arg); }
          if (prop === 'delete') op = 'delete';
          if (prop === 'eq') filters[String(arg)] = val;
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
    if (db.createError) return { data: null, error: db.createError };
    return { data: { id: 'new', ...ev }, error: null };
  },
}));

const setlists = vi.hoisted(() => ({ created: [] as { sl: any; songs: any }[] }));
vi.mock('../songs', () => ({
  createSetlist: async (sl: any, songs: any) => {
    setlists.created.push({ sl, songs });
    return { data: { id: 'sl-copy', ...sl }, error: null };
  },
}));

import { moveRehearsalDateOnly } from '../rehearsalSkip';

beforeEach(() => {
  db.rpc.length = 0;
  db.updates.length = 0;
  db.created.length = 0;
  setlists.created.length = 0;
  db.setlistBand = 'b1';
  db.existing = null;
  db.existingAfterCreate = null;
  db.createError = null;
  db.deletes.length = 0;
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
      args: { p_event_id: 'ev', p_date: '2099-12-08', p_new_date: '2099-12-10', p_fields: { title: 'Weekly', start_time: '19:00', end_time: '22:00' }, p_client_id: 'req-1', p_tz: 'America/New_York' },
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
      venue_name: 'Studio 4', notes: 'Bring charts', setlist_id: 'sl-copy', parent_event_id: 'ev', is_recurring: false, recurrence_rule: null,
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

describe('Only this date, Claude #297 r5', () => {
  const series = { eventId: 'ev', band_id: 'b1', date: '2099-12-08', seriesDate: '2099-12-01' };
  const wizard = {
    title: 'Weekly', date: '2099-12-10', startTime: '15:00', endTime: '18:00', clientId: 'req-1',
    fields: {
      venue_name: 'Room 2, Queens', notes: 'New charts', fee: 90,
      // Never taken from the form.
      band_id: 'other', recurrence_rule: { frequency: 'daily' }, event_date: '2001-01-01', setlist_id: 'x', status: 'cancelled', _editing: true,
    },
  };

  it('minor 2: the wizard\'s other edits go in the same server step', async () => {
    await moveRehearsalDateOnly(series, wizard);
    expect(db.rpc).toHaveLength(1);
    expect(db.rpc[0].args.p_fields).toEqual({ venue_name: 'Room 2, Queens', notes: 'New charts', fee: 90, title: 'Weekly', start_time: '15:00', end_time: '18:00' });
  });

  it('minor 2 without 195: the copy carries the edits, the series is not written', async () => {
    db.moveRpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    await moveRehearsalDateOnly(series, wizard);
    expect(db.created[0].ev).toMatchObject({ venue_name: 'Room 2, Queens', notes: 'New charts', fee: 90, band_id: 'b1', event_date: '2099-12-10', is_recurring: false, recurrence_rule: null, start_time: '15:00' });
    expect(db.updates).toEqual([]);
  });

  it('minor 1 without 195: the one-off gets its own copy of the setlist', async () => {
    db.moveRpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    await moveRehearsalDateOnly(series, wizard);
    expect(setlists.created).toEqual([{
      sl: { band_id: 'b1', name: 'Weekly setlist' },
      songs: [{ song_id: 's1', position: 0, set_number: 1 }, { song_id: 's2', position: 1, set_number: 1, notes: 'capo 2' }],
    }]);
    expect(db.created[0].ev.setlist_id).toBe('sl-copy');
  });

  it.each([
    ['bw:not_a_date', /no longer part of the series/],
    ['bw:date_deleted', /already deleted/],
    ['bw:date_past', /in the past/],
  ])('minor 4: the refusal %s says why', async (hint, text) => {
    db.moveRpc = { data: null, error: { code: '22023', message: 'refused', hint } };
    const { error } = await moveRehearsalDateOnly(series, wizard);
    expect(error?.message).toMatch(text);
    expect(db.created).toEqual([]);
  });
});

describe('Only this date before 195, Codex #297 r6', () => {
  const series = { eventId: 'ev', band_id: 'b1', date: '2099-12-08', seriesDate: '2099-12-01' };
  const values = { title: 'Weekly', date: '2099-12-10', startTime: '19:00', endTime: '22:00', clientId: 'req-9' };
  const older = () => { db.moveRpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }; };

  it('B1: a setlist of another band is not copied, and the one-off has none', async () => {
    older();
    db.setlistBand = 'other-band';
    const { error } = await moveRehearsalDateOnly(series, values);
    expect(error).toBeNull();
    expect(setlists.created).toEqual([]);
    expect(db.created[0].ev.setlist_id).toBeNull();
  });

  it('B3: a retry finds the one-off it made and only takes the old date out', async () => {
    older();
    db.existing = { id: 'req-9', parent_event_id: 'ev' };
    const out = await moveRehearsalDateOnly(series, values);
    expect(out).toEqual({ error: null, eventId: 'req-9' });
    expect(db.created).toEqual([]);
    expect(setlists.created).toEqual([]);
    expect(db.rpc.map((r) => r.fn)).toEqual(['bw_move_rehearsal_date', 'bw_skip_rehearsal_date']);
  });

  it('B3: the same id already taken (23505) by this request: that one-off, the extra setlist copy dropped, the date taken out', async () => {
    older();
    db.createError = { code: '23505', message: 'duplicate key value violates unique constraint "events_pkey"' };
    db.existingAfterCreate = { id: 'req-9', parent_event_id: 'ev' };
    const out = await moveRehearsalDateOnly(series, values);
    expect(out).toEqual({ error: null, eventId: 'req-9' });
    expect(db.deletes).toEqual([{ table: 'setlists', id: 'sl-copy' }]);
    expect(db.rpc.map((r) => r.fn)).toEqual(['bw_move_rehearsal_date', 'bw_skip_rehearsal_date']);
  });

  it('B3: an id taken by something else is still an error', async () => {
    older();
    db.createError = { code: '23505', message: 'duplicate' };
    db.existingAfterCreate = { id: 'req-9', parent_event_id: 'another-series' };
    const out = await moveRehearsalDateOnly(series, values);
    expect(out.error).toBeTruthy();
    expect(db.rpc.map((r) => r.fn)).toEqual(['bw_move_rehearsal_date']);
  });
});
