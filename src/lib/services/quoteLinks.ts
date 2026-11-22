/**
 * The client's quote link (migration 099): the admin sends a personal link
 * to /quote.html where the client accepts, declines or discusses the quote
 * without an account.
 *
 * The page shows a client summary the app publishes here
 * (bw_quote_link_publish), built from the same numbers and labels as the
 * PDF and already in the client's language. Editing a sent quote publishes
 * a new version: the same link then shows the latest one.
 */
import { supabase } from '@/lib/supabase';
import { APP_URL } from '@/lib/appUrl';
import { parseLocalDate } from '@/lib/dates';
import { builtinText } from '@/lib/i18n/builtins';
import { planRefusal } from '@/lib/userError';
import { intlLocale, translate, LANGUAGES, loadLocale, type Locale, type TranslateVars } from '@/lib/i18n';
import { formatDistance } from '@/lib/units';
import {
  calculateDepositAmount,
  DEFAULT_SET_MINUTES,
  DEFAULT_SETS,
  DEFAULT_VAT_RATE,
  formatQuoteMoney,
  quoteDepositPercent,
  totalsForQuote,
} from '@/lib/services/quoteMath';
import { currencySymbol } from '@/lib/currency';
import { getEventTypeLabel, type Quote } from '@/app/data/quotes';
import type { ClientBalance, ClientQuoteItem, ClientQuotePay, ClientQuoteSnapshot, QuoteLinkStatus } from '@/quote/types';
import { bankDetailRows, hasBankAccount, type BandPricingSettings } from '@/lib/services/pricing';
import { safePaymentUrl } from '@/lib/quoteBalance';
import { fetchBandPlan } from '@/lib/usePlan';
import { madeWithMark } from '@/lib/planText';

export type { ClientQuoteSnapshot, QuoteLinkStatus } from '@/quote/types';

export type QuoteMessageKind = 'sent' | 'reminder' | 'updated';
export type QuoteChannel = 'whatsapp' | 'sms' | 'email' | 'copy' | 'share';

export interface QuoteLinkRow {
  /** 183: a new recipient gets a new link (another id and token). */
  id?: string;
  quote_id: string;
  token: string;
  lang: Locale;
  status: QuoteLinkStatus;
  version: number;
  version_at: string | null;
  pdf_url: string | null;
  pdf_version: number | null;
  sent_at: string | null;
  first_viewed_at: string | null;
  responded_at: string | null;
  accepted_name: string | null;
  accepted_version: number | null;
  decline_reason: string | null;
  revoked_at: string | null;
  /** 168: the balance request on the client's page (null before 168 or before any). */
  balance?: ClientBalance | null;
  balance_version?: number | null;
  balance_at?: string | null;
  balance_sent_at?: string | null;
  balance_paid_at?: string | null;
}

export type QuoteActivityKind =
  | 'sent'
  | 'resent'
  | 'reminded'
  | 'viewed'
  | 'updated'
  | 'client_message'
  | 'band_reply'
  | 'accepted'
  | 'declined'
  | 'link_rotated'
  | 'link_revoked'
  | 'balance_requested'
  | 'balance_updated'
  | 'balance_reminded'
  | 'balance_paid'
  | 'balance_reopened'
  | 'deposit_received'
  | 'deposit_reopened';

export interface QuoteActivity {
  id: string;
  kind: QuoteActivityKind;
  body: string | null;
  channel: QuoteChannel | null;
  version: number | null;
  created_at: string;
  /** 183: the link the row belongs to (a conversation line stays on its client's link). */
  link_id?: string | null;
}

type Result<T> = { data: T | null; error: Error | null };

const asError = (e: unknown): Error => planRefusal(e) ?? (e instanceof Error ? e : new Error(String((e as { message?: string })?.message ?? e)));

const isLocale = (v: unknown): v is Locale => LANGUAGES.some((l) => l.id === v);

/** The client's page. `preview` opens it without counting as "viewed". */
export const quoteLinkUrl = (token: string, opts: { preview?: boolean } = {}) =>
  `${APP_URL}/quote.html?t=${token}${opts.preview ? '&preview=1' : ''}`;

// ------------------------------------------------------------------ summary

type SnapshotDefaults = {
  default_vat_rate?: number | null;
  default_deposit_rate?: number | null;
  core_members_count?: number | null;
} & Partial<Omit<BandPricingSettings, 'default_vat_rate' | 'default_deposit_rate' | 'core_members_count'>>;

/**
 * 168: how to pay the deposit, for the page once the client accepted: the
 * bank details the PDF prints (unless the quote hides them) and the band's
 * own payment link. Null when there is nothing to show.
 */
export function clientDepositPay(
  quote: Partial<Quote>,
  lang: Locale,
  settings: Partial<Omit<BandPricingSettings, 'default_vat_rate' | 'default_deposit_rate' | 'core_members_count'>>,
): ClientQuotePay | null {
  const bank = quote.showBankDetailsOnPdf !== false && hasBankAccount(settings) ? bankDetailRows(settings, lang) : null;
  const stripeUrl = safePaymentUrl(settings.stripe_payment_link);
  if (!bank?.length && !stripeUrl) return null;
  const ref = quote.quoteNumber || '';
  return {
    bank: bank?.length ? bank : null,
    stripeUrl,
    reference: ref ? translate(lang, '{ref} · Deposit', { ref }) : translate(lang, 'Deposit'),
  };
}

const stripColon = (s: string) => s.replace(/\s*:\s*$/, '');
/** "( Pro Production )" → "Pro Production" (the PDF's column style). */
const unwrap = (s: string) => s.replace(/^\(\s*|\s*\)$/g, '');
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const clean = (v: unknown, max = 400) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, max) : null;
};

/**
 * The rows of the quote as the PDF lists them (band fee, production,
 * moments, extras, travel, accommodation, meals), in `lang`. `amount: null`
 * is "Included".
 */
export function clientQuoteItems(quote: Partial<Quote>, lang: Locale, defaults: SnapshotDefaults = {}): ClientQuoteItem[] {
  const tr = (s: string, vars?: TranslateVars) => translate(lang, s, vars);
  const musicians = quote.musicians || [];
  const count = musicians.length > 0 ? musicians.length : quote.musicianCount || defaults.core_members_count || 6;
  const mainFee = quote.baseFee && quote.baseFee > 0 ? quote.baseFee : quote.subtotal || 0;

  const items: ClientQuoteItem[] = [];
  items.push({
    label: tr('MAIN BAND'),
    detail: tr('{count}pc band', { count }),
    amount: mainFee,
  });

  const prodTier = (quote as { productionTier?: string }).productionTier || 'standard';
  if (prodTier !== 'none' && (quote.soundIncluded !== false || (quote.soundFee || 0) > 0 || (quote.lightsFee || 0) > 0)) {
    const included = quote.soundIncluded !== false && !quote.soundFee;
    items.push({
      label: tr('MUSICAL PRODUCTION'),
      detail: unwrap(prodTier === 'pro' ? tr('( Pro Production )') : prodTier === 'custom' ? tr('( Custom )') : tr('( Standard )')),
      amount: included ? null : (quote.soundFee || 0) + (quote.lightsFee || 0),
    });
  }
  for (const m of quote.selectedMoments || []) {
    items.push({
      label: builtinText(m.name, lang).toUpperCase(),
      detail: tr('{count}pc ({minutes}m)', { count: m.musicians, minutes: m.duration }),
      amount: m.included || m.price === 0 ? null : n(m.price),
    });
  }
  for (const c of quote.customItems || []) {
    const ci = c as { name?: string; description?: string; price?: number; amount?: number; quantity?: number };
    const price = n(ci.price ?? ci.amount) * (ci.quantity || 1);
    items.push({
      label: (builtinText(ci.name || ci.description, lang) || tr('EXTRA SERVICE')).toUpperCase(),
      detail: ci.quantity && ci.quantity > 1 ? `× ${ci.quantity}` : null,
      amount: price > 0 ? price : null,
    });
  }
  if (!quote.travelIncluded && (quote.travelFee || 0) > 0) {
    items.push({
      label: tr('TRAVEL & LOGISTICS'),
      detail: quote.travelDistanceKm
        ? tr('{distance} round trip', { distance: formatDistance(quote.travelDistanceKm * 2) })
        : tr('Transport & mileage'),
      amount: quote.travelFee || 0,
    });
  }
  if (quote.accommodationNeeded && (quote.accommodationFee || 0) > 0) {
    items.push({ label: tr('ACCOMMODATION'), detail: tr('Hotel & lodging'), amount: quote.accommodationFee || 0 });
  }
  if (quote.mealsIncluded === false && (quote.mealsFee || 0) > 0) {
    items.push({ label: tr('CATERING / MEALS'), detail: tr('{count} persons', { count }), amount: quote.mealsFee || 0 });
  }

  return items;
}

/**
 * What the client sees: the rows, totals and deposit of the PDF
 * (src/lib/services/quotePdf.ts), in `lang`. Nothing internal: no
 * musician names or fees, no internal notes.
 */
/** FNV-1a, 32 bits: a short key, not a secret. */
const contentHash = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16).padStart(8, '0')}${text.length.toString(16)}`;
};

/**
 * What the client sees, in their language. `contentKey` (round 4): the same
 * quote in any language has the same key, so the server keeps the version
 * (and the client's "I accept") when only the language changed.
 */
export function buildClientQuoteSnapshot(quote: Partial<Quote>, lang: Locale, defaults: SnapshotDefaults = {}): ClientQuoteSnapshot {
  return { ...snapshotIn(quote, lang, defaults), contentKey: contentHash(JSON.stringify(snapshotIn(quote, 'en', defaults))) };
}

function snapshotIn(quote: Partial<Quote>, lang: Locale, defaults: SnapshotDefaults): ClientQuoteSnapshot {
  const tr = (s: string, vars?: TranslateVars) => translate(lang, s, vars);
  const currency = (quote.currency || 'EUR').toUpperCase();
  const sym = currencySymbol(currency);
  const money = (v: number) => formatQuoteMoney(v, sym, intlLocale('en-US', lang));

  const musicians = quote.musicians || [];
  const count = musicians.length > 0 ? musicians.length : quote.musicianCount || defaults.core_members_count || 6;
  // The PDF's defaults when the quote has no sets.
  const numSets = quote.numberOfSets || DEFAULT_SETS;
  const setDur = quote.setDuration || DEFAULT_SET_MINUTES;
  const mainFee = quote.baseFee && quote.baseFee > 0 ? quote.baseFee : quote.subtotal || 0;
  const items = clientQuoteItems(quote, lang, defaults);

  const vatRate = quote.vatRate ?? defaults.default_vat_rate ?? DEFAULT_VAT_RATE;
  const totals = totalsForQuote(
    {
      subtotal: quote.subtotal,
      lineItems: quote.lineItems,
      discountType: quote.discountType,
      discountValue: quote.discountValue,
      discountAmount: quote.discountAmount,
      vatRate,
      vatExempt: quote.vatExempt,
      reverseCharge: quote.reverseCharge,
    },
    { subtotal: mainFee },
  );
  const discountPct =
    quote.discountType === 'percentage'
      ? Math.min(100, Math.max(0, quote.discountValue || 0))
      : totals.subtotal > 0 && totals.discount > 0
        ? Math.round((totals.discount / totals.subtotal) * 100)
        : 0;
  const depositPct = quoteDepositPercent(quote, defaults.default_deposit_rate);
  const pay = depositPct > 0 ? clientDepositPay(quote, lang, defaults) : null;

  const options = (quote.includeProposalSummary ? quote.quoteOptions || [] : [])
    .filter((o) => o && Number.isFinite(Number(o.totalWithVat)))
    .slice(0, 6)
    .map((o) => ({
      label: builtinText(o.name || o.label, lang) || o.lineupLabel || '',
      detail: o.lineupLabel || null,
      total: n(o.totalWithVat),
    }));

  return {
    v: 1,
    ref: quote.quoteNumber || '',
    title: (quote.eventName || quote.eventTitle || tr(getEventTypeLabel(quote.eventType))).slice(0, 160),
    eventType: quote.eventType ? tr(getEventTypeLabel(quote.eventType)) : null,
    date: quote.eventDate || null,
    start: quote.eventTimeStart ? quote.eventTimeStart.slice(0, 5) : null,
    end: quote.eventTimeEnd ? quote.eventTimeEnd.slice(0, 5) : null,
    venue: clean(quote.venueName, 160),
    city: clean(quote.venueCity, 120),
    guests: quote.guestCount || null,
    lineup: tr('{count} musicians', { count }),
    sets:
      numSets > 0 && setDur > 0
        ? unwrap(
            numSets === 1
              ? tr('(Includes 1 set of {minutes} minutes or equivalent)', { minutes: setDur })
              : tr('(Includes {count} sets of {minutes} minutes or equivalent)', { count: numSets, minutes: setDur }),
          )
        : null,
    items,
    currency,
    subtotal: totals.subtotal,
    discount: totals.discount,
    discountNote:
      totals.discount > 0
        ? tr('Package Discount Applied ({amount})', { amount: discountPct > 0 ? `${discountPct}%` : money(totals.discount) })
        : null,
    net: totals.net,
    vatLabel: stripColon(
      quote.vatExempt ? tr('VAT (Exempt):') : quote.reverseCharge ? tr('VAT (Reverse Charge 0%):') : tr('VAT {rate}%:', { rate: vatRate }),
    ),
    vat: totals.vat,
    total: totals.total,
    totalLabel: money(totals.total),
    deposit: depositPct > 0 ? { percent: depositPct, amount: calculateDepositAmount(totals.total, depositPct), ...(/^\d{4}-\d{2}-\d{2}$/.test(quote.depositDueDate || '') ? { dueDate: quote.depositDueDate } : {}) } : null,
    ...(pay ? { pay } : {}),
    validUntil: quote.validUntil || null,
    notes: clean(quote.clientNotes, 1500),
    terms: clean(quote.specialTerms || quote.cancellationTerms, 2000),
    ...(options.length > 1 ? { options } : {}),
  };
}

// ------------------------------------------------------------------ message

/** The text that goes with the link (WhatsApp, SMS, copy), in the client's language. */
export function clientLinkMessage(
  quote: Partial<Quote>,
  opts: { bandName: string; url: string; lang: Locale; kind: QuoteMessageKind; total: string; signer?: string | null },
): string {
  const tr = (s: string, vars?: TranslateVars) => translate(opts.lang, s, vars);
  const event = quote.eventName || quote.eventTitle || tr(getEventTypeLabel(quote.eventType));
  const date = quote.eventDate
    ? parseLocalDate(quote.eventDate).toLocaleDateString(intlLocale('en-GB', opts.lang), { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const what = date ? `"${event}" · ${date}` : `"${event}"`;
  const first = (quote.clientName || '').trim().split(/\s+/)[0];
  const lead =
    opts.kind === 'reminder'
      ? tr('Just a reminder: your quote from {band} for {event} is waiting for your answer.', { band: opts.bandName, event: what })
      : opts.kind === 'updated'
        ? tr('{band} updated your quote for {event}. New total: {total}.', { band: opts.bandName, event: what, total: opts.total })
        : tr('{band} sent you a quote for {event}: {total}.', { band: opts.bandName, event: what, total: opts.total });
  return [
    first ? tr('Hi {name},', { name: first }) : tr('Hi there,'),
    '',
    lead,
    tr('Open it here to accept it, decline it or ask a question:'),
    opts.url,
    '',
    tr('Best regards,'),
    opts.signer || opts.bandName,
  ].join('\n');
}

// ------------------------------------------------------------------ RPCs

/**
 * 183: the link was replaced (the client changed, or "New link") after the
 * caller read its token, so the publish wrote nothing.
 */
export const isLinkChangedError = (e: unknown): boolean =>
  /BW_LINK_CHANGED/.test(String((e as { message?: string } | null)?.message ?? ''));

/** 183: another version was published after this one went out, so the send was not recorded. */
export const isVersionChangedError = (e: unknown): boolean =>
  /BW_VERSION_CHANGED/.test(String((e as { message?: string } | null)?.message ?? ''));

/** A database before 183 has not the new optional parameter: call again without it. */
const missingParam = (error: unknown) => (error as { code?: string } | null)?.code === 'PGRST202';

/**
 * Publish what the client sees. `token`: the link the caller read; when it
 * has been replaced since, nothing is written and the error says so
 * (isLinkChangedError), so a publish started for the old client never lands
 * on the new client's link. Without a token (no link yet) as before.
 */
export async function publishQuoteLink(
  quoteId: string,
  snapshot: ClientQuoteSnapshot,
  lang: Locale,
  pdfUrl?: string | null,
  token?: string | null,
  /** Round 4: the version the screen shows; another one published since: refused (isVersionChangedError). */
  version?: number | null,
): Promise<Result<{ token: string; status: QuoteLinkStatus; version: number; revoked: boolean }>> {
  const args = { p_quote_id: quoteId, p_snapshot: snapshot, p_lang: lang, p_pdf_url: pdfUrl || null };
  const extra = { ...(token ? { p_token: token } : {}), ...(typeof version === 'number' ? { p_version: version } : {}) };
  let { data, error } = await supabase.rpc('bw_quote_link_publish', { ...args, ...extra });
  // A database before 183 has no p_token / p_version: publish as before.
  if (error && Object.keys(extra).length && missingParam(error)) {
    ({ data, error } = await supabase.rpc('bw_quote_link_publish', args));
  }
  if (error) return { data: null, error: asError(error) };
  const row = (Array.isArray(data) ? data[0] : data) as { token: string; status: QuoteLinkStatus; version: number; revoked: boolean } | null;
  return row?.token ? { data: row, error: null } : { data: null, error: new Error('No link') };
}

/**
 * Record a send. `sent`: the link (token) and the version that went out
 * (183): when the link was replaced since, or another version published,
 * nothing is recorded and the error says so (isLinkChangedError,
 * isVersionChangedError).
 */
export async function markQuoteLinkSent(
  quoteId: string,
  kind: 'sent' | 'reminded',
  channel: QuoteChannel,
  sent?: { token?: string | null; version?: number | null },
): Promise<Result<QuoteLinkStatus>> {
  const args = { p_quote_id: quoteId, p_kind: kind, p_channel: channel };
  const extra = {
    ...(sent?.token ? { p_token: sent.token } : {}),
    ...(typeof sent?.version === 'number' ? { p_version: sent.version } : {}),
  };
  let { data, error } = await supabase.rpc('bw_quote_link_mark_sent', { ...args, ...extra });
  if (error && Object.keys(extra).length && missingParam(error)) ({ data, error } = await supabase.rpc('bw_quote_link_mark_sent', args));
  return error ? { data: null, error: asError(error) } : { data: data as QuoteLinkStatus, error: null };
}

/**
 * The band's reply, on the link of the conversation it was written in
 * (`token`, 183): when that link was replaced since (the quote went to
 * another client) nothing is written and the error says so (isLinkChangedError).
 */
export async function replyToQuoteClient(quoteId: string, body: string, token?: string | null): Promise<Result<string>> {
  const args = { p_quote_id: quoteId, p_body: body };
  let { data, error } = await supabase.rpc('bw_quote_reply', token ? { ...args, p_token: token } : args);
  if (error && token && missingParam(error)) ({ data, error } = await supabase.rpc('bw_quote_reply', args));
  return error ? { data: null, error: asError(error) } : { data: String(data), error: null };
}

export async function rotateQuoteLink(quoteId: string): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('bw_quote_link_rotate', { p_quote_id: quoteId });
  return error ? { data: null, error: asError(error) } : { data: String(data), error: null };
}

export async function revokeQuoteLink(quoteId: string): Promise<Result<boolean>> {
  const { data, error } = await supabase.rpc('bw_quote_link_revoke', { p_quote_id: quoteId });
  return error ? { data: null, error: asError(error) } : { data: Boolean(data), error: null };
}

const LINK_COLUMNS =
  'id, quote_id, token, lang, status, version, version_at, pdf_url, pdf_version, sent_at, first_viewed_at, responded_at, accepted_name, accepted_version, decline_reason, revoked_at';
// 168: read separately, so the quote detail keeps working before 168 is applied.
const BALANCE_COLUMNS = 'balance, balance_version, balance_at, balance_sent_at, balance_paid_at';

export interface QuoteContact {
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  /** Round 4: the price saved now (a sheet opened on an older copy publishes nothing). */
  total?: number | string | null;
  currency?: string | null;
}

/** 183: who the quote is for, as saved now (the share sheet never sends from an older copy). */
export async function getQuoteContact(quoteId: string): Promise<Result<QuoteContact | null>> {
  const { data, error } = await supabase
    .from('quotes')
    .select('client_name, client_email, client_phone, total, currency')
    .eq('id', quoteId)
    .maybeSingle();
  return error ? { data: null, error: asError(error) } : { data: (data as QuoteContact | null) ?? null, error: null };
}

const contactKey = (name?: string | null, email?: string | null, phone?: string | null) =>
  [
    (name || '').trim().replace(/\s+/g, ' ').toLowerCase(),
    (email || '').trim().toLowerCase(),
    (phone || '').replace(/[^0-9+]/g, ''),
  ].join('|');

/**
 * 183: the quote a screen holds is for the client saved now. The wizard
 * saves an empty name as "Client".
 */
export const sameQuoteContact = (saved: QuoteContact, quote: Partial<Pick<Quote, 'clientName' | 'clientEmail' | 'clientPhone'>>) =>
  contactKey(saved.client_name === 'Client' && !quote.clientName ? '' : saved.client_name, saved.client_email, saved.client_phone) ===
  contactKey(quote.clientName, quote.clientEmail, quote.clientPhone);

/**
 * Round 4: and its price as saved now (total and currency, when both sides
 * have them): another admin's edit since this copy was made is never
 * published from it.
 */
export const sameQuoteTerms = (
  saved: QuoteContact,
  quote: Partial<Pick<Quote, 'clientName' | 'clientEmail' | 'clientPhone' | 'total' | 'currency'>>,
) => {
  if (!sameQuoteContact(saved, quote)) return false;
  const cents = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
  const [a, b] = [cents(saved.total), cents(quote.total)];
  if (a !== null && b !== null && a !== b) return false;
  const [x, y] = [(saved.currency || '').trim().toUpperCase(), (quote.currency || '').trim().toUpperCase()];
  return !x || !y || x === y;
};

/** The link (if any) and the timeline of a quote. Admins only (RLS). */
export async function getQuoteLinkState(quoteId: string): Promise<Result<{ link: QuoteLinkRow | null; activity: QuoteActivity[] }>> {
  const activityOf = (columns: string) =>
    supabase.from('quote_activity').select(columns).eq('quote_id', quoteId).order('created_at', { ascending: true });
  const [first, firstActivity] = await Promise.all([
    supabase.from('quote_links').select(`${LINK_COLUMNS}, ${BALANCE_COLUMNS}`).eq('quote_id', quoteId).maybeSingle(),
    activityOf('id, kind, body, channel, version, created_at, link_id'),
  ]);
  // Before 183 the timeline has no link_id: read it without.
  const activity = firstActivity.error && /link_id/.test(firstActivity.error.message || '')
    ? await activityOf('id, kind, body, channel, version, created_at')
    : firstActivity;
  // Before 168 the balance columns don't exist: read the link without them.
  const link = first.error && /balance/.test(first.error.message || '')
    ? await supabase.from('quote_links').select(LINK_COLUMNS).eq('quote_id', quoteId).maybeSingle()
    : first;
  if (link.error) return { data: null, error: asError(link.error) };
  if (activity.error) return { data: null, error: asError(activity.error) };
  const row = link.data as QuoteLinkRow | null;
  return {
    data: {
      link: row ? { ...row, lang: isLocale(row.lang) ? row.lang : 'en' } : null,
      activity: (activity.data || []) as unknown as QuoteActivity[],
    },
    error: null,
  };
}

/**
 * Email the client through send-email (server: recipient, link, language
 * and PDF come from the quote). `code` is 'email_not_configured' when the
 * server can't send mail, 'no_email' when the quote has no address.
 */
export async function sendQuoteEmail(
  quoteId: string,
  kind: QuoteMessageKind | 'reply',
  /** Round 4: the link the email is for; replaced since (another client): nothing is sent (code link_changed). */
  linkId?: string | null,
): Promise<{ ok: boolean; code?: string; error?: Error }> {
  const link = linkId ? { linkId } : {};
  const { data, error } = await supabase.functions.invoke('send-email', {
    body: kind === 'reply' ? { type: 'quote_reply', data: { quoteId, ...link } } : { type: 'quote_link', data: { quoteId, kind, ...link } },
  });
  if (error) {
    let code: string | undefined;
    try {
      const ctx = (error as { context?: Response }).context;
      const body = ctx && typeof ctx.json === 'function' ? await ctx.clone().json() : null;
      code = body?.code;
    } catch {
      /* no body */
    }
    return { ok: false, code, error: asError(error) };
  }
  return { ok: (data as { success?: boolean })?.success !== false };
}

// ------------------------------------------------------------------ balance (168)

/** Publish (or change) the balance on the client's page. */
export async function publishQuoteBalance(
  quoteId: string,
  balance: ClientBalance,
): Promise<Result<{ token: string; balance_version: number; changed: boolean }>> {
  const { data, error } = await supabase.rpc('bw_quote_balance_publish', { p_quote_id: quoteId, p_balance: balance });
  if (error) return { data: null, error: asError(error) };
  const row = data as { token?: string; balance_version?: number; changed?: boolean } | null;
  return row?.token
    ? { data: { token: row.token, balance_version: Number(row.balance_version) || 1, changed: !!row.changed }, error: null }
    : { data: null, error: new Error('No link') };
}

export async function markQuoteBalanceSent(quoteId: string, kind: 'sent' | 'reminded', channel: QuoteChannel): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('bw_quote_balance_mark_sent', { p_quote_id: quoteId, p_kind: kind, p_channel: channel });
  return error ? { data: null, error: asError(error) } : { data: String(data), error: null };
}

/** The balance was received (or not after all): the gig made from the quote follows. */
export async function markQuoteBalancePaid(quoteId: string, paid: boolean): Promise<Result<{ paid: boolean; event_id: string | null }>> {
  const { data, error } = await supabase.rpc('bw_quote_balance_mark_paid', { p_quote_id: quoteId, p_paid: paid });
  if (error) return { data: null, error: asError(error) };
  const row = (data || {}) as { paid?: boolean; event_id?: string | null };
  return { data: { paid: !!row.paid, event_id: row.event_id ?? null }, error: null };
}

/**
 * The gig of an accepted quote, as the balance needs it: status, currency
 * and date (public columns) with the fee, deposit and payment status from
 * bw_event_private (078: admins only).
 */
export interface BalanceGigRow {
  id: string;
  status: string | null;
  currency: string | null;
  event_date: string | null;
  fee: number | null;
  deposit_amount: number | null;
  deposit_paid: boolean;
  payment_status: string | null;
}

export async function getBalanceGig(quoteId: string, eventId?: string | null): Promise<Result<BalanceGigRow | null>> {
  let id = eventId || null;
  if (!id) {
    const { data: q } = await supabase.from('quotes').select('converted_to_event_id').eq('id', quoteId).maybeSingle();
    id = (q as { converted_to_event_id?: string | null } | null)?.converted_to_event_id || null;
  }
  if (!id) {
    const { data: rows } = await supabase.from('events').select('id').eq('quote_id', quoteId).order('created_at', { ascending: true }).limit(1);
    id = (Array.isArray(rows) && (rows[0] as { id?: string } | undefined)?.id) || null;
  }
  if (!id) return { data: null, error: null };
  const [{ data: ev, error }, { getEventPrivate }] = await Promise.all([
    supabase.from('events').select('id, status, currency, event_date').eq('id', id).maybeSingle(),
    import('@/lib/services/eventPrivate'),
  ]);
  if (error) return { data: null, error: asError(error) };
  if (!ev) return { data: null, error: null };
  const priv = (await getEventPrivate([id])).data[0]?.private ?? {};
  const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
  const e = ev as { id: string; status?: string | null; currency?: string | null; event_date?: string | null };
  return {
    data: {
      id: e.id,
      status: e.status ?? null,
      currency: e.currency ?? null,
      event_date: e.event_date ?? null,
      fee: num(priv.fee ?? priv.price),
      deposit_amount: num(priv.deposit_amount),
      deposit_paid: !!priv.deposit_paid,
      payment_status: (priv.payment_status as string | null) ?? null,
    },
    error: null,
  };
}

/**
 * Email the balance request through send-email (server: recipient,
 * language, link and amount come from the database). Codes as
 * sendQuoteEmail, plus 'no_balance'.
 */
export async function sendQuoteBalanceEmail(
  quoteId: string,
  kind: 'sent' | 'updated' | 'reminder',
  /** Round 4: the balance version the screen shows; another one on the page now: nothing is sent (code balance_changed). */
  balanceVersion?: number | null,
) {
  const seen = typeof balanceVersion === 'number' ? { balanceVersion } : {};
  const { data, error } = await supabase.functions.invoke('send-email', { body: { type: 'quote_balance', data: { quoteId, kind, ...seen } } });
  if (error) {
    let code: string | undefined;
    try {
      const ctx = (error as { context?: Response }).context;
      const body = ctx && typeof ctx.json === 'function' ? await ctx.clone().json() : null;
      code = body?.code;
    } catch {
      /* no body */
    }
    return { ok: false, code, error: asError(error) };
  }
  return { ok: (data as { success?: boolean })?.success !== false };
}

// ------------------------------------------------------------------ status

/** The quote's place in the confirmation flow, from its link and status. */
export type ClientQuoteStage = 'draft' | 'sent' | 'viewed' | 'discussing' | 'accepted' | 'declined';

export const QUOTE_STAGE_ORDER: ClientQuoteStage[] = ['sent', 'viewed', 'discussing', 'accepted'];

// ------------------------------------------------------------------ after an edit

/**
 * 183: the band changed the client of a sent quote, so the server gave the
 * link a new token (the old client's link stopped working) and put it back
 * to draft. True until the quote is sent to the new client.
 */
/**
 * 183: when the quote was last given to another client (the latest
 * "recipient_changed" new link). The band's conversation labels client
 * messages written before it as the previous client's, not the current one's.
 */
export const recipientChangedAt = (activity: QuoteActivity[]): string | null =>
  activity.reduce<string | null>(
    (at, a) => (a.kind === 'link_rotated' && a.body === 'recipient_changed' && (!at || a.created_at > at) ? a.created_at : at),
    null,
  );

export const awaitingNewRecipient = (link: Pick<QuoteLinkRow, 'status'> | null | undefined, activity: QuoteActivity[]) =>
  !!link && link.status === 'draft' && activity.some((a) => a.kind === 'link_rotated' && a.body === 'recipient_changed');

/**
 * A sent quote was edited: publish the new version on the client's page,
 * with its PDF, in the language the client already got. Returns the new
 * version, or null when the quote has no sent link (nothing to do) or the
 * client already answered. `newRecipient`: the client changed (183), the
 * quote waits to be sent to the new one.
 */
export async function republishClientQuote(
  quote: Quote,
  bandId: string,
  bandName: string,
): Promise<Result<number> & { newRecipient?: boolean }> {
  const state = await getQuoteLinkState(quote.id);
  if (state.error) return { data: null, error: state.error };
  const link = state.data?.link;
  if (awaitingNewRecipient(link, state.data?.activity ?? [])) return { data: null, error: null, newRecipient: true };
  if (!link || link.status === 'draft' || link.status === 'accepted') return { data: null, error: null };
  try {
    const [{ getBandPricing }, { generateQuotePdf, uploadQuotePdfForSharing }] = await Promise.all([
      import('@/lib/services/pricing'),
      import('@/lib/services/quotePdf'),
    ]);
    const settings = await getBandPricing(bandId);
    // The client's language (the snapshot below), maybe not the app's.
    await loadLocale(link.lang);
    let pdfUrl: string | null = null;
    try {
      const plan = await fetchBandPlan(bandId).catch(() => null);
      const pdf = await generateQuotePdf(quote, bandName, settings, link.lang, { madeWith: madeWithMark(plan) });
      pdfUrl = await uploadQuotePdfForSharing(bandId, quote.quoteNumber || 'DRAFT', pdf.pdfBlob, pdf.fileName);
    } catch (e) {
      console.warn('[quoteLinks] PDF of the new version not created:', e);
    }
    // The link read above: if it is replaced meanwhile (new client), nothing is published.
    const pub = await publishQuoteLink(quote.id, buildClientQuoteSnapshot(quote, link.lang, settings), link.lang, pdfUrl, link.token);
    return pub.error ? { data: null, error: pub.error } : { data: pub.data?.version ?? null, error: null };
  } catch (e) {
    return { data: null, error: asError(e) };
  }
}
