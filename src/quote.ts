// /quote.html — the client's quote page (migration 099). No account.
// The link carries a 64-character token. bw_quote_link_seen marks the
// first open (the admins hear it) and returns what the client may see:
// the client summary the band published, its version, the PDF and the
// conversation. The client accepts (typed name + "I accept", recorded
// with the time, on the version they saw), declines (optional reason) or
// writes to the band; the band answers from the app and the reply shows
// up here. `&preview=1` is the admin's own preview: nothing is recorded
// (`&k=` adds the draft balance the admin is looking at, 185).
//
// 168: once the band asks for the final balance, the same page shows the
// balance due, by when, and how to pay it (bank details with Copy buttons,
// the band's own Stripe payment link, cash), above the same quote with
// what was already received. When the band records it as received, the
// page says thank you instead.

import type { ClientBalance, ClientQuoteSnapshot, QuoteLinkView } from './quote/types';
import { QUOTE_STRINGS, fill, pickQuoteLang, type QuoteLang, type QuoteStrings } from './quote/strings';
import { rememberFocus, restoreFocus } from './quote/focus';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const params = new URL(window.location.href).searchParams;
const token = (params.get('t') ?? '').toLowerCase();
const preview = params.get('preview') === '1';
// 185: the admin's draft balance (Preview in the app), shown only with its key.
const previewKey = preview && /^[0-9a-f]{64}$/.test(params.get('k') ?? '') ? (params.get('k') as string) : '';
const forcedLang = params.get('l') ?? '';
let lang: QuoteLang = pickQuoteLang([forcedLang, ...(navigator.languages ?? []), navigator.language ?? '']);
let S: QuoteStrings = QUOTE_STRINGS[lang];
document.documentElement.lang = lang;

const app = document.getElementById('app') as HTMLElement;

// ---------------------------------------------------------------- DOM

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false) el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}
const arrow = () => h('span', { class: 'arrow', 'aria-hidden': 'true' }, '↗');

// ---------------------------------------------------------------- formatting

const hhmm = (v?: string | null) => (v ? v.slice(0, 5) : '');
const ymd = (v: string) => {
  const [y, m, d] = v.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
const longDate = (v?: string | null) =>
  v ? new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(ymd(v)) : '';
const shortDate = (v?: string | null) =>
  v ? new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(ymd(v)) : '';
const stampDate = (iso: string) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
const stampTime = (iso: string) =>
  new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const stamp = (iso: string) =>
  new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
let currency = 'EUR';
/** `cur`: another currency than the quote's (183: the deposit in the gig's currency). */
const money = (n: number, cur = currency) => {
  try {
    return new Intl.NumberFormat(lang, { style: 'currency', currency: cur, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  } catch {
    return `${n} ${cur}`;
  }
};

// ---------------------------------------------------------------- data

type Api = {
  seen: () => Promise<QuoteLinkView | null>;
  view: () => Promise<QuoteLinkView | null>;
  respond: (action: 'accept' | 'decline', name: string | null, reason: string | null, version: number) => Promise<QuoteLinkView | null>;
  message: (body: string) => Promise<QuoteLinkView | null>;
};

class RpcError extends Error {
  constructor(public status: number, public code: string) {
    super(code || String(status));
  }
}

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    // Publishable keys go on `apikey` only: they are not JWTs.
    headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE_KEY as string },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let code = '';
    try {
      code = ((await res.json()) as { code?: string }).code ?? '';
    } catch {
      /* no body */
    }
    throw new RpcError(res.status, code);
  }
  return (await res.json()) as T;
}

const remoteApi: Api = {
  seen: () => rpc('bw_quote_link_seen', { p_token: token }),
  view: () =>
    previewKey
      ? rpc('bw_quote_link_preview', { p_token: token, p_key: previewKey })
      : rpc('bw_quote_link_view', { p_token: token }),
  respond: (action, name, reason, version) =>
    rpc('bw_quote_link_respond', { p_token: token, p_action: action, p_name: name, p_reason: reason, p_version: version }),
  message: (body) => rpc('bw_quote_link_message', { p_token: token, p_body: body }),
};
let api: Api = remoteApi;

let view: QuoteLinkView | null = null;
// The page could not be loaded (no signal, server down): not a bad link.
let offline = false;
let busy = false;
let failure: string | null = null;
let fieldError: { field: 'name' | 'check'; text: string } | null = null;
let stale = false;
// Typed text survives re-renders.
const draft = { name: '', checked: false, reason: '', message: '' };

function readFields() {
  const v = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value;
  draft.name = v('acc-name') ?? draft.name;
  draft.reason = v('reason') ?? draft.reason;
  draft.message = v('message') ?? draft.message;
  const box = document.getElementById('acc-check') as HTMLInputElement | null;
  if (box) draft.checked = box.checked;
}

/**
 * Show a view from the server. `keepStale` (the poll): a notice already on
 * screen stays. A different version of a quote not yet accepted is a new
 * quote for the client: the "I accept" box ticked for the old one is
 * cleared (the typed name stays) and the page says it was updated, so an
 * acceptance is always given on the version on screen.
 */
function applyView(next: QuoteLinkView | null, keepStale = false) {
  if (!next) return;
  const revised = !!view && next.status !== 'accepted' && next.version !== view.version;
  if (revised) draft.checked = false;
  view = next;
  stale = !!next.stale || revised || (keepStale && stale);
  currency = next.quote?.currency || 'EUR';
  if (!forcedLang && next.lang && next.lang in QUOTE_STRINGS && next.lang !== lang) {
    lang = next.lang as QuoteLang;
    S = QUOTE_STRINGS[lang];
    document.documentElement.lang = lang;
  }
}

async function act(run: () => Promise<QuoteLinkView | null>, focus?: string) {
  if (busy || !view || preview) return;
  readFields();
  busy = true;
  failure = null;
  render();
  try {
    const next = await run();
    if (!next) {
      // The link was turned off or replaced meanwhile: nothing was recorded.
      view = null;
    } else {
      applyView(next);
      if (focus === 'sent') draft.message = '';
    }
  } catch (e) {
    failure = e instanceof RpcError && e.code === '54000' ? S.tooMany : S.error;
  }
  busy = false;
  render();
  app.querySelector<HTMLElement>(focus === 'sent' ? '#message' : '[data-focus]')?.focus();
}

function accept() {
  readFields();
  fieldError = null;
  if (draft.name.trim().length < 2) fieldError = { field: 'name', text: S.needName };
  else if (!draft.checked) fieldError = { field: 'check', text: S.needCheck };
  if (fieldError) {
    render();
    document.getElementById(fieldError.field === 'name' ? 'acc-name' : 'acc-check')?.focus();
    return;
  }
  const version = view!.version;
  void act(() => api.respond('accept', draft.name.trim(), null, version));
}

function decline() {
  readFields();
  const version = view!.version;
  void act(() => api.respond('decline', null, draft.reason.trim() || null, version));
}

function send() {
  readFields();
  const body = draft.message.trim();
  if (!body) {
    document.getElementById('message')?.focus();
    return;
  }
  void act(() => api.message(body), 'sent');
}

// ---------------------------------------------------------------- views

function simpleCard(kicker: string, title: string, body: string, ink = true) {
  return h('section', { class: `card ${ink ? 'ink' : 'lime'}` }, h('div', { class: 'kicker' }, kicker), h('h1', {}, title), body ? h('p', {}, body) : null);
}

const vars = (v: QuoteLinkView) => ({
  band: v.band_name,
  name: (v.client_name || '').trim().split(/\s+/)[0] || '',
  ref: v.quote.ref,
  n: v.version,
});

function heroCard(v: QuoteLinkView, q: ClientQuoteSnapshot) {
  const dl = h('dl');
  const row = (label: string, value?: string | null) => value && dl.append(h('dt', {}, label), h('dd', {}, value));
  row(S.date, longDate(q.date));
  row(S.time, q.start ? `${hhmm(q.start)}${q.end ? `–${hhmm(q.end)}` : ''}` : null);
  row(S.venue, q.venue);
  row(S.city, q.city);
  row(S.guests, q.guests ? String(q.guests) : null);
  row(S.lineup, q.lineup);
  row(S.sets, q.sets);
  const name = vars(v).name;
  return h(
    'section',
    { class: 'card lime' },
    h('div', { class: 'kicker' }, `${v.band_name} · ${S.kicker}${q.ref ? ` ${q.ref}` : ''}`),
    h('h1', {}, q.title || v.band_name),
    v.status !== 'accepted' ? h('p', {}, `${name ? `${fill(S.hello, { name })} ` : ''}${fill(S.intro, vars(v))}`) : null,
    v.updated_at ? h('p', { class: 'kicker', style: 'margin-top:14px' }, fill(S.updated, { date: stampDate(v.updated_at) })) : null,
    dl.childElementCount ? h('div', { style: 'margin-top:22px' }, dl) : null,
  );
}

function quoteCard(v: QuoteLinkView, q: ClientQuoteSnapshot) {
  const list = h('ul', { class: 'items' });
  for (const it of q.items || []) {
    list.append(
      h(
        'li',
        {},
        h('div', { class: 'what' }, h('b', {}, it.label), it.detail ? h('span', {}, it.detail) : null),
        h('div', { class: 'amt' }, it.amount == null ? S.included : money(it.amount)),
      ),
    );
  }
  const totals = h('div', { class: 'totals' });
  const line = (label: string, value: Child, cls = '') => totals.append(h('div', cls ? { class: cls } : {}, h('span', {}, label), h('span', {}, value)));
  if (q.discount > 0) {
    line(S.subtotal, h('s', {}, money(q.subtotal)));
    line(S.discount, `−${money(q.discount)}`);
    line(S.net, money(q.net));
  } else {
    line(S.subtotal, money(q.subtotal));
  }
  line(q.vatLabel, money(q.vat));
  const b = balanceOf(v);
  if (b) {
    // The balance: the agreed total, what was received, what is left.
    line(b.total !== q.total ? S.agreedTotal : S.total, money(b.total), 'grand');
    for (const r of b.received) line(r.label, `−${money(r.amount)}`);
    line(S.balanceRow, money(v.balance_paid ? 0 : b.amount), 'grand');
  } else {
    line(S.total, money(q.total), 'grand');
    if (q.deposit) line(fill(S.deposit, { percent: q.deposit.percent }), money(q.deposit.amount));
    if (q.validUntil) line(S.validUntil, shortDate(q.validUntil));
  }

  const card = h('section', { class: 'card' }, h('h2', {}, S.itemsTitle), list, totals);
  if (q.discountNote) card.append(h('p', { class: 'mute', style: 'font-size:14px;line-height:20px' }, q.discountNote));
  if (q.options && q.options.length > 1) {
    const opts = h('ul', { class: 'items' });
    for (const o of q.options) {
      opts.append(h('li', {}, h('div', { class: 'what' }, h('b', {}, o.label), o.detail ? h('span', {}, o.detail) : null), h('div', { class: 'amt' }, money(o.total))));
    }
    card.append(h('div', { class: 'kicker', style: 'margin-top:22px' }, S.options), opts);
  }
  if (q.notes) card.append(h('div', { class: 'kicker', style: 'margin-top:22px' }, S.notes), h('p', { class: 'pre' }, q.notes));
  if (q.terms) card.append(h('div', { class: 'kicker', style: 'margin-top:22px' }, S.terms), h('p', { class: 'pre mute', style: 'font-size:15px;line-height:21px' }, q.terms));
  const pdf = b?.pdfUrl || v.pdf_url;
  if (b) {
    // The balance as a document of its own: the page itself, printed.
    card.append(
      h(
        'div',
        { class: 'stack no-print' },
        h('button', { class: 'btn light', type: 'button', onclick: () => window.print() }, S.savePdf, arrow()),
        pdf ? h('a', { class: 'btn light', href: pdf, target: '_blank', rel: 'noopener' }, S.pdf, arrow()) : null,
      ),
    );
    return card;
  }
  card.append(
    pdf
      ? h('div', { class: 'stack' }, h('a', { class: 'btn light', href: pdf, target: '_blank', rel: 'noopener' }, S.pdf, arrow()))
      : h('p', { class: 'mute', style: 'font-size:14px;line-height:20px' }, S.pdfPending),
  );
  return card;
}

// ---------------------------------------------------------------- balance (168)

/** The balance request, only on an accepted quote (the server already checks). */
const balanceOf = (v: QuoteLinkView): ClientBalance | null => (v.status === 'accepted' && v.balance && v.balance.amount > 0 ? v.balance : null);

/** A payment link the page may turn into a button: https only. */
const safeHref = (url?: string | null) => (url && /^https:\/\/[^\s"'<>\\]+$/i.test(url) ? url : null);

let copiedKey: string | null = null;
function copyValue(key: string, value: string) {
  const done = () => {
    copiedKey = key;
    render();
    window.setTimeout(() => {
      if (copiedKey === key) {
        copiedKey = null;
        render();
      }
    }, 2000);
  };
  try {
    void navigator.clipboard.writeText(value).then(done, () => selectValue(key));
  } catch {
    selectValue(key);
  }
}
/** No clipboard: select the value so the client can copy it by hand. */
function selectValue(key: string) {
  const el = document.querySelector<HTMLElement>(`[data-copy="${key}"]`);
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** An IBAN reads in groups of four (IT60 X054 2811…); Copy still gives the plain value. */
const groupIban = (value: string) =>
  /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(value) ? value.replace(/(.{4})(?=.)/g, '$1 ') : value;

function copyRow(dl: HTMLElement, key: string, label: string, value: string) {
  dl.append(
    h('dt', {}, label),
    h(
      'dd',
      { class: 'copy-row' },
      h('span', { 'data-copy': key }, groupIban(value)),
      h(
        'button',
        { class: 'copy no-print', type: 'button', 'aria-label': fill(S.copyLabel, { label }), onclick: () => copyValue(key, value) },
        copiedKey === key ? S.copied : S.copy,
      ),
    ),
  );
}

/**
 * A horizontal fold on screen (dual-screen phone half folded, "laptop"):
 * the app shell's regions, or the browser's Viewport Segments API.
 */
function horizontalFold(): { top: number; bottom: number } | null {
  const w = window as unknown as {
    __bwRegions?: { division?: { y: number; w: number; h: number } | null };
    viewport?: { segments?: DOMRect[] };
  };
  const d = w.__bwRegions?.division;
  if (d && d.w > d.h) return { top: d.y, bottom: d.y + d.h };
  const segs = w.viewport?.segments;
  if (segs && segs.length === 2 && segs[0].bottom <= segs[1].top) return { top: segs[0].bottom, bottom: segs[1].top };
  return null;
}

/** The balance card (or the accepted card above the deposit) reaches past the fold, so the Copy buttons and Pay start below it. */
function clearFold(hero: HTMLElement) {
  const fold = horizontalFold();
  hero.style.minHeight = '';
  if (!fold) return;
  const top = hero.getBoundingClientRect().top + window.scrollY;
  if (top < fold.top) hero.style.minHeight = `${Math.ceil(fold.bottom + 12 - top)}px`;
}

// The fold moves with the hinge (and the window): follow it without a re-render.
for (const type of ['bwregions', 'resize']) {
  window.addEventListener(type, () => {
    const hero = document.querySelector<HTMLElement>('[data-balance-hero]');
    if (hero) clearFold(hero);
  });
}

function balanceHero(v: QuoteLinkView, b: ClientBalance) {
  const name = vars(v).name;
  if (v.balance_paid) {
    return h(
      'section',
      { class: 'card ink', role: 'status' },
      h('div', { class: 'kicker' }, `${v.band_name} · ${S.balanceKicker}${v.quote.ref ? ` ${v.quote.ref}` : ''}`),
      h('h1', { 'data-focus': true, tabindex: '-1' }, S.paidTitle),
      h('p', {}, v.balance_paid_at ? fill(S.paidBody, { band: v.band_name, date: stampDate(v.balance_paid_at) }) : fill(S.paidBodyNoDate, { band: v.band_name })),
    );
  }
  return h(
    'section',
    { class: 'card lime' },
    h('div', { class: 'kicker' }, `${v.band_name} · ${S.balanceKicker}${v.quote.ref ? ` ${v.quote.ref}` : ''}`),
    h('h1', {}, S.balanceTitle),
    h('div', { class: 'big', 'data-testid': 'balance-amount' }, money(b.amount)),
    b.dueDate ? h('p', { class: 'kicker', style: 'margin-top:10px' }, fill(S.balanceDueBy, { date: shortDate(b.dueDate) })) : null,
    // The greeting on its own line, as in the emails ("Ciao Giulia," then the sentence).
    h('p', {}, ...(name ? [fill(S.hello, { name }), h('br')] : []), fill(S.balanceIntro, vars(v))),
  );
}

function payCard(v: QuoteLinkView, b: ClientBalance) {
  const card = h('section', { class: 'card' }, h('h2', {}, S.howTitle));
  if (b.note) {
    card.append(h('div', { class: 'kicker', style: 'margin-top:18px' }, fill(S.bandNote, { band: v.band_name })), h('p', { class: 'pre' }, b.note));
  }
  if (b.bank && b.bank.length) {
    const dl = h('dl', { class: 'pay' });
    b.bank.forEach((r, i) => copyRow(dl, `bank-${i}`, r.label, r.value));
    copyRow(dl, 'amount', S.balanceRow, money(b.amount));
    if (b.reference) copyRow(dl, 'ref', S.reference, b.reference);
    card.append(h('div', { class: 'kicker', style: 'margin-top:22px' }, S.bankTitle), h('div', { style: 'margin-top:12px' }, dl));
  }
  const stripe = safeHref(b.stripeUrl);
  if (stripe) {
    card.append(
      h('div', { class: 'kicker', style: 'margin-top:22px' }, S.cardTitle),
      h(
        'div',
        { class: 'stack' },
        h('a', { class: 'btn', href: stripe, target: '_blank', rel: 'noopener noreferrer' }, fill(S.payCard, { amount: money(b.amount) }), arrow()),
      ),
      h('p', { class: 'mute', style: 'font-size:14px;line-height:20px' }, fill(S.cardNote, { band: v.band_name, amount: money(b.amount) })),
    );
  }
  if (b.cash) card.append(h('div', { class: 'kicker', style: 'margin-top:22px' }, S.cashTitle), h('p', { class: 'pre' }, b.cash));
  card.append(h('p', { class: 'mute', style: 'font-size:14px;line-height:20px;margin-top:22px' }, fill(S.alreadyPaid, vars(v))));
  return card;
}

// ---------------------------------------------------------------- deposit (168)

/**
 * After the client accepted: how to pay the deposit (the band's bank details
 * with Copy buttons, its own payment link), or that it was received.
 */
function depositCard(v: QuoteLinkView, q: ClientQuoteSnapshot) {
  if (v.status !== 'accepted' || !q.deposit || !(q.deposit.amount > 0)) return null;
  const amount = money(q.deposit.amount);
  const kicker = h('div', { class: 'kicker' }, `${v.band_name} · ${S.depositKicker}${q.ref ? ` ${q.ref}` : ''}`);
  if (v.deposit_paid) {
    // 183: what the band recorded, in the gig's currency ($300 on a €500
    // deposit says $300). No amount recorded (or a server before 183): no
    // amount, never the one asked.
    const cur = v.deposit_paid_currency && /^[A-Z]{3}$/.test(v.deposit_paid_currency) ? v.deposit_paid_currency : currency;
    const got = v.deposit_paid_amount != null && v.deposit_paid_amount > 0 ? money(v.deposit_paid_amount, cur) : null;
    return h(
      'section',
      { class: 'card', role: 'status', 'data-testid': 'deposit-paid' },
      kicker,
      h('h2', { style: 'margin-top:12px' }, S.depositPaidTitle),
      h('p', {}, got ? fill(S.depositPaidBody, { ...vars(v), amount: got }) : fill(S.depositPaidBodyNoAmount, vars(v))),
    );
  }
  const pay = q.pay;
  if (!pay) return null;
  const card = h(
    'section',
    { class: 'card', 'data-testid': 'deposit-pay' },
    kicker,
    h('h2', { style: 'margin-top:12px' }, S.depositTitle),
    h('div', { class: 'big' }, amount),
    q.deposit.dueDate ? h('p', { class: 'kicker', style: 'margin-top:10px' }, fill(S.balanceDueBy, { date: shortDate(q.deposit.dueDate) })) : null,
    h('p', {}, fill(S.depositIntro, vars(v))),
  );
  if (pay.bank && pay.bank.length) {
    const dl = h('dl', { class: 'pay' });
    pay.bank.forEach((r, i) => copyRow(dl, `dep-bank-${i}`, r.label, r.value));
    copyRow(dl, 'dep-amount', S.depositRow, amount);
    if (pay.reference) copyRow(dl, 'dep-ref', S.reference, pay.reference);
    card.append(h('div', { class: 'kicker', style: 'margin-top:22px' }, S.bankTitle), h('div', { style: 'margin-top:12px' }, dl));
  }
  const stripe = safeHref(pay.stripeUrl);
  if (stripe) {
    card.append(
      h('div', { class: 'kicker', style: 'margin-top:22px' }, S.cardTitle),
      h('div', { class: 'stack' }, h('a', { class: 'btn', href: stripe, target: '_blank', rel: 'noopener noreferrer' }, fill(S.payCard, { amount }), arrow())),
      h('p', { class: 'mute', style: 'font-size:14px;line-height:20px' }, fill(S.cardNote, { band: v.band_name, amount })),
    );
  }
  card.append(h('p', { class: 'mute', style: 'font-size:14px;line-height:20px;margin-top:22px' }, fill(S.alreadyPaid, vars(v))));
  return card;
}

function statusCard(v: QuoteLinkView) {
  if (v.status === 'accepted' && v.accepted_at) {
    const at = { ...vars(v), who: v.accepted_name || '', date: stampDate(v.accepted_at), time: stampTime(v.accepted_at) };
    return h(
      'section',
      { class: 'card ink', role: 'status' },
      h('h2', { 'data-focus': true, tabindex: '-1' }, S.acceptedTitle),
      // No name: the band recorded the client's yes (by phone, in person).
      h('p', {}, fill(v.accepted_name ? S.acceptedBody : S.acceptedBodyBand, at)),
      h('p', { class: 'mute', style: 'font-size:14px;line-height:20px' }, S.acceptedLegal),
    );
  }
  if (stale) {
    // Round 4: a polite status: it arrives on a refresh, while the client may be typing.
    return h('section', { class: 'card ink', role: 'status' }, h('h2', { 'data-focus': true, tabindex: '-1' }, S.staleTitle), h('p', {}, S.staleBody));
  }
  if (v.status === 'declined') {
    return h(
      'section',
      { class: 'card', role: 'status' },
      h('h2', { 'data-focus': true, tabindex: '-1' }, S.declinedTitle),
      v.decline_reason ? h('p', { class: 'mute' }, `“${v.decline_reason}”`) : null,
      h('p', {}, fill(S.declinedBody, vars(v))),
    );
  }
  if (v.expired && v.quote.validUntil) {
    return h(
      'section',
      { class: 'card ink', role: 'status' },
      h('h2', {}, fill(S.expiredTitle, { date: shortDate(v.quote.validUntil) })),
      h('p', {}, fill(S.expiredBody, vars(v))),
    );
  }
  return null;
}

function answerCard(v: QuoteLinkView) {
  if (v.status === 'accepted' || v.expired) return null;
  const err = (field: 'name' | 'check') => (fieldError?.field === field ? h('p', { class: 'err', id: `${field}-err`, role: 'alert' }, fieldError.text) : null);
  const name = h('input', {
    id: 'acc-name',
    type: 'text',
    autocomplete: 'name',
    maxlength: '120',
    'aria-invalid': fieldError?.field === 'name' ? 'true' : 'false',
    ...(fieldError?.field === 'name' ? { 'aria-describedby': 'name-err' } : {}),
  });
  name.value = draft.name;
  const box = h('input', { id: 'acc-check', type: 'checkbox', ...(fieldError?.field === 'check' ? { 'aria-describedby': 'check-err' } : {}) });
  box.checked = draft.checked;
  const reason = h('textarea', { id: 'reason', maxlength: '1000', placeholder: S.reasonPlaceholder });
  reason.value = draft.reason;
  const disabled = busy || preview;
  return h(
    'section',
    { class: 'card' },
    h('h2', v.status === 'declined' || stale ? {} : { 'data-focus': true, tabindex: '-1' }, S.question),
    h('div', { class: 'field' }, h('label', { class: 'kicker', for: 'acc-name' }, S.nameLabel), name),
    err('name'),
    h('div', { class: 'check' }, box, h('label', { for: 'acc-check' }, fill(S.checkLabel, vars(v)))),
    err('check'),
    h('div', { class: 'stack' }, h('button', { class: 'btn', type: 'button', disabled, onclick: accept }, S.accept, arrow())),
    // 168: the deposit asked to confirm the date, named before the client accepts.
    v.quote.deposit && v.quote.deposit.amount > 0
      ? h('p', { 'data-testid': 'accept-deposit', style: 'font-size:15px;line-height:21px' }, fill(S.acceptDeposit, { ...vars(v), amount: money(v.quote.deposit.amount) }))
      : null,
    h('p', { class: 'mute', style: 'font-size:14px;line-height:20px' }, fill(S.acceptNote, vars(v))),
    v.status !== 'declined'
      ? h(
          'details',
          {},
          h('summary', {}, S.declineOpen),
          h('div', { class: 'field' }, h('label', { class: 'kicker', for: 'reason' }, S.reasonLabel), reason),
          h('div', { class: 'stack' }, h('button', { class: 'btn light', type: 'button', disabled, onclick: decline }, S.decline, arrow())),
        )
      : null,
  );
}

function chatCard(v: QuoteLinkView) {
  const thread = h('div', { class: 'thread', role: 'log', 'aria-live': 'polite' });
  for (const m of v.messages || []) {
    thread.append(h('div', { class: `msg ${m.from}` }, m.body, h('small', {}, `${m.from === 'client' ? S.you : v.band_name} · ${stamp(m.at)}`)));
  }
  const box = h('textarea', { id: 'message', maxlength: '2000', placeholder: S.messagePlaceholder });
  box.value = draft.message;
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, S.chatTitle),
    h('p', { class: 'mute' }, fill(S.chatBody, vars(v))),
    v.messages?.length ? thread : null,
    h('div', { class: 'field' }, h('label', { class: 'kicker', for: 'message' }, S.messageLabel), box),
    h('div', { class: 'stack' }, h('button', { class: 'btn lime', type: 'button', disabled: busy || preview, onclick: send }, S.send, arrow())),
  );
}

function render() {
  app.replaceChildren();
  if (offline) {
    const card = simpleCard('BandWith', S.offlineTitle, S.offlineBody);
    card.append(h('div', { class: 'stack' }, h('button', { class: 'btn light', type: 'button', onclick: () => void load() }, S.retry, arrow())));
    app.append(card);
    return;
  }
  if (!view?.quote) {
    app.append(simpleCard('BandWith', S.invalidTitle, S.invalidBody));
    return;
  }
  const v = view;
  if (preview) app.append(h('p', { class: 'note', role: 'note' }, S.preview));
  const b = balanceOf(v);
  if (b) {
    // 168: the balance first, then how to pay, then the same quote.
    const hero = balanceHero(v, b);
    hero.setAttribute('data-balance-hero', '');
    app.append(hero);
    if (!v.balance_paid) app.append(payCard(v, b));
    clearFold(hero);
  } else {
    const status = statusCard(v);
    if (status) app.append(status);
    const deposit = depositCard(v, v.quote);
    if (deposit) {
      // As the balance: the card above reaches past a fold, so Copy and Pay sit below it.
      if (status) status.setAttribute('data-balance-hero', '');
      app.append(deposit);
      if (status) clearFold(status);
    }
  }
  app.append(heroCard(v, v.quote), quoteCard(v, v.quote));
  const answer = answerCard(v);
  if (answer) app.append(answer);
  if (failure) app.append(h('p', { class: 'note err', role: 'alert' }, failure));
  app.append(chatCard(v));
  // 163: on a plan without branding, the mark links to BandWith (paid plans §4.3).
  app.append(
    v.made_with
      ? h('p', { class: 'note', 'data-testid': 'made-with' }, h('a', { href: 'https://bandwith.fun', target: '_blank', rel: 'noopener' }, S.madeWith))
      : h('p', { class: 'note' }, 'BandWith'),
  );
}

// New band replies while the page stays open.
let polling = false;
function poll() {
  window.setInterval(async () => {
    if (document.hidden || busy || !view) return;
    try {
      const next = await api.view();
      // A new version counts too, with or without a message (183).
      const changed = (a: QuoteLinkView, b: QuoteLinkView) =>
        JSON.stringify([a.version, a.messages, a.balance, a.balance_paid, a.deposit_paid, a.deposit_paid_amount, a.deposit_paid_currency]) !==
        JSON.stringify([b.version, b.messages, b.balance, b.balance_paid, b.deposit_paid, b.deposit_paid_amount, b.deposit_paid_currency]);
      if (next && changed(next, view)) {
        readFields();
        // Round 4: the field the client is typing in stays focused, caret and all.
        const mark = rememberFocus();
        applyView(next, true);
        render();
        restoreFocus(mark);
      }
    } catch {
      /* try again next time */
    }
  }, 30_000);
}

async function load() {
  if (import.meta.env.DEV && token === 'demo') {
    api = (await import('./quote/demo')).demoQuoteApi(params.get('state') ?? '');
  } else if (!/^[0-9a-f]{64}$/.test(token) || !SUPABASE_URL || !PUBLISHABLE_KEY) {
    render();
    return;
  }
  app.replaceChildren(simpleCard('BandWith', S.loading, '', false));
  offline = false;
  let next: QuoteLinkView | null = null;
  try {
    next = await (preview ? api.view() : api.seen());
  } catch {
    offline = true;
  }
  // NULL: an unknown, replaced or turned-off link.
  if (next) applyView(next);
  else view = null;
  const kicker = view && balanceOf(view) ? S.balanceKicker : S.kicker;
  document.title = view?.quote ? `${kicker} ${view.quote.ref} · ${view.band_name}` : `${S.kicker} · BandWith`;
  render();
  if (view && !polling) {
    polling = true;
    poll();
  }
}

void load();
