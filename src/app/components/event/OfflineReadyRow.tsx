import React, { useState } from 'react';
import { CheckCircle2, Download } from '@/app/components/icons';
import { PillButton } from '@/app/components/bw/Form';
import { cn } from '@/app/components/ui/utils';
import { haptic } from '@/lib/haptics';
import { dateName, useT } from '@/lib/i18n';
import type { LivePack } from '@/lib/livePack';
import { refreshPack } from '@/lib/livePackStore';
import { readChoice, writeChoice } from '@/lib/livePackConsent';

type T = ReturnType<typeof useT>;

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** When a pack was downloaded: "14:32", "yesterday 18:02" or "Sat 21 Nov 18:02" (24 h, like the rest of the app). */
export function packSavedLabel(savedAt: string, t: T, now: Date = new Date()): string {
  const d = new Date(savedAt);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return hhmm(d);
  if (diff === 1) return t('yesterday {time}', { time: hhmm(d) });
  return `${dateName(d, { weekday: 'short', day: 'numeric', month: 'short' })} ${hhmm(d)}`;
}

/**
 * "Offline ready ✓ · updated 14:32" on the event screen (plan §3.4), or
 * "Download for offline": this event's setlist, lyrics, chords and my notes
 * kept on this device for live mode with no signal. Tapping Download is the
 * person's yes for this event (livePackConsent).
 */
export const OfflineReadyRow: React.FC<{
  pack: LivePack | null;
  userId?: string;
  event: Record<string, unknown>;
  occurrenceDate?: string;
  online: boolean;
  className?: string;
}> = ({ pack, userId, event, occurrenceDate, online, className }) => {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = !!pack && pack.songs.length > 0;
  const download = async () => {
    if (!userId || busy) return;
    haptic.tap();
    const eventId = String(event.id ?? '');
    const choice = readChoice(userId);
    if (!choice.auto && !choice.events.includes(eventId)) writeChoice(userId, { ...choice, events: [...choice.events, eventId] });
    setBusy(true);
    setFailed(false);
    const p = await refreshPack({ userId, event, occurrenceDate, withFiles: true, unknownTitle: t('Unknown Song') }).catch(() => null);
    setBusy(false);
    setFailed(!p);
  };
  return (
    <div className={cn('bg-card rounded-[16px] p-4 flex flex-wrap items-center gap-x-4 gap-y-3', className)} role="group" aria-label={t('Offline')}>
      <span className="flex items-start gap-3 flex-1 min-w-[200px]">
        {ready ? (
          <CheckCircle2 className="w-5 h-5 shrink-0 text-success mt-0.5" aria-hidden />
        ) : (
          <Download className="w-5 h-5 shrink-0 text-muted-foreground mt-0.5" aria-hidden />
        )}
        <span className="flex flex-col gap-1 min-w-0">
          <span className="bw-body-md">
            {ready ? t('Offline ready · updated {time}', { time: packSavedLabel(pack!.savedAt, t) }) : t('Not on this device yet')}
          </span>
          <span className="bw-body-sm text-muted-foreground">
            {failed
              ? t('Couldn’t download it. Try again with internet.')
              : ready
                ? t('Lyrics, chords and your notes work in live mode without signal.')
                : t('Download lyrics, chords and your notes to use live mode without signal.')}
          </span>
        </span>
      </span>
      {!ready && online && userId && (
        <PillButton
          variant="dark"
          size="sm"
          fullWidth={false}
          onClick={download}
          disabled={busy}
          icon={<Download className="w-4 h-4" />}
          className="shrink-0"
        >
          {busy ? t('Downloading…') : t('Download for offline')}
        </PillButton>
      )}
    </div>
  );
};
