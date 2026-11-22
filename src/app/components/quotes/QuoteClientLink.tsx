import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CalendarPlus,
  Check,
  Copy,
  Eye,
  FileSignature,
  Loader2,
  RefreshCw,
  Receipt,
  Send,
  Wallet,
  X,
} from '@/app/components/icons';
import { Card, Tag } from '@/app/components/bw/Screen';
import { PillButton } from '@/app/components/bw/Form';
import { cn } from '@/app/components/ui/utils';
import { useT, intlLocale } from '@/lib/i18n';
import { openExternal } from '@/lib/nativeFiles';
import type { Quote } from '@/app/data/quotes';
import {
  getQuoteLinkState,
  quoteLinkUrl,
  isLinkChangedError,
  recipientChangedAt,
  replyToQuoteClient,
  revokeQuoteLink,
  rotateQuoteLink,
  sendQuoteEmail,
  type QuoteActivity,
  type QuoteLinkRow,
  type QuoteMessageKind,
} from '@/lib/services/quoteLinks';

/**
 * The client's confirmation link of a quote (migration 099), in the quote
 * detail: where the client is (Sent → Viewed → Discussing → Accepted /
 * Declined), the conversation with the reply box, the timeline, and the
 * link's actions (remind, preview, copy, new link, turn off). After the
 * client accepts: "Create gig from quote" and "Prepare contract".
 */
export interface QuoteClientLinkProps {
  quote: Quote;
  /** Opens the send sheet with this message. */
  onSend: (kind: QuoteMessageKind) => void;
  /** Bumped by the parent after the send sheet changed the link. */
  refreshKey?: number;
  /** The quote's status changed on the client's side (refresh the list). */
  onStatusSeen?: (status: string) => void;
  onCreateGig?: () => void;
  creatingGig?: boolean;
  hasGig?: boolean;
  onPrepareContract?: () => void;
  /** Opens the final balance (saldo, migration 168). */
  onBalance?: () => void;
  /** Opens "Deposit received" (migration 168). */
  onDeposit?: () => void;
  notify?: (text: string, tone?: 'ok' | 'error') => void;
}

const POLL_MS = 20_000;

export const QuoteClientLink: React.FC<QuoteClientLinkProps> = ({
  quote,
  onSend,
  refreshKey = 0,
  onStatusSeen,
  onCreateGig,
  creatingGig,
  hasGig,
  onPrepareContract,
  onBalance,
  onDeposit,
  notify,
}) => {
  const t = useT();
  const [link, setLink] = useState<QuoteLinkRow | null>(null);
  const [activity, setActivity] = useState<QuoteActivity[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reply, setReply] = useState('');
  // Round 4: the link (client) a draft reply was started on. It is sent on
  // that link only: if the quote goes to another client meanwhile, the
  // draft is never sent to them.
  const [draftLink, setDraftLink] = useState<{ id?: string; token: string } | null>(null);
  // Round 5: who the draft was written to (the loaded conversation's
  // client). The same link written to someone else since (a corrected
  // name or email): a banner, and no send until the admin confirms.
  const [draftTo, setDraftTo] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const [confirm, setConfirm] = useState<'rotate' | 'revoke' | null>(null);
  const [copied, setCopied] = useState(false);
  const lastStatus = useRef<string | null>(null);
  // Kept in a ref so a new callback from the parent doesn't reload the state.
  const onStatusSeenRef = useRef(onStatusSeen);
  onStatusSeenRef.current = onStatusSeen;

  const load = useCallback(async () => {
    const { data } = await getQuoteLinkState(quote.id);
    setLoaded(true);
    if (!data) return;
    setLink(data.link);
    setActivity(data.activity);
    const status = data.link?.status ?? null;
    if (status && lastStatus.current && status !== lastStatus.current) onStatusSeenRef.current?.(status);
    lastStatus.current = status;
  }, [quote.id]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) void load();
    };
    const timer = window.setInterval(tick, POLL_MS);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, [load]);

  const when = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale('en-GB'), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  const messages = useMemo(() => activity.filter((a) => a.kind === 'client_message' || a.kind === 'band_reply'), [activity]);
  const changedAt = useMemo(() => recipientChangedAt(activity), [activity]);
  // 183: written on another link (the quote's previous client).
  const fromPrevious = (m: QuoteActivity) => (m.link_id && link?.id ? m.link_id !== link.id : !!changedAt && m.created_at < changedAt);
  const hadPrevious = !!changedAt || messages.some(fromPrevious);
  const timeline = useMemo(() => activity.filter((a) => a.kind !== 'client_message' && a.kind !== 'band_reply').slice().reverse(), [activity]);

  // An edit the client hasn't been told about: the last "updated" after the last send.
  const unannounced = useMemo(() => {
    let lastSend = -1;
    let lastUpdate = -1;
    activity.forEach((a, i) => {
      if (a.kind === 'sent' || a.kind === 'resent' || a.kind === 'reminded') lastSend = i;
      if (a.kind === 'updated') lastUpdate = i;
    });
    return lastUpdate > lastSend;
  }, [activity]);

  // 168: the last word on the deposit in the timeline.
  const depositIn = useMemo(() => {
    let on = false;
    for (const a of activity) {
      if (a.kind === 'deposit_received') on = true;
      if (a.kind === 'deposit_reopened') on = false;
    }
    return on;
  }, [activity]);

  const channelName = (c: string | null) =>
    c === 'whatsapp' ? 'WhatsApp' : c === 'sms' ? t('Text message') : c === 'email' ? t('Email') : c === 'copy' ? t('copied link') : null;

  const activityText = (a: QuoteActivity): string => {
    const via = channelName(a.channel);
    switch (a.kind) {
      case 'sent':
        return via ? t('Sent via {channel}', { channel: via }) : t('Sent');
      case 'resent':
        return via ? t('Sent again via {channel}', { channel: via }) : t('Sent again');
      case 'reminded':
        return via ? t('Reminder sent via {channel}', { channel: via }) : t('Reminder sent');
      case 'viewed':
        return t('Opened by the client');
      case 'updated':
        return t('Quote updated · version {n}', { n: a.version ?? '' });
      case 'accepted':
        return t('Accepted by {name}', { name: a.body || t('the client') });
      case 'declined':
        return a.body ? t('Declined: “{reason}”', { reason: a.body }) : t('Declined');
      case 'link_rotated':
        // 183: the client changed, the old client's link stopped working.
        return a.body === 'recipient_changed' ? t('New link for the new client') : t('New link created');
      case 'link_revoked':
        return t('Link turned off');
      case 'balance_requested':
        return via ? t('Balance requested via {channel}', { channel: via }) : t('Balance requested');
      case 'balance_updated':
        return t('Balance updated');
      case 'balance_reminded':
        return via ? t('Balance reminder via {channel}', { channel: via }) : t('Balance reminder sent');
      case 'balance_paid':
        return t('Balance received');
      case 'balance_reopened':
        return t('Balance open again');
      case 'deposit_received':
        return a.body === 'transfer'
          ? t('Deposit received · bank transfer')
          : a.body === 'cash'
            ? t('Deposit received · cash')
            : t('Deposit received');
      case 'deposit_reopened':
        return t('Deposit marked as not received');
      default:
        return '';
    }
  };

  // Round 5: the client of the loaded conversation (the link's recipient
  // as published), else the quote's contact (before 183's first publish).
  const recipientName = (link?.recipient_name ?? '').trim() || quote.clientName || t('Client');
  const recipientEmail = link && link.recipient_email !== undefined ? link.recipient_email || '' : quote.clientEmail || '';
  const recipientKey = `${recipientName.toLowerCase()}|${recipientEmail.toLowerCase()}`;
  const editReply = (value: string) => {
    setReply(value);
    if (!value.trim()) {
      setDraftLink(null);
      setDraftTo(null);
    } else {
      if (!draftLink && link) setDraftLink({ id: link.id, token: link.token });
      if (draftTo === null) setDraftTo(recipientKey);
    }
  };
  // Round 4: the quote went to another client since this draft was started.
  const draftOrphaned =
    !!reply.trim() && !!draftLink && (!link || (draftLink.id && link.id ? draftLink.id !== link.id : draftLink.token !== link.token));
  // Round 5: same link, another recipient than when the draft started.
  const draftReaddressed = !!reply.trim() && !draftOrphaned && draftTo !== null && draftTo !== recipientKey;
  const discardDraft = () => {
    setReply('');
    setDraftLink(null);
    setDraftTo(null);
  };
  const copyDraft = () => {
    try {
      navigator.clipboard.writeText(reply).then(
        () => notify?.(t('Copied')),
        () => notify?.(t('Could not copy the text.'), 'error'),
      );
    } catch {
      notify?.(t('Could not copy the text.'), 'error');
    }
  };

  // Shown wherever the panel is (the new client's link starts as a draft):
  // the text is the admin's, never sent to the new client.
  const orphanNotice = draftOrphaned ? (
    <div role="alert" className="flex flex-col gap-2 rounded-[20px] border border-border p-4">
      <p className="bw-body-sm">{t('The recipient changed: this draft was for the previous client.')}</p>
      <div className="grid grid-cols-2 gap-2">
        <PillButton size="md" variant="outline" icon={<Copy className="w-4 h-4" />} onClick={copyDraft}>
          {t('Copy')}
        </PillButton>
        <PillButton size="md" variant="outline" onClick={discardDraft}>
          {t('Discard')}
        </PillButton>
      </div>
    </div>
  ) : null;

  const readdressNotice = draftReaddressed ? (
    <div role="alert" data-testid="quote-reply-readdressed" className="flex flex-col gap-2 rounded-[20px] border border-border p-4">
      <p className="bw-body-sm">{t('This conversation is now with {name}. Check your reply before you send it.', { name: [recipientName, recipientEmail].filter(Boolean).join(' · ') })}</p>
      <PillButton size="md" variant="outline" onClick={() => setDraftTo(recipientKey)}>
        {t('Write to {name}', { name: recipientName })}
      </PillButton>
    </div>
  ) : null;

  const sendReply = async () => {
    const body = reply.trim();
    if (!body || replying || draftOrphaned || draftReaddressed) return;
    const on = draftLink ?? (link ? { id: link.id, token: link.token } : null);
    setReplying(true);
    // 183: on the link the draft was written on; if the quote went to
    // another client since, nothing is written (it never reaches them).
    const { error } = await replyToQuoteClient(quote.id, body, on?.token);
    if (error) {
      setReplying(false);
      if (isLinkChangedError(error)) {
        notify?.(t('This conversation was with the previous client. Your reply was not sent: open the quote again to write to the current client.'), 'error');
        void load();
      } else notify?.(t('Your reply was not sent. Try again.'), 'error');
      return;
    }
    setReply('');
    setDraftLink(null);
    setDraftTo(null);
    let emailed = false;
    // Round 4: the email of that same link (the server sends nothing if it was replaced).
    if (recipientEmail) emailed = (await sendQuoteEmail(quote.id, 'reply', on?.id)).ok;
    setReplying(false);
    notify?.(emailed ? t('Reply sent. The client also got it by email.') : t('Reply sent. It shows on the client’s page.'));
    void load();
  };

  const copyLink = () => {
    if (!link) return;
    try {
      navigator.clipboard.writeText(quoteLinkUrl(link.token)).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        },
        () => notify?.(t('Could not copy the link.'), 'error'),
      );
    } catch {
      notify?.(t('Could not copy the link.'), 'error');
    }
  };

  const runConfirm = async () => {
    const what = confirm;
    setConfirm(null);
    if (what === 'rotate') {
      const { error } = await rotateQuoteLink(quote.id);
      notify?.(error ? t('Could not create a new link. Try again.') : t('New link ready. The old one no longer works.'), error ? 'error' : 'ok');
    } else if (what === 'revoke') {
      const { error } = await revokeQuoteLink(quote.id);
      notify?.(error ? t('Could not turn off the link. Try again.') : t('Link turned off. The client can no longer open it.'), error ? 'error' : 'ok');
    }
    void load();
  };

  if (!loaded) {
    return (
      <section className="flex flex-col gap-4" aria-busy="true">
        <h2 className="bw-h1">{t('Client confirmation')}</h2>
        <Card className="items-center py-6">
          <Loader2 className="w-5 h-5 animate-spin" />
        </Card>
      </section>
    );
  }

  if (!link || link.status === 'draft') {
    // Answered outside the link (by phone, in person) or closed: nothing to
    // send; an accepted quote still gets its next steps.
    if (['ACCEPTED', 'DECLINED', 'EXPIRED', 'ARCHIVED'].includes(quote.status)) {
      if (quote.status !== 'ACCEPTED' || (!onCreateGig && !onPrepareContract && !onBalance && !onDeposit)) return null;
      return (
        <section className="flex flex-col gap-4">
          <h2 className="bw-h1">{t('Next steps')}</h2>
          <Card className="grid grid-cols-1 @min-[420px]:grid-cols-2 gap-2">
            {onCreateGig && (
              <PillButton size="md" loading={creatingGig} icon={<CalendarPlus className="w-4 h-4" />} onClick={onCreateGig}>
                {hasGig ? t('Confirm & open gig') : t('Create gig from quote')}
              </PillButton>
            )}
            {onPrepareContract && (
              <PillButton variant="outline" size="md" icon={<FileSignature className="w-4 h-4" />} onClick={onPrepareContract}>
                {t('Prepare contract')}
              </PillButton>
            )}
            {onDeposit && (
              <PillButton variant="outline" size="md" icon={<Receipt className="w-4 h-4" />} onClick={onDeposit}>
                {t('Deposit received')}
              </PillButton>
            )}
            {onBalance && (
              <PillButton variant="outline" size="md" className={onDeposit ? undefined : '@min-[420px]:col-span-2'} icon={<Wallet className="w-4 h-4" />} onClick={onBalance}>
                {t('Final balance')}
              </PillButton>
            )}
          </Card>
        </section>
      );
    }
    return (
      <section className="flex flex-col gap-4">
        <h2 className="bw-h1">{t('Client confirmation')}</h2>
        {orphanNotice}
        <Card>
          <p className="bw-body-md">
            {t('Send the quote with a personal link: the client accepts it, declines it or asks you questions without an account, and you see it here.')}
          </p>
          <PillButton size="md" icon={<Send className="w-4 h-4" />} onClick={() => onSend('sent')}>
            {t('Send to client')}
          </PillButton>
        </Card>
      </section>
    );
  }

  // An answer recorded in the app (by phone, in person) counts as the
  // client's answer here too, even before the link itself shows it.
  const linkFinal = link.status === 'accepted' || link.status === 'declined';
  const status = linkFinal ? link.status : quote.status === 'ACCEPTED' ? 'accepted' : quote.status === 'DECLINED' ? 'declined' : link.status;
  const answeredInApp = !linkFinal && status !== link.status;
  const final = status === 'accepted' || status === 'declined';
  const steps: { key: string; label: string; done: boolean; current: boolean }[] = [
    { key: 'sent', label: t('Sent'), done: true, current: status === 'sent' },
    { key: 'viewed', label: t('Viewed'), done: !!link.first_viewed_at, current: status === 'viewed' },
    {
      key: 'discussing',
      label: t('Discussing'),
      done: messages.some((m) => m.kind === 'client_message'),
      current: status === 'discussing',
    },
    {
      key: 'answer',
      label: status === 'declined' ? t('Declined') : t('Accepted'),
      done: final,
      current: final,
    },
  ];
  const revoked = !!link.revoked_at;

  return (
    <section className="@container flex flex-col gap-4" aria-labelledby="client-confirmation">
      <div className="flex items-center justify-between gap-3">
        <h2 id="client-confirmation" className="bw-h1">{t('Client confirmation')}</h2>
        <Tag variant={status === 'accepted' ? 'solid' : status === 'declined' ? 'outline' : 'quote'}>{steps.find((s) => s.current)?.label ?? t('Sent')}</Tag>
      </div>

      {/* Sent → Viewed → Discussing → Accepted / Declined */}
      <ol className="grid grid-cols-4 gap-1.5" aria-label={t('Client confirmation')}>
        {steps.map((s) => (
          <li key={s.key} className="flex flex-col gap-1.5 min-w-0" aria-current={s.current ? 'step' : undefined}>
            <span
              className={cn(
                'h-1.5 rounded-full',
                s.done ? (s.key === 'answer' && status === 'declined' ? 'bg-foreground/40' : 'bg-foreground') : 'bg-foreground/[0.12]',
              )}
            />
            <span className={cn('bw-label-xs truncate', s.done ? 'text-foreground' : 'text-muted-foreground')}>{s.label}</span>
          </li>
        ))}
      </ol>

      {revoked && (
        <Card className="gap-2">
          <p className="bw-body-sm">{t('The link of this quote is turned off.')}</p>
          <PillButton variant="outline" size="sm" fullWidth={false} icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => setConfirm('rotate')}>
            {t('Create a new link')}
          </PillButton>
        </Card>
      )}

      {status === 'accepted' && (
        <Card className="dark bg-sheet text-sheet-foreground">
          <p className="bw-body-md">
            {answeredInApp
              ? t('You marked this quote as accepted.')
              : t('Accepted by {name} on {date} · version {n}', {
                  name: link.accepted_name || t('the client'),
                  date: link.responded_at ? when(link.responded_at) : '',
                  n: link.accepted_version ?? link.version,
                })}
          </p>
          {!answeredInApp && <p className="bw-body-sm text-sheet-foreground/70">{t('A recorded acceptance, not a signature: formal signing stays in Contracts.')}</p>}
          <div className="grid grid-cols-1 @min-[420px]:grid-cols-2 gap-2">
            {onCreateGig && (
              <PillButton variant="white" size="md" loading={creatingGig} icon={<CalendarPlus className="w-4 h-4" />} onClick={onCreateGig}>
                {hasGig ? t('Confirm & open gig') : t('Create gig from quote')}
              </PillButton>
            )}
            {onPrepareContract && (
              <PillButton variant="outline" size="md" className="border-sheet-foreground text-sheet-foreground" icon={<FileSignature className="w-4 h-4" />} onClick={onPrepareContract}>
                {t('Prepare contract')}
              </PillButton>
            )}
            {onDeposit && (
              <PillButton
                variant="outline"
                size="md"
                className="border-sheet-foreground text-sheet-foreground"
                icon={<Receipt className="w-4 h-4" />}
                onClick={onDeposit}
              >
                {depositIn ? t('Deposit · received') : t('Deposit received')}
              </PillButton>
            )}
            {onBalance && (
              <PillButton
                variant="outline"
                size="md"
                className={cn(!onDeposit && '@min-[420px]:col-span-2', 'border-sheet-foreground text-sheet-foreground')}
                icon={<Wallet className="w-4 h-4" />}
                onClick={onBalance}
              >
                {link.balance_paid_at ? t('Balance · paid') : link.balance_sent_at ? t('Final balance · asked') : t('Final balance')}
              </PillButton>
            )}
          </div>
        </Card>
      )}

      {status === 'declined' && link.decline_reason && (
        <Card>
          <p className="bw-body-md">{t('Declined: “{reason}”', { reason: link.decline_reason })}</p>
        </Card>
      )}

      {unannounced && !final && !revoked && (
        <Card className="gap-2">
          <p className="bw-body-sm">{t('The client’s page already shows version {n}. Let them know.', { n: link.version })}</p>
          <PillButton size="md" icon={<Send className="w-4 h-4" />} onClick={() => onSend('updated')}>
            {t('Send the update')}
          </PillButton>
        </Card>
      )}

      {/* Conversation */}
      <Card className="gap-3">
        <h3 className="bw-label-md">{t('Conversation')}</h3>
        {messages.length === 0 ? (
          <p className="bw-body-sm text-muted-foreground">{t('No messages yet. The client can write to you from the quote page.')}</p>
        ) : (
          <ol className="flex flex-col gap-2" aria-live="polite">
            {messages.map((m, i) => (
              <React.Fragment key={m.id}>
              {/* Round 4: where the conversation with the current client starts. */}
              {i > 0 && fromPrevious(messages[i - 1]) && !fromPrevious(m) && (
                <li role="separator" className="self-stretch flex items-center gap-2 bw-label-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  {t('From here: {name}', { name: recipientName })}
                  <span className="h-px flex-1 bg-border" />
                </li>
              )}
              <li
                className={cn(
                  'max-w-[88%] rounded-[18px] px-4 py-3 bw-body-md whitespace-pre-wrap [overflow-wrap:anywhere]',
                  m.kind === 'band_reply' ? 'self-end bg-surface-inverse text-surface-inverse-foreground rounded-br-[6px]' : 'self-start bg-foreground/[0.06] rounded-bl-[6px]',
                )}
              >
                {m.body}
                <span className="block mt-1 bw-label-xs opacity-60">
                  {(m.kind === 'band_reply'
                    ? t('You')
                    : fromPrevious(m)
                      ? t('Previous client')
                      : recipientName) +
                    ' · ' +
                    when(m.created_at)}
                </span>
              </li>
              </React.Fragment>
            ))}
          </ol>
        )}
        {!revoked && (
          <div className="flex flex-col gap-2">
            <label htmlFor={`quote-reply-${quote.id}`} className="bw-label-sm text-muted-foreground">
              {t('Reply to the client')}
            </label>
            <textarea
              id={`quote-reply-${quote.id}`}
              value={reply}
              onChange={(e) => editReply(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder={t('e.g. Sure, I added the DJ set: the quote is updated.')}
              className="w-full rounded-[20px] bg-field border border-border p-4 bw-body-md text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground resize-none"
            />
            {orphanNotice}
            {readdressNotice}
            <PillButton size="md" loading={replying} disabled={!reply.trim() || draftOrphaned || draftReaddressed} icon={<Send className="w-4 h-4" />} onClick={() => void sendReply()}>
              {t('Send reply')}
            </PillButton>
            {hadPrevious && !draftOrphaned && (
              <p className="bw-body-sm">{t('You’re writing to {name}', { name: recipientName })}</p>
            )}
            <p className="bw-body-sm text-muted-foreground">
              {recipientEmail
                ? t('Your reply shows on the client’s page, and {email} gets it by email.', { email: recipientEmail })
                : t('Your reply shows on the client’s page.')}
            </p>
          </div>
        )}
      </Card>

      {/* Link actions */}
      {!revoked && (
        <div className="grid grid-cols-2 gap-2">
          {!final && (
            <PillButton variant="outline" size="md" className="col-span-2" icon={<Bell className="w-4 h-4" />} onClick={() => onSend('reminder')}>
              {t('Remind client')}
            </PillButton>
          )}
          <PillButton variant="outline" size="sm" icon={<Eye className="w-3.5 h-3.5" />} onClick={() => void openExternal(quoteLinkUrl(link.token, { preview: true }))}>
            {t('Preview page')}
          </PillButton>
          <PillButton variant="outline" size="sm" icon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} onClick={copyLink}>
            {copied ? t('Copied!') : t('Copy link')}
          </PillButton>
        </div>
      )}

      {/* Timeline */}
      <Card className="gap-2">
        <h3 className="bw-label-md">{t('Quote history')}</h3>
        <ol className="flex flex-col">
          {timeline.map((a, i) => (
            <li key={a.id} className={cn('flex items-baseline justify-between gap-3 py-2', i > 0 && 'border-t border-border')}>
              <span className="bw-body-sm min-w-0 [overflow-wrap:anywhere]">{activityText(a)}</span>
              <span className="bw-label-xs text-muted-foreground shrink-0">{when(a.created_at)}</span>
            </li>
          ))}
        </ol>
      </Card>

      {!revoked && (
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <button type="button" onClick={() => setConfirm('rotate')} className="inline-flex items-center gap-1.5 min-h-11 px-3 bw-button-sm text-foreground">
            <RefreshCw className="w-3.5 h-3.5" />
            {t('New link')}
          </button>
          <button type="button" onClick={() => setConfirm('revoke')} className="inline-flex items-center gap-1.5 min-h-11 px-3 bw-button-sm text-destructive">
            <X className="w-3.5 h-3.5" />
            {t('Turn off link')}
          </button>
        </div>
      )}

      {confirm && (
        <Card role="alertdialog" aria-labelledby="quote-link-confirm" className="gap-3 border border-foreground">
          <p id="quote-link-confirm" className="bw-body-md">
            {confirm === 'rotate'
              ? t('Create a new link? The one the client has stops working; send them the new one.')
              : t('Turn off the link? The client can no longer open the quote until you create a new link.')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <PillButton variant="outline" size="md" onClick={() => setConfirm(null)}>
              {t('Cancel')}
            </PillButton>
            <PillButton variant={confirm === 'revoke' ? 'danger' : 'primary'} size="md" onClick={() => void runConfirm()}>
              {confirm === 'rotate' ? t('New link') : t('Turn off')}
            </PillButton>
          </div>
        </Card>
      )}
    </section>
  );
};
