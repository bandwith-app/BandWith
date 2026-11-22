/**
 * 183: the band changed the client of a sent quote. The server gave the
 * link a new token and put it back to draft (the new client has not been
 * sent it). Saving the quote then says so instead of "Quote updated" alone,
 * until the quote is sent to the new client.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let linkRow: Record<string, unknown> | null;
let activity: Record<string, unknown>[];
const mockRpc = vi.fn();

const chain = (result: () => { data: unknown; error: null }) => {
  const c: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'order', 'limit']) c[k] = () => c;
  c.maybeSingle = async () => result();
  c.then = (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok);
  return c;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => mockRpc(fn, args),
    from: (table: string) =>
      table === 'quote_links' ? chain(() => ({ data: linkRow, error: null })) : chain(() => ({ data: activity, error: null })),
  },
}));

import { awaitingNewRecipient, republishClientQuote } from '../quoteLinks';
import type { Quote } from '@/app/data/quotes';

const quote = { id: '22222222-2222-4222-8222-222222222222', quoteNumber: 'Q-2026-0042', clientName: 'Jordan Lee' } as Quote;
const row = (status: string) => ({ quote_id: quote.id, token: 'b'.repeat(64), lang: 'en', status, version: 2 });
const rotated = { id: 'a1', kind: 'link_rotated', body: 'recipient_changed', channel: null, version: 2, created_at: '2026-11-22T10:00:00Z' };

beforeEach(() => {
  mockRpc.mockReset();
  activity = [];
});

describe('a new client on a sent quote (183)', () => {
  it('saving says the new client needs the quote, and publishes nothing', async () => {
    linkRow = row('draft');
    activity = [{ id: 's1', kind: 'sent', body: null, channel: 'email', version: 1, created_at: '2026-11-20T10:00:00Z' }, rotated];
    const res = await republishClientQuote(quote, 'band-1', 'The Night Shift');
    expect(res).toEqual({ data: null, error: null, newRecipient: true });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('a draft link that was never sent: nothing to say', async () => {
    linkRow = row('draft');
    const res = await republishClientQuote(quote, 'band-1', 'The Night Shift');
    expect(res.newRecipient).toBeFalsy();
  });

  it('once sent to the new client, the notice stops', () => {
    expect(awaitingNewRecipient(row('draft') as never, [rotated] as never)).toBe(true);
    expect(awaitingNewRecipient(row('sent') as never, [rotated] as never)).toBe(false);
    expect(awaitingNewRecipient(row('draft') as never, [{ ...rotated, body: null }] as never)).toBe(false);
  });
});
