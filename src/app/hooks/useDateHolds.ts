import { useCallback, useEffect, useState } from 'react';
import {
  DATE_HOLDS_CHANGED,
  fetchDateHoldAnswers,
  fetchMyDateHolds,
  type DateHold,
  type DateHoldAnswerRow,
} from '@/lib/dateHolds';

/**
 * Reloads on an answer, a hold notification and when the app comes back.
 * A failed load keeps what was there: a network blip never empties the card.
 */
function useReloading<T>(load: () => Promise<{ data: T; error: string | null }>, enabled: boolean, empty: T) {
  const [data, setData] = useState<T | null>(enabled ? null : empty);
  const run = useCallback(
    async (isCancelled: () => boolean) => {
      if (!enabled) {
        setData(empty);
        return;
      }
      const res = await load();
      if (isCancelled() || res.error) return;
      setData(res.data);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `empty` is a constant per call site
    [load, enabled],
  );
  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    void run(isCancelled);
    const reload = () => void run(isCancelled);
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    window.addEventListener(DATE_HOLDS_CHANGED, reload);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener(DATE_HOLDS_CHANGED, reload);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [run]);
  return [data, setData] as const;
}

const NO_HOLDS: DateHold[] = [];
const NO_ANSWERS: DateHoldAnswerRow[] = [];

/** The dates this account is asked to keep free (all its bands). Null until loaded. */
export function useMyDateHolds(enabled = true) {
  return useReloading(fetchMyDateHolds, enabled, NO_HOLDS);
}

/** Admin: the answers for one quote event. Null until loaded. */
export function useDateHoldAnswers(eventId: string | null | undefined, enabled = true) {
  const load = useCallback(() => fetchDateHoldAnswers(eventId || ''), [eventId]);
  const [data] = useReloading(load, enabled && !!eventId, NO_ANSWERS);
  return data;
}
