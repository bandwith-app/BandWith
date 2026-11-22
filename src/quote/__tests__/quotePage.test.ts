import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuoteLinkView } from '../types';
import { QUOTE_STRINGS } from '../strings';

/**
 * The real /quote.html script (src/quote.ts) in jsdom, with the four page
 * RPCs answered here. Audit of 383f15b, public pages #9 and #11.
 */
const S = QUOTE_STRINGS.en;
const TOKEN = 'a'.repeat(64);

const base = (over: Partial<QuoteLinkView> = {}): QuoteLinkView => ({
  status: 'viewed',
  lang: 'en',
  band_name: 'The Night Shift',
  client_name: 'Emma Carter',
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
    ref: 'Q-2026-0042',
    title: 'Rooftop wedding',
    items: [{ label: 'MAIN BAND', detail: '5pc band', amount: 4000 }],
    currency: 'EUR',
    subtotal: 4000,
    discount: 0,
    net: 4000,
    vatLabel: 'VAT 0%',
    vat: 0,
    total: 4000,
    totalLabel: '€4,000',
    deposit: { percent: 12.5, amount: 500 },
    pay: { bank: [{ label: 'IBAN', value: 'IT60X0542811101000000123456' }], stripeUrl: null, reference: 'Q-2026-0042 · Deposit' },
  },
  ...over,
});

let answers: Record<string, (body: Record<string, unknown>) => QuoteLinkView | null>;
let calls: { fn: string; body: Record<string, unknown> }[];

async function openPage() {
  vi.resetModules();
  document.body.innerHTML = '<main id="app"></main>';
  window.history.replaceState(null, '', `/quote.html?t=${TOKEN}`);
  await import('../../quote');
  await vi.advanceTimersByTimeAsync(0);
}
const app = () => document.getElementById('app') as HTMLElement;
const button = (text: string) => [...app().querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  calls = [];
  answers = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      const fn = String(url).split('/rpc/')[1];
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push({ fn, body });
      const out = answers[fn]?.(body) ?? null;
      return { ok: true, status: 200, json: async () => out } as Response;
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('quote page: consent is given on one version (#9)', () => {
  it('a new version on the next poll clears the ticked box and says the quote changed', async () => {
    let current = base();
    answers.bw_quote_link_seen = () => current;
    answers.bw_quote_link_view = () => current;
    answers.bw_quote_link_respond = (b) => ({ ...current, status: 'accepted', accepted_name: String(b.p_name), accepted_at: new Date().toISOString() });
    await openPage();

    (document.getElementById('acc-name') as HTMLInputElement).value = 'Emma Carter';
    (document.getElementById('acc-check') as HTMLInputElement).checked = true;

    // The band changes the price and writes about it; the page polls.
    current = base({
      version: 2,
      updated_at: new Date().toISOString(),
      quote: { ...base().quote, total: 4800, totalLabel: '€4,800' },
      messages: [{ from: 'band', body: 'New price with the DJ set.', at: new Date().toISOString() }],
    });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(app().textContent).toContain(S.staleTitle);
    expect((document.getElementById('acc-check') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('acc-name') as HTMLInputElement).value).toBe('Emma Carter');

    button(S.accept).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.some((c) => c.fn === 'bw_quote_link_respond')).toBe(false);
    expect(app().textContent).toContain(S.needCheck);

    // Ticked again on version 2: accepted on version 2.
    (document.getElementById('acc-check') as HTMLInputElement).checked = true;
    button(S.accept).click();
    await vi.advanceTimersByTimeAsync(0);
    const respond = calls.find((c) => c.fn === 'bw_quote_link_respond');
    expect(respond?.body.p_version).toBe(2);
  });

  it('a new version without a new message still reaches the open page', async () => {
    let current = base();
    answers.bw_quote_link_seen = () => current;
    answers.bw_quote_link_view = () => current;
    await openPage();
    (document.getElementById('acc-check') as HTMLInputElement).checked = true;

    current = base({ version: 2, quote: { ...base().quote, total: 4800 } });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(app().textContent).toContain(S.staleTitle);
    expect(app().textContent).toContain('4,800');
    expect((document.getElementById('acc-check') as HTMLInputElement).checked).toBe(false);
  });

  it('the same version on the next poll keeps what the client typed', async () => {
    let current = base();
    answers.bw_quote_link_seen = () => current;
    answers.bw_quote_link_view = () => current;
    await openPage();
    (document.getElementById('acc-check') as HTMLInputElement).checked = true;

    current = base({ messages: [{ from: 'band', body: 'Any questions?', at: new Date().toISOString() }] });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(app().textContent).toContain('Any questions?');
    expect(app().textContent).not.toContain(S.staleTitle);
    expect((document.getElementById('acc-check') as HTMLInputElement).checked).toBe(true);
  });
});

describe('quote page: the deposit receipt says what was received (#11)', () => {
  const accepted = (over: Partial<QuoteLinkView>) =>
    base({ status: 'accepted', accepted_name: 'Emma Carter', accepted_at: new Date().toISOString(), ...over });

  it('€300 recorded on a €500 deposit: the receipt says €300', async () => {
    answers.bw_quote_link_seen = () => accepted({ deposit_paid: true, deposit_paid_amount: 300 });
    await openPage();
    const receipt = app().querySelector('[data-testid="deposit-paid"]') as HTMLElement;
    expect(receipt.textContent).toContain('€300');
    expect(receipt.textContent).not.toContain('€500');
  });

  it('not paid yet: the payment prompt asks for the requested €500', async () => {
    answers.bw_quote_link_seen = () => accepted({ deposit_paid: false });
    await openPage();
    const pay = app().querySelector('[data-testid="deposit-pay"]') as HTMLElement;
    expect(pay.textContent).toContain('€500');
  });

  it('USD 300 recorded on a EUR quote: the receipt says $300, not €300', async () => {
    answers.bw_quote_link_seen = () => accepted({ deposit_paid: true, deposit_paid_amount: 300, deposit_paid_currency: 'USD' });
    await openPage();
    const receipt = (app().querySelector('[data-testid="deposit-paid"]') as HTMLElement).textContent || '';
    expect(receipt).toContain('$300');
    expect(receipt).not.toContain('€');
  });

  it('recorded without an amount (or a server before 183): no amount, never the one asked', async () => {
    answers.bw_quote_link_seen = () => accepted({ deposit_paid: true, deposit_paid_amount: null });
    await openPage();
    const receipt = (app().querySelector('[data-testid="deposit-paid"]') as HTMLElement).textContent || '';
    expect(receipt).not.toContain('€500');
    expect(receipt).toContain(S.depositPaidBodyNoAmount.replace('{band}', 'The Night Shift'));
  });
});

describe('quote page: the 30 s refresh never takes the client’s place (round 4)', () => {
  it('a band reply arrives while the client types: focus, text and caret stay', async () => {
    let current = base();
    answers.bw_quote_link_seen = () => current;
    answers.bw_quote_link_view = () => current;
    await openPage();
    const box = document.getElementById('message') as HTMLTextAreaElement;
    box.focus();
    box.value = 'Can we start at 7?';
    box.setSelectionRange(7, 12);

    current = base({ messages: [{ from: 'band', body: 'Sure, see you there.', at: new Date().toISOString() }] });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(app().textContent).toContain('Sure, see you there.');
    const now = document.getElementById('message') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(now);
    expect(now.value).toBe('Can we start at 7?');
    expect([now.selectionStart, now.selectionEnd]).toEqual([7, 12]);
  });

  it('the name field keeps focus and caret when a new version arrives', async () => {
    let current = base();
    answers.bw_quote_link_seen = () => current;
    answers.bw_quote_link_view = () => current;
    await openPage();
    const name = document.getElementById('acc-name') as HTMLInputElement;
    name.focus();
    name.value = 'Emma Car';
    name.setSelectionRange(8, 8);

    current = base({ version: 2, quote: { ...base().quote, total: 4800 } });
    await vi.advanceTimersByTimeAsync(30_000);

    const now = document.getElementById('acc-name') as HTMLInputElement;
    expect(document.activeElement).toBe(now);
    expect(now.selectionStart).toBe(8);
  });

  it('the "quote updated" notice is a status (polite), not an alert', async () => {
    let current = base();
    answers.bw_quote_link_seen = () => current;
    answers.bw_quote_link_view = () => current;
    await openPage();
    current = base({ version: 2, quote: { ...base().quote, total: 4800 } });
    await vi.advanceTimersByTimeAsync(30_000);
    const card = [...app().querySelectorAll('section')].find((s) => s.textContent?.includes(S.staleTitle));
    expect(card?.getAttribute('role')).toBe('status');
  });
});
