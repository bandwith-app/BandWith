import React from 'react';
import { CalendarPlus } from '@/app/components/icons';
import { PillButton } from '@/app/components/bw/Form';
import { cn } from '@/app/components/ui/utils';
import { getLocale, useT } from '@/lib/i18n';
import { GIG_LABELS, googleCalendarUrl, type DeputyGig } from '@/lib/deputyCalendar';
import { openExternal } from '@/lib/nativeFiles';
import { memberEventCalendarUrl, useEventCalendarToken } from '@/lib/memberCalendar';
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
  const { token } = useEventCalendarToken(event.eventId, event.date);
  const file = token ? memberEventCalendarUrl(token) : null;
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
          disabled={!file}
          icon={<CalendarPlus className="w-4 h-4" aria-hidden />}
          onClick={() => file && void openExternal(file)}
        >
          {t('Add to calendar')}
        </PillButton>
        <PillButton size="sm" variant="ghost" fullWidth={false} onClick={() => void openExternal(googleCalendarUrl(gig, labels))}>
          {t('Google Calendar')}
        </PillButton>
      </div>
    </div>
  );
};
