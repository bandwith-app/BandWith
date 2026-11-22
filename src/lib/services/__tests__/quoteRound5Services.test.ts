/**
 * 183 round 5, app side (Codex review of 8f5922d7): a field the wizard
 * clears (it sends undefined) goes out as null, the totals are never sent
 * with an edit (the server computes them), and the automatic republish after
 * an edit names the version it read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockRpc = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (t: string) => mockFrom(t),
    rpc: (fn: string, args: unknown) => mockRpc(fn, args),
    functions: { invoke: vi.fn() },
    storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ error: { message: 'offline' } }), getPublicUrl: vi.fn() }) },
  },
  getSafeUser: vi.fn(),
}));
vi.mock('@/lib/services/pricing', async (orig) => ({ ...(await orig<object>()), getBandPricing: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/services/quotePdf', () => ({
  generateQuotePdf: vi.fn().mockRejectedValue(new Error('no canvas')),
  uploadQuotePdfForSharing: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/usePlan', () => ({ fetchBandPlan: vi.fn().mockResolvedValue(null) }));

import { quoteUpdateRecord } from '../quotes';
import { republishClientQuote } from '../quoteLinks';
import type { Quote as AppQuote } from '@/app/data/quotes';

const BAND_ID = '11111111-1111-4111-8111-111111111111';
const QUOTE_ID = '22222222-2222-4222-8222-222222222222';
const READ_AT = '2026-11-20T15:04:05.123456+00:00';

const original = {
  id: QUOTE_ID,
  status: 'SENT',
  clientName: 'Jordan Lee',
  clientEmail: 'jordan@brooklynevents.example',
  clientPhone: '+1 917 555 0101',
  clientCompany: 'Brooklyn Events',
  vatNumber: 'US-12-3456789',
  clientNotes: 'Load-in from the side door',
  notes: 'Load-in from the side door',
  eventName: 'Lee wedding',
  eventDate: '2027-05-15',
  venueName: 'The Foundry',
  currency: 'USD',
  baseFee: 4200,
  travelFee: 0,
  subtotal: 4200,
  total: 4200,
  depositRequired: true,
  depositPercentage: 30,
  depositAmount: 1260,
  customItems: [],
  updatedAt: READ_AT,
} as unknown as Partial<AppQuote>;

beforeEach(() => { mockFrom.mockReset(); mockRpc.mockReset(); });

describe('quoteUpdateRecord: a cleared field (the wizard sends undefined) is cleared', () => {
  it('phone, company, VAT number and client notes cleared: each goes out as null', () => {
    // As QuoteCreationWizard builds it: `clientPhone.trim() || undefined`, ...
    const rec = quoteUpdateRecord(
      { ...original, clientPhone: undefined, clientCompany: undefined, vatNumber: undefined, clientNotes: undefined },
      BAND_ID,
      original,
    ) as Record<string, unknown>;
    expect(rec).toEqual({ client_phone: null, client_company: null, vat_number: null, client_notes: null, edit_base_at: READ_AT });
  });
  it('a reassign with the old phone cleared: the old phone never stays', () => {
    const rec = quoteUpdateRecord(
      { ...original, clientName: 'Taylor Brooks', clientEmail: 'taylor@example.com', clientPhone: undefined, clientNotes: undefined },
      BAND_ID,
      original,
    ) as Record<string, unknown>;
    expect(rec.client_phone).toBeNull();
    expect(rec.client_notes).toBeNull();
  });
  it('a key the edit does not have still keeps the quote value', () => {
    const rec = quoteUpdateRecord({ eventDate: '2027-05-22' }, BAND_ID, original) as Record<string, unknown>;
    expect(rec).toEqual({ event_date: '2027-05-22', edit_base_at: READ_AT });
  });
});

describe('quoteUpdateRecord: the totals are the server\'s', () => {
  it('a fee change sends the fee only, never subtotal, total or deposit amount', () => {
    const rec = quoteUpdateRecord({ ...original, travelFee: 300, subtotal: 4500, total: 4500, depositAmount: 1350 }, BAND_ID, original) as Record<string, unknown>;
    expect(rec).toEqual({ travel_fee: 300, edit_base_at: READ_AT });
  });
});

describe('republishClientQuote: the version it read', () => {
  it('publishes with the link token and version read, so a late PDF never overwrites newer terms', async () => {
    const link = { id: 'link-b', token: 'b'.repeat(64), status: 'sent', version: 3, lang: 'en', revoked_at: null };
    mockFrom.mockImplementation(() => {
      const chain: any = {
        select: () => chain, eq: () => chain, order: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve({ data: link, error: null }),
      };
      return chain;
    });
    mockRpc.mockResolvedValue({ data: [{ token: link.token, status: 'sent', version: 4, revoked: false }], error: null });
    const res = await republishClientQuote({ id: QUOTE_ID, quote_number: 'Q-2027-0042', client_name: 'Jordan Lee', currency: 'USD' } as any, BAND_ID, 'The Night Shift');
    expect(res.error).toBeNull();
    const call = mockRpc.mock.calls.find((c) => c[0] === 'bw_quote_link_publish');
    expect(call?.[1]).toMatchObject({ p_token: link.token, p_version: 3 });
  });
});
