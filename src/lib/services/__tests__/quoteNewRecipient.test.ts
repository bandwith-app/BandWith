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

vi.mock('@/lib/services/quotePdf', () => ({
  generateQuotePdf: async () => {
    throw new Error('no PDF in tests');
  },
  uploadQuotePdfForSharing: async () => null,
}));
vi.mock('@/lib/usePlan', () => ({ fetchBandPlan: async () => null }));

import { awaitingNewRecipient, isLinkChangedError, publishQuoteLink, recipientChangedAt, republishClientQuote } from '../quoteLinks';
import shareModalSrc from '@/app/components/quotes/QuoteShareModal.tsx?raw';
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

  // Round 2 (#286): a publish that started for the old client must not land on the new client's link.
  it('a publish names the link it read; the server refusal is recognised', async () => {
    mockRpc.mockResolvedValue({ data: [{ token: 'b'.repeat(64), status: 'sent', version: 3, revoked: false }], error: null });
    await publishQuoteLink(quote.id, {} as never, 'en', null, 'a'.repeat(64));
    expect(mockRpc).toHaveBeenCalledWith('bw_quote_link_publish', expect.objectContaining({ p_token: 'a'.repeat(64) }));
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'BW_LINK_CHANGED: the quote link was replaced, open the quote again' } });
    const res = await publishQuoteLink(quote.id, {} as never, 'en', null, 'a'.repeat(64));
    expect(isLinkChangedError(res.error)).toBe(true);
  });

  it('a database before 183 (no p_token): publishes without it', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
      .mockResolvedValueOnce({ data: [{ token: 'b'.repeat(64), status: 'sent', version: 3, revoked: false }], error: null });
    const res = await publishQuoteLink(quote.id, {} as never, 'en', null, 'a'.repeat(64));
    expect(res.data?.version).toBe(3);
    expect(mockRpc.mock.calls[1][1]).not.toHaveProperty('p_token');
  });

  it('republishing after an edit names the link it read', async () => {
    linkRow = row('sent');
    mockRpc.mockResolvedValue({ data: [{ token: 'b'.repeat(64), status: 'sent', version: 3, revoked: false }], error: null });
    await republishClientQuote(quote, 'band-1', 'The Night Shift');
    const call = mockRpc.mock.calls.find((c) => c[0] === 'bw_quote_link_publish');
    expect(call?.[1]).toMatchObject({ p_token: 'b'.repeat(64) });
  });

  it('the share sheet publishes for the token it handed out', () => {
    // Round 3: once, for the link it shows, before any channel opens (QuoteShareModal.newRecipient.test.tsx).
    expect(shareModalSrc).toContain('buildClientQuoteSnapshot(quoteRef.current, docLang, settings), docLang, uploadedUrl, link.token)');
  });

  it('client messages before the latest change of client belong to the previous client', () => {
    const acts = [
      { id: 'm1', kind: 'client_message', body: 'Hi — Emma', channel: null, version: 1, created_at: '2026-11-20T10:00:00Z' },
      rotated,
      { id: 'm2', kind: 'client_message', body: 'Hi — Jordan', channel: null, version: 2, created_at: '2026-11-22T11:00:00Z' },
    ];
    expect(recipientChangedAt(acts as never)).toBe('2026-11-22T10:00:00Z');
    expect(recipientChangedAt([{ ...rotated, body: null }] as never)).toBeNull();
  });
});
