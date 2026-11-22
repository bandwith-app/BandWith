/**
 * Gig chats and the lineup (review round 2 of #281):
 *  - sendMessage re-adds the gig's lineup to its chat on every send; only
 *    musicians who are still in the band, and still on the gig (not
 *    declined, dropped out or removed). A failed insert is reported.
 *  - createChat (no 193 yet) adds the creator on their own first, then the
 *    others still in the band: one former member on the lineup used to make
 *    the whole insert fail and leave a chat nobody was in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Call = [string, ...unknown[]];
type Resolver = (table: string, calls: Call[]) => { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  resolve: (() => ({ data: null, error: null })) as Resolver,
  chains: [] as { table: string; calls: Call[] }[],
}));

vi.mock('@/lib/supabase', () => {
  const chain = (table: string) => {
    const rec = { table, calls: [] as Call[] };
    h.chains.push(rec);
    const proxy: any = new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === 'then') {
            const p = Promise.resolve(h.resolve(table, rec.calls));
            return p.then.bind(p);
          }
          return (...args: unknown[]) => {
            rec.calls.push([prop, ...args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  const supabase = {
    from: (table: string) => chain(table),
    rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  };
  return { supabase, getSafeUser: async () => ({ data: { user: { id: 'me', email: 'me@example.invalid' } } }) };
});
vi.mock('../notifications', () => ({ sendPushToUsers: vi.fn() }));

import { createChat, sendMessage } from '../chats';

const has = (calls: Call[], m: string) => calls.some(([x]) => x === m);
const writes = (table: string, method: 'upsert' | 'insert') =>
  h.chains
    .filter((c) => c.table === table)
    .flatMap((c) => c.calls.filter(([m]) => m === method).map(([, rows]) => (Array.isArray(rows) ? rows : [rows]) as { user_id: string }[]));

const LINEUP = [
  { user_id: 'me', status: 'confirmed' },
  { user_id: 'line-1', status: 'confirmed' },
  { user_id: 'ex-1', status: 'confirmed' }, // left the band, still on the lineup
  { user_id: 'drop-1', status: 'dropped_out' },
  { user_id: 'gone-1', status: 'removed' },
  { user_id: 'new-1', status: null },
];
const ACTIVE = ['me', 'line-1', 'drop-1', 'gone-1', 'new-1'];

let warn: { mock: { calls: unknown[][] } };
beforeEach(() => {
  h.chains.length = 0;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const resolver = (opts: { upsertError?: unknown } = {}): Resolver => (table, calls) => {
  if (table === 'chats' && has(calls, 'single'))
    return { data: { id: 'ev-chat', type: 'event', band_id: null, event_id: 'gig-1', name: 'Rooftop', created_by: 'admin' }, error: null };
  if (table === 'events') return { data: { band_id: 'band-1' }, error: null };
  if (table === 'event_members') return { data: LINEUP, error: null };
  if (table === 'band_members') {
    if (has(calls, 'maybeSingle')) return { data: { role: 'admin', id: 'bm' }, error: null };
    const ids = (calls.find(([m, col]) => m === 'in' && col === 'user_id')?.[2] as string[] | undefined) ?? ACTIVE;
    return { data: ids.filter((u) => ACTIVE.includes(u)).map((user_id) => ({ user_id })), error: null };
  }
  if (table === 'chat_participants' && has(calls, 'upsert') && opts.upsertError && writes('chat_participants', 'upsert').some((r) => r.length > 1))
    return { data: null, error: opts.upsertError };
  if (table === 'chat_participants' && has(calls, 'select') && !has(calls, 'upsert')) return { data: [{ user_id: 'me' }], error: null };
  return { data: null, error: null };
};

describe('sendMessage keeps the gig chat to the current lineup', () => {
  it('re-adds only musicians still in the band and still on the gig', async () => {
    h.resolve = resolver();
    await sendMessage('ev-chat', 'Load-in at 6');
    const added = writes('chat_participants', 'upsert').filter((rows) => rows.length > 1 || rows[0]?.user_id !== 'me').flat().map((r) => r.user_id);
    expect(added.sort()).toEqual(['line-1', 'me', 'new-1']);
  });

  it('reports a failed lineup insert instead of ignoring it', async () => {
    h.resolve = resolver({ upsertError: { message: 'new row violates row-level security policy' } });
    await sendMessage('ev-chat', 'Load-in at 6');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('[sendMessage]') && String(c.join(' ')).includes('row-level security'))).toBe(true);
  });
});

describe('createChat without 193', () => {
  it('adds the creator on their own, then the lineup still in the band', async () => {
    h.resolve = (table, calls) => {
      if (table === 'chats' && has(calls, 'maybeSingle')) return { data: null, error: null };
      if (table === 'chats' && has(calls, 'single')) return { data: { id: 'new-chat', type: 'event' }, error: null };
      return resolver()(table, calls);
    };
    const { data, error } = await createChat({
      type: 'event',
      name: 'Rooftop',
      band_id: 'band-1',
      event_id: 'gig-1',
      participant_ids: ['line-1', 'ex-1'],
    });
    expect(error).toBeNull();
    expect(data?.id).toBe('new-chat');
    const batches = writes('chat_participants', 'insert');
    expect(batches[0].map((r) => r.user_id)).toEqual(['me']);
    expect(batches.slice(1).flat().map((r) => r.user_id)).toEqual(['line-1']);
  });

  it('a creator who cannot join gets an error, not an empty chat', async () => {
    h.resolve = (table, calls) => {
      if (table === 'chats' && has(calls, 'maybeSingle')) return { data: null, error: null };
      if (table === 'chats' && has(calls, 'single')) return { data: { id: 'new-chat', type: 'event' }, error: null };
      if (table === 'chat_participants' && has(calls, 'insert')) return { data: null, error: { message: 'refused' } };
      return resolver()(table, calls);
    };
    const { data, error } = await createChat({ type: 'event', band_id: 'band-1', event_id: 'gig-1', participant_ids: ['line-1'] });
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });
});
