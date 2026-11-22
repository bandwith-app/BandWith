/**
 * Audit of 383f15b, money #6: reopening a balance dropped an earlier payment.
 * On a 1,000 quote with 200 under other payments, an 800 balance was sent;
 * a 300 deposit recorded later made the sheet rebuild "other" as
 * 1000 − 800 − 300 = −100, drop it and ask 700. The balance keeps the other
 * payments on their own, so the next request is 500.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn(), functions: { invoke: vi.fn() } } }));
// The sheet can open before the page's language has loaded: translate() then gives English.
vi.mock('@/lib/i18n', async (orig) => ({
  ...(await orig<typeof import('@/lib/i18n')>()),
  translate: (_lang: string, s: string, vars?: Record<string, unknown>) =>
    s.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m)),
}));

import { buildClientBalance, planBalance, previousOtherReceived, LEGACY_ALREADY_PAID, LEGACY_DEPOSIT_RECEIVED, type BalanceFacts } from '../quoteBalance';
import itDict from '@/lib/i18n/locales/it';
import esDict from '@/lib/i18n/locales/es';
import frDict from '@/lib/i18n/locales/fr';
import deDict from '@/lib/i18n/locales/de';
import ptDict from '@/lib/i18n/locales/pt';
import type { ClientBalance } from '@/quote/types';

const facts = (over: Partial<BalanceFacts> = {}): BalanceFacts => ({
  total: 1000,
  currency: 'USD',
  deposit: 300,
  depositReceived: false,
  otherReceived: 0,
  quoteAccepted: true,
  gig: { status: 'confirmed', currency: 'USD', fee: 1000, paymentStatus: 'pending', date: '2027-06-12' },
  setup: { bank: false, stripe: false },
  ways: ['cash'],
  clientEmail: 'jordan@brooklynevents.example',
  previous: null,
  paidAt: null,
  dueDate: '2027-06-12',
  today: '2027-05-01',
  ...over,
});

describe('reopening a balance keeps the other payments', () => {
  it('asks 500, not 700, once the deposit is recorded after the first request', () => {
    const first = facts({ otherReceived: 200 });
    const firstPlan = planBalance(first);
    expect(firstPlan.due).toBe(800);
    const sent = buildClientBalance(firstPlan, first, {}, 'en', { ref: 'Q-2027-0007' });

    // Later: the 300 deposit is recorded, the sheet opens again from what the client has.
    const other = previousOtherReceived(sent, 'en');
    expect(other).toBe(200);
    expect(planBalance(facts({ depositReceived: true, otherReceived: other })).due).toBe(500);
  });

  it('reads the other payments of a balance sent before they were kept apart', () => {
    const old = (received: ClientBalance['received']): ClientBalance =>
      ({ v: 1, currency: 'USD', total: 1000, received, amount: 0, amountLabel: '', dueDate: null, reference: '', bank: null, stripeUrl: null, cash: null, note: null });
    expect(previousOtherReceived(old([{ label: 'Already paid', amount: 200 }]), 'en')).toBe(200);
    expect(previousOtherReceived(old([{ label: 'Deposit received', amount: 300 }, { label: 'Already paid', amount: 150 }]), 'en')).toBe(150);
    expect(previousOtherReceived(old([{ label: 'Deposit received', amount: 300 }]), 'en')).toBe(0);
    expect(previousOtherReceived(null, 'en')).toBe(0);
  });

  // Review of #293: the sheet can open before the page's language is loaded.
  it('an Italian balance read before the Italian dictionary loads: the deposit is not another payment', () => {
    const old = (received: ClientBalance['received']): ClientBalance =>
      ({ v: 1, currency: 'EUR', total: 1000, received, amount: 0, amountLabel: '', dueDate: null, reference: '', bank: null, stripeUrl: null, cash: null, note: null });
    expect(previousOtherReceived(old([{ label: 'Acconto ricevuto', amount: 300 }]), 'it')).toBe(0);
    expect(previousOtherReceived(old([{ label: 'Già pagato', amount: 120 }]), 'it')).toBe(120);
    expect(previousOtherReceived(old([{ label: 'Anzahlung erhalten', amount: 300 }]), 'de')).toBe(0);
  });

  it('the frozen labels are the dictionaries\' words', () => {
    for (const d of [itDict, esDict, frDict, deDict, ptDict]) {
      expect(LEGACY_DEPOSIT_RECEIVED.has(d['Deposit received'])).toBe(true);
      expect(LEGACY_ALREADY_PAID.has(d['Already paid'])).toBe(true);
    }
  });
});
