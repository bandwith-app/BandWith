/**
 * 183 round 4, app side: an edit of a quote writes only what changed (and
 * says when its screen read the quote), a cleared field goes out as null and
 * a field the edit does not carry stays as it is.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockInvoke = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (t: string) => mockFrom(t),
    rpc: (fn: string, args: unknown) => mockRpc(fn, args),
    functions: { invoke: (fn: string, args: unknown) => mockInvoke(fn, args) },
  },
  getSafeUser: vi.fn(),
}));

import { quoteUpdateRecord, updateQuote } from '../quotes';
import { buildClientQuoteSnapshot, publishQuoteLink, sendQuoteEmail, sendQuoteBalanceEmail } from '../quoteLinks';
import type { Quote as AppQuote } from '@/app/data/quotes';

const BAND_ID = '11111111-1111-4111-8111-111111111111';
const QUOTE_ID = '22222222-2222-4222-8222-222222222222';
const READ_AT = '2026-11-20T15:04:05.123456+00:00';

// The quote as the editing screen read it (Brooklyn wedding, NY numbers).
const original = {
  id: QUOTE_ID,
  status: 'SENT',
  clientName: 'Jordan Lee',
  clientEmail: 'jordan@brooklynevents.example',
  clientPhone: '+1 917 555 0101',
  clientCompany: 'Brooklyn Events',
  clientNotes: 'Load-in from the side door',
  eventName: 'Lee wedding',
  eventDate: '2027-05-15',
  eventTimeStart: '19:00',
  venueName: 'The Foundry',
  venueCity: 'Long Island City',
  currency: 'USD',
  baseFee: 4200,
  subtotal: 4800,
  travelIncluded: true,
  depositRequired: true,
  depositPercentage: 30,
  customItems: [{ id: 'c1', description: 'Ceremony set', price: 600, quantity: 1 }],
  sentAt: '2026-11-18T10:00:00Z',
  updatedAt: READ_AT,
} as unknown as Partial<AppQuote>;

beforeEach(() => { mockFrom.mockReset(); mockRpc.mockReset(); mockInvoke.mockReset(); });

describe('quoteUpdateRecord: only what changed', () => {
  it('edit only the date (the wizard sends the whole form): only the date goes out', () => {
    const rec = quoteUpdateRecord({ ...original, eventDate: '2027-05-22' }, BAND_ID, original) as Record<string, unknown>;
    expect(rec).toEqual({ event_date: '2027-05-22', edit_base_at: READ_AT });
  });
  it('a cleared field goes out as null, nothing else', () => {
    const rec = quoteUpdateRecord({ ...original, clientPhone: '', clientNotes: '' }, BAND_ID, original) as Record<string, unknown>;
    expect(rec).toEqual({ client_phone: null, client_notes: null, edit_base_at: READ_AT });
  });
  it('a field the edit does not carry stays omitted (not cleared)', () => {
    const rec = quoteUpdateRecord({ eventDate: '2027-05-22' }, BAND_ID, original) as Record<string, unknown>;
    expect(rec).toEqual({ event_date: '2027-05-22', edit_base_at: READ_AT });
    expect(rec).not.toHaveProperty('client_phone');
  });
  it('a price change sends the fee and the totals it moves, never the status or the send time', () => {
    const rec = quoteUpdateRecord({ ...original, status: 'VIEWED', baseFee: 4500, subtotal: 5100 }, BAND_ID, original) as Record<string, unknown>;
    expect(rec.base_fee).toBe(4500);
    expect(rec.subtotal).toBe(5100);
    expect(rec.total).toBe(5100);
    expect(rec).not.toHaveProperty('status');
    expect(rec).not.toHaveProperty('sent_at');
    expect(rec).not.toHaveProperty('band_id');
    expect(rec).not.toHaveProperty('client_name');
  });
  it('a save that changes nothing writes nothing but the read time', () => {
    expect(quoteUpdateRecord({ ...original }, BAND_ID, original)).toEqual({ edit_base_at: READ_AT });
  });
});

describe('updateQuote: a database before 183 has no edit_base_at', () => {
  const table = (results: unknown[]) => {
    const update = vi.fn();
    for (const r of results) update.mockReturnValueOnce({ eq: () => ({ select: () => ({ single: () => Promise.resolve(r) }) }) });
    return { update };
  };
  it('retries the same edit without it', async () => {
    const t = table([
      { data: null, error: { code: 'PGRST204', message: "Could not find the 'edit_base_at' column of 'quotes' in the schema cache" } },
      { data: { id: QUOTE_ID }, error: null },
    ]);
    mockFrom.mockReturnValue(t);
    const r = await updateQuote(QUOTE_ID, { event_date: '2027-05-22', edit_base_at: READ_AT });
    expect(r.error).toBeNull();
    expect(t.update).toHaveBeenLastCalledWith({ event_date: '2027-05-22' });
  });
  it('any other error: no retry', async () => {
    const t = table([{ data: null, error: { code: '40001', message: 'Another admin changed the client' } }]);
    mockFrom.mockReturnValue(t);
    const r = await updateQuote(QUOTE_ID, { client_email: 'emma@example.com', edit_base_at: READ_AT });
    expect(r.error).toBeTruthy();
    expect(t.update).toHaveBeenCalledTimes(1);
  });
});

describe('the client page: one version per content, on the version the admin sees', () => {
  const dbQuote = { quote_number: 'Q-2027-0042', event_name: 'Lee wedding', event_date: '2027-05-15', client_name: 'Jordan Lee', currency: 'USD', base_fee: 4200, subtotal: 4200, total: 4200 } as any;
  it('the same quote in another language has the same content key; another price does not', () => {
    const en = buildClientQuoteSnapshot(dbQuote, 'en');
    const it = buildClientQuoteSnapshot(dbQuote, 'it');
    expect(en.contentKey).toBeTruthy();
    expect(it.contentKey).toBe(en.contentKey);
    expect(buildClientQuoteSnapshot({ ...dbQuote, base_fee: 4500, subtotal: 4500, total: 4500 }, 'it').contentKey).not.toBe(en.contentKey);
  });
  it('publish names the link and the version shown', async () => {
    mockRpc.mockResolvedValue({ data: [{ token: 'b'.repeat(64), status: 'sent', version: 4, revoked: false }], error: null });
    await publishQuoteLink(QUOTE_ID, buildClientQuoteSnapshot(dbQuote, 'en'), 'en', null, 'b'.repeat(64), 3);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_token: 'b'.repeat(64), p_version: 3 });
  });
  it('a quote email names its link; a balance email the balance version shown', async () => {
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null });
    await sendQuoteEmail(QUOTE_ID, 'reply', 'link-b');
    expect(mockInvoke.mock.calls[0][1]).toEqual({ body: { type: 'quote_reply', data: { quoteId: QUOTE_ID, linkId: 'link-b' } } });
    await sendQuoteBalanceEmail(QUOTE_ID, 'sent', 2);
    expect(mockInvoke.mock.calls[1][1]).toEqual({ body: { type: 'quote_balance', data: { quoteId: QUOTE_ID, kind: 'sent', balanceVersion: 2 } } });
  });
});
