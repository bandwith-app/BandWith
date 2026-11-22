import React, { useState } from 'react';
import { Calendar, CalendarPlus, ChevronRight, Copy, Check, RefreshCw, Eye } from '@/app/components/icons';
import { PillButton } from '@/app/components/bw';
import { cn } from '@/app/components/ui/utils';
import { useT } from '@/lib/i18n';
import { openExternal } from '@/lib/nativeFiles';
import { CalendarLinkNotice } from '@/app/components/calendar/CalendarLinkNotice';
import { googleSubscribeUrl, memberCalendarUrl, myCalendarToken, useCalendarToken, webcalUrl } from '@/lib/memberCalendar';

const CARD = 'bg-card text-card-foreground rounded-[24px]';
const ROW = 'p-4 flex items-center gap-3 w-full text-left';
const PRESSABLE =
  'transition-colors hover:bg-foreground/[0.03] active:bg-foreground/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60';

const Tile: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span aria-hidden className="size-10 rounded-full bg-foreground/[0.08] flex items-center justify-center text-foreground shrink-0 [&>svg]:size-[18px]">
    {children}
  </span>
);

const Text: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <span className="flex flex-col gap-1 min-w-0 flex-1">
    <span className="bw-label-md text-foreground">{title}</span>
    {hint && <span className="bw-body-sm text-muted-foreground">{hint}</span>}
  </span>
);

/**
 * Settings → Calendar sync: subscribe to your BandWith events (migration
 * 165, edge function member-calendar) in Apple Calendar, Google Calendar or
 * anything that takes a calendar link. The calendar app checks the link
 * itself, so changes and cancellations follow. Logistics only, no fees.
 */
export const CalendarSyncSection: React.FC = () => {
  const t = useT();
  const { token: loadedToken, loading } = useCalendarToken(true);
  const [rotated, setRotated] = useState<string | null>(null);
  const token = rotated ?? loadedToken;
  const feed = token ? memberCalendarUrl(token) : null;
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = async () => {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t('Couldn’t copy the link. Try again.'));
    }
  };

  const reset = async () => {
    setResetting(true);
    setError(null);
    const next = await myCalendarToken(true);
    setResetting(false);
    setConfirmReset(false);
    if (next) {
      setRotated(next);
      setResetDone(true);
    } else {
      setError(t('Couldn’t make a new link. Check your connection and try again.'));
    }
  };

  const unavailable = !loading && !feed;

  return (
    <div className="flex flex-col gap-3" data-testid="calendar-sync">
      <CalendarLinkNotice />
      <div className={cn(CARD, 'p-4 flex items-start gap-3')}>
        <Tile>
          <Calendar />
        </Tile>
        <Text
          title={t('Your events in your calendar')}
          hint={t('Gigs, rehearsals and personal gigs you’re part of appear in your phone’s calendar and update by themselves when something changes. Calendars check every few hours; Google can take up to a day.')}
        />
      </div>

      <div className={cn(CARD, 'flex flex-col')}>
        <button type="button" disabled={!feed} onClick={() => feed && void openExternal(webcalUrl(feed))} className={cn(ROW, PRESSABLE)}>
          <Tile>
            <CalendarPlus />
          </Tile>
          <Text title={t('Apple Calendar')} hint={t('iPhone, iPad and Mac')} />
          <ChevronRight aria-hidden className="w-[18px] h-[18px] text-foreground shrink-0" />
        </button>
        <button
          type="button"
          disabled={!feed}
          onClick={() => feed && void openExternal(googleSubscribeUrl(feed))}
          className={cn(ROW, PRESSABLE, 'border-t border-border')}
        >
          <Tile>
            <CalendarPlus />
          </Tile>
          <Text title={t('Google Calendar')} hint={t('Android and the web; it then shows on every device signed in to Google')} />
          <ChevronRight aria-hidden className="w-[18px] h-[18px] text-foreground shrink-0" />
        </button>
        <button type="button" disabled={!feed} onClick={() => void copy()} className={cn(ROW, PRESSABLE, 'border-t border-border')}>
          <Tile>{copied ? <Check /> : <Copy />}</Tile>
          <Text title={copied ? t('Link copied') : t('Copy the link')} hint={t('For Outlook or another calendar: add a calendar “from URL” and paste it')} />
        </button>
      </div>

      {loading && <p className="bw-body-sm text-muted-foreground" role="status">{t('Preparing your link…')}</p>}
      {unavailable && (
        <p role="alert" className="bw-body-sm text-destructive">
          {t('Calendar sync isn’t available right now. Check your connection and try again.')}
        </p>
      )}

      <div className={cn(CARD, 'p-4 flex items-start gap-3')}>
        <Tile>
          <Eye />
        </Tile>
        <Text
          title={t('Only for you')}
          hint={t('Anyone with this link sees your events (no fees, no client details). Don’t share it. If you did, make a new one: the old link stops working.')}
        />
      </div>

      {!confirmReset ? (
        <button type="button" disabled={!feed || resetting} onClick={() => { setConfirmReset(true); setResetDone(false); }} className={cn(CARD, ROW, PRESSABLE)}>
          <Tile>
            <RefreshCw />
          </Tile>
          <Text title={resetDone ? t('New link ready') : t('Make a new link')} hint={resetDone ? t('Add it to your calendar again: the old one no longer updates.') : t('The old link stops working')} />
        </button>
      ) : (
        <div className={cn(CARD, 'p-4 flex flex-col gap-3')} role="group" aria-label={t('Make a new link')}>
          <p className="bw-body-md text-foreground">
            {t('The calendars you added stop updating. You’ll need to add the new link again. Continue?')}
          </p>
          <div className="flex flex-wrap gap-2">
            <PillButton size="sm" variant="primary" fullWidth={false} disabled={resetting} onClick={() => void reset()}>
              {resetting ? t('Making…') : t('Make a new link')}
            </PillButton>
            <PillButton size="sm" variant="ghost" fullWidth={false} disabled={resetting} onClick={() => setConfirmReset(false)}>
              {t('Cancel')}
            </PillButton>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="bw-body-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
};
