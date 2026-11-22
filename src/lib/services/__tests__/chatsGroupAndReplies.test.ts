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

import { createChat, getMessages, sendMessage, subscribeToChat, ChatRuleError } from '../chats';
import type { Message } from '../chats';

const called = (table: string, method: string) =>
  h.chains.some((c) => c.table === table && c.calls.some(([m]) => m === method));

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

// Codex review #291 r3 (193:52): sending to a gig chat re-added the whole
// lineup, an ex-member still on it too.
describe('sending to a gig chat restores the lineup', () => {
  it('a lineup member who left the band is not brought back', async () => {
    h.resolve = (table, calls) => {
      const has = (m: string) => calls.some(([c]) => c === m);
      if (table === 'chats' && has('single')) {
        return { data: { band_id: 'band-1', type: 'event', event_id: 'gig-1', name: 'Rooftop Session', created_by: 'me' }, error: null };
      }
      if (table === 'event_members' && !has('maybeSingle')) return { data: [{ user_id: 'line-1' }, { user_id: 'ex-1' }], error: null };
      if (table === 'band_members') {
        return has('in') ? { data: [{ user_id: 'line-1' }], error: null } : { data: { role: 'admin' }, error: null };
      }
      if (table === 'messages' && has('single')) return { data: { id: 'm9', chat_id: 'ev-chat', sender_id: 'me', content: 'hi' }, error: null };
      return { data: null, error: null };
    };
    const { error } = await sendMessage('ev-chat', 'hi');
    expect(error).toBeNull();
    const restored = h.chains
      .filter((c) => c.table === 'chat_participants')
      .flatMap((c) => c.calls.filter(([m]) => m === 'upsert').map(([, rows]) => rows))
      .flatMap((rows) => (Array.isArray(rows) ? rows : [rows])) as { user_id: string }[];
    expect(restored.map((r) => r.user_id)).toContain('line-1');
    expect(restored.map((r) => r.user_id)).not.toContain('ex-1');
  });
});

// Claude review #291 r4: a send that timed out after the insert landed,
// then Try again, saved the message twice.
describe('sending with a client id', () => {
  const chatRow = { band_id: null, type: 'direct', event_id: null, name: null, created_by: 'me' };
  const base = (over: (table: string, calls: Call[]) => { data: unknown; error: unknown } | undefined): Resolver => (table, calls) => {
    const o = over(table, calls);
    if (o) return o;
    const has = (m: string) => calls.some(([c]) => c === m);
    if (table === 'chats' && has('single')) return { data: chatRow, error: null };
    if (table === 'chat_participants' && !has('upsert')) return { data: [{ user_id: 'me' }, { user_id: 'u2' }], error: null };
    if (table === 'band_members') return { data: [{ band_id: 'b1', role: 'admin', user_id: 'me' }, { band_id: 'b1', role: 'member', user_id: 'u2' }], error: null };
    return { data: null, error: null };
  };
  const messageChains = () => h.chains.filter((c) => c.table === 'messages');

  it('the insert names the client id and skips a copy already saved', async () => {
    const existing = { id: 'm-saved', chat_id: 'dm', sender_id: 'me', content: 'see you at 8', client_id: 'cid-1' };
    h.resolve = base((table, calls) => {
      if (table !== 'messages') return undefined;
      if (calls.some(([m]) => m === 'upsert')) return { data: [], error: null };
      if (calls.some(([m, col]) => m === 'eq' && col === 'client_id')) return { data: existing, error: null };
      return undefined;
    });
    const { data, error } = await sendMessage('dm', 'see you at 8', 'text', undefined, 'cid-1');
    expect(error).toBeNull();
    expect(data?.id).toBe('m-saved');
    const up = messageChains().flatMap((c) => c.calls).find(([m]) => m === 'upsert');
    expect(up?.[1]).toMatchObject({ client_id: 'cid-1', content: 'see you at 8' });
    expect(up?.[2]).toEqual({ onConflict: 'sender_id,client_id', ignoreDuplicates: true });
    expect(messageChains().some((c) => c.calls.some(([m]) => m === 'insert'))).toBe(false);
    // Claude r5: the copy read back is this chat's.
    const back = messageChains().find((c) => c.calls.some(([m, col]) => m === 'eq' && col === 'client_id'));
    expect(back?.calls).toContainEqual(['eq', 'chat_id', 'dm']);
  });

  it('a database without the column: a plain insert, as before', async () => {
    h.resolve = base((table, calls) => {
      if (table !== 'messages') return undefined;
      if (calls.some(([m]) => m === 'upsert')) return { data: null, error: { code: 'PGRST204', message: "Could not find the 'client_id' column of 'messages'" } };
      if (calls.some(([m]) => m === 'insert')) return { data: { id: 'm-new', chat_id: 'dm', sender_id: 'me', content: 'hi' }, error: null };
      return undefined;
    });
    const { data, error } = await sendMessage('dm', 'hi', 'text', undefined, 'cid-2');
    expect(error).toBeNull();
    expect(data?.id).toBe('m-new');
    const ins = messageChains().flatMap((c) => c.calls).find(([m]) => m === 'insert');
    expect(ins?.[1]).not.toHaveProperty('client_id');
  });
});

describe('reply quotes (07 #11)', () => {
  const at = (min: number) => new Date(Date.UTC(2026, 10, 20, 18, min)).toISOString();
  const original = { id: 'm1', chat_id: 'c1', sender_id: 'u1', content: 'Can you bring the long XLR?', created_at: at(0) };
  const reply = { id: 'm2', chat_id: 'c1', sender_id: 'me', content: 'Yes, two of them', created_at: at(5), reply_to_id: 'm1' };

  let quotedRow: Record<string, unknown> | null = null;
  beforeEach(() => { quotedRow = null; });
  const db = (clearedAt: string | null): Resolver => (table, calls) => {
    if (table === 'chat_participants') return { data: { cleared_at: clearedAt }, error: null };
    if (table === 'profiles') return { data: [{ id: 'u1', full_name: 'Leo Line' }, { id: 'me', full_name: 'Me' }], error: null };
    if (table === 'messages') {
      if (calls.some(([m]) => m === 'in')) return { data: [quotedRow ?? original], error: null };
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

  // Codex review #291 r3: the reader's cut-off could not be read, and the
  // quote from before they deleted the chat was shown anyway.
  const noCutoff = (): Resolver => {
    const base = db(at(2));
    return (table, calls) => (table === 'chat_participants' ? { data: null, error: { code: '57014', message: 'timeout' } } : base(table, calls));
  };

  it('cut-off unknown: a Realtime reply comes without its quote', async () => {
    h.resolve = noCutoff();
    const got: Message[] = [];
    subscribeToChat('c1', (m) => got.push(m));
    await h.onInsert?.({ new: { id: 'm2' } });
    expect(got[0]?.id).toBe('m2');
    expect(got[0]?.reply_to).toBeUndefined();
  });

  it('cut-off unknown: the messages are not shown (could be from before the delete)', async () => {
    h.resolve = noCutoff();
    const { data, error } = await getMessages('c1', { limit: 50 });
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });

  // Codex review #291 r3: the quoted message was deleted, its text still showed.
  it('a quote of a deleted message says so, not what it said', async () => {
    h.resolve = db(null);
    quotedRow = { ...original, deleted: true };
    const { data } = await getMessages('c1', { limit: 50 });
    const m = (data || []).find((x) => x.id === 'm2') as Message;
    expect(m.reply_to?.content).toBe('Message deleted');
    expect(m.reply_to?.deleted).toBe(true);
    expect(JSON.stringify(m)).not.toContain('long XLR');
  });

  it('a reply from Realtime carries the quote for the recipient', async () => {
    h.resolve = db(null);
    const got: Message[] = [];
    subscribeToChat('c1', (m) => got.push(m));
    await h.onInsert?.({ new: { id: 'm2' } });
    expect(got[0]?.reply_to?.content).toBe('Can you bring the long XLR?');
  });
});

// Main (#291 r4, offline fails open): a membership lookup that failed is no
// answer, never a no. The send fails as a network error (the bubble waits),
// not as "You can only message in bands…".
describe('a membership check that could not run is not a refusal', () => {
  it('band chat, lookup fails offline: a network error, no rule message', async () => {
    h.resolve = (table, calls) => {
      const has = (m: string) => calls.some(([c]) => c === m);
      if (table === 'chats' && has('single')) {
        return { data: { band_id: 'band-1', type: 'band', event_id: null, name: 'Velvet Static', created_by: 'me' }, error: null };
      }
      if (table === 'band_members' && has('maybeSingle')) return { data: null, error: new Error('Failed to fetch') };
      return { data: null, error: null };
    };
    const { data, error } = await sendMessage('band-chat', 'hi');
    expect(data).toBeNull();
    expect(error).not.toBeInstanceOf(ChatRuleError);
    expect(String(error?.message)).toMatch(/Failed to fetch/);
  });

  it('gig chat, lineup lookup fails: a network error, no rule message', async () => {
    h.resolve = (table, calls) => {
      const has = (m: string) => calls.some(([c]) => c === m);
      if (table === 'chats' && has('single')) {
        return { data: { band_id: 'band-1', type: 'event', event_id: 'gig-1', name: 'Rooftop Session', created_by: 'me' }, error: null };
      }
      if (table === 'band_members' && has('maybeSingle')) return { data: { role: 'member' }, error: null };
      if (table === 'event_members' && has('maybeSingle')) return { data: null, error: new Error('Failed to fetch') };
      return { data: null, error: null };
    };
    const { error } = await sendMessage('ev-chat', 'hi');
    expect(error).not.toBeInstanceOf(ChatRuleError);
  });
});
