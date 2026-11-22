import React, { useState } from 'react';
import { Download } from '@/app/components/icons';
import { BwSheet } from '@/app/components/bw/Screen';
import { AcademyHelpButton } from '@/app/components/academy/AcademyHelpButton';
import { PillButton } from '@/app/components/bw/Form';
import { haptic } from '@/lib/haptics';
import { localDecimal, useT } from '@/lib/i18n';
import { estimatePackBytes, packSizeMb, type LiveSong } from '@/lib/livePack';
import { refreshPack } from '@/lib/livePackStore';
import { chooseAutomatic, chooseNotNow, chooseThisEvent } from '@/lib/livePackConsent';

export type LivePackAnswer = 'auto' | 'event' | 'notNow';

/** Download this event's pack now (after a yes on the sheet or the row). */
export async function downloadPackNow(args: {
  userId: string;
  event: Record<string, unknown>;
  occurrenceDate?: string;
  unknownTitle: string;
}): Promise<boolean> {
  const p = await refreshPack({ ...args, withFiles: true }).catch(() => null);
  return !!p;
}

/**
 * "Have the setlist with you, even without signal" (plan §3.3): one screen,
 * plain words. Opened by the live_pack_ready push (170), or the first time
 * the person taps "Download for offline". The answer is kept on the device
 * and on the profile (the daily job stops asking).
 */
export const LivePackConsentSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  userId?: string;
  event: Record<string, unknown>;
  occurrenceDate?: string;
  songs: LiveSong[];
  rehearsal?: boolean;
  /** After the answer (the download, if any, has started). */
  onAnswered?: (answer: LivePackAnswer, download?: Promise<boolean>) => void;
}> = ({ open, onClose, userId, event, occurrenceDate, songs, rehearsal, onAnswered }) => {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const eventId = String(event.id ?? '');
  const size = packSizeMb(estimatePackBytes(songs));

  const answer = (a: LivePackAnswer) => {
    if (!userId || busy) return;
    haptic.tap();
    if (a === 'auto') chooseAutomatic(userId, eventId);
    else if (a === 'event') chooseThisEvent(userId, eventId);
    else chooseNotNow(userId);
    let download: Promise<boolean> | undefined;
    if (a !== 'notNow') {
      setBusy(true);
      download = downloadPackNow({ userId, event, occurrenceDate, unknownTitle: t('Unknown Song') }).finally(() => setBusy(false));
    }
    onAnswered?.(a, download);
    onClose();
  };

  return (
    <BwSheet
      open={open}
      onClose={onClose}
      overline={t('Offline & live')}
      title={t('Have the setlist with you, even without signal.')}
      closeLabel={t('Close')}
      zIndex={160}
      portal
      headerAction={<AcademyHelpButton article="live-mode-offline" size="sm" variant="sheet" />}
      footer={
        <div className="dark flex flex-col gap-2">
          <PillButton icon={<Download className="w-4 h-4" />} onClick={() => answer('auto')} disabled={!userId}>
            {t('Download and keep it automatic')}
          </PillButton>
          <PillButton variant="outline" onClick={() => answer('event')} disabled={!userId}>
            {rehearsal ? t('Only this rehearsal') : t('Only this gig')}
          </PillButton>
          <PillButton variant="ghost" onClick={() => answer('notNow')} disabled={!userId}>
            {t('Not now')}
          </PillButton>
        </div>
      }
    >
      <div className="dark flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="bw-label-sm text-muted-foreground">{t('What')}</p>
          <p className="bw-body-md">
            {rehearsal
              ? t('Lyrics, chords, structures and your own notes for the songs of this rehearsal. No fees, no contracts.')
              : t('Lyrics, chords, structures and your own notes for the songs of this gig. No fees, no contracts.')}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <p className="bw-label-sm text-muted-foreground">{t('Where')}</p>
          <p className="bw-body-md">
            {rehearsal
              ? t('Only on this device, private to you. It updates by itself until the rehearsal and is removed the day after.')
              : t('Only on this device, private to you. It updates by itself until the gig and is removed the day after.')}
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <p className="bw-label-sm text-muted-foreground">{t('Size')}</p>
          <p className="bw-body-md">{t('About {size} MB, plus your own files.', { size: localDecimal(size) })}</p>
        </div>
        <p className="bw-body-sm text-muted-foreground">{t('You can change this anytime in Settings › Offline & live.')}</p>
      </div>
    </BwSheet>
  );
};
