/**
 * Client quote link (migration 099): what the client's page and message get.
 * The snapshot is the only thing the page shows, so it must never carry
 * musician fees, payouts or internal notes.
 */
import { describe, it, expect, vi } from 'vitest';

const mockRpc = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args), from: vi.fn() },
}));

import { buildClientQuoteSnapshot, clientLinkMessage, clientQuoteItems, publishQuoteLink, quoteLinkUrl } from '../quoteLinks';
import { DEFAULT_SETS, DEFAULT_SET_MINUTES, DEFAULT_VAT_RATE } from '../quoteMath';
import type { Quote } from '@/app/data/quotes';

const quote: Partial<Quote> = {
  id: '22222222-2222-4222-8222-222222222222',
  quoteNumber: 'Q-2026-0013',
  clientName: 'Anna Conti',
  clientEmail: 'anna@example.com',
  eventName: 'Year-end gala',
  eventType: 'corporate',
  eventDate: '2027-01-04',
  eventTimeStart: '20:30',
  venueName: 'Palazzo Clerici',
  venueCity: 'Milano',
  guestCount: 300,
  currency: 'EUR',
  baseFee: 3800,
  subtotal: 3800,
  total: 3800,
  musicians: [
    { id: 'm1', name: 'Leo M.', instrument: 'Drums', fee: 412, isExternal: false, isAvailable: true },
    { id: 'm2', name: 'Sam R.', instrument: 'Bass', fee: 377, isExternal: true, isAvailable: true },
  ],
  internalNotes: 'Pay Sam in cash',
  clientNotes: 'Dress code black.',
  validUntil: '2026-12-31',
};

describe('client quote snapshot', () => {
  it('has no musician fees, names or internal notes', () => {
    const snap = buildClientQuoteSnapshot(quote, 'en');
    const text = JSON.stringify(snap);
    expect(text).not.toContain('412');
    expect(text).not.toContain('377');
    expect(text).not.toContain('Leo M.');
    expect(text).not.toContain('Sam R.');
    expect(text).not.toContain('Pay Sam');
    expect(snap.notes).toBe('Dress code black.');
    expect(snap.ref).toBe('Q-2026-0013');
    expect(snap.lineup).toBe('2 musicians');
  });

  it('is written in the client language', () => {
    const snap = buildClientQuoteSnapshot(quote, 'it');
    expect(snap.items[0].label).not.toBe('MAIN BAND');
    expect(snap.lineup).not.toBe('2 musicians');
  });
});

describe('how to pay the deposit (168)', () => {
  const bank = {
    bank_region: 'eu' as const,
    bank_account_holder: 'Velvet Static APS',
    bank_iban: 'IT60X0542811101000000123456',
    bank_bic_swift: 'BPMOIT22XXX',
    stripe_payment_link: 'https://buy.stripe.com/test_velvet',
  };

  it('carries the bank details, the band link and a reference in the client language', () => {
    const snap = buildClientQuoteSnapshot({ ...quote, depositRequired: true, depositPercentage: 30, depositDueDate: '2026-12-10' }, 'it', bank);
    expect(snap.deposit).toEqual({ percent: 30, amount: expect.any(Number), dueDate: '2026-12-10' });
    expect(snap.pay?.bank?.map((r) => r.value)).toContain('IT60X0542811101000000123456');
    expect(snap.pay?.stripeUrl).toBe('https://buy.stripe.com/test_velvet');
    expect(snap.pay?.reference).toBe('Q-2026-0013 · Acconto');
  });

  it('hides the bank details the quote hides on the PDF, and refuses a link that is not https', () => {
    const snap = buildClientQuoteSnapshot({ ...quote, showBankDetailsOnPdf: false }, 'en', { ...bank, stripe_payment_link: 'javascript:alert(1)' });
    expect(snap.pay).toBeUndefined();
    const onlyLink = buildClientQuoteSnapshot({ ...quote, showBankDetailsOnPdf: false }, 'en', bank);
    expect(onlyLink.pay).toEqual({ bank: null, stripeUrl: 'https://buy.stripe.com/test_velvet', reference: 'Q-2026-0013 · Deposit' });
  });

  it('nothing to pay without a deposit; a due date only when it is a date', () => {
    expect(buildClientQuoteSnapshot({ ...quote, depositRequired: false }, 'en', bank).pay).toBeUndefined();
    const snap = buildClientQuoteSnapshot({ ...quote, depositDueDate: 'on_acceptance' }, 'en', bank);
    expect(snap.deposit && 'dueDate' in snap.deposit).toBe(false);
  });
});

describe('client message', () => {
  it('carries the page link and the total', () => {
    const url = quoteLinkUrl('a'.repeat(64));
    const msg = clientLinkMessage(quote, { bandName: 'The Night Shift', url, lang: 'en', kind: 'sent', total: '€3,800.00' });
    expect(msg).toContain(url);
    expect(msg).toContain('€3,800.00');
    expect(msg).toContain('Hi Anna,');
    expect(url).toMatch(/\/quote\.html\?t=a{64}$/);
  });

  it('says reminder and update differently', () => {
    const url = quoteLinkUrl('b'.repeat(64));
    const reminder = clientLinkMessage(quote, { bandName: 'X', url, lang: 'en', kind: 'reminder', total: '1' });
    const updated = clientLinkMessage(quote, { bandName: 'X', url, lang: 'en', kind: 'updated', total: '1' });
    expect(reminder).toContain('Just a reminder');
    expect(updated).toContain('updated your quote');
  });
});

describe('publishing', () => {
  it('sends the snapshot through the admin RPC', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ token: 't', status: 'draft', version: 1, revoked: false }], error: null });
    const snap = buildClientQuoteSnapshot(quote, 'en');
    const res = await publishQuoteLink(String(quote.id), snap, 'en', null);
    expect(mockRpc).toHaveBeenCalledWith('bw_quote_link_publish', expect.objectContaining({ p_quote_id: quote.id, p_lang: 'en' }));
    expect(res.data?.version).toBe(1);
  });
});

describe('line items (quote detail, PDF and client page)', () => {
  const full: Partial<Quote> = {
    ...quote,
    baseFee: 3000,
    subtotal: 3790,
    soundIncluded: false,
    soundFee: 400,
    lightsFee: 100,
    travelIncluded: false,
    travelFee: 120,
    accommodationNeeded: true,
    accommodationFee: 170,
    customItems: [{ id: 'c1', description: 'DJ set', amount: 0, quantity: 1 }],
  };

  it('lists the band fee, production, travel and accommodation, not only the extras', () => {
    const items = clientQuoteItems(full, 'en');
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(['MAIN BAND', 'MUSICAL PRODUCTION', 'DJ SET', 'TRAVEL & LOGISTICS', 'ACCOMMODATION']);
    expect(items.map((i) => i.amount)).toEqual([3000, 500, null, 120, 170]);
    // The priced rows add up to the subtotal.
    expect(items.reduce((sum, i) => sum + (i.amount ?? 0), 0)).toBe(3790);
  });

  it('are the same rows the client page shows', () => {
    expect(buildClientQuoteSnapshot(full, 'en').items).toEqual(clientQuoteItems(full, 'en'));
  });
});

describe('defaults shared with the PDF', () => {
  it('a quote without a VAT rate uses the same rate as the PDF', () => {
    const snap = buildClientQuoteSnapshot({ ...quote, vatRate: undefined }, 'en');
    expect(snap.vatLabel).toBe(`VAT ${DEFAULT_VAT_RATE}%`);
    expect(snap.vat).toBe(Math.round(3800 * DEFAULT_VAT_RATE) / 100);
  });

  it('the band default VAT rate wins over the shared one', () => {
    expect(buildClientQuoteSnapshot({ ...quote, vatRate: undefined }, 'en', { default_vat_rate: 10 }).vatLabel).toBe('VAT 10%');
  });

  it('a quote without sets shows the sets the PDF shows', () => {
    const snap = buildClientQuoteSnapshot({ ...quote, numberOfSets: 0, setDuration: 0 }, 'en');
    expect(snap.sets).toContain(`${DEFAULT_SETS} sets of ${DEFAULT_SET_MINUTES} minutes`);
  });

  it('no deposit (or 0%) means no deposit line', () => {
    expect(buildClientQuoteSnapshot({ ...quote, depositRequired: false, depositPercentage: 30 }, 'en').deposit).toBeNull();
    expect(buildClientQuoteSnapshot({ ...quote, depositPercentage: 0 }, 'en').deposit).toBeNull();
    expect(buildClientQuoteSnapshot({ ...quote, vatRate: 0, depositPercentage: 30 }, 'en').deposit).toEqual({ percent: 30, amount: 1140 });
  });
});
