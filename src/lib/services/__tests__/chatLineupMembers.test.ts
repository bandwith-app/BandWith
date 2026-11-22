/**
 * Gig chats and the lineup (review round 2 of #281):
 *  - sendMessage re-adds the gig's lineup to its chat on every send; only
 *    musicians who are still in the band, and still on the gig (not
 *    declined, dropped out or removed). A failed insert is reported.
 *  - createChat (no 193 yet) adds the creator on their own first, then the
 *    others still in the band: one former member on the lineup used to make
 *    the whole insert fail and leave a chat nobody was in.
 *  - round 3: with 193, createChat opens band and gig chats through
 *    bw_open_group_chat (one chat per band / gig, also for someone whose
 *    participant row was removed); without it, the older path above.
 *  - round 4: that older path never creates a second band / gig chat (it
 *    asks bw_group_chat_exists, 175, and stops with a translated "try
 *    again"); only a missing bw_open_group_chat counts as "no 193" (a
 *    42P01 inside it is an error); band members with is_active NULL are
 *    active, as in the database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Call = [string, ...unknown[]];
type Resolver = (table: string, calls: Call[]) => { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  resolve: (() => ({ data: null, error: null })) as Resolver,
  chains: [] as { table: string; calls: Call[] }[],
  rpc: (async (fn: string) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } })) as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>,
  rpcCalls: [] as [string, Record<string, unknown>][],
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
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpcCalls.push([fn, args]);
      return h.rpc(fn, args);
    },
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
// is_active NULL (older rows): active for the database (coalesce(is_active, true)).
const NULL_ACTIVE = ['null-1'];

let warn: { mock: { calls: unknown[][] } };
beforeEach(() => {
  h.chains.length = 0;
  h.rpcCalls.length = 0;
  h.rpc = async (fn) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } });
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
    // .eq('is_active', true) leaves out NULL rows, as PostgREST would.
    const nullOk = calls.some(([m, f]) => m === 'or' && /is_active\.is\.null/.test(String(f)));
    return { data: ids.filter((u) => ACTIVE.includes(u) || (nullOk && NULL_ACTIVE.includes(u))).map((user_id) => ({ user_id })), error: null };
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

describe('createChat with 193 (bw_open_group_chat)', () => {
  it('finds or creates the gig chat on the server: no second chat, no client-side lookup', async () => {
    h.resolve = resolver();
    h.rpc = async () => ({ data: { id: 'ev-chat', type: 'event', event_id: 'gig-1', band_id: 'band-1', created: false }, error: null });
    const { data, error } = await createChat({ type: 'event', name: 'Rooftop', band_id: 'band-1', event_id: 'gig-1', participant_ids: ['line-1'] });
    expect(error).toBeNull();
    expect(data?.id).toBe('ev-chat');
    expect(h.rpcCalls.some(([fn, a]) => fn === 'bw_open_group_chat' && a.p_type === 'event' && a.p_event_id === 'gig-1')).toBe(true);
    expect(h.chains.some((c) => c.table === 'chats' && has(c.calls, 'insert'))).toBe(false);
  });

  it('a band chat too, and a refusal is a translated chat rule, not a new chat', async () => {
    h.resolve = resolver();
    h.rpc = async () => ({ data: null, error: { code: '42501', message: 'Not allowed to open this chat' } });
    const { data, error } = await createChat({ type: 'band', name: 'Hudson Horns', band_id: 'band-1', participant_ids: [] });
    expect(data).toBeNull();
    expect(error?.constructor.name).toBe('ChatRuleError');
    expect(h.chains.some((c) => c.table === 'chats' && has(c.calls, 'insert'))).toBe(false);
  });
});

describe('createChat, round 4', () => {
  const newChat: Resolver = (table, calls) => {
    if (table === 'chats' && has(calls, 'maybeSingle')) return { data: null, error: null };
    if (table === 'chats' && has(calls, 'single')) return { data: { id: 'new-chat', type: 'band' }, error: null };
    return resolver()(table, calls);
  };

  it('without 193: a band chat the lookup cannot see is never created twice ("try again" instead)', async () => {
    h.resolve = newChat;
    h.rpc = async (fn) =>
      fn === 'bw_group_chat_exists'
        ? { data: true, error: null }
        : { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } };
    const { data, error } = await createChat({ type: 'band', name: 'Hudson Horns', band_id: 'band-1', participant_ids: [] });
    expect(data).toBeNull();
    expect(error?.constructor.name).toBe('ChatRuleError');
    expect(error?.message).toBe("Couldn't open the chat right now. Please try again in a moment.");
    expect(h.chains.some((c) => c.table === 'chats' && has(c.calls, 'insert'))).toBe(false);
  });

  it('and when it cannot ask (an error other than a missing function), it stops too', async () => {
    h.resolve = newChat;
    h.rpc = async (fn) =>
      fn === 'bw_group_chat_exists'
        ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
        : { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } };
    const { data, error } = await createChat({ type: 'event', band_id: 'band-1', event_id: 'gig-1', participant_ids: [] });
    expect(data).toBeNull();
    expect(error?.constructor.name).toBe('ChatRuleError');
    expect(h.chains.some((c) => c.table === 'chats' && has(c.calls, 'insert'))).toBe(false);
  });

  it('no chat yet: it is created, after asking', async () => {
    h.resolve = newChat;
    h.rpc = async (fn) =>
      fn === 'bw_group_chat_exists'
        ? { data: false, error: null }
        : { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } };
    const { data, error } = await createChat({ type: 'band', name: 'Hudson Horns', band_id: 'band-1', participant_ids: [] });
    expect(error).toBeNull();
    expect(data?.id).toBe('new-chat');
    expect(h.rpcCalls.some(([fn, a]) => fn === 'bw_group_chat_exists' && a.p_type === 'band' && a.p_band_id === 'band-1')).toBe(true);
  });

  it('a 42P01 / 42883 inside bw_open_group_chat is an error, not "no 193"', async () => {
    h.resolve = newChat;
    for (const err of [
      { code: '42P01', message: 'relation "public.event_date_holds" does not exist' },
      { code: '42883', message: 'function public.bw_event_quote_hidden(uuid, uuid) does not exist' },
    ]) {
      h.chains.length = 0;
      h.rpc = async (fn) => (fn === 'bw_open_group_chat' ? { data: null, error: err } : { data: false, error: null });
      const { data, error } = await createChat({ type: 'band', name: 'Hudson Horns', band_id: 'band-1', participant_ids: [] });
      expect(data).toBeNull();
      expect(error).toBeTruthy();
      expect(h.chains.some((c) => c.table === 'chats' && has(c.calls, 'insert'))).toBe(false);
    }
  });

  it('a band member with is_active NULL is added like any active member', async () => {
    h.resolve = (table, calls) => {
      if (table === 'chats' && has(calls, 'maybeSingle')) return { data: null, error: null };
      if (table === 'chats' && has(calls, 'single')) return { data: { id: 'new-chat', type: 'event' }, error: null };
      return resolver()(table, calls);
    };
    const { error } = await createChat({ type: 'event', band_id: 'band-1', event_id: 'gig-1', participant_ids: ['line-1', 'null-1', 'ex-1'] });
    expect(error).toBeNull();
    const others = writes('chat_participants', 'insert').slice(1).flat().map((r) => r.user_id);
    expect(others.sort()).toEqual(['line-1', 'null-1']);
  });
});

