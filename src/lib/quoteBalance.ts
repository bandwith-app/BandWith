/**
 * The final balance (saldo) of an accepted quote (migration 168).
 *
 * After the client accepted, the admin asks for the rest: the accepted total
 * less the deposit received and any other payment. The same client page
 * (/quote.html) then shows the amount due, by when, and the ways to pay that
 * the band set up: bank transfer, the band's own Stripe payment link, cash.
 * BandWith never moves money: the Stripe link is a plain link the band
 * pasted, and "Mark as paid" is the admin saying the money arrived.
 *
 * Everything here is pure: the sheet (BalanceRequestSheet) feeds it the
 * facts and shows the result; the server re-checks what matters
 * (accepted, not cancelled, a safe link) in bw_quote_balance_publish.
 */
import { intlLocale, translate, type Locale, type TranslateVars } from '@/lib/i18n';
import { formatQuoteMoney, roundCents } from '@/lib/services/quoteMath';
import { currencySymbol } from '@/lib/currency';
import { bankDetailRows, hasBankAccount, type BandPricingSettings } from '@/lib/services/pricing';
import type { ClientBalance } from '@/quote/types';

export type BalanceWay = 'bank' | 'stripe' | 'cash';
export const BALANCE_WAYS: BalanceWay[] = ['bank', 'stripe', 'cash'];

export type BalanceDueRule = 'event' | 'after7' | 'after14' | 'custom';

export interface BalanceGig {
  status?: string | null;
  currency?: string | null;
  fee?: number | null;
  paymentStatus?: string | null;
  /** YYYY-MM-DD */
  date?: string | null;
}

export interface BalanceFacts {
  /** The total the client accepted (or the gig fee, when the admin picks it). */
  total: number;
  currency: string;
  /** The deposit asked on the quote (0 = none). */
  deposit: number;
  /** events.deposit_paid of the gig. */
  depositReceived: boolean;
  /** Any other money already received from the client (typed by the admin). */
  otherReceived: number;
  quoteAccepted: boolean;
  gig: BalanceGig | null;
  /** What the band set up in Pricing → Payment. */
  setup: { bank: boolean; stripe: boolean };
  /** The ways the admin picked for this request. */
  ways: BalanceWay[];
  clientEmail?: string | null;
  /** The balance already on the client's page, if any. */
  previous?: { amount: number; dueDate: string | null; ways: BalanceWay[]; sentAt: string | null } | null;
  /** quote_links.balance_paid_at */
  paidAt?: string | null;
  /** YYYY-MM-DD */
  dueDate: string | null;
  /** YYYY-MM-DD, the admin's today. */
  today: string;
}

export type BalanceIssueCode =
  | 'not_accepted'
  | 'gig_cancelled'
  | 'paid'
  | 'nothing_due'
  | 'no_setup'
  | 'no_way'
  | 'deposit_not_recorded'
  | 'currency_mismatch'
  | 'fee_mismatch'
  | 'no_email'
  | 'due_past'
  | 'stripe_amount'
  | 'already_requested';

/** block: nothing can be sent; warn: check before sending; info: good to know. */
export interface BalanceIssue {
  code: BalanceIssueCode;
  level: 'block' | 'warn' | 'info';
}

/**
 * - blocked: not accepted / cancelled gig.
 * - paid: the balance was received.
 * - settle: nothing left to pay: "Mark as paid" instead of a request.
 * - send: a first request. update: a changed request. remind: the same one again.
 */
export type BalanceMode = 'blocked' | 'paid' | 'settle' | 'send' | 'update' | 'remind';

export interface BalancePlan {
  received: number;
  due: number;
  /** The picked ways that are set up (bank and Stripe need the band's details). */
  ways: BalanceWay[];
  mode: BalanceMode;
  issues: BalanceIssue[];
  canSend: boolean;
  canEmail: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const sameWays = (a: BalanceWay[], b: BalanceWay[]) => [...a].sort().join() === [...b].sort().join();

export function planBalance(f: BalanceFacts): BalancePlan {
  const issues: BalanceIssue[] = [];
  const add = (code: BalanceIssueCode, level: BalanceIssue['level']) => issues.push({ code, level });

  const total = roundCents(Math.max(0, num(f.total)));
  const deposit = roundCents(Math.max(0, num(f.deposit)));
  const received = roundCents((f.depositReceived ? deposit : 0) + Math.max(0, num(f.otherReceived)));
  const due = roundCents(Math.max(0, total - received));
  const ways = BALANCE_WAYS.filter(
    (w) => f.ways.includes(w) && (w === 'cash' || (w === 'bank' ? f.setup.bank : f.setup.stripe)),
  );
  const canEmail = EMAIL_RE.test(String(f.clientEmail ?? '').trim());
  const status = String(f.gig?.status ?? '').toLowerCase();

  let mode: BalanceMode;
  if (!f.quoteAccepted) {
    add('not_accepted', 'block');
    mode = 'blocked';
  } else if (status === 'cancelled') {
    add('gig_cancelled', 'block');
    mode = 'blocked';
  } else if (f.paidAt || String(f.gig?.paymentStatus ?? '').toLowerCase() === 'paid') {
    add('paid', 'info');
    mode = 'paid';
  } else if (due <= 0) {
    add('nothing_due', 'info');
    mode = 'settle';
  } else if (f.previous?.sentAt) {
    const same =
      roundCents(num(f.previous.amount)) === due && (f.previous.dueDate ?? null) === (f.dueDate ?? null) && sameWays(f.previous.ways, ways);
    mode = same ? 'remind' : 'update';
    add('already_requested', 'info');
  } else {
    mode = 'send';
  }

  const asking = mode === 'send' || mode === 'update' || mode === 'remind';
  if (asking) {
    if (!f.setup.bank && !f.setup.stripe) add('no_setup', 'warn');
    if (ways.length === 0) add('no_way', 'block');
    if (deposit > 0 && !f.depositReceived) add('deposit_not_recorded', 'warn');
    if (f.dueDate && f.dueDate < f.today) add('due_past', 'warn');
    if (ways.includes('stripe')) add('stripe_amount', 'info');
    if (!canEmail) add('no_email', 'info');
  }
  if (mode !== 'blocked') {
    const gigCurrency = String(f.gig?.currency ?? '').trim().toUpperCase();
    if (gigCurrency && gigCurrency !== String(f.currency).trim().toUpperCase()) add('currency_mismatch', 'warn');
    const fee = f.gig?.fee == null ? null : num(f.gig.fee);
    if (fee != null && fee > 0 && Math.abs(fee - total) >= 0.01) add('fee_mismatch', 'warn');
  }

  return {
    received,
    due,
    ways,
    mode,
    issues,
    canSend: asking && !issues.some((i) => i.level === 'block'),
    canEmail,
  };
}

// ------------------------------------------------------------------ dates

const addDays = (ymd: string, days: number) => {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
};

/** The due date for a rule: the gig day, 7 or 14 days after it, or a custom date. No gig date: a week from today. */
export function balanceDueDate(rule: BalanceDueRule, gigDate: string | null | undefined, today: string, custom?: string | null): string {
  if (rule === 'custom' && custom && /^\d{4}-\d{2}-\d{2}$/.test(custom)) return custom;
  const base = gigDate && /^\d{4}-\d{2}-\d{2}/.test(gigDate) ? gigDate.slice(0, 10) : null;
  if (!base) return addDays(today, 7);
  if (rule === 'after7') return addDays(base, 7);
  if (rule === 'after14') return addDays(base, 14);
  return base;
}

/** The rule a sheet opens with: the gig day while it is ahead, otherwise a week from today. */
export function defaultDueRule(gigDate: string | null | undefined, today: string): BalanceDueRule {
  return gigDate && gigDate.slice(0, 10) >= today ? 'event' : 'custom';
}

// ------------------------------------------------------------------ links

/**
 * The band's payment link, if it is a plain https URL. Anything else
 * (javascript:, http:, quotes or spaces inside) is dropped: the client's
 * page turns it into a button. "buy.stripe.com/…" gets its https://.
 */
export function safePaymentUrl(raw: unknown): string | null {
  let s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  if (s.length > 500 || !/^https:\/\/[^\s"'<>\\]+$/i.test(s)) return null;
  try {
    const url = new URL(s);
    return url.protocol === 'https:' && url.hostname.includes('.') ? s : null;
  } catch {
    return null;
  }
}

/** The ways the band set up in Pricing → Payment. */
export function balanceSetup(s: Partial<BandPricingSettings> | null | undefined): { bank: boolean; stripe: boolean } {
  return { bank: !!s && hasBankAccount(s), stripe: !!safePaymentUrl(s?.stripe_payment_link) };
}

// ------------------------------------------------------------------ client side

const moneyIn = (lang: Locale, currency: string) => {
  const sym = currencySymbol(currency);
  return (v: number) => formatQuoteMoney(v, sym, intlLocale('en-US', lang));
};

/**
 * What the client's page shows for the balance, in `lang`: the amount, what
 * was already received, the due date and only the ways picked. The bank
 * details are the ones the PDF prints; nothing internal.
 */
export function buildClientBalance(
  plan: BalancePlan,
  facts: Pick<BalanceFacts, 'total' | 'currency' | 'deposit' | 'depositReceived' | 'otherReceived' | 'dueDate'>,
  settings: Partial<BandPricingSettings>,
  lang: Locale,
  opts: { ref: string; cashNote?: string | null; note?: string | null; pdfUrl?: string | null },
): ClientBalance {
  const tr = (s: string, vars?: TranslateVars) => translate(lang, s, vars);
  const currency = (facts.currency || 'EUR').toUpperCase();
  const received: ClientBalance['received'] = [];
  const deposit = roundCents(Math.max(0, num(facts.deposit)));
  if (facts.depositReceived && deposit > 0) received.push({ label: tr('Deposit received'), amount: deposit });
  const other = roundCents(Math.max(0, num(facts.otherReceived)));
  if (other > 0) received.push({ label: tr('Already paid'), amount: other });
  const stripe = plan.ways.includes('stripe') ? safePaymentUrl(settings.stripe_payment_link) : null;
  const clip = (v: string | null | undefined, max: number) => {
    const s = (v ?? '').trim();
    return s ? s.slice(0, max) : null;
  };
  return {
    v: 1,
    currency,
    total: roundCents(Math.max(0, num(facts.total))),
    received,
    other,
    amount: plan.due,
    amountLabel: moneyIn(lang, currency)(plan.due),
    dueDate: facts.dueDate || null,
    reference: opts.ref ? tr('{ref} · Balance', { ref: opts.ref }) : tr('Balance'),
    bank: plan.ways.includes('bank') && hasBankAccount(settings) ? bankDetailRows(settings, lang) : null,
    stripeUrl: stripe,
    cash: plan.ways.includes('cash') ? clip(opts.cashNote, 300) || tr('Cash, to the band on the day of the event.') : null,
    note: clip(opts.note, 1000),
    ...(opts.pdfUrl ? { pdfUrl: opts.pdfUrl } : {}),
  };
}

/**
 * The other payments a balance already on the client's page counted (not
 * the deposit), to start the next request from. Balances from 185 on keep
 * them as `other`; older ones only have the "Already paid" line, in the
 * page's language. The deposit received since then is not one of them.
 */
export function previousOtherReceived(prev: ClientBalance | null | undefined, lang: Locale): number {
  if (!prev) return 0;
  if (typeof prev.other === 'number' && Number.isFinite(prev.other)) return roundCents(Math.max(0, prev.other));
  const label = translate(lang, 'Already paid');
  const deposit = translate(lang, 'Deposit received');
  const lines = Array.isArray(prev.received) ? prev.received : [];
  const line = lines.find((r) => r?.label === label) ?? (lines.length === 2 ? lines[1] : lines.length === 1 && lines[0]?.label !== deposit ? lines[0] : null);
  return line ? roundCents(Math.max(0, num(line.amount))) : 0;
}

/** The text that goes with the link (WhatsApp, SMS, copy), in the client's language. */
export function balanceMessage(o: {
  clientName?: string | null;
  event: string;
  bandName: string;
  amount: string;
  dueDate: string | null;
  url: string;
  lang: Locale;
  kind: 'sent' | 'updated' | 'reminder';
  signer?: string | null;
}): string {
  const tr = (s: string, vars?: TranslateVars) => translate(o.lang, s, vars);
  const first = (o.clientName || '').trim().split(/\s+/)[0];
  const date = o.dueDate
    ? new Date(`${o.dueDate}T12:00:00`).toLocaleDateString(intlLocale('en-GB', o.lang), { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const vars = { band: o.bandName, event: `"${o.event}"`, amount: o.amount, date: date ?? '' };
  const lead =
    o.kind === 'reminder'
      ? date
        ? tr('A friendly reminder: the balance of {amount} for {event} is due by {date}.', vars)
        : tr('A friendly reminder: the balance of {amount} for {event} is still open.', vars)
      : o.kind === 'updated'
        ? tr('{band} updated the balance for {event}: {amount}.', vars)
        : date
          ? tr('Thank you for choosing {band}! Here is the balance for {event}: {amount}, due by {date}.', vars)
          : tr('Thank you for choosing {band}! Here is the balance for {event}: {amount}.', vars);
  return [
    first ? tr('Hi {name},', { name: first }) : tr('Hi there,'),
    '',
    lead,
    tr('Bank details and the other ways to pay are here:'),
    o.url,
    '',
    tr('Best regards,'),
    o.signer || o.bandName,
  ].join('\n');
}
