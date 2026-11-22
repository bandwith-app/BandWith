import { useEffect, useState } from 'react';
import { flushLiveOutbox, readLiveOutbox, waitingChanges, WAITING_EVENTS } from '@/lib/liveOutbox';
import { flushOutbox, readOutbox } from '@/lib/rehearsalNotesOutbox';
import { liveOutboxApi } from '@/lib/services/liveOutboxApi';
import { deleteNote, saveNote, setNoteOk, setPractised } from '@/lib/services/rehearsalNotes';
import { sessionUserId } from '@/lib/sessionUser';

const rehearsalApi = { save: saveNote, remove: deleteNote, practised: setPractised, ok: setNoteOk };
const RETRY_MS = 30_000;

/** The signed-in person: the given id, else the session saved on this device. */
function useMe(userId?: string | null): string | null {
  const [found, setFound] = useState<string | null>(null);
  useEffect(() => {
    if (userId) return;
    let alive = true;
    void sessionUserId().then((id) => alive && setFound(id));
    return () => {
      alive = false;
    };
  }, [userId]);
  return userId ?? found;
}

/**
 * "3 changes waiting for signal" (plan §3.5): my changes kept on this phone,
 * the rehearsal notes included, until they are sent.
 */
export function useWaitingChanges(userId?: string | null): number {
  const me = useMe(userId);
  const [n, setN] = useState(() => waitingChanges(me));
  useEffect(() => {
    const update = () => setN(waitingChanges(me));
    update();
    for (const e of WAITING_EVENTS) window.addEventListener(e, update);
    return () => {
      for (const e of WAITING_EVENTS) window.removeEventListener(e, update);
    };
  }, [me]);
  return n;
}

/**
 * Sends what waits on this phone: at start, when the signal comes back, when
 * the app comes to the front, and every 30 s while something waits (a weak
 * signal at the venue). Mounted once for the signed-in person.
 */
export function useLiveOutboxFlush(userId?: string | null) {
  useEffect(() => {
    if (!userId) return;
    const go = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (readLiveOutbox(userId).length) void flushLiveOutbox(userId, liveOutboxApi);
      if (readOutbox(userId).length) void flushOutbox(userId, rehearsalApi);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') go();
    };
    go();
    window.addEventListener('online', go);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => {
      if (waitingChanges(userId) > 0) go();
    }, RETRY_MS);
    return () => {
      window.removeEventListener('online', go);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [userId]);
}
