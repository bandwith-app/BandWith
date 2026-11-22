import { useEffect, useState } from 'react';
import { flushLiveOutbox, isDefiniteRefusal, readLiveOutbox, readRefusedLiveOps, waitingChanges, WAITING_EVENTS } from '@/lib/liveOutbox';
import { flushOutbox, readOutbox, type OutboxApi } from '@/lib/rehearsalNotesOutbox';
import { liveOutboxApi } from '@/lib/services/liveOutboxApi';
import { deleteNote, saveNote, setNoteOk, setPractised } from '@/lib/services/rehearsalNotes';
import { sessionUserId } from '@/lib/sessionUser';
import { isOfflineError } from '@/lib/offline/networkErrors';
import type { RehearsalNote } from '@/lib/rehearsalNotes';

const rehearsalApi = { save: saveNote, remove: deleteNote, practised: setPractised, ok: setNoteOk };

/**
 * The rehearsal outbox sent only as its owner: before each change, the
 * session must still be `userId` (another tab may have signed someone else
 * in). Not: the flush stops as if offline and the change waits for its owner.
 */
const notOwnerNow = Object.assign(new Error('Held offline: another account is signed in on this device.'), { code: 'BW_NOT_OWNER' });
/** Not a refusal (a server problem): held like no signal, so the note waits and is tried again. */
const heldForRetry = Object.assign(new Error('Held offline: the server could not take it now.'), { code: 'BW_RETRY' });

/**
 * Notes the server refused for good, kept with their words in #296's list
 * (`bw:rehearsal_notes_rejected:<uid>`, the note itself), so the outbox can
 * let go of them and nothing is lost. True only when really written.
 */
const REHEARSAL_REJECTED = (userId: string) => `bw:rehearsal_notes_rejected:${userId}`;
export function readRejectedRehearsalNotes(userId: string): RehearsalNote[] {
  try {
    const v = JSON.parse(localStorage.getItem(REHEARSAL_REJECTED(userId)) || '[]');
    return Array.isArray(v) ? (v as RehearsalNote[]) : [];
  } catch {
    return [];
  }
}
/**
 * One refused version of a note, as #296 keys it (rejectedKey): the same note
 * refused again with other words is another entry, never written over.
 */
const refusedVersion = (n: Partial<RehearsalNote> | null) =>
  JSON.stringify([n?.id ?? null, n?.body ?? null, n?.section ?? null, n?.preset ?? null, n?.songId ?? null]);
function keepRejectedRehearsalNote(userId: string, note: RehearsalNote): boolean {
  const key = refusedVersion(note);
  const kept = readRejectedRehearsalNotes(userId);
  if (kept.some((n) => refusedVersion(n) === key)) return true;
  try {
    localStorage.setItem(REHEARSAL_REJECTED(userId), JSON.stringify([...kept, note]));
  } catch {
    return false;
  }
  // Written for real (some browsers fail quietly when full): read back.
  return readRejectedRehearsalNotes(userId).some((n) => refusedVersion(n) === key);
}

function ownedRehearsalApi(userId: string): OutboxApi {
  const mine = async () => (await sessionUserId()) === userId;
  /**
   * Sent, no signal, or refused for good: as it is. A refused note's words
   * are kept first; only then may the outbox drop it. Anything else (a 5xx,
   * a timeout): held, never dropped, tried again later.
   */
  const settle = (res: { error: unknown }, note?: RehearsalNote) => {
    if (!res.error || isOfflineError(res.error)) return res;
    if (!isDefiniteRefusal(res.error)) return { error: heldForRetry };
    if (note && !keepRejectedRehearsalNote(userId, note)) return { error: heldForRetry };
    return res;
  };
  return {
    save: async (note, before) => ((await mine()) ? settle(await rehearsalApi.save(note, before), note) : { error: notOwnerNow }),
    remove: async (id) => ((await mine()) ? settle(await rehearsalApi.remove(id)) : { error: notOwnerNow }),
    practised: async (id, user, value) => ((await mine()) ? settle(await rehearsalApi.practised(id, user, value)) : { error: notOwnerNow }),
    ok: async (id, value) => ((await mine()) ? settle(await rehearsalApi.ok(id, value)) : { error: notOwnerNow }),
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
/**
 * `refused`: turned down during this send, and kept (Stage changes, rehearsal
 * notes); `refusedNotes`: of those, the rehearsal notes. `busy`: another tab
 * was sending them right now.
 */
export async function sendWaitingNow(userId: string): Promise<{ left: number; refused: number; refusedNotes: number; busy: boolean }> {
  if ((await sessionUserId()) !== userId) return { left: waitingChanges(userId), refused: 0, refusedNotes: 0, busy: false };
  const before = readRefusedLiveOps(userId).length;
  const notesBefore = new Set(readRejectedRehearsalNotes(userId).map(refusedVersion));
  const [live] = await Promise.all([flushLiveOutbox(userId, liveOutboxApi, { force: true }), flushOutbox(userId, ownedRehearsalApi(userId))]);
  // Entries, not note ids: one per refused version (#296).
  const refusedNotes = readRejectedRehearsalNotes(userId).filter((n) => !notesBefore.has(refusedVersion(n))).length;
  return {
    left: waitingChanges(userId),
    refused: Math.max(0, readRefusedLiveOps(userId).length - before) + refusedNotes,
    refusedNotes,
    busy: !!live?.busy,
  };
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
