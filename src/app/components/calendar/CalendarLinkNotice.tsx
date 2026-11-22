import React, { useState } from 'react';
import { PillButton } from '@/app/components/bw/Form';
import { cn } from '@/app/components/ui/utils';
import { useT } from '@/lib/i18n';
import { keepMyCalendarLink, replaceMyCalendarLink, useCalendarLinkReview } from '@/lib/memberCalendar';

/**
 * Asked once (migration 182): "Add to calendar" links made before 182 had
 * the account's calendar link inside, so whoever got one could see every
 * event. "Make a new link" replaces it (subscriptions are added again);
 * "Keep my link" stops asking. Shown in the event, next to Add to calendar,
 * and in Settings → Calendar sync. Not rotated by itself: that would
 * silently stop the calendars the user subscribed.
 */
export const CalendarLinkNotice: React.FC<{ className?: string }> = ({ className }) => {
  const t = useT();
  const needsReview = useCalendarLinkReview();
  const [busy, setBusy] = useState<'new' | 'keep' | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!needsReview && !done) return null;

  const replace = async () => {
    setBusy('new');
    setError(null);
    const ok = await replaceMyCalendarLink();
    setBusy(null);
    if (ok) setDone(true);
    else setError(t('Couldn’t make a new link. Check your connection and try again.'));
  };
  const keep = async () => {
    setBusy('keep');
    setError(null);
    const ok = await keepMyCalendarLink();
    setBusy(null);
    if (!ok) setError(t('Something went wrong. Please try again in a moment.'));
  };

  return (
    <div
      className={cn('rounded-[20px] border border-border bg-card text-card-foreground p-4 flex flex-col gap-3 min-w-0', className)}
      data-testid="calendar-link-review"
      role="region"
      aria-label={t('Check your calendar link')}
    >
      {done ? (
        <div className="flex flex-col gap-1 min-w-0" role="status">
          <p className="bw-label-md text-foreground">{t('New link ready')}</p>
          <p className="bw-body-sm text-muted-foreground [overflow-wrap:anywhere]">{t('Add it to your calendar again: the old one no longer updates.')}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1 min-w-0">
            <p className="bw-label-md text-foreground">{t('Check your calendar link')}</p>
            <p className="bw-body-sm text-muted-foreground [overflow-wrap:anywhere]">
              {t('Until now, “Add to calendar” links had your private calendar link inside. If you sent one to anyone, make a new link: with the old one they can see all your events. If you subscribed in a calendar, add the new link there again.')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <PillButton size="sm" variant="primary" fullWidth={false} disabled={!!busy} onClick={() => void replace()}>
              {busy === 'new' ? t('Making…') : t('Make a new link')}
            </PillButton>
            <PillButton size="sm" variant="ghost" fullWidth={false} disabled={!!busy} onClick={() => void keep()}>
              {t('Keep my link')}
            </PillButton>
          </div>
          {error && (
            <p role="alert" className="bw-body-sm text-destructive">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
};
