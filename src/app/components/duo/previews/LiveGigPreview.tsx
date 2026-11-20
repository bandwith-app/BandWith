import React from 'react';
import { Calendar, MapPin, Users } from '@/app/components/icons';
import { Tag } from '@/app/components/bw/Screen';
import { useT } from '@/lib/i18n';

/**
 * Figma "Duo · 04": while the new gig wizard is on its first step in the
 * two-pane book layout, the leading page shows the gig as it will be saved,
 * filling in as the user types. Read-only, styled like the wizard's
 * "Review & confirm" summary card. Every value comes from the wizard's form.
 */
export interface LiveGigPreviewProps {
  /** "Gig" or "Quote". */
  kindLabel: string;
  /** Event type label, e.g. "Wedding". */
  typeLabel?: string | null;
  /** "indoor" / "outdoor". */
  settingLabel?: string | null;
  title: string;
  /** Formatted date, or null while not set. */
  dateLabel?: string | null;
  /** e.g. "20:00 – 23:30". */
  timeLabel?: string | null;
  venue?: string | null;
  city?: string | null;
  lineupCount: number;
  /** Names of the selected musicians. */
  lineupNames?: string[];
  /** Formatted total fee; omit for members or when nothing is set. */
  fee?: string | null;
  /** Event colour (CSS colour / var) and its foreground. */
  accent: string;
  accentFg: string;
  /** Laptop pose Display: no label, tighter card, one-line rows, so it fits the upper half. */
  compact?: boolean;
}

export const LiveGigPreview: React.FC<LiveGigPreviewProps> = ({
  kindLabel,
  typeLabel,
  settingLabel,
  title,
  dateLabel,
  timeLabel,
  venue,
  city,
  lineupCount,
  lineupNames = [],
  fee,
  accent,
  accentFg,
  compact = false,
}) => {
  const t = useT();
  // `settingLabel` is the raw setting value; translate it for display only.
  const setting =
    settingLabel === 'indoor' ? t('indoor') : settingLabel === 'outdoor' ? t('outdoor') : settingLabel;
  const place = [venue?.trim(), city?.trim()].filter(Boolean).join(', ');
  return (
    <div className={compact ? 'flex flex-col px-4 pb-3' : 'flex flex-col gap-3 px-4 pt-4 pb-6'} aria-live="polite">
      {!compact && <p className="bw-label-sm text-muted-foreground">{t('Live preview')}</p>}
      <section
        className={compact ? 'rounded-[20px] p-4 flex flex-col gap-1.5' : 'rounded-[24px] p-5 flex flex-col gap-3'}
        style={{ backgroundColor: accent, color: accentFg }}
        aria-label={t('{kind} preview', { kind: kindLabel })}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Tag variant="solid">{kindLabel}</Tag>
          {typeLabel && <span className="bw-label-xs">{typeLabel}</span>}
          {setting && <span className="bw-label-xs opacity-85">{setting}</span>}
        </div>
        <h2 className={compact ? 'bw-h1 line-clamp-2 [overflow-wrap:anywhere]' : 'bw-display-lg [overflow-wrap:anywhere]'}>{title}</h2>

        <div className="flex items-start gap-2">
          <Calendar className="w-4 h-4 shrink-0 mt-[3px]" />
          <span className="bw-body-md">
            {dateLabel || t('Date TBD')}
            {timeLabel ? ` · ${timeLabel}` : ''}
          </span>
        </div>
        <div className="flex items-start gap-2 min-w-0">
          <MapPin className="w-4 h-4 shrink-0 mt-[3px]" />
          <span className={compact ? 'bw-body-md truncate' : 'bw-body-md [overflow-wrap:anywhere]'}>{place || t('Venue TBD')}</span>
        </div>
        <div className="flex items-start gap-2 min-w-0">
          <Users className="w-4 h-4 shrink-0 mt-[3px]" />
          <span className={compact ? 'bw-body-md truncate' : 'bw-body-md [overflow-wrap:anywhere]'}>
            {lineupCount === 1 ? t('{count} musician', { count: lineupCount }) : t('{count} musicians', { count: lineupCount })}
            {lineupNames.length > 0 && <span className="opacity-85"> · {lineupNames.join(', ')}</span>}
          </span>
        </div>

        {fee && (
          <div
            className={compact ? 'flex items-baseline justify-between gap-3 pt-1.5' : 'flex items-baseline justify-between gap-3 pt-2'}
            style={{ borderTop: '1px solid color-mix(in srgb, currentColor 20%, transparent)' }}
          >
            <span className="bw-label-sm">{t('Fee')}</span>
            <span className="bw-value-md shrink-0">{fee}</span>
          </div>
        )}
      </section>
    </div>
  );
};

export default LiveGigPreview;
