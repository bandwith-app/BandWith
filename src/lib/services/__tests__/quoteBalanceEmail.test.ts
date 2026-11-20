import { describe, expect, it } from 'vitest';
import {
  quoteEmailVars,
  QUOTE_BALANCE_STRINGS,
  QUOTE_EMAIL_STRINGS,
  quoteBalanceEmailVars,
} from '../../../../supabase/functions/_shared/quote-email-strings';
import { renderEmail } from '../../../../supabase/functions/_shared/email-templates';

/** The "quote-balance" email (168): the client's language, the band's own ways to pay. */
const balance = {
  v: 1,
  currency: 'EUR',
  total: 3904,
  received: [{ label: 'Acconto ricevuto', amount: 960 }],
  amount: 2944,
  amountLabel: '€ 2.944',
  dueDate: '2026-11-28',
  reference: 'Q-2026-0014 · Saldo',
  bank: [
    { label: 'Beneficiario', value: 'Velvet Static APS' },
    { label: 'IBAN', value: 'IT60X0542811101000000123456' },
  ],
  stripeUrl: 'https://buy.stripe.com/test_velvetstatic',
  cash: 'Al capobanda dopo il soundcheck',
};
const input = {
  kind: 'sent' as const,
  lang: 'it' as const,
  band: 'Velvet Static',
  ref: 'Q-2026-0014',
  event: 'Client A — Wedding',
  date: '21 novembre 2026',
  clientName: 'Giulia',
  to: 'client.a@example.com',
  url: 'https://app.bandwith.fun/quote.html?t=' + 'e'.repeat(64),
  balance,
};

describe('quote-balance email', () => {
  it('has every word in all six languages', () => {
    const keys = Object.keys(QUOTE_BALANCE_STRINGS.en).sort();
    for (const lang of Object.keys(QUOTE_EMAIL_STRINGS)) {
      expect(Object.keys(QUOTE_BALANCE_STRINGS[lang as keyof typeof QUOTE_BALANCE_STRINGS]).sort()).toEqual(keys);
    }
  });

  it('speaks the client’s language with the amount, the due date and the bank lines', () => {
    const v = quoteBalanceEmailVars(input);
    expect(v.Subject).toBe('Velvet Static — Saldo del preventivo Q-2026-0014');
    expect(v.Intro).toContain('Gentile Giulia,');
    expect(v.Intro).toContain('€ 2.944');
    expect(v.Intro).toContain('28 novembre 2026');
    expect(v.HowText).toContain('IBAN: IT60X0542811101000000123456');
    expect(v.HowText).toContain('Causale: Q-2026-0014 · Saldo');
    expect(v.HowText).toContain('Paga con carta');
    expect(v.HowText).toContain('Contanti: Al capobanda dopo il soundcheck');
    expect(v.Received).toMatch(/960/);
  });

  it('a reminder says so; no card line without an https link', () => {
    const v = quoteBalanceEmailVars({ ...input, kind: 'reminder', lang: 'en', balance: { ...balance, stripeUrl: 'javascript:alert(1)' } });
    expect(v.Subject).toBe('Reminder: balance for Q-2026-0014 from Velvet Static');
    expect(v.HowText).not.toContain('Pay by card');
  });

  it('renders escaped, with the page link and no leftover placeholder', () => {
    const v = quoteBalanceEmailVars({ ...input, balance: { ...balance, cash: '<b>cash</b>' } });
    const { subject, html } = renderEmail('quote-balance', { ...v, AppURL: 'https://app.bandwith.fun' });
    expect(subject).toContain('Saldo del preventivo');
    expect(html).toContain(input.url);
    expect(html).toContain('&lt;b&gt;cash&lt;/b&gt;');
    expect(html).not.toContain('<b>cash</b>');
    expect(html).not.toMatch(/\{\{\w+\}\}/);
  });

  it('the quote email names the deposit that confirms the date, and where to pay it', () => {
    const base = { kind: 'sent' as const, lang: 'it' as const, band: 'Velvet Static', ref: 'Q-2026-0014', event: 'Matrimonio', date: '', total: '€ 3.904', clientName: 'Giulia', to: 'c@example.com', url: 'https://app.bandwith.fun/quote.html?t=x', pdfAttached: false };
    const v = quoteEmailVars({ ...base, deposit: '1171 €' });
    expect(v.NoteText).toContain('acconto di 1171 €');
    expect(v.NoteText).toContain('Non è una firma');
    expect(quoteEmailVars(base).NoteText).not.toContain('acconto');
    expect(quoteEmailVars({ ...base, kind: 'reply', deposit: '1171 €' }).NoteText).not.toContain('acconto');
  });
});
