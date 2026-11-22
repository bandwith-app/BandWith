/**
 * Chat service, audit 07 of release 383f15b:
 *  #6  opening a gig (or band) chat goes through the server's get-or-join
 *      (bw_open_group_chat, migration 193), so a band admin outside the
 *      lineup joins the gig's chat instead of starting a second one;
 *  #11 replies carry the quoted message (text and author) when loaded,
 *      from Realtime and in older pages, within the reader's history.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = [string, ...unknown[]];
type Resolver = (table: string, calls: Call[]) => { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  resolve: (() => ({ data: null, error: null })) as Resolver,
  chains: [] as { table: string; calls: Call[] }[],
  rpc: vi.fn(),
  onInsert: null as null | ((payload: { new: { id: string } }) => Promise<void>),
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
  const channel: any = {
    on: (_e: string, _f: unknown, cb: (p: { new: { id: string } }) => Promise<void>) => {
      h.onInsert = cb;
      return channel;
    },
    subscribe: () => channel,
  };
  const supabase = {
    from: (table: string) => chain(table),
    rpc: (...a: unknown[]) => h.rpc(...a),
    channel: () => channel,
    removeChannel: () => {},
  };
  return { supabase, getSafeUser: async () => ({ data: { user: { id: 'me', email: 'me@example.invalid' } } }) };
});
vi.mock('../notifications', () => ({ sendPushToUsers: vi.fn() }));

import { createChat, getMessages, subscribeToChat, ChatRuleError } from '../chats';
import type { Message } from '../chats';

const called = (table: string, method: string) =>
  h.chains.some((c) => c.table === table && c.calls.some(([m]) => m === method));
const selected = (calls: Call[]) => calls.find(([m]) => m === 'select')?.[1];

beforeEach(() => {
  h.chains.length = 0;
  h.rpc.mockReset();
  h.onInsert = null;
  h.resolve = (table) =>
    table === 'band_members' ? { data: { role: 'admin' }, error: null } : { data: null, error: null };
});

describe('opening a gig or band chat (07 #6)', () => {
  const openGig = () =>
    createChat({ type: 'event', name: 'Rooftop Session', band_id: 'band-1', event_id: 'gig-1', participant_ids: ['line-1'] });

  it('an admin outside the lineup gets the chat the lineup already uses', async () => {
    h.rpc.mockResolvedValue({ data: { id: 'ev-chat', type: 'event', event_id: 'gig-1', created: false }, error: null });
    const { data, error } = await openGig();
    expect(error).toBeNull();
    expect(data?.id).toBe('ev-chat');
    expect(h.rpc).toHaveBeenCalledWith('bw_open_group_chat', {
      p_type: 'event',
      p_band_id: 'band-1',
      p_event_id: 'gig-1',
      p_name: 'Rooftop Session',
    });
    expect(called('chats', 'insert')).toBe(false);
    expect(data).not.toHaveProperty('created');
  });

  it('a chat it just created gets the lineup added', async () => {
    h.rpc.mockResolvedValue({ data: { id: 'ev-new', type: 'event', created: true }, error: null });
    await openGig();
    const add = h.chains.find((c) => c.table === 'chat_participants' && c.calls.some(([m]) => m === 'upsert'));
    expect(add?.calls.find(([m]) => m === 'upsert')?.[1]).toEqual([{ chat_id: 'ev-new', user_id: 'line-1' }]);
  });

  it('a band chat goes the same way', async () => {
    h.rpc.mockResolvedValue({ data: { id: 'band-chat', type: 'band', created: false }, error: null });
    const { data } = await createChat({ type: 'band', name: 'Hudson Horns', band_id: 'band-1', participant_ids: [] });
    expect(data?.id).toBe('band-chat');
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_type: 'band', p_band_id: 'band-1' });
  });

  it('refused by the server: the rule is shown', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Not allowed to open this chat' } });
    const { data, error } = await openGig();
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(ChatRuleError);
  });

  it('a database without 193 keeps the older lookup', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    h.resolve = (table, calls) =>
      table === 'band_members'
        ? { data: { role: 'admin' }, error: null }
        : table === 'chats' && calls.some(([m]) => m === 'maybeSingle')
          ? { data: { id: 'found', type: 'event' }, error: null }
          : { data: null, error: null };
    const { data } = await openGig();
    expect(data?.id).toBe('found');
    expect(called('chats', 'insert')).toBe(false);
  });
});

describe('reply quotes (07 #11)', () => {
  const at = (min: number) => new Date(Date.UTC(2026, 10, 20, 18, min)).toISOString();
  const original = { id: 'm1', chat_id: 'c1', sender_id: 'u1', content: 'Can you bring the long XLR?', created_at: at(0) };
  const reply = { id: 'm2', chat_id: 'c1', sender_id: 'me', content: 'Yes, two of them', created_at: at(5), reply_to_id: 'm1' };

  const db = (clearedAt: string | null): Resolver => (table, calls) => {
    if (table === 'chat_participants') return { data: { cleared_at: clearedAt }, error: null };
    if (table === 'profiles') return { data: [{ id: 'u1', full_name: 'Leo Line' }, { id: 'me', full_name: 'Me' }], error: null };
    if (table === 'messages') {
      const sel = selected(calls);
      if (sel === 'id, content, sender_id, created_at') return { data: [original], error: null };
      if (calls.some(([m]) => m === 'single')) return { data: reply, error: null };
      return { data: [reply], error: null };
    }
    return { data: null, error: null };
  };

  it('a loaded reply shows what it answers, and who wrote it', async () => {
    h.resolve = db(null);
    const { data } = await getMessages('c1', { limit: 50 });
    const m = (data || []).find((x) => x.id === 'm2') as Message;
    expect(m.reply_to?.content).toBe('Can you bring the long XLR?');
    expect(m.reply_to?.sender?.full_name).toBe('Leo Line');
  });

  it('a quote from before the reader deleted the chat stays hidden', async () => {
    h.resolve = db(at(2));
    const { data } = await getMessages('c1', { limit: 50, before: at(10) });
    expect((data || []).find((x) => x.id === 'm2')?.reply_to).toBeUndefined();
  });

  it('a reply from Realtime carries the quote for the recipient', async () => {
    h.resolve = db(null);
    const got: Message[] = [];
    subscribeToChat('c1', (m) => got.push(m));
    await h.onInsert?.({ new: { id: 'm2' } });
    expect(got[0]?.reply_to?.content).toBe('Can you bring the long XLR?');
  });
});
