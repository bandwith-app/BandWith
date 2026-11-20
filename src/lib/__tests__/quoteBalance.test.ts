/**
 * The final balance (saldo) of an accepted quote: what is still due, by when,
 * and the warnings the admin sees before it goes to the client.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn(), functions: { invoke: vi.fn() } } }));

import {
  balanceDueDate,
  balanceMessage,
  buildClientBalance,
  planBalance,
  safePaymentUrl,
  type BalanceFacts,
} from '../quoteBalance';

const facts = (over: Partial<BalanceFacts> = {}): BalanceFacts => ({
  total: 3904,
  currency: 'EUR',
  deposit: 1171.2,
  depositReceived: true,
  otherReceived: 0,
  quoteAccepted: true,
  gig: { status: 'confirmed', currency: 'EUR', fee: 3904, paymentStatus: 'partial', date: '2027-06-12' },
  setup: { bank: true, stripe: true },
  ways: ['bank', 'stripe'],
  clientEmail: 'client.a@example.com',
  previous: null,
  paidAt: null,
  dueDate: '2027-06-12',
  today: '2027-05-01',
  ...over,
});

const codes = (f: BalanceFacts) => planBalance(f).issues.map((i) => i.code);

describe('planBalance: the amount', () => {
  it('is the total less the deposit received and other payments', () => {
    const p = planBalance(facts({ otherReceived: 200 }));
    expect(p.received).toBeCloseTo(1371.2);
    expect(p.due).toBeCloseTo(2532.8);
    expect(p.mode).toBe('send');
    expect(p.canSend).toBe(true);
  });

  it('asks for the whole total while the deposit is not recorded, and says so', () => {
    const p = planBalance(facts({ depositReceived: false }));
    expect(p.due).toBe(3904);
    expect(codes(facts({ depositReceived: false }))).toContain('deposit_not_recorded');
    expect(p.canSend).toBe(true);
  });

  it('rounds to cents (no 0.1 + 0.2 leftovers)', () => {
    const p = planBalance(facts({ total: 100.3, deposit: 30.1, otherReceived: 0.1 }));
    expect(p.due).toBe(70.1);
  });

  it('nothing left to pay: no request, offer "Mark as paid"', () => {
    const p = planBalance(facts({ otherReceived: 2732.8 }));
    expect(p.due).toBe(0);
    expect(p.mode).toBe('settle');
    expect(p.canSend).toBe(false);
    expect(codes(facts({ otherReceived: 5000 }))).toContain('nothing_due');
    expect(planBalance(facts({ otherReceived: 5000 })).due).toBe(0);
  });
});

describe('planBalance: blocking states', () => {
  it('a quote not accepted yet cannot have a balance', () => {
    const p = planBalance(facts({ quoteAccepted: false }));
    expect(p.mode).toBe('blocked');
    expect(p.canSend).toBe(false);
    expect(codes(facts({ quoteAccepted: false }))).toContain('not_accepted');
  });

  it('a cancelled gig cannot have a balance', () => {
    const f = facts({ gig: { ...facts().gig!, status: 'cancelled' } });
    expect(planBalance(f).mode).toBe('blocked');
    expect(codes(f)).toContain('gig_cancelled');
  });

  it('already paid: shows paid, nothing to send', () => {
    expect(planBalance(facts({ paidAt: '2027-06-13T10:00:00Z' })).mode).toBe('paid');
    const viaGig = facts({ gig: { ...facts().gig!, paymentStatus: 'paid' } });
    expect(planBalance(viaGig).mode).toBe('paid');
    expect(planBalance(viaGig).canSend).toBe(false);
  });

  it('needs at least one way to pay', () => {
    const f = facts({ ways: [] });
    expect(codes(f)).toContain('no_way');
    expect(planBalance(f).canSend).toBe(false);
  });

  it('a way that is not set up does not count', () => {
    const f = facts({ setup: { bank: false, stripe: false }, ways: ['bank', 'stripe'] });
    expect(planBalance(f).ways).toEqual([]);
    expect(codes(f)).toEqual(expect.arrayContaining(['no_setup', 'no_way']));
    const cash = facts({ setup: { bank: false, stripe: false }, ways: ['cash'] });
    expect(planBalance(cash).canSend).toBe(true);
    expect(codes(cash)).toContain('no_setup');
  });
});

describe('planBalance: warnings', () => {
  it('currency of the gig differs from the quote', () => {
    expect(codes(facts({ gig: { ...facts().gig!, currency: 'USD' } }))).toContain('currency_mismatch');
    expect(codes(facts({ gig: { ...facts().gig!, currency: 'eur' } }))).not.toContain('currency_mismatch');
  });

  it('the gig fee differs from the accepted total', () => {
    expect(codes(facts({ gig: { ...facts().gig!, fee: 4200 } }))).toContain('fee_mismatch');
    expect(codes(facts())).not.toContain('fee_mismatch');
  });

  it('no client email: share the link instead', () => {
    const p = planBalance(facts({ clientEmail: '' }));
    expect(p.canEmail).toBe(false);
    expect(p.canSend).toBe(true);
    expect(p.issues.map((i) => i.code)).toContain('no_email');
  });

  it('a due date in the past', () => {
    expect(codes(facts({ dueDate: '2027-04-01' }))).toContain('due_past');
    expect(codes(facts())).not.toContain('due_past');
  });

  it('a Stripe link usually has a fixed amount', () => {
    expect(codes(facts())).toContain('stripe_amount');
    expect(codes(facts({ ways: ['bank'] }))).not.toContain('stripe_amount');
  });
});

describe('planBalance: asked before', () => {
  const sent = { amount: 2732.8, dueDate: '2027-06-12', ways: ['stripe', 'bank'] as const, sentAt: '2027-05-01T09:00:00Z' };
  it('the same request again is a reminder', () => {
    const p = planBalance(facts({ previous: { ...sent, ways: [...sent.ways] } }));
    expect(p.mode).toBe('remind');
    expect(p.issues.map((i) => i.code)).toContain('already_requested');
  });
  it('a changed amount, date or way is an update', () => {
    expect(planBalance(facts({ previous: { ...sent, ways: [...sent.ways], amount: 2000 } })).mode).toBe('update');
    expect(planBalance(facts({ previous: { ...sent, ways: [...sent.ways], dueDate: '2027-06-20' } })).mode).toBe('update');
    expect(planBalance(facts({ previous: { ...sent, ways: ['bank'] } })).mode).toBe('update');
  });
  it('published but never sent is still a first send', () => {
    expect(planBalance(facts({ previous: { ...sent, ways: [...sent.ways], sentAt: null } })).mode).toBe('send');
  });
});

describe('balanceDueDate', () => {
  it('on the gig day, or N days after it', () => {
    expect(balanceDueDate('event', '2027-06-12', '2027-05-01')).toBe('2027-06-12');
    expect(balanceDueDate('after7', '2027-06-12', '2027-05-01')).toBe('2027-06-19');
    expect(balanceDueDate('after14', '2027-06-28', '2027-05-01')).toBe('2027-07-12');
  });
  it('a custom date, or a week from today without a gig date', () => {
    expect(balanceDueDate('custom', '2027-06-12', '2027-05-01', '2027-06-01')).toBe('2027-06-01');
    expect(balanceDueDate('event', null, '2027-05-01')).toBe('2027-05-08');
  });
});

describe('safePaymentUrl', () => {
  it('keeps https links only', () => {
    expect(safePaymentUrl('https://buy.stripe.com/test_123')).toBe('https://buy.stripe.com/test_123');
    expect(safePaymentUrl('  buy.stripe.com/abc ')).toBe('https://buy.stripe.com/abc');
    expect(safePaymentUrl('javascript:alert(1)')).toBeNull();
    expect(safePaymentUrl('http://buy.stripe.com/x')).toBeNull();
    expect(safePaymentUrl('https://buy.stripe.com/"><script>')).toBeNull();
    expect(safePaymentUrl('')).toBeNull();
  });
});

describe('buildClientBalance', () => {
  const settings = {
    bank_region: 'eu' as const,
    bank_account_holder: 'Velvet Static APS',
    bank_iban: 'IT60X0542811101000000123456',
    bank_bic_swift: 'BPMOIT22',
    bank_name: 'Banca Demo',
    stripe_payment_link: 'https://buy.stripe.com/test_123',
  };
  const plan = planBalance(facts({ ways: ['bank', 'stripe', 'cash'] }));

  it('carries what the client needs to pay, in their language', () => {
    const b = buildClientBalance(plan, facts(), settings, 'it', { ref: 'Q-2026-0014', cashNote: '' });
    expect(b.amount).toBeCloseTo(2732.8);
    expect(b.received).toEqual([{ label: 'Acconto ricevuto', amount: 1171.2 }]);
    expect(b.bank?.map((r) => r.value)).toEqual(expect.arrayContaining(['Velvet Static APS', 'IT60X0542811101000000123456', 'BPMOIT22']));
    expect(b.reference).toBe('Q-2026-0014 · Saldo');
    expect(b.stripeUrl).toBe('https://buy.stripe.com/test_123');
    expect(b.cash).toBeTruthy();
    expect(b.amountLabel).toMatch(/2\.?732,80/);
  });

  it('only the ways chosen', () => {
    const p = planBalance(facts({ ways: ['bank'] }));
    const b = buildClientBalance(p, facts({ ways: ['bank'] }), settings, 'en', { ref: 'Q-1' });
    expect(b.stripeUrl).toBeNull();
    expect(b.cash).toBeNull();
    expect(b.bank).not.toBeNull();
  });

  it('never carries an unsafe payment link', () => {
    const b = buildClientBalance(plan, facts(), { ...settings, stripe_payment_link: 'javascript:alert(1)' }, 'en', { ref: 'Q-1' });
    expect(b.stripeUrl).toBeNull();
  });
});

describe('balanceMessage', () => {
  it('says the amount, the due date and carries the link', () => {
    const url = 'https://app.bandwith.fun/quote.html?t=' + 'e'.repeat(64);
    const msg = balanceMessage({ clientName: 'Giulia Rossi', event: 'Wedding', bandName: 'Velvet Static', amount: '€2,732.80', dueDate: '2027-06-12', url, lang: 'en', kind: 'sent' });
    expect(msg).toContain('Hi Giulia,');
    expect(msg).toContain('€2,732.80');
    expect(msg).toContain('12 June 2027');
    expect(msg).toContain(url);
    const it = balanceMessage({ clientName: 'Giulia', event: 'Matrimonio', bandName: 'Velvet Static', amount: '2.732,80 €', dueDate: '2027-06-12', url, lang: 'it', kind: 'reminder' });
    expect(it).toContain('Gentile Giulia,');
    expect(it).toContain('promemoria');
  });
});
