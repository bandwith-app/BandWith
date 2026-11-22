import { createPortal } from 'react-dom';
import { useSystemBack } from '@/lib/backStack';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Download,
  Share2,
  Mail,
  MessageCircle,
  Copy,
  Check,
  IconSettings,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  RefreshCw,
  Smartphone,
  Link,
} from '@/app/components/icons';
import { Quote, getEventTypeLabel } from '@/app/data/quotes';
import {
  BandPricingSettings,
  DEFAULT_BAND_PRICING,
  getBandPricing,
  hasBankAccount,
} from '@/lib/services/pricing';
import {
  generateQuotePdf,
  QuotePdfGenerationResult,
  uploadQuotePdfForSharing,
} from '@/lib/services/quotePdf';
import { parseLocalDate } from '@/lib/dates';
import { DEFAULT_VAT_RATE, formatQuoteMoney } from '@/lib/services/quoteMath';
import { currencySymbol } from '@/lib/currency';
import { isUuid, sendQuote } from '@/lib/services/quotes';
import { shareFile, saveFile, openExternal } from '@/lib/nativeFiles';
import { HeaderAction, IconButton } from '@/app/components/bw/Screen';
import { RailCover } from '@/lib/railActions';
import { PillButton, Selector } from '@/app/components/bw/Form';
import { OnlineDepositLinks } from '@/app/components/quotes/OnlineDeposit';
import { useT, translate, intlLocale, useLocaleReady, type Locale } from '@/lib/i18n';
import { docLanguageFor, rememberDocLanguage } from '@/lib/i18n/docLanguage';
import { DocLanguagePicker } from '@/app/components/bw/DocLanguagePicker';
import { fetchBandPlan } from '@/lib/usePlan';
import { madeWithMark } from '@/lib/planText';
import {
  buildClientQuoteSnapshot,
  clientLinkMessage,
  getQuoteContact,
  getQuoteLinkState,
  isLinkChangedError,
  isVersionChangedError,
  sameQuoteContact,
  sameQuoteTerms,
  type QuoteContact,
  markQuoteLinkSent,
  publishQuoteLink,
  quoteLinkUrl,
  rotateQuoteLink,
  sendQuoteEmail,
  type QuoteChannel,
  type QuoteLinkStatus,
  type QuoteMessageKind,
} from '@/lib/services/quoteLinks';

export interface QuoteShareModalProps {
  isOpen: boolean;
  quote: Partial<Quote>;
  bandId?: string;
  bandName?: string;
  onClose: () => void;
  onOpenBandSettings?: () => void;
  /** Called after a draft quote is marked as sent (a share channel completed). */
  onSent?: (quoteId: string) => void;
  /**
   * What the message with the client's link says (migration 099): the
   * first send, a reminder, or "the quote was updated".
   */
  kind?: QuoteMessageKind;
  /** The client's link changed (sent, reminded, new link). */
  onLinkChanged?: () => void;
  /**
   * "Send quote" in the iPad composer (Figma iPad · 06 "Quote / New"): email
   * the client's link once, as soon as the link and the PDF are ready. Without
   * the client's email it says so and the other channels stay available.
   */
  autoSendEmail?: boolean;
}

const isIOS = () =>
  Capacitor.getPlatform() === 'ios' || (typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent));

export const QuoteShareModal: React.FC<QuoteShareModalProps> = ({
  isOpen,
  quote,
  bandId,
  bandName = 'Band',
  onClose,
  onOpenBandSettings,
  onSent,
  kind = 'sent',
  onLinkChanged,
  autoSendEmail = false,
}) => {
  const t = useT();
  const [settings, setSettings] = useState<BandPricingSettings>(DEFAULT_BAND_PRICING);
  const [pdfResult, setPdfResult] = useState<QuotePdfGenerationResult | null>(null);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(true);
  const [generateError, setGenerateError] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const sentRef = useRef(false);
  // Language of the PDF and of the message the client receives.
  const clientKey = quote.clientEmail || quote.clientName;
  const [docLang, setDocLang] = useState<Locale>(() => docLanguageFor(clientKey));
  // The client's language may not be the app's: load it (the sheet renders again once it's in).
  useLocaleReady(docLang);
  const tr = (source: string, vars?: Record<string, string | number>) => translate(docLang, source, vars);

  const sym = currencySymbol(quote.currency || 'EUR');
  const quoteRef = useRef(quote);
  quoteRef.current = quote;
  const quoteKey = useMemo(() => {
    try { return JSON.stringify(quote); } catch { return String(quote.id || ''); }
  }, [quote]);
  const canUpload = isUuid(bandId);
  // The client's confirmation link: only for a saved quote of a real band.
  const canLink = canUpload && isUuid(quote.id);
  const [link, setLink] = useState<{ id?: string; token: string; status: QuoteLinkStatus; revoked: boolean; version?: number } | null>(null);
  const [linkError, setLinkError] = useState(false);
  // Round 4: the link and the saved quote were read (and match this sheet).
  // Opening the sheet publishes nothing: a send (Copy, WhatsApp, SMS,
  // email) publishes this sheet's version first, on the version it read,
  // and goes out only if that worked.
  const [linkChecked, setLinkChecked] = useState(false);
  const [sending, setSending] = useState<QuoteChannel | null>(null);
  // 183: the quote this sheet was opened with is not the one saved now (the
  // client changed meanwhile, another admin, another device): nothing is
  // shared from it, the sheet asks to open the quote again.
  const [stale, setStale] = useState(false);
  // Round 5/6: the client saved now, read again right before every publish
  // (WhatsApp, SMS, email, Copy). Another one than this sheet's summary and
  // PDF are for: "this quote now goes to X", nothing is published or sent,
  // and the sheet must be opened again (its summary and PDF name the
  // previous client).
  const [recipientNow, setRecipientNow] = useState<{ contact: QuoteContact } | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // "Send quote": what happened, kept at the top of the sheet (the flash
  // below the channels is easy to miss when nobody tapped anything).
  const [autoNote, setAutoNote] = useState<{ text: string; tone: 'ok' | 'error' | 'busy' } | null>(null);
  const autoPendingRef = useRef(false);
  const flash = (text: string, tone: 'ok' | 'error' = 'ok') => {
    if (autoPendingRef.current) {
      autoPendingRef.current = false;
      setAutoNote({ text, tone });
    }
    setShareFeedback({ text, tone });
    setTimeout(() => setShareFeedback(null), tone === 'error' ? 5000 : 3000);
  };

  const loadAndGenerate = useCallback(async () => {
    setIsGenerating(true);
    setGenerateError(false);
    try {
      let loadedSettings = DEFAULT_BAND_PRICING;
      if (bandId) {
        loadedSettings = await getBandPricing(bandId);
      }
      setSettings(loadedSettings);
      setSettingsReady(true);
      // Paid plans §4.3: the mark when the band's plan has no branding.
      const plan = bandId ? await fetchBandPlan(bandId).catch(() => null) : null;
      const generated = await generateQuotePdf(quoteRef.current, bandName, loadedSettings, docLang, { madeWith: madeWithMark(plan) });
      setPdfResult(generated);
      setActivePageIndex(0);
    } catch (err) {
      console.error('[QuoteShareModal] Failed to generate PDF:', err);
      setPdfResult(null);
      setGenerateError(true);
    } finally {
      setIsGenerating(false);
    }
    // Regenerate when the quote's content changes, not on every parent
    // render (callers often pass an inline object).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandId, bandName, quoteKey, docLang]);

  useEffect(() => {
    if (!isOpen) return;
    const onPricingSaved = () => {
      setUploadedUrl(null);
      loadAndGenerate();
    };
    window.addEventListener('bw:band-pricing-saved', onPricingSaved);
    return () => window.removeEventListener('bw:band-pricing-saved', onPricingSaved);
  }, [isOpen, loadAndGenerate]);

  useEffect(() => {
    if (isOpen) {
      setUploadedUrl(null);
      setDocLang(docLanguageFor(clientKey));
      sentRef.current = false;
      loadAndGenerate();
    }
  }, [isOpen, loadAndGenerate]);

  // Reads the link as saved (token, version), so every channel can open
  // synchronously inside the tap. Opening publishes nothing: a quote without
  // a link gets one only when Send or Copy is tapped (publishForSend).
  useEffect(() => {
    if (!isOpen || !canLink) return;
    let cancelled = false;
    setLinkError(false);
    setStale(false);
    setLinkChecked(false);
    (async () => {
      // The link and the client as saved now, never the copy this sheet got.
      const [{ data, error }, contact] = await Promise.all([getQuoteLinkState(String(quote.id)), getQuoteContact(String(quote.id))]);
      if (cancelled) return;
      if (error || contact.error) {
        setLinkError(true);
        return;
      }
      // The client and the price saved now, not the ones of this sheet's copy.
      if (contact.data && !sameQuoteTerms(contact.data, quoteRef.current)) {
        setStale(true);
        return;
      }
      if (data?.link) {
        setLink({ id: data.link.id, token: data.link.token, status: data.link.status, revoked: !!data.link.revoked_at, version: data.link.version });
        // The page and the emails speak the language the client already got.
        if (data.link.status !== 'draft') setDocLang(data.link.lang);
      } else setLink(null);
      setLinkChecked(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, canLink, quote.id]);

  // The PDF upload finished (with or without a link): "Send quote" can go.
  // State, not a ref: an upload that ends at once (offline, no storage)
  // must still re-render the sheet, or the link would never be published.
  const [uploadTried, setUploadTried] = useState(false);

  const pdfSettled = !isGenerating && !!pdfResult && !isUploading && (!canUpload || !!uploadedUrl || uploadTried);
  // Upload as soon as the PDF exists, so WhatsApp / copy / email can run
  // synchronously inside the tap (iOS blocks clipboard and popups after an await).
  useEffect(() => {
    if (!isOpen || !pdfResult || !canUpload || uploadedUrl) return;
    let cancelled = false;
    setIsUploading(true);
    uploadQuotePdfForSharing(String(bandId), quote.quoteNumber || 'DRAFT', pdfResult.pdfBlob, pdfResult.fileName)
      .then((url) => { if (!cancelled && url) setUploadedUrl(url); })
      .finally(() => {
        setUploadTried(true);
        if (!cancelled) setIsUploading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen, pdfResult, canUpload, bandId, quote.quoteNumber, uploadedUrl]);

  // "Send quote": one email to the client once everything is ready.
  const emailLinkRef = useRef<(() => Promise<void>) | null>(null);
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (isOpen) return;
    setRecipientNow(null);
    autoSentRef.current = false;
    setUploadTried(false);
    autoPendingRef.current = false;
    setAutoNote(null);
  }, [isOpen]);
  // "Send quote" (an explicit send from the wizard): the email, once ready.
  const autoSendReady = isOpen && autoSendEmail && linkChecked && !link?.revoked && !stale && settingsReady && pdfSettled;
  useEffect(() => {
    if (!autoSendReady || autoSentRef.current) return;
    autoSentRef.current = true;
    autoPendingRef.current = true;
    if (quote.clientEmail) setAutoNote({ text: t('Sending the quote to {email}…', { email: quote.clientEmail }), tone: 'busy' });
    void emailLinkRef.current?.().finally(() => {
      // Nothing was flashed (e.g. the link went away): don't leave "Sending…".
      if (autoPendingRef.current) {
        autoPendingRef.current = false;
        setAutoNote(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSendReady]);

  useSystemBack(isOpen, onClose);

  if (!isOpen) return null;

  // Round 4: what the sheet read matches the saved quote; a send publishes first.
  const canShareLink = linkChecked && !link?.revoked && !stale && !recipientNow && settingsReady && !sending;

  /**
   * Publish this sheet's version, on the link and the version it read
   * (round 4). Another version published meanwhile, or the link replaced
   * (another client): nothing is written, the sheet asks to open the quote
   * again. Returns what was published, or null (nothing to send).
   */
  const publishForSend = async (): Promise<{ token: string; version: number; linkId?: string } | null> => {
    // Round 6: the client saved now, right before the publish: another one
    // than this summary and PDF are for, nothing goes out.
    if (!(await recipientStill())) return null;
    const pub = await publishQuoteLink(
      String(quote.id),
      buildClientQuoteSnapshot(quoteRef.current, docLang, settings),
      docLang,
      uploadedUrl,
      link?.token ?? null,
      // Round 5: the version this sheet read; 0 = it read no link (one made
      // since, by another admin or device: refused, 40001).
      link ? (typeof link.version === 'number' ? link.version : null) : 0,
    );
    if (!pub.data) {
      if (isLinkChangedError(pub.error) || isVersionChangedError(pub.error)) {
        setStale(true);
        flash(t('This quote changed meanwhile (another client, or another admin). Close this and open the quote again.'), 'error');
      } else flash(t('The client page could not be updated. Try again.'), 'error');
      return null;
    }
    const linkId = link?.token === pub.data.token ? link.id : undefined;
    setLink({ id: linkId, token: pub.data.token, status: pub.data.status, revoked: pub.data.revoked, version: pub.data.version });
    return { token: pub.data.token, version: pub.data.version, linkId };
  };

  /** The quote with the client this sheet's summary and PDF are for. */
  const current = (): typeof quoteRef.current => quoteRef.current;

  /**
   * Round 5/6: the client saved now. The same as this sheet's summary: go.
   * Another one: nothing goes out, and the sheet says who the quote goes to
   * now and to open it again (a summary and PDF for them are made then).
   * Codex 11-22: the price too (total and currency), as when the sheet
   * opened. A draft with no link has no version for the server to refuse,
   * so another device's new price would go out at this sheet's old one:
   * nothing goes out, the sheet says the quote changed.
   */
  const recipientStill = async (): Promise<boolean> => {
    const saved = await getQuoteContact(String(quote.id));
    if (saved.error || !saved.data) {
      flash(t('The client page could not be updated. Try again.'), 'error');
      return false;
    }
    if (sameQuoteTerms(saved.data, current())) return true;
    if (sameQuoteContact(saved.data, current())) {
      // The same client, another price: the notice a refused publish shows.
      setStale(true);
      flash(t('This quote changed meanwhile (another client, or another admin). Close this and open the quote again.'), 'error');
    } else setRecipientNow({ contact: saved.data });
    return false;
  };

  /** Record the send of the version just published, on its link (183). */
  const publishAndRecord = async (channel: QuoteChannel, published: { token: string; version: number }) => {
    const id = String(quote.id);
    const sent = await markQuoteLinkSent(id, kind === 'reminder' ? 'reminded' : 'sent', channel, { token: published.token, version: published.version });
    if (sent.error) {
      if (isLinkChangedError(sent.error) || isVersionChangedError(sent.error)) {
        setStale(true);
        flash(t('The quote changed meanwhile, so this send was not recorded. Close this and open the quote again.'), 'error');
      } else flash(t('The client page could not be updated. Try again.'), 'error');
      return false;
    }
    setLink((l) => (l ? { ...l, status: sent.data || l.status } : l));
    if (String(quote.status || '').toUpperCase() === 'DRAFT' || !quote.status) onSent?.(id);
    onLinkChanged?.();
    return true;
  };

  const linkMessage = (token: string) => {
    const snapshot = buildClientQuoteSnapshot(quoteRef.current, docLang, settings);
    return clientLinkMessage(current(), {
      bandName,
      url: quoteLinkUrl(token),
      lang: docLang,
      kind,
      total: snapshot.totalLabel,
      signer: settings.signer_name,
    });
  };

  const cleanPhone = () => (current().clientPhone || '').replace(/[^0-9+]/g, '');

  const sendLinkVia = (channel: 'whatsapp' | 'sms' | 'copy') => {
    if (!canShareLink) return;
    setSending(channel);
    setRecipientNow(null);
    // Started inside the tap: the publish runs first, and the channel gets
    // the link only once it worked (iOS keeps the clipboard write and the
    // window open for the tap that started them). WhatsApp and SMS: the
    // client saved now is checked first (round 5).
    const job = publishForSend();
    if (channel === 'copy') {
      const text = job.then((p) => {
        if (!p) throw new Error('not published');
        return linkMessage(p.token);
      });
      const copied = (() => {
        try {
          if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
            return navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((v) => new Blob([v], { type: 'text/plain' })) })]);
          }
        } catch {
          /* the fallback below */
        }
        return text.then((v) => navigator.clipboard.writeText(v));
      })();
      void copied
        .then(async () => {
          const p = await job;
          if (!p) return;
          setCopiedLink(true);
          setTimeout(() => setCopiedLink(false), 2500);
          await publishAndRecord('copy', p);
        })
        .catch(async () => {
          if (await job) flash(t('Could not copy the link.'), 'error');
        })
        .finally(() => setSending(null));
      return;
    }
    // WhatsApp on the web: the window opens in the tap and gets its address
    // after the publish (closed if nothing was published).
    const pending = channel === 'whatsapp' && !Capacitor.isNativePlatform() ? window.open('', '_blank') : null;
    void job
      .then(async (p) => {
        if (!p) {
          pending?.close();
          return;
        }
        const phone = cleanPhone();
        const text = linkMessage(p.token);
        const url =
          channel === 'whatsapp'
            ? `https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`
            : `sms:${phone}${isIOS() ? '&' : '?'}body=${encodeURIComponent(text)}`;
        if (pending) {
          try {
            pending.opener = null;
          } catch {
            /* cross-origin */
          }
          pending.location.href = url;
        } else await openExternal(url);
        if (await publishAndRecord(channel, p)) flash(kind === 'reminder' ? t('Reminder sent') : t('Quote shared'));
      })
      .finally(() => setSending(null));
  };

  const emailLink = async () => {
    if (!canShareLink || emailing) return;
    if (!current().clientEmail) {
      flash(t('Add the client’s email to the quote first.'), 'error');
      return;
    }
    setEmailing(true);
    setSending('email');
    setRecipientNow(null);
    try {
      const id = String(quote.id);
      const p = await publishForSend();
      if (!p) return;
      const res = await sendQuoteEmail(id, kind, p.linkId);
      if (!res.ok && res.code === 'link_changed') {
        setStale(true);
        flash(t('This quote changed meanwhile (another client, or another admin). Close this and open the quote again.'), 'error');
        return;
      }
      if (!res.ok && res.code === 'too_soon') {
        flash(t('An email was just sent. Wait a minute and try again.'), 'error');
        return;
      }
      if (!res.ok) {
        // The server could not send it (no mail server yet, or offline): hand
        // the same message to the mail app instead.
        const subject = tr('{band} — Quote {ref}', { band: bandName, ref: quote.quoteNumber || '' }).trim();
        void openExternal(`mailto:${encodeURIComponent(current().clientEmail || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(linkMessage(p.token))}`);
      }
      if (await publishAndRecord('email', p)) {
        flash(res.ok ? t('Email sent to {email}', { email: current().clientEmail || '' }) : t('Your mail app opened with the message and the link.'));
      }
    } finally {
      setEmailing(false);
      setSending(null);
    }
  };

  emailLinkRef.current = emailLink;

  const newLink = async () => {
    if (!isUuid(quote.id)) return;
    const { data, error } = await rotateQuoteLink(quote.id);
    if (error || !data) {
      flash(t('Could not create a new link. Try again.'), 'error');
      return;
    }
    setLink((l) => (l ? { ...l, id: undefined, token: data, revoked: false } : l));
    onLinkChanged?.();
    flash(t('New link ready. The old one no longer works.'));
  };

  /** A draft becomes SENT only once it actually left through a channel. */
  const markSent = async () => {
    if (sentRef.current) return;
    const id = quote.id;
    const status = String(quote.status || '').toUpperCase();
    if (!isUuid(id) || (status && status !== 'DRAFT')) return;
    sentRef.current = true;
    const { error } = await sendQuote(id);
    if (error) {
      sentRef.current = false;
      console.warn('[QuoteShareModal] Could not mark the quote as sent:', error);
      return;
    }
    onSent?.(id);
  };

  const changeDocLang = (l: Locale) => {
    if (l === docLang) return;
    rememberDocLanguage(clientKey, l);
    // Drop the old PDF and link so nothing in the previous language gets uploaded or shared.
    setPdfResult(null);
    setUploadedUrl(null);
    setDocLang(l);
  };

  // 176/177: PDF messages carry no link. The storage URL outlived "Turn off
  // link", and a link built on the client's token would hand whoever gets the
  // PDF the client page too (Accept, Decline, messages). The PDF goes as a
  // file; the client's own link goes only through "Send to client".
  const buildShareText = () => {
    const eventLabel = tr(getEventTypeLabel((quote.eventType as any) || 'wedding'));
    const eventDateStr = quote.eventDate
      ? parseLocalDate(quote.eventDate).toLocaleDateString(intlLocale('en-GB', docLang), {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : tr('TBD', { context: 'doc' });
    // The same total, VAT and deposit as the PDF and the client's page, to the cent.
    const snap = buildClientQuoteSnapshot(quote, docLang, settings);
    const docMoney = (n: number) => formatQuoteMoney(n, sym, intlLocale('en-US', docLang));
    const validUntilStr = quote.validUntil
      ? parseLocalDate(quote.validUntil).toLocaleDateString(intlLocale('en-GB', docLang), {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : tr('{days} days', { days: quote.validityDays || settings.default_validity_days || 30 });

    const venueLocation = [
      quote.venueName || (quote as any).venue,
      quote.venueCity || (quote as any).city,
    ]
      .filter(Boolean)
      .join(', ');

    const amount = snap.totalLabel;
    const lines = [
      quote.clientName ? tr('Hi {name},', { name: quote.clientName }) : tr('Hi there,'),
      ``,
      tr('Here is the official event proposal from {band} for "{event}":', {
        band: bandName.toUpperCase(),
        event: quote.eventName || quote.eventTitle || eventLabel,
      }),
      tr('• Quote Ref: {ref}', { ref: quote.quoteNumber || 'EVT-QUOTE' }),
      tr('• Event Date: {date}', { date: eventDateStr }),
      tr('• Location: {place}', { place: venueLocation || tr('TBD', { context: 'doc' }) }),
      tr('• Lineup: {count} Musicians', { count: quote.musicianCount || (quote.musicians || []).length || 1 }),
      quote.vatExempt
        ? tr('• Total Proposal: {amount} (VAT Exempt)', { amount })
        : tr('• Total Proposal: {amount} (incl. {rate}% VAT)', { amount, rate: quote.reverseCharge ? 0 : quote.vatRate ?? settings.default_vat_rate ?? DEFAULT_VAT_RATE }),
      snap.deposit
        ? tr('• Booking Deposit ({percent}%): {amount}', {
            percent: snap.deposit.percent,
            amount: docMoney(snap.deposit.amount),
          })
        : null,
      tr('• Valid Until: {date}', { date: validUntilStr }),
      ``,
      tr('Please let us know if you have any questions or would like to tailor the package!'),
      tr('Best regards,'),
      settings.signer_name || bandName,
    ].filter((line): line is string => line !== null);

    return lines.join('\n');
  };

  const shareTitle = tr('{band} — Quote {ref}', { band: bandName, ref: quote.quoteNumber || '' }).trim();

  /** WhatsApp or the mail app with the message, to the client when known. */
  const openComposer = (channel: 'whatsapp' | 'email') => {
    const text = buildShareText();
    if (channel === 'whatsapp') {
      const phone = (quote.clientPhone || '').replace(/[^0-9+]/g, '').replace(/^\+/, '');
      void openExternal(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`);
    } else {
      void openExternal(`mailto:${encodeURIComponent(quote.clientEmail || '')}?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(text)}`);
    }
  };

  /**
   * System share sheet with the PDF attached (Mail, WhatsApp, Files, AirDrop…).
   * `channel`: where the user asked to send it. Without file sharing (a
   * desktop browser) the PDF is downloaded and that channel opens with the
   * message, to attach the file there (Codex #281 r2).
   */
  const sharePdf = async (opts: { markAsSent: boolean; withText: boolean; channel?: 'whatsapp' | 'email' }) => {
    if (!pdfResult) return;
    try {
      const result = await shareFile(pdfResult.pdfBlob, pdfResult.fileName, {
        title: shareTitle,
        text: opts.withText ? buildShareText() : undefined,
      });
      if (result === 'cancelled') return;
      if (result === 'downloaded' && opts.channel) {
        openComposer(opts.channel);
        flash(t('PDF downloaded. Attach it to your message.'));
      } else if (result === 'downloaded') flash(t('PDF downloaded'));
      else flash(opts.markAsSent ? t('Quote shared') : t('PDF ready'));
      if (opts.markAsSent) void markSent();
    } catch (err) {
      console.error('[QuoteShareModal] Share failed:', err);
      flash(t('Could not share the PDF. Try again.'), 'error');
    }
  };

  const handleNativeShare = () => sharePdf({ markAsSent: true, withText: true });

  /** Download = save the file on the device (Share opens the system sheet). */
  const handleDownload = async () => {
    if (!pdfResult) return;
    try {
      const { result, location } = await saveFile(pdfResult.pdfBlob, pdfResult.fileName);
      if (result === 'saved') flash(t('PDF saved to {location}', { location: String(location) }));
      else if (result === 'downloaded') flash(t('PDF downloaded'));
      else if (result === 'shared') flash(t('PDF ready'));
    } catch (err) {
      console.error('[QuoteShareModal] Save failed:', err);
      flash(t('Could not save the PDF. Try Share instead.'), 'error');
    }
  };

  // WhatsApp and Mail are in the system sheet, with the file attached.
  const handleWhatsAppShare = () => void sharePdf({ markAsSent: true, withText: true, channel: 'whatsapp' });
  const handleEmailShare = () => void sharePdf({ markAsSent: true, withText: true, channel: 'email' });

  const handleCopySummary = () => {
    const text = buildShareText();
    const done = () => {
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2500);
      void markSent();
    };
    try {
      navigator.clipboard.writeText(text).then(done, () => flash(t('Could not copy. Use Share PDF instead.'), 'error'));
    } catch {
      flash(t('Could not copy. Use Share PDF instead.'), 'error');
    }
  };

  const missingBranding = !settings.band_logo_url || !hasBankAccount(settings);

  // Band settings open on top of this sheet (BandPricingModal is portaled
  // above it); saving there re-renders the PDF here with the new branding.
  const openBandSettings = onOpenBandSettings;
  const pageCount = pdfResult?.pageDataUrls.length ?? 0;

  const shareChannels: {
    key: string;
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    onClick: () => void;
    disabled: boolean;
  }[] = [
    {
      key: 'native',
      title: t('Share PDF document'),
      subtitle: t('Native share sheet'),
      icon: <Share2 />,
      onClick: handleNativeShare,
      disabled: stale || isGenerating || !pdfResult,
    },
    {
      key: 'whatsapp',
      title: 'WhatsApp',
      subtitle: t('Send the PDF file'),
      icon: isUploading ? <Loader2 className="animate-spin" /> : <MessageCircle />,
      onClick: handleWhatsAppShare,
      disabled: stale || isGenerating || isUploading || !pdfResult,
    },
    {
      key: 'email',
      title: t('Email client'),
      subtitle: t('PDF as attachment'),
      icon: isUploading ? <Loader2 className="animate-spin" /> : <Mail />,
      onClick: handleEmailShare,
      disabled: stale || isGenerating || isUploading || !pdfResult,
    },
    {
      key: 'download',
      title: t('Download PDF'),
      subtitle: Capacitor.isNativePlatform() ? t('Save a copy on this device') : t('Save to your computer'),
      icon: <Download />,
      onClick: handleDownload,
      disabled: stale || isGenerating || !pdfResult,
    },
    {
      key: 'copy',
      title: copiedSummary ? t('Copied!') : t('Copy summary'),
      subtitle: t('Paste anywhere'),
      icon: copiedSummary ? <Check className="text-success" /> : <Copy />,
      onClick: handleCopySummary,
      disabled: stale || isGenerating || isUploading || !pdfResult,
    },
  ];

  const linkReady = canShareLink && pdfSettled;
  const firstName = (quote.clientName || '').trim().split(/\s+/)[0];
  const linkChannels: typeof shareChannels = [
    {
      key: 'link-whatsapp',
      title: 'WhatsApp',
      subtitle: t('Message with the quote link'),
      icon: <MessageCircle />,
      onClick: () => sendLinkVia('whatsapp'),
      disabled: !linkReady,
    },
    {
      key: 'link-sms',
      title: t('Text message'),
      subtitle: t('Message with the quote link'),
      icon: <Smartphone />,
      onClick: () => sendLinkVia('sms'),
      disabled: !linkReady,
    },
    {
      key: 'link-email',
      title: t('Email'),
      subtitle: current().clientEmail ? t('To {email}, with the PDF', { email: current().clientEmail || '' }) : t('Add the client’s email to the quote first.'),
      icon: emailing ? <Loader2 className="animate-spin" /> : <Mail />,
      onClick: () => void emailLink(),
      disabled: !linkReady || emailing || !current().clientEmail,
    },
    {
      key: 'link-copy',
      title: copiedLink ? t('Copied!') : t('Copy message & link'),
      subtitle: t('Paste anywhere'),
      icon: copiedLink ? <Check className="text-success" /> : <Link />,
      onClick: () => sendLinkVia('copy'),
      disabled: !linkReady,
    },
  ];
  const pdfChannels = shareChannels.filter((c) => c.key === 'native' || c.key === 'download');
  const heading = kind === 'reminder' ? t('Remind client') : kind === 'updated' ? t('Send the update') : t('PDF ready');

  const renderChannel = (ch: (typeof shareChannels)[number]) => (
    <button
      key={ch.key}
      type="button"
      onClick={ch.onClick}
      disabled={ch.disabled}
      className="w-full flex items-center gap-3 p-4 rounded-[16px] bg-sheet text-sheet-foreground text-left active:scale-[0.99] transition-transform disabled:opacity-40"
    >
      <span className="w-10 h-10 rounded-full bg-foreground/[0.08] flex items-center justify-center shrink-0 [&_svg]:w-5 [&_svg]:h-5">
        {ch.icon}
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-1">
        <span className="bw-body-lg truncate">{ch.title}</span>
        <span className="bw-body-sm text-muted-foreground truncate">{ch.subtitle}</span>
      </span>
      <ChevronRight className="w-5 h-5 shrink-0" aria-hidden />
    </button>
  );

  // Portaled to <body>: some callers render it inside a scrolling pane, where
  // WKWebView clips fixed children (the Done bar could end up untappable).
  return createPortal(
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ type: 'tween', duration: 0.25 }}
      role="dialog"
      aria-modal="true"
      aria-label={t('Quote PDF ready')}
      className="bw-pane-detail dark fixed inset-0 z-[120] flex flex-col bg-background text-foreground"
    >
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div
          className="max-w-xl mx-auto w-full px-4 flex flex-col gap-4"
          style={{ paddingTop: 'calc(var(--safe-top) + 16px)', paddingBottom: 24 }}
        >
          {/* Header: kicker + close, then branding / regenerate */}
          <header className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <p className="bw-label-sm text-muted-foreground truncate">
                  {quote.quoteNumber || t('Draft')} · {t('Official quote')}
                </p>
                <h1 className="bw-display-lg">{heading}</h1>
              </div>
              <RailCover pane />
              <HeaderAction pane label={t('Close')} variant="filled" railProminent={false} icon={<X />} onClick={onClose} />
            </div>
            <div className="flex items-center gap-2">
              {openBandSettings && (
                <PillButton
                  variant="outline"
                  size="sm"
                  fullWidth={false}
                  icon={<IconSettings className="w-3.5 h-3.5" />}
                  onClick={openBandSettings}
                  title={t('Configure band logo, signature & payment details')}
                >
                  {t('Branding & payment')}
                </PillButton>
              )}
              <IconButton
                label={t('Regenerate PDF preview')}
                size="sm"
                icon={<RefreshCw className={isGenerating ? 'animate-spin' : undefined} />}
                onClick={loadAndGenerate}
                disabled={isGenerating}
              />
            </div>
          </header>

          {autoSendEmail && (() => {
            const note =
              autoNote ??
              (linkError || generateError || !canLink
                ? { text: t('The quote could not be sent automatically. Pick a channel below.'), tone: 'error' as const }
                : null);
            return (
            <p
              role="status"
              aria-live="polite"
              className={`flex items-center gap-2 min-h-11 px-4 py-2 rounded-[16px] bw-body-sm ${
                note?.tone === 'error'
                  ? 'bg-destructive-solid text-white'
                  : note?.tone === 'ok'
                    ? 'bg-success text-success-foreground'
                    : 'bg-card text-muted-foreground'
              }`}
            >
              {note?.tone === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0" />
              ) : note?.tone === 'ok' ? (
                <Check className="w-4 h-4 shrink-0" />
              ) : (
                <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
              )}
              <span className="min-w-0 [overflow-wrap:anywhere]">{note?.text ?? t('Preparing the quote…')}</span>
            </p>
            );
          })()}

          {/* A4 preview */}
          <section className="bg-card rounded-[24px] p-4 flex flex-col items-center gap-3">
            {pageCount > 1 && pdfResult && (
              <div className="w-full flex items-center gap-2">
                <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
                  {pdfResult.pageDataUrls.map((_, idx) => {
                    const isSummaryPage = idx === pageCount - 1 && pageCount > 1 && quote.includeProposalSummary;
                    return (
                      <Selector key={idx} selected={activePageIndex === idx} onClick={() => setActivePageIndex(idx)}>
                        {isSummaryPage ? t('Page {page} · Summary', { page: idx + 1 }) : t('Page {page}', { page: idx + 1 })}
                      </Selector>
                    );
                  })}
                </div>
                <IconButton
                  label={t('Previous page')}
                  size="sm"
                  variant="ghost"
                  icon={<ChevronLeft />}
                  onClick={() => setActivePageIndex((p) => Math.max(0, p - 1))}
                  disabled={activePageIndex === 0}
                />
                <IconButton
                  label={t('Next page')}
                  size="sm"
                  variant="ghost"
                  icon={<ChevronRight />}
                  onClick={() => setActivePageIndex((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={activePageIndex === pageCount - 1}
                />
              </div>
            )}

            <div className="relative w-full flex items-center justify-center overflow-hidden">
              {generateError && !isGenerating ? (
                <div className="w-full max-w-[260px] aspect-[1/1.414] bg-card rounded-[16px] flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <AlertCircle className="w-7 h-7 text-destructive" />
                  <p className="bw-body-sm">{t('The PDF could not be created.')}</p>
                  <PillButton variant="outline" size="sm" fullWidth={false} icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={loadAndGenerate}>
                    {t('Try again')}
                  </PillButton>
                </div>
              ) : isGenerating || !pdfResult ? (
                <div className="w-full max-w-[260px] aspect-[1/1.414] bg-white text-black rounded-[16px] flex flex-col items-center justify-center gap-3 p-6">
                  <Loader2 className="w-7 h-7 animate-spin" />
                  <p className="bw-label-xs text-black/60 text-center">{t('Rendering A4 PDF…')}</p>
                </div>
              ) : (
                <AnimatePresence mode="wait">
                  <motion.img
                    key={activePageIndex}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.18 }}
                    src={pdfResult.pageDataUrls[activePageIndex]}
                    alt={t('Quote PDF page {page}', { page: activePageIndex + 1 })}
                    className="max-h-[52vh] w-auto max-w-full object-contain rounded-[16px] bg-white"
                  />
                </AnimatePresence>
              )}
            </div>

            <p className="bw-label-xs text-muted-foreground text-center">
              {pdfResult
                ? t('A4 portrait · Page {page} of {count} · {size} KB', {
                    page: activePageIndex + 1,
                    count: pageCount,
                    size: (pdfResult.pdfBlob.size / 1024).toFixed(0),
                  })
                : t('A4 portrait · Preparing…')}
            </p>
          </section>

          {/* Missing branding tip */}
          {missingBranding && openBandSettings && (
            <button
              type="button"
              onClick={openBandSettings}
              className="w-full flex items-center gap-3 p-4 rounded-[16px] bg-card text-left active:scale-[0.99] transition-transform"
            >
              <AlertCircle className="w-5 h-5 shrink-0 text-warning" />
              <span className="flex-1 min-w-0 flex flex-col gap-1">
                <span className="bw-label-sm text-foreground">{t('Complete your band branding')}</span>
                <span className="bw-body-sm text-muted-foreground">
                  {!settings.band_logo_url
                    ? t('Add logo and signature to the PDF')
                    : t('Add your bank account to show transfer details on the quote.')}
                </span>
              </span>
              <ChevronRight className="w-5 h-5 shrink-0" aria-hidden />
            </button>
          )}

          <OnlineDepositLinks />

          <DocLanguagePicker value={docLang} onChange={changeDocLang} className="pt-2" />

          {canLink ? (
            <>
              {/* The client's link (099): accept, decline or discuss on /quote.html */}
              <section className="flex flex-col gap-2" aria-labelledby="send-to-client">
                <h2 id="send-to-client" className="bw-label-sm text-muted-foreground pt-2">{t('Send to client')}</h2>
                <p className="bw-body-sm text-muted-foreground">
                  {firstName
                    ? t('A personal link where {name} can accept the quote, decline it or ask you questions. You get a notification for each answer.', { name: firstName })
                    : t('A personal link where the client can accept the quote, decline it or ask you questions. You get a notification for each answer.')}
                </p>
                {link?.revoked ? (
                  <div className="flex flex-col gap-3 p-4 rounded-[16px] bg-card">
                    <p className="bw-body-sm">{t('The link of this quote is turned off.')}</p>
                    <PillButton variant="outline" size="sm" fullWidth={false} icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => void newLink()}>
                      {t('Create a new link')}
                    </PillButton>
                  </div>
                ) : stale ? (
                  <p role="alert" className="bw-body-sm text-destructive">{t('This quote changed meanwhile (another client, or another admin). Close this and open the quote again.')}</p>
                ) : linkError ? (
                  <p role="alert" className="bw-body-sm text-destructive">{t('The client link could not be prepared. Check your connection and reopen this screen.')}</p>
                ) : (
                  <>
                    {recipientNow && (
                      <div role="alert" data-testid="quote-recipient-changed" className="flex flex-col gap-3 p-4 rounded-[16px] bg-card">
                        <p className="bw-body-sm">
                          {t('This quote now goes to {name}. Nothing was sent: close this and open the quote again.', {
                            name: [recipientNow.contact.client_name, recipientNow.contact.client_email || recipientNow.contact.client_phone].filter(Boolean).join(' · '),
                          })}
                        </p>
                      </div>
                    )}
                    {linkChannels.map(renderChannel)}
                  </>
                )}
              </section>
              <section className="flex flex-col gap-2">
                <h2 className="bw-label-sm text-muted-foreground pt-2">{t('PDF only')}</h2>
                {pdfChannels.map(renderChannel)}
              </section>
            </>
          ) : (
            <section className="flex flex-col gap-2">
              <h2 className="bw-label-sm text-muted-foreground pt-2">{t('Share quote via')}</h2>
              {shareChannels.map(renderChannel)}
            </section>
          )}

          {shareFeedback && (
            <p
              role="status"
              className={`self-center inline-flex items-center gap-2 min-h-9 px-4 py-2 rounded-full bw-button-sm ${
                shareFeedback.tone === 'ok' ? 'bg-success text-success-foreground' : 'bg-destructive-solid text-white'
              }`}
            >
              {shareFeedback.tone === 'ok' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {shareFeedback.text}
            </p>
          )}
        </div>
      </div>

      {/* Done */}
      <div className="shrink-0 px-4 pt-3" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}>
        <div className="max-w-xl mx-auto w-full">
          <PillButton icon={<Check className="w-[18px] h-[18px]" />} onClick={onClose}>
            {t('Done')}
          </PillButton>
        </div>
      </div>
    </motion.div>,
    document.body,
  );
};
