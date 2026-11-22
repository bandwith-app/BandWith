import { useEffect, useState } from 'react';
import { flushLiveOutbox, readLiveOutbox, readRefusedLiveOps, waitingChanges, WAITING_EVENTS } from '@/lib/liveOutbox';
import { flushOutbox, readOutbox, type OutboxApi } from '@/lib/rehearsalNotesOutbox';
import { liveOutboxApi } from '@/lib/services/liveOutboxApi';
import { deleteNote, saveNote, setNoteOk, setPractised } from '@/lib/services/rehearsalNotes';
import { sessionUserId } from '@/lib/sessionUser';

const rehearsalApi = { save: saveNote, remove: deleteNote, practised: setPractised, ok: setNoteOk };

/**
 * The rehearsal outbox sent only as its owner: before each change, the
 * session must still be `userId` (another tab may have signed someone else
 * in). Not: the flush stops as if offline and the change waits for its owner.
 */
const notOwnerNow = Object.assign(new Error('Held offline: another account is signed in on this device.'), { code: 'BW_NOT_OWNER' });
function ownedRehearsalApi(userId: string): OutboxApi {
  const mine = async () => (await sessionUserId()) === userId;
  return {
    save: async (note, before) => ((await mine()) ? rehearsalApi.save(note, before) : { error: notOwnerNow }),
    remove: async (id) => ((await mine()) ? rehearsalApi.remove(id) : { error: notOwnerNow }),
    practised: async (id, user, value) => ((await mine()) ? rehearsalApi.practised(id, user, value) : { error: notOwnerNow }),
    ok: async (id, value) => ((await mine()) ? rehearsalApi.ok(id, value) : { error: notOwnerNow }),
  };
}
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
 * Send everything waiting for this person now, only while they are the
 * account signed in. `left`: still waiting; `refused`: turned down by the
 * server during this send (kept in Settings › Offline & live).
 */
export async function sendWaitingNow(userId: string): Promise<{ left: number; refused: number }> {
  if ((await sessionUserId()) !== userId) return { left: waitingChanges(userId), refused: 0 };
  const before = readRefusedLiveOps(userId).length;
  const [, rehearsal] = await Promise.all([flushLiveOutbox(userId, liveOutboxApi, { force: true }), flushOutbox(userId, ownedRehearsalApi(userId))]);
  return { left: waitingChanges(userId), refused: Math.max(0, readRefusedLiveOps(userId).length - before) + rehearsal.dropped };
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
      if (readOutbox(userId).length) void flushOutbox(userId, ownedRehearsalApi(userId));
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
