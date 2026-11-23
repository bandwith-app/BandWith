// Development only: /quote.html?t=demo shows a sample quote kept in memory
// (`&state=discussing|accepted|deposit_paid|declined|expired|balance|balance_paid`, `&l=it`). Production
// builds drop it (quote.ts imports it behind import.meta.env.DEV).
import type { QuoteLinkView } from './types';

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export function demoQuoteApi(state: string) {
  let v: QuoteLinkView = {
    status: 'viewed',
    lang: 'en',
    band_name: 'The Night Shift',
    client_name: 'Northwind Conferences',
    version: 1,
    updated_at: null,
    pdf_url: null,
    accepted_name: null,
    accepted_at: null,
    declined_at: null,
    decline_reason: null,
    expired: false,
    messages: [],
    quote: {
      v: 1,
      ref: 'Q-2026-0013',
      title: 'Year-end gala',
      eventType: 'Corporate Event',
      date: day(52),
      start: '20:30',
      end: '23:30',
      venue: 'Palazzo Clerici',
      city: 'Milano',
      guests: 300,
      lineup: '6 musicians',
      sets: 'Includes 3 sets of 45 minutes or equivalent',
      items: [
        { label: 'MAIN BAND', detail: '6pc band', amount: 3800 },
        { label: 'MUSICAL PRODUCTION', detail: 'Pro Production', amount: 900 },
        { label: 'DJ SET', detail: null, amount: null },
      ],
      currency: 'EUR',
      subtotal: 4700,
      discount: 0,
      discountNote: null,
      net: 4700,
      vatLabel: 'VAT 22%',
      vat: 1034,
      total: 5734,
      totalLabel: '€5,734.00',
      deposit: { percent: 30, amount: 1720.2, dueDate: day(7) },
      // 168: how to pay the deposit (the server sends it only once accepted).
      pay: {
        bank: [
          { label: 'Beneficiary', value: 'The Night Shift APS' },
          { label: 'IBAN', value: 'IT60X0542811101000000123456' },
          { label: 'BIC', value: 'BPMOIT22XXX' },
        ],
        stripeUrl: 'https://buy.stripe.com/test_demo',
        reference: 'Q-2026-0013 · Deposit',
      },
      validUntil: day(14),
      notes: 'Dress code black. We arrive two hours before the first set for the soundcheck.',
      terms: 'Deposit due within 7 days of acceptance; balance on the day of the event.',
    },
  };
  if (state === 'discussing' || state === 'accepted' || state === 'deposit_paid') {
    v = {
      ...v,
      status: 'discussing',
      version: 2,
      updated_at: ago(60),
      messages: [
        { from: 'client', body: 'Could you add a DJ set after the band?', at: ago(60 * 26) },
        { from: 'band', body: 'Of course: I added a 2-hour DJ set, included in the price.', at: ago(65) },
      ],
    };
  }
  if (state === 'accepted' || state === 'deposit_paid') v = { ...v, status: 'accepted', accepted_name: 'Leo M.', accepted_at: ago(20), deposit_paid: state === 'deposit_paid', deposit_paid_amount: state === 'deposit_paid' ? 1500 : null, deposit_paid_currency: state === 'deposit_paid' ? 'EUR' : null };
  // 168: the band asked for the final balance (and, for balance_paid, recorded it).
  if (state === 'balance' || state === 'balance_paid') {
    v = {
      ...v,
      status: 'accepted',
      accepted_name: 'Leo M.',
      accepted_at: ago(60 * 24 * 30),
      balance_at: ago(60),
      balance_paid: state === 'balance_paid',
      balance_paid_at: state === 'balance_paid' ? ago(30) : null,
      balance: {
        v: 1,
        currency: 'EUR',
        total: 5734,
        received: [{ label: 'Deposit received', amount: 1720.2 }],
        amount: 4013.8,
        amountLabel: '€4,013.80',
        dueDate: day(52),
        reference: 'Q-2026-0013 · Balance',
        bank: [
          { label: 'Beneficiary', value: 'The Night Shift APS' },
          { label: 'IBAN', value: 'IT60X0542811101000000123456' },
          { label: 'BIC', value: 'BPMOIT22XXX' },
          { label: 'Bank', value: 'Banca Demo' },
        ],
        stripeUrl: 'https://buy.stripe.com/test_demo',
        cash: 'Cash, to the band leader on the night.',
        note: null,
      },
    };
  }
  if (state === 'declined') v = { ...v, status: 'declined', declined_at: ago(30), decline_reason: 'We chose another date.' };
  if (state === 'expired') v = { ...v, expired: true, quote: { ...v.quote, validUntil: day(-5) } };

  // As bw_quote_link_view: how to pay the deposit only once accepted.
  const wait = (x: QuoteLinkView) =>
    new Promise<QuoteLinkView>((r) =>
      setTimeout(() => {
        const out = structuredClone(x);
        if (out.status !== 'accepted') delete out.quote.pay;
        r(out);
      }, 250),
    );
  return {
    seen: () => wait(v),
    view: () => wait(v),
    respond: (action: 'accept' | 'decline', name: string | null, reason: string | null) => {
      v =
        action === 'accept'
          ? { ...v, status: 'accepted', accepted_name: name, accepted_at: new Date().toISOString() }
          : { ...v, status: 'declined', declined_at: new Date().toISOString(), decline_reason: reason };
      return wait(v);
    },
    message: (body: string) => {
      v = { ...v, status: v.status === 'accepted' ? v.status : 'discussing', messages: [...v.messages, { from: 'client', body, at: new Date().toISOString() }] };
      return wait(v);
    },
  };
}
