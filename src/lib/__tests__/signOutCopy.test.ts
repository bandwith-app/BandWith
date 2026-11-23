import { describe, it, expect, beforeEach } from 'vitest';
import { clearOfflineCache, removeOfflineItemsWhere, SIGN_OUT_CLEAR, signOutKeeps } from '../offline/storage';
import { signOutCopy, QUEUED_DELETED, QUEUED_KEPT } from '../signOutGate';

// Main's decision (round 5): the sign-out sheet's sentence follows what
// sign-out really keeps, from one source (clearOfflineCache itself), so it
// is right whether #292 or #287 (keepPendingWrites) lands first. Each state
// is checked against the keys that actually survive a clearOfflineCache call.
const UID = '0b7c6a1e-2f4d-4c8e-9a51-3d2e1f0a9b8c';
const KEYS = [
  `bw:live_outbox:${UID}`,
  `bw:rehearsal_notes_outbox:${UID}`,
  `bw:offline_queue:${UID}`,
  `bw:live_refused:${UID}`,
  `bw:rehearsal_notes_rejected:${UID}`,
  `bw:chat_outbox:${UID}`,
  `bw:${UID}:global:songs`,
];

type Clear = (prefix?: string, opts?: { keepPendingWrites?: boolean }) => Promise<void>;
// #287's clearOfflineCache, as on fix/auth-signout: pending-write queues of
// an account survive when the caller passes keepPendingWrites.
const PENDING = ['bw:offline_queue:', 'bw:rehearsal_notes_outbox:', 'bw:live_outbox:'];
const ACCOUNT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clear287: Clear = async (prefix = 'bw:', opts) => {
  const keep = opts?.keepPendingWrites === true;
  await removeOfflineItemsWhere(
    (k) => k.startsWith(prefix) && !(keep && PENDING.some((p) => k.startsWith(p) && ACCOUNT.test(k.slice(p.length)))),
  );
};

const STATES: [string, Clear, boolean][] = [
  // #287 is in the tree: the real clearOfflineCache keeps an account's queues when asked (keepPendingWrites).
  ['this tree (#287 in: queues kept at sign-out)', clearOfflineCache as Clear, true],
  ['with #287 (keepPendingWrites)', clear287, true],
];

describe('sign-out: the sheet says what sign-out keeps', () => {
  beforeEach(() => localStorage.clear());

  for (const [state, clear, queuesKept] of STATES) {
    it(`${state}: signOutKeeps matches the keys a sign-out leaves`, async () => {
      for (const k of KEYS) localStorage.setItem(k, '[1]');
      const predicted = KEYS.filter((k) => signOutKeeps(k, clear));
      // The dry run touched nothing.
      expect(KEYS.every((k) => localStorage.getItem(k) === '[1]')).toBe(true);
      await clear('bw:', SIGN_OUT_CLEAR);
      const survived = KEYS.filter((k) => localStorage.getItem(k) !== null);
      expect(predicted).toEqual(survived);
      expect(survived).toEqual(expect.arrayContaining([`bw:live_refused:${UID}`, `bw:rehearsal_notes_rejected:${UID}`, `bw:chat_outbox:${UID}`]));
      expect(survived.includes(`bw:live_outbox:${UID}`)).toBe(queuesKept);
    });

    it(`${state}: the queued-changes sentence agrees with what survives`, async () => {
      const copy = signOutCopy(UID, clear);
      localStorage.setItem(`bw:live_outbox:${UID}`, '[1]');
      localStorage.setItem(`bw:rehearsal_notes_outbox:${UID}`, '[1]');
      await clear('bw:', SIGN_OUT_CLEAR);
      const kept = localStorage.getItem(`bw:live_outbox:${UID}`) !== null && localStorage.getItem(`bw:rehearsal_notes_outbox:${UID}`) !== null;
      expect(copy.queued).toBe(kept ? QUEUED_KEPT : QUEUED_DELETED);
      expect(copy.chatKept).toBe(true);
      expect(copy.refusedKept).toBe(true);
    });
  }
});
