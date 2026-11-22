import { useEffect, useMemo, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { onAppResume } from '@/lib/appResume';
import { LIVE_PACK_REFRESH_EVENT, packRowFromItem, type LivePackItem } from '@/lib/livePack';
import { runLivePackPrefetch, type PrefetchEvent } from '@/lib/livePackStore';
import { LIVE_PACK_CHOICE_EVENT, hasAnswered, readChoice, writeChoice } from '@/lib/livePackConsent';
import { readProfileAuto } from '@/lib/livePackStatus';
import { t } from '@/lib/i18n';
import { isFlagOn, useFlag } from '@/lib/appFlags';

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
 * A silent push (170) refreshes the event it names at once. "Keep it
 * automatic" chosen on another device (profiles.live_pack_auto) counts here.
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
  // Switched off (app_flags live_pack, docs/flags.md): no downloads ahead of
  // time, silent pushes ignored, a running download stops. The tidy-up (old
  // copies moved in, expired packs and bands left removed) always runs.
  const on = useFlag('live_pack');
  const key = `${on ? 1 : 0}#${userId ?? ''}#${bandIds ? bandIds.slice().sort().join(',') : '?'}#${list.map((e) => `${e.eventId}@${e.date}@${e.setlistId}`).join('|')}`;
  const ref = useRef({ list, bandIds });
  ref.current = { list, bandIds };

  useEffect(() => {
    if (!userId) return;
    const run = (force?: string[]) =>
      void runLivePackPrefetch({
        userId,
        bandIds: ref.current.bandIds,
        events: ref.current.list,
        online: Capacitor.isNativePlatform() && isOnline(),
        onWifi: !onCellular(),
        unknownTitle: t('Unknown Song'),
        force: on ? force : undefined,
        downloads: on,
        keepGoing: () => isFlagOn('live_pack'),
      }).catch(() => undefined);
    const again = () => run();
    const refresh = (e: Event) => {
      const id = (e as CustomEvent).detail?.eventId ?? (e as Event & { eventId?: string }).eventId;
      run(id ? [String(id)] : undefined);
    };
    const timer = window.setTimeout(again, 1500);
    const offResume = onAppResume(again);
    window.addEventListener('online', again);
    window.addEventListener(LIVE_PACK_CHOICE_EVENT, again);
    window.addEventListener(LIVE_PACK_REFRESH_EVENT, refresh);
    return () => {
      window.clearTimeout(timer);
      offResume();
      window.removeEventListener('online', again);
      window.removeEventListener(LIVE_PACK_CHOICE_EVENT, again);
      window.removeEventListener(LIVE_PACK_REFRESH_EVENT, refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Answered "keep it automatic" on another device: this one follows.
  useEffect(() => {
    if (!userId || !on || hasAnswered(readChoice(userId))) return;
    let alive = true;
    void readProfileAuto(userId).then((auto) => {
      if (alive && auto && !hasAnswered(readChoice(userId))) writeChoice(userId, { ...readChoice(userId), auto: true });
    });
    return () => {
      alive = false;
    };
  }, [userId, on]);
}
