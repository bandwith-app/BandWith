import { useEffect, useMemo, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { onAppResume } from '@/lib/appResume';
import { packRowFromItem, type LivePackItem } from '@/lib/livePack';
import { runLivePackPrefetch, type PrefetchEvent } from '@/lib/livePackStore';
import { LIVE_PACK_CHOICE_EVENT } from '@/lib/livePackConsent';
import { t } from '@/lib/i18n';

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/** On mobile data now (Android tells; iOS doesn't, so it counts as Wi-Fi). */
export const onCellular = (): boolean => {
  const c = (typeof navigator !== 'undefined' ? (navigator as { connection?: { type?: string } }).connection : undefined) ?? undefined;
  return c?.type === 'cellular';
};

/**
 * App open, resume and back online (plan §3.2): tidy the live packs (24 h
 * after the event, bands left), then, in the native apps and only after the
 * person said yes, download the gigs and rehearsals of the next 7 days.
 */
export function useLivePackPrefetch(
  events: Array<LivePackItem & { band_id?: string }>,
  userId: string | null | undefined,
  /** null while the band list loads. */
  bandIds: string[] | null,
) {
  const list = useMemo<PrefetchEvent[]>(
    () =>
      events
        .filter((e) => !!e.eventId && !!e.band_id && !!e.setlistId && !!e.date)
        .map((e) => ({
          eventId: e.eventId!,
          bandId: e.band_id,
          date: (e.date || '').slice(0, 10),
          eventType: e.eventType,
          setlistId: e.setlistId,
          row: packRowFromItem(e),
        })),
    [events],
  );
  const key = `${userId ?? ''}#${bandIds ? bandIds.slice().sort().join(',') : '?'}#${list.map((e) => `${e.eventId}@${e.date}@${e.setlistId}`).join('|')}`;
  const ref = useRef({ list, bandIds });
  ref.current = { list, bandIds };

  useEffect(() => {
    if (!userId) return;
    const run = () =>
      void runLivePackPrefetch({
        userId,
        bandIds: ref.current.bandIds,
        events: ref.current.list,
        online: Capacitor.isNativePlatform() && isOnline(),
        onWifi: !onCellular(),
        unknownTitle: t('Unknown Song'),
      }).catch(() => undefined);
    const timer = window.setTimeout(run, 1500);
    const offResume = onAppResume(run);
    window.addEventListener('online', run);
    window.addEventListener(LIVE_PACK_CHOICE_EVENT, run);
    return () => {
      window.clearTimeout(timer);
      offResume();
      window.removeEventListener('online', run);
      window.removeEventListener(LIVE_PACK_CHOICE_EVENT, run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
