/**
 * Codex round 3 on #293 (QuotesExpanded.tsx:247): a quote made from Quotes
 * holds its date with a tentative event. Editing the quote there (date,
 * a musician replaced, a fee) updated only the quote, so accepting it
 * confirmed the event with its first date, lineup and fees.
 * syncQuoteHoldEvent keeps the tentative event in step; a confirmed gig is
 * never touched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const db: Record<string, Row[]> = { quotes: [], events: [], event_members: [] };
// Round 4: another admin confirms the gig between the find and the update.
const race = { confirmAfterFind: false };

vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'update' | 'delete' = 'select';
    let patch: Row = {};
    let single = false;
    let returning = false;
    const b: Record<string, any> = {};
    b.select = () => ((returning = op === 'update'), b);
    b.update = (p: Row) => ((op = 'update'), (patch = p), b);
    b.delete = () => ((op = 'delete'), b);
    b.eq = (c: string, v: unknown) => (filters.push((r) => r[c] === v), b);
    b.in = (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b);
    b.limit = () => b;
    b.maybeSingle = () => ((single = true), b);
    b.then = (ok: (v: unknown) => unknown) => {
      const hit = (db[table] || []).filter((r) => filters.every((f) => f(r)));
      if (op === 'update') hit.forEach((r) => Object.assign(r, patch));
      if (op === 'delete') db[table] = db[table].filter((r) => !hit.includes(r));
      if (table === 'events' && op === 'select' && race.confirmAfterFind) db.events.forEach((r) => (r.status = 'confirmed'));
      const data = op === 'select' ? (single ? hit[0] ?? null : hit.map((r) => ({ ...r }))) : returning ? hit.map((r) => ({ ...r })) : null;
      return Promise.resolve({ data, error: null }).then(ok);
    };
    return b;
  };
  const rpc = async (name: string, args: { p_event_id: string; p_rows: Row[] }) => {
    if (name !== 'bw_save_event_lineup') throw new Error(name);
    for (const r of args.p_rows) {
      const cur = db.event_members.find((m) => m.event_id === args.p_event_id && m.user_id === r.user_id);
      if (cur) Object.assign(cur, { role: r.role, fee: r.fee });
      else db.event_members.push({ event_id: args.p_event_id, ...r });
    }
    return { data: null, error: null };
  };
  const getSafeUser = async () => ({ data: { user: { id: ADMIN } } });
  return { supabase: { from, rpc, auth: { getUser: getSafeUser } }, getSafeUser };
});

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MAYA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SAM = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LENA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const QUOTE = '22222222-2222-4222-8222-222222222222';
const EVENT = '33333333-3333-4333-8333-333333333333';

import * as quotes from '../quotes';

const edited = {
  eventName: 'Rooftop wedding',
  clientName: 'Jordan Lee',
  eventDate: '2027-06-19',
  eventTimeStart: '19:00',
  venueName: 'The Foundry',
  venueCity: 'Long Island City',
  total: 3100,
  currency: 'usd',
};

beforeEach(() => {
  race.confirmAfterFind = false;
  db.quotes = [{ id: QUOTE, converted_to_event_id: EVENT }];
  db.events = [{ id: EVENT, status: 'tentative', event_date: '2027-06-12', venue_name: '230 Fifth', fee: 2400, currency: 'EUR' }];
  db.event_members = [
    { event_id: EVENT, user_id: MAYA, role: 'Vocals', fee: 400, status: 'confirmed' },
    { event_id: EVENT, user_id: SAM, role: 'Bass', fee: 350, status: 'pending' },
  ];
});

describe('syncQuoteHoldEvent', () => {
  it('a new date, place and fee reach the tentative event', async () => {
    expect(typeof (quotes as any).syncQuoteHoldEvent).toBe('function');
    const res = await quotes.syncQuoteHoldEvent(QUOTE, edited);
    expect(res).toEqual({ data: EVENT, error: null });
    expect(db.events[0]).toMatchObject({
      event_date: '2027-06-19', start_time: '19:00', venue_name: 'The Foundry', venue_city: 'Long Island City',
      fee: 3100, currency: 'USD', client_name: 'Jordan Lee', title: 'Rooftop wedding',
    });
    // No lineup given: the lineup is left as it is.
    expect(db.event_members).toHaveLength(2);
  });

  it('a musician replaced leaves the event, the new one joins, fees follow the quote', async () => {
    const res = await quotes.syncQuoteHoldEvent(QUOTE, edited, [
      { user_id: MAYA, instrument: 'Vocals', fee: 450 },
      { user_id: LENA, instrument: 'Bass', fee: 375 },
    ], [MAYA, SAM]);
    expect(res.error).toBeNull();
    const byUser = Object.fromEntries(db.event_members.map((m) => [m.user_id, m]));
    expect(Object.keys(byUser).sort()).toEqual([MAYA, LENA].sort());
    // Maya keeps her answer, with the new fee; Lena is asked.
    expect(byUser[MAYA]).toMatchObject({ fee: 450, status: 'confirmed' });
    expect(byUser[LENA]).toMatchObject({ fee: 375, status: 'pending', role: 'Bass' });
  });

  it('a confirmed gig is never touched', async () => {
    db.events[0].status = 'confirmed';
    const res = await quotes.syncQuoteHoldEvent(QUOTE, edited, [{ user_id: LENA, instrument: 'Bass', fee: 375 }]);
    expect(res).toEqual({ data: null, error: null });
    expect(db.events[0]).toMatchObject({ event_date: '2027-06-12', fee: 2400, currency: 'EUR' });
    expect(db.event_members.map((m) => m.user_id).sort()).toEqual([MAYA, SAM].sort());
  });

  it('finds the hold by events.quote_id when the quote has no link to it', async () => {
    db.quotes = [{ id: QUOTE, converted_to_event_id: null }];
    db.events[0].quote_id = QUOTE;
    const res = await quotes.syncQuoteHoldEvent(QUOTE, edited);
    expect(res.data).toBe(EVENT);
    expect(db.events[0].event_date).toBe('2027-06-19');
  });

  it('confirmed between the find and the update: stops, changes and deletes nothing, says so', async () => {
    race.confirmAfterFind = true;
    const res = await quotes.syncQuoteHoldEvent(QUOTE, edited, [{ user_id: LENA, instrument: 'Bass', fee: 375 }]);
    expect(res).toEqual({ data: null, error: null, confirmed: true });
    expect(db.events[0]).toMatchObject({ event_date: '2027-06-12', fee: 2400 });
    expect(db.event_members.map((m) => m.user_id).sort()).toEqual([MAYA, SAM].sort());
  });

  // Claude review of #293, MINOR 3 (the fallback before 185): only who was on
  // the quote's lineup before can leave the gig.
  it('someone added to the gig directly, the admin, a deputy stay; only the replaced musician leaves', async () => {
    const DEPUTY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    db.event_members.push(
      { event_id: EVENT, user_id: ADMIN, role: 'Keys', fee: 0, status: 'confirmed' },
      { event_id: EVENT, user_id: DEPUTY, role: 'Sax', fee: 180, status: 'confirmed' },
    );
    const res = await quotes.syncQuoteHoldEvent(QUOTE, edited, [{ user_id: MAYA, instrument: 'Vocals', fee: 450 }], [MAYA, SAM]);
    expect(res.error).toBeNull();
    expect(db.event_members.map((m) => m.user_id).sort()).toEqual([MAYA, ADMIN, DEPUTY].sort());
  });

  it('a quote that had no lineup takes nobody off the gig', async () => {
    const res = await quotes.syncQuoteHoldEvent(QUOTE, edited, [], []);
    expect(res.error).toBeNull();
    expect(db.event_members.map((m) => m.user_id).sort()).toEqual([MAYA, SAM].sort());
  });
});
