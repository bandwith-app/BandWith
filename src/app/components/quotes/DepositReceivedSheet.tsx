import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Info, RotateCcw } from '@/app/components/icons';
import { BwSheet, Tag } from '@/app/components/bw/Screen';
import { PillButton, PillField, Selector } from '@/app/components/bw/Form';
import { useT, intlLocale, localDecimal } from '@/lib/i18n';
import { currencySymbol } from '@/lib/currency';
import { calculateDepositAmount, formatQuoteMoney, quoteDepositPercent, roundCents, totalsForQuote } from '@/lib/services/quoteMath';
import type { Quote } from '@/app/data/quotes';
import { getBalanceGig, type BalanceGigRow } from '@/lib/services/quoteLinks';
import { amountKeys, parseAmount } from '@/lib/amount';
import { recordQuoteDeposit, type DepositMethod, type QuoteDepositResult } from '@/lib/services/quotes';

/**
 * "Deposit received" of an accepted quote (migration 168, deposit tweaks).
 * Admins only. The admin says the deposit arrived and how (bank transfer,
 * cash, other): the gig records it (deposit_paid, amount, payment_status
 * 'partial', as payouts, readiness and analytics read it) and is confirmed
 * through the shared step; a quote with no gig yet gets one first, with its
 * lineup. The client's page then says the deposit was received. Undo puts
 * it back. BandWith never moves money.
 */
export interface DepositReceivedSheetProps {
  open: boolean;
  onClose: () => void;
  quote: Quote;
  /** The deposit changed: the caller refreshes (gig, quote list). */
  onChanged?: (result: QuoteDepositResult & { amount: number | null }) => void;
  zIndex?: number;
}


export const DepositReceivedSheet: React.FC<DepositReceivedSheetProps> = ({ open, onClose, quote, onChanged, zIndex = 140 }) => {
  const t = useT();
  const [gig, setGig] = useState<BalanceGigRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [method, setMethod] = useState<DepositMethod>('transfer');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<'save' | 'undo' | null>(null);
  const [flash, setFlash] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  // Round 5: the deposit is recorded in the quote's currency (the RPC), so
  // the sheet names that one; the gig's only for a quote without one.
  const currency = (quote.currency || gig?.currency || 'EUR').toUpperCase();
  const money = useMemo(() => {
    const sym = currencySymbol(currency);
    return (v: number) => formatQuoteMoney(v, sym, intlLocale('en-US'));
  }, [currency]);

  // The deposit the quote asks for (as the PDF and the client's page).
  const quoteDeposit = useMemo(() => {
    if (quote.depositRequired === false) return 0;
    const pct = quoteDepositPercent(quote);
    const total = Number(quote.total) > 0 ? Number(quote.total) : totalsForQuote(quote, { subtotal: quote.subtotal || 0 }).total;
    return pct > 0 ? calculateDepositAmount(total, pct) : 0;
  }, [quote]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoaded(false);
    setFlash(null);
    void getBalanceGig(String(quote.id)).then((res) => {
      if (!alive) return;
      const g = res.data ?? null;
      setGig(g);
      const start = g?.deposit_amount && g.deposit_amount > 0 ? g.deposit_amount : quoteDeposit;
      setAmount(start > 0 ? localDecimal(String(roundCents(start))) : '');
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [open, quote.id, quoteDeposit]);

  const received = !!gig?.deposit_paid;
  const cancelled = (gig?.status || '').toLowerCase() === 'cancelled';
  const value = parseAmount(amount);

  const save = async (on: boolean) => {
    if (busy) return;
    setBusy(on ? 'save' : 'undo');
    setFlash(null);
    const { data, error } = await recordQuoteDeposit(String(quote.id), { method, amount: on ? value : null, received: on });
    setBusy(null);
    if (error || !data) {
      const msg = (error as { message?: string } | null)?.message || '';
      setFlash({
        text: /cancelled/i.test(msg) ? t('The gig is cancelled: there is no deposit to record.') : t('Could not save. Try again.'),
        tone: 'error',
      });
      return;
    }
    setGig((g) => ({
      ...(g ?? { id: data.eventId || '', status: 'confirmed', currency, event_date: quote.eventDate || null, fee: null, deposit_amount: null, payment_status: null }),
      id: data.eventId || g?.id || '',
      status: data.confirmed ? 'confirmed' : g?.status ?? null,
      deposit_paid: data.received,
      deposit_amount: on && value ? value : g?.deposit_amount ?? null,
      payment_status: g?.payment_status === 'paid' ? 'paid' : data.received ? 'partial' : 'pending',
    }));
    onChanged?.({ ...data, amount: on ? value : null });
    setFlash({
      text: !on
        ? t('Deposit marked as not received.')
        : data.lineupError
          ? t('Deposit recorded. The gig was created, but its lineup was not added: add the musicians in the gig.')
          : data.created
            ? t('Deposit recorded. The gig was created from the quote and is confirmed.')
            : t('Deposit recorded. The gig is confirmed.'),
      tone: data.lineupError ? 'error' : 'ok',
    });
  };

  const footer = !loaded ? undefined : received ? (
    <PillButton variant="outline" loading={busy === 'undo'} icon={<RotateCcw className="w-4 h-4" />} onClick={() => void save(false)}>
      {t('Undo')}
    </PillButton>
  ) : cancelled ? undefined : (
    <PillButton variant="primary" loading={busy === 'save'} disabled={value == null} icon={<Check className="w-4 h-4" />} onClick={() => void save(true)}>
      {t('Mark deposit received')}
    </PillButton>
  );

  return (
    <BwSheet open={open} onClose={onClose} closeLabel={t('Close sheet')} zIndex={zIndex} overline={t('Admin only')} title={t('Deposit received')} footer={footer}>
      <div className="dark flex flex-col gap-4" aria-busy={!loaded}>
        {!loaded ? (
          <p className="bw-label-sm text-muted-foreground">{t('Loading…')}</p>
        ) : (
          <>
            <section className="rounded-[20px] bg-foreground/[0.06] p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="bw-label-sm text-muted-foreground">{t('Deposit')}</span>
                {received && <Tag variant="solid">{t('Received')}</Tag>}
              </div>
              <span className="text-[40px] leading-none font-bold tracking-[-0.02em] tabular-nums break-all">
                {money(received ? gig?.deposit_amount || value || 0 : value || 0)}
              </span>
              {quoteDeposit > 0 && !received && (
                <span className="bw-body-sm text-muted-foreground">{t('The quote asks for {amount}.', { amount: money(quoteDeposit) })}</span>
              )}
            </section>

            {cancelled ? (
              <p role="alert" className="flex gap-2 bw-body-sm">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                {t('The gig is cancelled: there is no deposit to record.')}
              </p>
            ) : received ? (
              <p className="bw-body-sm">{t('The client’s page says the deposit was received. Undo it if it did not arrive.')}</p>
            ) : (
              <>
                <PillField
                  label={t('Amount received')}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(amountKeys(e.target.value))}
                  error={amount.trim() && value == null ? t('Enter an amount, like {example}.', { example: localDecimal('1250.50') }) : undefined}
                  trailing={<span className="bw-label-sm text-muted-foreground">{currency}</span>}
                />
                <section className="flex flex-col gap-2">
                  <span className="bw-label-sm text-muted-foreground">{t('How it arrived')}</span>
                  <div className="flex flex-wrap gap-2">
                    <Selector size="md" selected={method === 'transfer'} onClick={() => setMethod('transfer')}>{t('Bank transfer')}</Selector>
                    <Selector size="md" selected={method === 'cash'} onClick={() => setMethod('cash')}>{t('Cash')}</Selector>
                    <Selector size="md" selected={method === 'other'} onClick={() => setMethod('other')}>{t('Other')}</Selector>
                  </div>
                </section>
                <p className="flex gap-2 bw-body-sm text-muted-foreground">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  {gig
                    ? t('The gig is confirmed, and the deposit shows as received in payouts, readiness and on the client’s page.')
                    : t('The gig is created from the quote, with its lineup, and confirmed. The client’s page says the deposit was received.')}
                </p>
              </>
            )}

            {flash && (
              <p role={flash.tone === 'error' ? 'alert' : 'status'} className={flash.tone === 'error' ? 'bw-body-sm text-destructive' : 'bw-body-sm'}>
                {flash.text}
              </p>
            )}
          </>
        )}
      </div>
    </BwSheet>
  );
};
