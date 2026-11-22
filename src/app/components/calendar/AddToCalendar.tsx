import React from 'react';
import { Capacitor } from '@capacitor/core';
import { CalendarPlus } from '@/app/components/icons';
import { PillButton } from '@/app/components/bw/Form';
import { cn } from '@/app/components/ui/utils';
import { getLocale, useT } from '@/lib/i18n';
import { GIG_LABELS, calendarFile, gigEvent, googleCalendarUrl, type DeputyGig } from '@/lib/deputyCalendar';
import { openExternal, shareFile } from '@/lib/nativeFiles';
import {
  eventCalendarLinksMissing,
  memberEventCalendarUrl,
  myEventCalendarToken,
  useEventCalendarToken,
} from '@/lib/memberCalendar';
import { CalendarLinkNotice } from './CalendarLinkNotice';

export interface CalendarEventInfo {
  eventId: string;
  title: string;
  bandName?: string | null;
  rehearsal?: boolean;
  /** YYYY-MM-DD */
  date: string;
  loadIn?: string | null;
  soundcheck?: string | null;
  start?: string | null;
  end?: string | null;
  venue?: string | null;
  city?: string | null;
  address?: string | null;
}

/**
 * "Add to calendar" for one event: the .ics file from member-calendar (Apple
 * Calendar on iPhone / iPad / Mac, Outlook) and Google Calendar. Logistics
 * only, never fees. Settings → Calendar sync keeps every event in sync.
 *
 * The file link carries a token bound to this event and this date (182),
 * never the account's feed token: forwarding the link shares this event
 * only. One date of a repeating rehearsal comes alone, not the series.
 */
export const AddToCalendar: React.FC<{ event: CalendarEventInfo; className?: string }> = ({ event, className }) => {
  const t = useT();
  // Opening the event only reads its link; the first tap makes it (Claude
  // review of #285, round 5: an open writes nothing on the server).
  // The file is only ever the hook's current link: a link made on a tap
  // comes back through the hook, and "Make a new link" ends it there (Codex
  // review #285 round 5).
  const { token, loading, legacy } = useEventCalendarToken(event.eventId, event.date);
  const [failed, setFailed] = React.useState(false);
  const file = token ? memberEventCalendarUrl(token) : null;
  const [making, setMaking] = React.useState(false);

  const add = async () => {
    setFailed(false);
    if (file) {
      void openExternal(file);
      return;
    }
    if (legacy) {
      void handOver();
      return;
    }
    // On the web the window opens in the tap (a window opened after an await
    // is a blocked pop-up); the app hands the link to the system afterwards.
    const w = Capacitor.isNativePlatform() ? null : window.open('', '_blank');
    setMaking(true);
    const next = await myEventCalendarToken(event.eventId, event.date, { create: true }).catch(() => null);
    const url = next ? memberEventCalendarUrl(next) : null;
    setMaking(false);
    if (!url && eventCalendarLinksMissing()) {
      w?.close();
      void handOver();
      return;
    }
    if (!url) {
      w?.close();
      setFailed(true);
      return;
    }
    if (w) {
      try {
        w.opener = null;
      } catch {
        /* cross-origin */
      }
      w.location.href = url;
    } else void openExternal(url);
  };
  // A database without 182 (PGRST202: the functions are not deployed yet;
  // Claude review #285 r5 M4, Codex B2): this event's .ics, made here and
  // handed to the system. No link, so no token: the account's feed token
  // never goes into a one-event link. It doesn't follow later changes.
  const handOver = async () => {
    const ics = calendarFile(
      [gigEvent(gig, labels, `event-${event.eventId}-${event.date.replace(/-/g, '')}`)],
      undefined,
      'Member',
    );
    try {
      await shareFile(new Blob([ics], { type: 'text/calendar' }), 'bandwith-event.ics', { title: gig.title });
    } catch {
      setFailed(true);
    }
  };
  const labels = GIG_LABELS[getLocale()] ?? GIG_LABELS.en;
  const gig: DeputyGig = {
    title: event.title || (event.rehearsal ? t('Rehearsal') : t('Gig')),
    bandName: event.bandName ?? '',
    kind: event.rehearsal ? 'rehearsal' : 'gig',
    date: event.date,
    loadIn: event.loadIn,
    soundcheck: event.soundcheck,
    start: event.start,
    end: event.end,
    venue: event.venue,
    city: event.city,
    address: event.address,
  };

  return (
    <div className={cn('flex flex-col gap-3 min-w-0', className)} data-testid="add-to-calendar">
      <CalendarLinkNotice />
      <div className="flex flex-wrap gap-2">
        <PillButton
          size="sm"
          variant="outline"
          fullWidth={false}
          disabled={!file && loading}
          loading={making}
          icon={<CalendarPlus className="w-4 h-4" aria-hidden />}
          onClick={() => void add()}
        >
          {t('Add to calendar')}
        </PillButton>
        <PillButton size="sm" variant="ghost" fullWidth={false} onClick={() => void openExternal(googleCalendarUrl(gig, labels))}>
          {t('Google Calendar')}
        </PillButton>
      </div>
      {failed && (
        <p role="alert" className="bw-body-sm text-destructive">
          {t('Could not create the link.')}
        </p>
      )}
    </div>
  );
};
