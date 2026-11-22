/**
 * 183 round 3, app side: a send and a reply name the link (and version)
 * they were made on, an edit clears what the wizard has empty, and the share
 * sheet can tell a copy of the quote made for another client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args), from: vi.fn() },
}));

import { markQuoteLinkSent, replyToQuoteClient, sameQuoteContact, isVersionChangedError, isLinkChangedError } from '../quoteLinks';
import { quoteUpdateRecord } from '../quotes';

const QUOTE_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'b'.repeat(64);
const noParam = { code: 'PGRST202', message: 'Could not find the function with parameter p_token' };

beforeEach(() => mockRpc.mockReset());

describe('markQuoteLinkSent: records the link and version that went out', () => {
  it('sends the token and the version', async () => {
    mockRpc.mockResolvedValue({ data: 'sent', error: null });
    const r = await markQuoteLinkSent(QUOTE_ID, 'sent', 'copy', { token: TOKEN, version: 3 });
    expect(r.data).toBe('sent');
    expect(mockRpc).toHaveBeenCalledWith('bw_quote_link_mark_sent', {
      p_quote_id: QUOTE_ID, p_kind: 'sent', p_channel: 'copy', p_token: TOKEN, p_version: 3,
    });
  });

  it('a database before 183 (no such parameters): records as before', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: noParam }).mockResolvedValueOnce({ data: 'sent', error: null });
    const r = await markQuoteLinkSent(QUOTE_ID, 'sent', 'copy', { token: TOKEN, version: 3 });
    expect(r.data).toBe('sent');
    expect(mockRpc).toHaveBeenLastCalledWith('bw_quote_link_mark_sent', { p_quote_id: QUOTE_ID, p_kind: 'sent', p_channel: 'copy' });
  });

  it('another version published meanwhile: nothing recorded, the error says so', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'BW_VERSION_CHANGED: the quote was updated after this was sent' } });
    const r = await markQuoteLinkSent(QUOTE_ID, 'sent', 'copy', { token: TOKEN, version: 3 });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(isVersionChangedError(r.error)).toBe(true);
  });
});

describe('replyToQuoteClient: the reply stays on its client’s link', () => {
  it('sends the token of the conversation', async () => {
    mockRpc.mockResolvedValue({ data: 'a1', error: null });
    await replyToQuoteClient(QUOTE_ID, 'See you there', TOKEN);
    expect(mockRpc).toHaveBeenCalledWith('bw_quote_reply', { p_quote_id: QUOTE_ID, p_body: 'See you there', p_token: TOKEN });
  });

  it('the link was replaced (another client): not sent, the error says so', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'BW_LINK_CHANGED: this conversation is with a client the quote is no longer for' } });
    const r = await replyToQuoteClient(QUOTE_ID, 'See you there', TOKEN);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(isLinkChangedError(r.error)).toBe(true);
  });

  it('a database before 183: replies as before', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: noParam }).mockResolvedValueOnce({ data: 'a1', error: null });
    const r = await replyToQuoteClient(QUOTE_ID, 'See you there', TOKEN);
    expect(r.data).toBe('a1');
    expect(mockRpc).toHaveBeenLastCalledWith('bw_quote_reply', { p_quote_id: QUOTE_ID, p_body: 'See you there' });
  });
});

describe('sameQuoteContact', () => {
  const saved = { client_name: 'Jordan Lee', client_email: 'jordan@brooklynevents.example', client_phone: '+1 646 555 0199' };
  it('same client, other spacing and case', () => {
    expect(sameQuoteContact(saved, { clientName: ' jordan  lee', clientEmail: 'Jordan@BrooklynEvents.example', clientPhone: '+1 (646) 555-0199' })).toBe(true);
  });
  it('another client', () => {
    expect(sameQuoteContact(saved, { clientName: 'Emma Carter', clientEmail: 'emma.carter@example.com', clientPhone: '+1 917 555 0101' })).toBe(false);
    expect(sameQuoteContact(saved, { clientName: 'Jordan Lee', clientEmail: 'jordan@brooklynevents.example', clientPhone: '+1 917 555 0101' })).toBe(false);
  });
  it('the wizard saves an empty name as "Client"', () => {
    expect(sameQuoteContact({ client_name: 'Client', client_email: null, client_phone: null }, { clientName: '' })).toBe(true);
  });
});

describe('quoteUpdateRecord: an edit clears what the wizard has empty', () => {
  it('writes null (not undefined, which the update would leave out) for a cleared field', () => {
    const rec = quoteUpdateRecord({ clientName: 'Emma Carter', clientEmail: 'emma.carter@example.com' }, '11111111-1111-4111-8111-111111111111', {}) as Record<string, unknown>;
    for (const key of ['client_phone', 'client_company', 'client_notes', 'billing_address', 'vat_number']) {
      expect(rec).toHaveProperty(key);
      expect(rec[key]).toBeNull();
    }
  });
  it('keeps the yes/no flags the wizard did not touch (no null for them)', () => {
    const rec = quoteUpdateRecord({ clientName: 'Emma Carter' }, '11111111-1111-4111-8111-111111111111', {}) as Record<string, unknown>;
    for (const key of ['travel_included', 'deposit_required']) expect(rec[key]).not.toBeNull();
  });
});
