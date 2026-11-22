/**
 * Audit of release 383f15b, money & documents and i18n: the pure rules
 * behind the fixes (each fails on 383f15b).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown } }));
vi.mock('@/lib/supabase', () => {
  const chain: any = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => void) => res(db.result) : chain),
    apply: () => chain,
  });
  return { supabase: { from: () => chain, rpc: vi.fn(), functions: { invoke: vi.fn() } }, getSafeUser: vi.fn() };
});

import { loadLocale } from '@/lib/i18n';
import { saveBandPricing, DEFAULT_BAND_PRICING } from '@/lib/services/pricing';
import { quoteCurrencyFor } from '@/app/components/quotes/QuoteCreationWizard';
import { inviteFeeCurrency } from '@/lib/inviteFee';
import { isOwedPayout, payoutsDue } from '@/lib/payoutsDue';
import { contentInLanguage, standardTerms, buildContractPdfBytes } from '@/lib/services/contracts';
import { parseFeeInput } from '@/lib/bandMembership';
import { parsePrice } from '@/lib/services/inventory';

const BAND = '00000000-0000-0000-0000-000000000001';

describe('08 #4: Pricing says Saved only when the database took it', () => {
  beforeEach(() => localStorage.clear());
  it('fails when the update errors, and keeps no cached copy', async () => {
    db.result = { data: null, error: { message: 'Failed to fetch' } };
    await expect(saveBandPricing({ ...DEFAULT_BAND_PRICING, band_id: BAND, bank_iban: 'US00 1234' } as any)).rejects.toThrow();
    expect(localStorage.getItem(`bandwith_pricing_settings_${BAND}`)).toBeNull();
  });
  it('fails when no row was changed (not allowed)', async () => {
    db.result = { data: [], error: null };
    await expect(saveBandPricing({ ...DEFAULT_BAND_PRICING, band_id: BAND } as any)).rejects.toThrow();
  });
  it('saves when the row comes back', async () => {
    db.result = { data: [{ id: BAND }], error: null };
    await expect(saveBandPricing({ ...DEFAULT_BAND_PRICING, band_id: BAND } as any)).resolves.toBeTruthy();
    expect(localStorage.getItem(`bandwith_pricing_settings_${BAND}`)).not.toBeNull();
  });
});

describe('08 #9: an edited quote keeps its currency', () => {
  it('uses the quote’s own currency, the band’s only for a new quote', () => {
    expect(quoteCurrencyFor({ id: 'q-1', currency: 'USD' } as any, 'EUR')).toBe('USD');
    expect(quoteCurrencyFor({ quoteNumber: 'Q-2027-0001', currency: 'usd' } as any, 'EUR')).toBe('USD');
    expect(quoteCurrencyFor(undefined, 'EUR')).toBe('EUR');
    expect(quoteCurrencyFor({ eventDate: '2027-06-12' } as any, 'GBP')).toBe('GBP');
    expect(quoteCurrencyFor({ id: 'q-1' } as any, 'EUR')).toBe('EUR');
  });
});

describe('10 #9: an invite’s fee is in its own band’s currency', () => {
  const bands = [{ id: 'band-eur', pricing_currency: 'EUR' }, { id: 'band-usd', pricing_currency: 'USD' }];
  it('takes the issuing band’s currency, not the band selected', () => {
    expect(inviteFeeCurrency({ member_fee: 500 }, 'band-usd', bands, 'EUR')).toBe('USD');
    expect(inviteFeeCurrency({ member_fee: 500, currency: 'GBP' }, 'band-usd', bands, 'EUR')).toBe('GBP');
    expect(inviteFeeCurrency({ member_fee: 500 }, 'band-unknown', bands, 'EUR')).toBe('EUR');
  });
});

describe('05 #9 / 08 #11: who "Mark all as paid" pays is who is listed as owed', () => {
  it('confirmed, a fee above 0, not paid yet', () => {
    expect(isOwedPayout({ status: 'confirmed', fee: 400, paidAt: null })).toBe(true);
    expect(isOwedPayout({ status: 'pending', fee: 350, paidAt: null })).toBe(false);
    expect(isOwedPayout({ status: 'confirmed', fee: 0, paidAt: null })).toBe(false);
    expect(isOwedPayout({ status: 'confirmed', fee: 400, paidAt: '2027-06-13T10:00:00Z' })).toBe(false);
  });
  it('is the rule of the Home / Analytics list', () => {
    const now = new Date('2027-06-20T12:00:00');
    const due = payoutsDue({
      gigs: [{ id: 'g', band_id: 'b', title: 'Rooftop wedding', event_type: 'wedding', status: 'confirmed', event_date: '2027-06-12', start_time: '19:00', end_time: '23:00' }],
      money: [
        { event_id: 'g', user_id: 'maya', fee: 400, paid_at: null },
        { event_id: 'g', user_id: 'sam', fee: 350, paid_at: null },
      ],
      members: [{ event_id: 'g', user_id: 'maya', status: 'confirmed' }, { event_id: 'g', user_id: 'sam', status: 'pending' }],
      isAdmin: true,
      viewerId: 'admin',
      now,
    } as any);
    expect(due[0].payouts.map((p) => p.userId)).toEqual(['maya']);
  });
});

describe('08 #12: standard contract terms in the client’s language', () => {
  beforeAll(async () => {
    await loadLocale('it');
  });
  it('writes the unedited standard terms in the document language', () => {
    const en = standardTerms('contract', 'en');
    const it = standardTerms('contract', 'it');
    expect(it).not.toBe(en);
    expect(contentInLanguage(en, 'contract', 'it')).toBe(it);
    expect(contentInLanguage(it, 'contract', 'en')).toBe(en);
  });
  it('keeps text the band edited as typed', () => {
    const edited = `${standardTerms('contract', 'en')}\n\nParking at 120 Bedford Ave, Brooklyn.`;
    expect(contentInLanguage(edited, 'contract', 'it')).toBe(edited.trim());
  });
  it('the Italian PDF prints the Italian clauses', () => {
    const bytes = buildContractPdfBytes(
      { id: 'c-1', band_id: BAND, type: 'contract', title: 'Rooftop wedding', status: 'draft', content: standardTerms('contract', 'en') } as any,
      { lang: 'it', bandName: 'The Night Shift' },
    );
    const text = new TextDecoder('latin1').decode(bytes);
    // The first standard clause, as the PDF writes it (WinAnsi, wrapped).
    const firstWords = standardTerms('contract', 'it').split(/\s+/).slice(0, 2).join(' ');
    expect(text).toContain(firstWords);
    expect(text).not.toContain('Performance: the band');
  });
});

describe('10 #2/#3: typed amounts elsewhere use the same parser', () => {
  it('fees and prices read 1.250,50 in German as 1250.5', async () => {
    const { setLocalePref } = await import('@/lib/i18n');
    await setLocalePref('de');
    try {
      expect(parseFeeInput('1.250,50')).toEqual({ value: 1250.5, invalid: false });
      expect(parsePrice('1.250').value).toBe(1250);
      expect(parseFeeInput('1,2,5').invalid).toBe(true);
    } finally {
      await setLocalePref('en');
    }
  });
});
