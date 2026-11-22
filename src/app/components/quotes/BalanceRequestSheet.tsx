import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, Eye, Info, Mail, MessageCircle, RotateCcw, Wallet } from '@/app/components/icons';
import { BwSheet, Tag } from '@/app/components/bw/Screen';
import { PillButton, PillField, Selector } from '@/app/components/bw/Form';
import { Toggle } from '@/app/components/bw/Toggle';
import { cn } from '@/app/components/ui/utils';
import { useT, intlLocale, LANGUAGES, loadLocale, localDecimal, useLocaleReady, type Locale } from '@/lib/i18n';
import { amountField, amountKeys } from '@/lib/amount';
import { docLanguageFor } from '@/lib/i18n/docLanguage';
import { openExternal } from '@/lib/nativeFiles';
import { todayLocal, parseLocalDate } from '@/lib/dates';
import { currencySymbol } from '@/lib/currency';
import { formatQuoteMoney } from '@/lib/services/quoteMath';
import { getBandPricing, maskedBankAccount, type BandPricingSettings } from '@/lib/services/pricing';
import type { Quote } from '@/app/data/quotes';
import type { ClientBalance } from '@/quote/types';
import { DepositReceivedSheet } from '@/app/components/quotes/DepositReceivedSheet';
import {
  balanceDueDate,
  balanceMessage,
  balanceSetup,
  buildClientBalance,
  defaultDueRule,
  planBalance,
  previousOtherReceived,
  type BalanceDueRule,
  type BalanceIssue,
  type BalanceWay,
} from '@/lib/quoteBalance';
import {
  buildClientQuoteSnapshot,
  getBalanceGig,
  getQuoteLinkState,
  markQuoteBalancePaid,
  markQuoteBalanceSent,
  previewQuoteBalance,
  publishQuoteBalance,
  publishQuoteLink,
  quoteLinkUrl,
  sendQuoteBalanceEmail,
  type BalanceGigRow,
  type QuoteChannel,
  type QuoteLinkRow,
} from '@/lib/services/quoteLinks';

/**
 * "Final balance" (saldo) of an accepted quote, migration 168. Admins only.
 *
 * Opened from the gig made from the quote (fee card) or from the accepted
 * quote. Works out what is still due (accepted total − deposit received −
 * other payments), the due date and the ways to pay the band set up, says
 * what to check first (deposit not recorded, gig fee ≠ quote, no way to
 * pay, no client email, a Stripe link with a fixed price, asked before…),
 * then sends the same client page as a balance request: by email (send-email),
 * WhatsApp or a copied link. "Mark as paid" records the money as received
 * and marks the gig paid. BandWith never moves money.
 */
export interface BalanceRequestSheetProps {
  open: boolean;
  onClose: () => void;
  quote: Quote;
  bandId: string;
  bandName: string;
  /** The gig made from the quote, when the caller knows it. */
  eventId?: string | null;
  /** The gig's payment changed (deposit, paid): the caller refreshes. */
  onChanged?: () => void;
  /** Opens Pricing → Payment (bank details, Stripe link). */
  onOpenPricing?: () => void;
  zIndex?: number;
}

type Flash = { text: string; tone: 'ok' | 'error' };
type Basis = 'quote' | 'gig';

/** The ways a published balance offered (to tell a reminder from an update). */
const waysOf = (b: ClientBalance | null | undefined): BalanceWay[] =>
  b ? ([b.bank?.length ? 'bank' : null, b.stripeUrl ? 'stripe' : null, b.cash ? 'cash' : null].filter(Boolean) as BalanceWay[]) : [];

export const BalanceRequestSheet: React.FC<BalanceRequestSheetProps> = ({
  open,
  onClose,
  quote,
  bandId,
  bandName,
  eventId,
  onChanged,
  onOpenPricing,
  zIndex = 130,
}) => {
  const t = useT();
  const today = todayLocal();

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [settings, setSettings] = useState<BandPricingSettings | null>(null);
  const [link, setLink] = useState<QuoteLinkRow | null>(null);
  const [gig, setGig] = useState<BalanceGigRow | null>(null);

  const [basis, setBasis] = useState<Basis>('quote');
  const [other, setOther] = useState('');
  const [rule, setRule] = useState<BalanceDueRule>('event');
  const [customDate, setCustomDate] = useState('');
  const [ways, setWays] = useState<BalanceWay[]>([]);
  const [cashNote, setCashNote] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const flashTimer = useRef<number | null>(null);

  const say = useCallback((text: string, tone: Flash['tone'] = 'ok') => {
    setFlash({ text, tone });
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 6000);
  }, []);

  const quoteId = String(quote.id);

  // ── Load the band's payment details, the client link and the gig.
  const load = useCallback(async () => {
    setLoadError(false);
    const [pricing, state, g] = await Promise.all([
      getBandPricing(bandId).catch(() => null),
      getQuoteLinkState(quoteId),
      getBalanceGig(quoteId, eventId || quote.convertedToEventId || null),
    ]);
    if (state.error || g.error) {
      setLoadError(true);
      setLoaded(true);
      return;
    }
    let row = state.data?.link ?? null;
    const s = pricing ?? null;
    // No client link yet (the quote went out as a PDF, or was agreed by
    // phone): make it now, so WhatsApp and Copy can run inside the tap.
    if (!row) {
      const lang = docLanguageFor(quote.clientName);
      await loadLocale(lang);
      const made = await publishQuoteLink(quoteId, buildClientQuoteSnapshot(quote, lang, s ?? {}), lang);
      if (made.data) {
        const again = await getQuoteLinkState(quoteId);
        row = again.data?.link ?? null;
      }
    }
    setSettings(s);
    setLink(row);
    setGig(g.data);

    // Start from what the client already has, else from sensible defaults.
    const prev = row?.balance ?? null;
    const setup = balanceSetup(s);
    const prevWays = waysOf(prev);
    setWays(
      prevWays.length ? prevWays : setup.bank || setup.stripe ? (['bank', 'stripe'] as BalanceWay[]).filter((w) => setup[w as 'bank' | 'stripe']) : ['cash'],
    );
    setCashNote(prev?.cash ?? '');
    setNote(prev?.note ?? '');
    const gigDate = g.data?.event_date || quote.eventDate || null;
    if (prev?.dueDate) {
      const r = (['event', 'after7', 'after14'] as BalanceDueRule[]).find((x) => balanceDueDate(x, gigDate, today) === prev.dueDate);
      setRule(r ?? 'custom');
      setCustomDate(r ? '' : prev.dueDate);
    } else {
      const r = defaultDueRule(gigDate, today);
      setRule(r);
      setCustomDate(r === 'custom' ? balanceDueDate('event', null, today) : '');
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandId, quoteId, eventId, quote.convertedToEventId]);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    setFlash(null);
    void load();
  }, [open, load]);

  // ── The facts and the plan.
  const lang: Locale = link?.lang ?? docLanguageFor(quote.clientName);
  // The client's language may not be the app's: the snapshot re-renders once it's in.
  const langReady = useLocaleReady(lang);
  const snapshot = useMemo(
    () => buildClientQuoteSnapshot(quote, lang, settings ?? {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quote, lang, settings, langReady],
  );
  const currency = snapshot.currency;
  const sym = currencySymbol(currency);
  const money = (v: number) => formatQuoteMoney(v, sym, intlLocale('en-US'));

  const gigFee = gig?.fee != null && gig.fee > 0 ? gig.fee : null;
  const total = basis === 'gig' && gigFee != null ? gigFee : snapshot.total;
  const deposit = gig?.deposit_amount && gig.deposit_amount > 0 ? gig.deposit_amount : snapshot.deposit?.amount ?? 0;
  // 10 #2/#3: the amount as the admin writes it ("1.250,00"); text that is no amount blocks sending.
  const otherField = amountField(other);
  const otherNum = otherField.value ?? 0;
  const gigDate = gig?.event_date || quote.eventDate || null;
  const dueDate = balanceDueDate(rule, gigDate, today, customDate);
  const setup = balanceSetup(settings);
  const accepted = String(quote.status || '').toUpperCase() === 'ACCEPTED' || link?.status === 'accepted';
  // What the client has: the balance sent (185), else the last one published.
  const prev = (link?.balance_sent_at ? link?.balance_sent ?? link?.balance : link?.balance) ?? null;

  const facts = {
    total,
    currency,
    deposit,
    depositReceived: !!gig?.deposit_paid,
    otherReceived: otherNum,
    quoteAccepted: accepted,
    gig: gig
      ? {
          status: gig.status,
          currency: gig.currency,
          fee: gig.fee,
          paymentStatus: gig.payment_status,
          date: gig.event_date,
        }
      : null,
    setup,
    ways,
    clientEmail: quote.clientEmail,
    previous: prev
      ? {
          amount: prev.amount,
          dueDate: prev.dueDate,
          ways: waysOf(prev),
          sentAt: link?.balance_sent_at ?? null,
        }
      : null,
    paidAt: link?.balance_paid_at ?? null,
    dueDate,
    today,
  };
  const plan = planBalance(facts);
  const canSend = plan.canSend && !otherField.invalid;

  // Other payments: what the client was told before, unless typed again.
  const otherSeeded = useRef(false);
  useEffect(() => {
    if (!open) {
      otherSeeded.current = false;
      return;
    }
    if (!loaded || otherSeeded.current) return;
    otherSeeded.current = true;
    if (prev) {
      // 08 #6: the other payments the client was told about, kept apart from
      // the deposit (a deposit recorded since then no longer eats them).
      const was = previousOtherReceived(prev, link?.lang ?? lang);
      if (was > 0) setOther(localDecimal(String(was)));
      if (gigFee != null && Math.abs(prev.total - gigFee) < 0.01 && Math.abs(prev.total - snapshot.total) >= 0.01) setBasis('gig');
    } else {
      setOther('');
      setBasis('quote');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded]);

  const clientBalance = (): ClientBalance =>
    buildClientBalance(plan, facts, settings ?? {}, lang, {
      ref: snapshot.ref,
      cashNote,
      note,
    });

  const sendKind = plan.mode === 'remind' ? 'reminder' : plan.mode === 'update' ? 'updated' : 'sent';

  /** Publish what the client sees now, then record the send. */
  const publishAndRecord = async (channel: QuoteChannel): Promise<boolean> => {
    const pub = await publishQuoteBalance(quoteId, clientBalance());
    if (pub.error || !pub.data) {
      say(t('The client page could not be updated. Try again.'), 'error');
      return false;
    }
    const sent = await markQuoteBalanceSent(quoteId, plan.mode === 'remind' ? 'reminded' : 'sent', channel);
    if (sent.error) {
      say(t('The client page could not be updated. Try again.'), 'error');
      return false;
    }
    const state = await getQuoteLinkState(quoteId);
    if (state.data?.link) setLink(state.data.link);
    return true;
  };

  const message = () =>
    link
      ? balanceMessage({
          clientName: quote.clientName,
          event: snapshot.title,
          bandName,
          amount: buildClientBalance(plan, facts, settings ?? {}, lang, {
            ref: snapshot.ref,
          }).amountLabel,
          dueDate,
          url: quoteLinkUrl(link.token),
          lang,
          kind: sendKind,
          signer: settings?.signer_name,
        })
      : '';

  const sendEmail = async () => {
    if (!canSend || !plan.canEmail || busy) return;
    setBusy('email');
    try {
      const pub = await publishQuoteBalance(quoteId, clientBalance());
      if (pub.error || !pub.data) {
        say(t('The client page could not be updated. Try again.'), 'error');
        return;
      }
      const res = await sendQuoteBalanceEmail(quoteId, sendKind);
      if (!res.ok) {
        say(
          res.code === 'email_not_configured'
            ? t('Email is not set up on the server yet. Share the link instead.')
            : res.code === 'too_soon'
            ? t('An email was just sent. Wait a minute and try again.')
            : res.code === 'no_client_email'
            ? t('Add the client’s email to the quote first.')
            : t('The email could not be sent. Share the link instead.'),
          'error',
        );
        return;
      }
      // The send record is what puts this balance on the client's page (185):
      // the email has the new amount, so the page must not keep the old one.
      const kindSent = plan.mode === 'remind' ? 'reminded' : 'sent';
      let recorded = await markQuoteBalanceSent(quoteId, kindSent, 'email');
      if (recorded.error) recorded = await markQuoteBalanceSent(quoteId, kindSent, 'email');
      const state = await getQuoteLinkState(quoteId);
      if (state.data?.link) setLink(state.data.link);
      if (recorded.error) {
        say(t('The email went out, but the client’s page still shows the earlier balance. Use Copy link to update it.'), 'error');
        return;
      }
      say(
        plan.mode === 'remind'
          ? t('Reminder sent to {email}', { email: quote.clientEmail })
          : t('Balance request sent to {email}', { email: quote.clientEmail }),
      );
    } finally {
      setBusy(null);
    }
  };

  // WhatsApp and Copy run inside the tap (iOS blocks popups and the clipboard after an await).
  const sendVia = (channel: 'whatsapp' | 'copy') => {
    if (!canSend || !link || link.revoked_at || busy) return;
    const text = message();
    if (channel === 'copy') {
      try {
        navigator.clipboard.writeText(text).then(
          () => {
            void publishAndRecord('copy').then((ok) => ok && say(t('Balance link copied')));
          },
          () => say(t('Could not copy the link.'), 'error'),
        );
      } catch {
        say(t('Could not copy the link.'), 'error');
      }
      return;
    }
    const phone = (quote.clientPhone || '').replace(/[^0-9+]/g, '').replace(/^\+/, '');
    void openExternal(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`);
    void publishAndRecord('whatsapp').then((ok) => ok && say(plan.mode === 'remind' ? t('Reminder sent') : t('Balance request shared')));
  };

  // 08 #8: the preview shows the draft with its own key; nothing reaches the
  // client until a send (the page shows the balance sent, 185/187).
  const preview = async () => {
    if (!link || busy) return;
    let key: string | null = null;
    if (canSend) {
      setBusy('preview');
      const res = await previewQuoteBalance(quoteId, clientBalance());
      setBusy(null);
      if (res.error) {
        say(t('The preview could not be opened. Try again.'), 'error');
        return;
      }
      key = res.data;
    }
    void openExternal(quoteLinkUrl(link.token, { preview: true, previewKey: key }));
  };

  const depositBeforePaid = useRef<boolean | null>(null);
  const setPaid = async (paid: boolean) => {
    if (busy) return;
    setBusy(paid ? 'paid' : 'undo');
    const res = await markQuoteBalancePaid(quoteId, paid);
    setBusy(null);
    if (res.error) {
      say(t('Could not save. Try again.'), 'error');
      return;
    }
    const [state, g] = await Promise.all([getQuoteLinkState(quoteId), getBalanceGig(quoteId, gig?.id ?? eventId ?? null)]);
    if (state.data) setLink(state.data.link);
    if (g.data) setGig(g.data);
    else if (gig) {
      // 08 #7: Undo gives back the deposit as it was before "Mark as paid".
      const deposit = paid ? true : depositBeforePaid.current ?? gig.deposit_paid;
      if (paid) depositBeforePaid.current = !!gig.deposit_paid;
      setGig({ ...gig, payment_status: paid ? 'paid' : deposit ? 'partial' : 'pending', deposit_paid: deposit });
    }
    onChanged?.();
    say(paid ? t('Balance marked as received') : t('Balance open again'));
  };

  // "Deposit received" opens its own sheet (method, amount, gig confirmed).
  const [depositOpen, setDepositOpen] = useState(false);

  const toggleWay = (w: BalanceWay, on: boolean) => setWays((prevWays) => (on ? [...new Set([...prevWays, w])] : prevWays.filter((x) => x !== w)));

  // ── Issues as the admin reads them, each with its action.
  const has = (code: BalanceIssue['code']) => plan.issues.some((i) => i.code === code);
  const issueText = (i: BalanceIssue): { text: string; action?: React.ReactNode } | null => {
    switch (i.code) {
      case 'not_accepted':
        return {
          text: t('The client has not accepted this quote yet: the balance comes after the yes.'),
        };
      case 'gig_cancelled':
        return { text: t('The gig is cancelled: there is no balance to ask.') };
      case 'deposit_not_recorded':
        return {
          text: t('The deposit of {amount} is not recorded as received, so the whole total is asked.', { amount: money(deposit) }),
          action: gig ? (
            <PillButton size="sm" variant="white" fullWidth={false} onClick={() => setDepositOpen(true)}>
              {t('Mark deposit received')}
            </PillButton>
          ) : undefined,
        };
      case 'fee_mismatch':
        return {
          text:
            basis === 'gig'
              ? t('Asking from the gig fee ({fee}), not the accepted quote ({total}).', { fee: money(gigFee ?? 0), total: money(snapshot.total) })
              : t('The gig fee ({fee}) is not the accepted quote total ({total}).', { fee: money(gigFee ?? 0), total: money(snapshot.total) }),
          action:
            gigFee != null ? (
              <PillButton size="sm" variant="white" fullWidth={false} onClick={() => setBasis(basis === 'gig' ? 'quote' : 'gig')}>
                {basis === 'gig' ? t('Use the quote total') : t('Use the gig fee')}
              </PillButton>
            ) : undefined,
        };
      case 'currency_mismatch':
        return {
          text: t('The gig is in {gig}, the quote in {quote}: the balance is asked in {quote}.', {
            gig: String(gig?.currency || '').toUpperCase(),
            quote: currency,
          }),
        };
      case 'no_setup':
        return {
          text: t('No bank details or Stripe link yet. The client can only pay in cash.'),
          action: onOpenPricing ? (
            <PillButton size="sm" variant="white" fullWidth={false} onClick={onOpenPricing}>
              {t('Set up payments')}
            </PillButton>
          ) : undefined,
        };
      case 'no_way':
        return { text: t('Pick at least one way to pay.') };
      case 'due_past':
        return { text: t('The due date is already past.') };
      case 'stripe_amount':
        return {
          text: t('A Stripe payment link often has a fixed price. Check that yours asks for {amount}, or lets the client type the amount.', {
            amount: money(plan.due),
          }),
        };
      case 'no_email':
        return {
          text: t('No client email: share the link on WhatsApp or copy it.'),
        };
      case 'already_requested':
        return {
          text:
            plan.mode === 'remind'
              ? t('Asked on {date}. Sending it again is a reminder.', {
                  date: shortDate(link?.balance_sent_at),
                })
              : t('Asked on {date}. Your changes update the client’s page.', {
                  date: shortDate(link?.balance_sent_at),
                }),
        };
      default:
        return null;
    }
  };

  // Most serious first: what stops the send, then what to check, then notes.
  const LEVEL = { block: 0, warn: 1, info: 2 } as const;
  const issues = plan.issues
    .filter((i) => i.code !== 'paid' && i.code !== 'nothing_due')
    .slice()
    .sort((a, b) => LEVEL[a.level] - LEVEL[b.level])
    .map((i) => ({ issue: i, view: issueText(i) }))
    .filter(
      (
        x,
      ): x is {
        issue: BalanceIssue;
        view: { text: string; action?: React.ReactNode };
      } => !!x.view,
    );

  const langName = LANGUAGES.find((l) => l.id === lang)?.name ?? lang;
  const asking = plan.mode === 'send' || plan.mode === 'update' || plan.mode === 'remind';
  const primaryLabel = plan.mode === 'remind' ? t('Send a reminder') : plan.mode === 'update' ? t('Send the update') : t('Send by email');

  const footer =
    !loaded || loadError ? undefined : plan.mode === 'paid' ? (
      <PillButton variant="outline" loading={busy === 'undo'} icon={<RotateCcw className="w-4 h-4" />} onClick={() => void setPaid(false)}>
        {t('Undo')}
      </PillButton>
    ) : plan.mode === 'settle' ? (
      <PillButton variant="primary" loading={busy === 'paid'} icon={<Check className="w-4 h-4" />} onClick={() => void setPaid(true)}>
        {t('Mark as paid')}
      </PillButton>
    ) : asking && plan.canEmail ? (
      <PillButton variant="primary" loading={busy === 'email'} disabled={!canSend} icon={<Mail className="w-4 h-4" />} onClick={() => void sendEmail()}>
        {plan.mode === 'remind' ? t('Send a reminder') : primaryLabel}
      </PillButton>
    ) : asking ? (
      <PillButton variant="primary" disabled={!canSend} icon={<MessageCircle className="w-4 h-4" />} onClick={() => sendVia('whatsapp')}>
        {t('Share on WhatsApp')}
      </PillButton>
    ) : undefined;

  return (
    <>
      <BwSheet
        open={open}
        onClose={onClose}
        closeLabel={t('Close sheet')}
        zIndex={zIndex}
        overline={t('Admin only')}
        title={t('Final balance')}
        footer={footer}
      >
        <div className="dark flex flex-col gap-4" aria-busy={!loaded}>
          {!loaded ? (
            <p className="bw-label-sm text-muted-foreground">{t('Loading…')}</p>
          ) : loadError ? (
            <p role="alert" className="bw-body-sm text-destructive">
              {t('Could not load the balance. Check your connection and try again.')}
            </p>
          ) : (
            <>
              {/* The amount */}
              <section className="rounded-[20px] bg-foreground/[0.06] p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="bw-label-sm text-muted-foreground">{t('Balance due')}</span>
                  {plan.mode === 'paid' ? <Tag variant="solid">{t('Paid')}</Tag> : link?.balance_sent_at ? <Tag variant="subtle">{t('Asked')}</Tag> : null}
                </div>
                <span className="text-[40px] leading-none font-bold tracking-[-0.02em] tabular-nums break-all">
                  {money(plan.mode === 'paid' ? 0 : plan.due)}
                </span>
                <dl className="flex flex-col gap-2 bw-body-sm">
                  <Row label={basis === 'gig' ? t('Gig fee') : t('Agreed total')} value={money(total)} />
                  {deposit > 0 && (
                    <Row
                      label={gig?.deposit_paid ? t('Deposit received') : t('Deposit not received yet')}
                      value={gig?.deposit_paid ? `−${money(deposit)}` : money(deposit)}
                      muted={!gig?.deposit_paid}
                    />
                  )}
                  {otherNum > 0 && <Row label={t('Other payments received')} value={`−${money(otherNum)}`} />}
                </dl>
                {plan.mode !== 'paid' && plan.mode !== 'blocked' && (
                  <PillField
                    label={t('Other payments received')}
                    inputMode="decimal"
                    placeholder="0"
                    value={other}
                    onChange={(e) => setOther(amountKeys(e.target.value))}
                    error={otherField.invalid ? t('Enter an amount, like {example}.', { example: localDecimal('1250.50') }) : undefined}
                    trailing={<span className="bw-label-sm text-muted-foreground">{currency}</span>}
                  />
                )}
              </section>

              {plan.mode === 'paid' && (
                <p role="status" className="flex items-center gap-2 bw-body-sm">
                  <Check className="w-4 h-4 shrink-0" aria-hidden />
                  {link?.balance_paid_at
                    ? t('Balance received on {date}. The gig is marked paid.', {
                        date: shortDate(link.balance_paid_at),
                      })
                    : t('Balance received. The gig is marked paid.')}
                </p>
              )}
              {plan.mode === 'settle' && (
                <p role="status" className="bw-body-sm">
                  {t('Nothing left to pay. Mark the balance as received to mark the gig paid.')}
                </p>
              )}

              {/* What to check */}
              {issues.length > 0 && (
                <ul className="flex flex-col gap-2" aria-label={t('Before you send')}>
                  {issues.map(({ issue, view }) => (
                    <li
                      key={issue.code}
                      className={cn(
                        'rounded-[16px] px-4 py-3 flex flex-col gap-2 bw-body-sm',
                        issue.level === 'block' ? 'bg-destructive/15' : issue.level === 'warn' ? 'bg-accent/15' : 'bg-foreground/[0.06]',
                      )}
                    >
                      <span className="flex items-start gap-2">
                        {issue.level === 'info' ? (
                          <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
                        ) : (
                          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
                        )}
                        <span>{view.text}</span>
                      </span>
                      {view.action && <span className="flex flex-wrap gap-2">{view.action}</span>}
                    </li>
                  ))}
                </ul>
              )}

              {asking && (
                <>
                  {/* Due date */}
                  <section className="flex flex-col gap-2">
                    <span className="bw-label-sm text-muted-foreground">{t('Due date')}</span>
                    <div className="flex flex-wrap gap-2" role="group" aria-label={t('Due date')}>
                      {gigDate && (
                        <>
                          <Selector size="md" selected={rule === 'event'} onClick={() => setRule('event')}>
                            {t('On the gig day')}
                          </Selector>
                          <Selector size="md" selected={rule === 'after7'} onClick={() => setRule('after7')}>
                            {t('7 days after')}
                          </Selector>
                          <Selector size="md" selected={rule === 'after14'} onClick={() => setRule('after14')}>
                            {t('14 days after')}
                          </Selector>
                        </>
                      )}
                      <Selector
                        size="md"
                        selected={rule === 'custom'}
                        onClick={() => {
                          setRule('custom');
                          if (!customDate) setCustomDate(dueDate);
                        }}
                      >
                        {t('Pick a date')}
                      </Selector>
                    </div>
                    {rule === 'custom' ? (
                      <PillField label={t('Pay by')} type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
                    ) : (
                      <span className="bw-body-sm">{t('Pay by {date}', { date: longDate(dueDate) })}</span>
                    )}
                  </section>

                  {/* Ways to pay */}
                  <section className="flex flex-col gap-2">
                    <span className="bw-label-sm text-muted-foreground">{t('Ways to pay')}</span>
                    <WayRow
                      label={t('Bank transfer')}
                      detail={setup.bank ? maskedBankAccount(settings ?? {}) || '' : t('Not set up')}
                      checked={ways.includes('bank') && setup.bank}
                      disabled={!setup.bank}
                      onChange={(on) => toggleWay('bank', on)}
                    />
                    <WayRow
                      label={t('Card · Stripe link')}
                      detail={setup.stripe ? t('Your Stripe payment link') : t('Not set up')}
                      checked={ways.includes('stripe') && setup.stripe}
                      disabled={!setup.stripe}
                      onChange={(on) => toggleWay('stripe', on)}
                    />
                    <WayRow
                      label={t('Cash')}
                      detail={t('On the day, or as you agree')}
                      checked={ways.includes('cash')}
                      onChange={(on) => toggleWay('cash', on)}
                    />
                    {ways.includes('cash') && (
                      <PillField
                        label={t('Cash note (optional)')}
                        placeholder={t('e.g. To the band leader after the soundcheck')}
                        maxLength={300}
                        value={cashNote}
                        onChange={(e) => setCashNote(e.target.value)}
                      />
                    )}
                    {(!setup.bank || !setup.stripe) && onOpenPricing && !has('no_setup') && (
                      <button type="button" onClick={onOpenPricing} className="self-start bw-label-sm underline underline-offset-4">
                        {t('Set up payments')}
                      </button>
                    )}
                  </section>

                  <PillField label={t('Note to the client (optional)')} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />

                  <p className="bw-body-sm text-muted-foreground">
                    {t('The client gets the same quote page, in {language}, with the balance and how to pay it. BandWith never takes payments.', {
                      language: langName,
                    })}
                  </p>

                  {/* Other ways to send */}
                  <div className="grid grid-cols-1 @min-[420px]:grid-cols-3 gap-2">
                    {plan.canEmail && (
                      <PillButton
                        size="md"
                        variant="outline"
                        disabled={!canSend}
                        icon={<MessageCircle className="w-4 h-4" />}
                        onClick={() => sendVia('whatsapp')}
                      >
                        {t('WhatsApp')}
                      </PillButton>
                    )}
                    <PillButton
                      size="md"
                      variant="outline"
                      disabled={!canSend || !link}
                      icon={<Copy className="w-4 h-4" />}
                      onClick={() => sendVia('copy')}
                    >
                      {t('Copy link')}
                    </PillButton>
                    <PillButton
                      size="md"
                      variant="outline"
                      disabled={!link}
                      loading={busy === 'preview'}
                      icon={<Eye className="w-4 h-4" />}
                      onClick={() => void preview()}
                    >
                      {t('Preview')}
                    </PillButton>
                  </div>
                </>
              )}

              {(asking || plan.mode === 'blocked') && plan.mode !== 'blocked' && (
                <div className="flex flex-col gap-2 pt-2 border-t border-foreground/10">
                  <span className="bw-body-sm text-muted-foreground">{t('Got the money another way?')}</span>
                  <PillButton size="md" variant="white" loading={busy === 'paid'} icon={<Wallet className="w-4 h-4" />} onClick={() => void setPaid(true)}>
                    {t('Mark as paid')}
                  </PillButton>
                </div>
              )}

              {flash && (
                <p
                  role={flash.tone === 'error' ? 'alert' : 'status'}
                  className={cn('bw-body-sm', flash.tone === 'error' ? 'text-destructive' : 'text-foreground')}
                >
                  {flash.text}
                </p>
              )}
            </>
          )}
        </div>
      </BwSheet>
      <DepositReceivedSheet
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        quote={quote}
        zIndex={zIndex + 10}
        onChanged={(r) => {
          if (gig || r.eventId) {
            setGig((g) => ({
              ...(g ?? {
                id: r.eventId || '',
                status: 'confirmed',
                currency: null,
                event_date: null,
                fee: null,
                payment_status: null,
                deposit_amount: null,
                deposit_paid: false,
              }),
              id: r.eventId || g?.id || '',
              deposit_paid: r.received,
              deposit_amount: r.received && r.amount ? r.amount : g?.deposit_amount ?? null,
              payment_status: g?.payment_status === 'paid' ? 'paid' : r.received ? 'partial' : 'pending',
            }));
          }
          onChanged?.();
          if (r.received) setDepositOpen(false);
        }}
      />
    </>
  );
};

function shortDate(iso?: string | null): string {
  if (!iso) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? parseLocalDate(iso) : new Date(iso);
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(intlLocale('en-GB'), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
}
function longDate(ymd: string): string {
  const d = parseLocalDate(ymd);
  return isNaN(d.getTime())
    ? ymd
    : d.toLocaleDateString(intlLocale('en-GB'), {
        weekday: 'short',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
}

const Row: React.FC<{ label: string; value: string; muted?: boolean }> = ({ label, value, muted }) => (
  <div className={cn('flex items-baseline justify-between gap-3', muted && 'text-muted-foreground')}>
    <dt className="min-w-0">{label}</dt>
    <dd className="tabular-nums shrink-0">{value}</dd>
  </div>
);

const WayRow: React.FC<{
  label: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}> = ({ label, detail, checked, disabled, onChange }) => {
  const id = React.useId();
  return (
    <div className={cn('flex items-center justify-between gap-3 rounded-[16px] bg-foreground/[0.06] px-4 py-3', disabled && 'opacity-60')}>
      <label htmlFor={id} className="flex flex-col min-w-0 cursor-pointer">
        <span className="bw-label-sm">{label}</span>
        {detail && <span className="bw-body-sm text-muted-foreground truncate">{detail}</span>}
      </label>
      <Toggle id={id} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(!!v)} aria-label={label} />
    </div>
  );
};
