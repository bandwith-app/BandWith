/**
 * Sign-out that threw (IdentityHub): this device is wiped so the reload
 * comes back signed out, but never what sign-out itself keeps (#296 round
 * 7, Claude r6 M3; it used to clear all of local storage):
 * - the session ends here first (a local sign-out: this device's
 *   credentials go, #296 round 8 Codex r8 B3), so the recordings' cleanup
 *   sees this account as signed out and deletes its folder;
 * - the Stage recordings go next, by their own cleanup (clearDownloadedAudio
 *   reads which accounts' folders to delete from `bw-regia-audio:*`), and
 *   those keys stay so an unfinished deletion ends at the next launch;
 * - the lists the person still has to deal with stay (refused notes and
 *   changes, unsent chat messages): KEEP_ON_SIGN_OUT_PREFIXES from
 *   offline/storage.ts (PR #292); until #292 is on this build, the same list
 *   copied as data from fix/data-loss-audit 661bd1b9;
 * - the device's privacy choices (the analytics answer, the crash-report
 *   switch: PRIVACY_CHOICE_KEYS, #277);
 * - the push queue, `bandwith.push-*` (#287: a revocation or a token
 *   deletion still waiting);
 * - the changes still waiting to be sent (offline queue, rehearsal notes and
 *   Stage outboxes), per account, sent at its next sign-in; the offline
 *   queue where it is stored (IndexedDB first), and never the anonymous or
 *   legacy queue, which the next account would adopt.
 * From its start to the reload the app shows only "Signing out…"
 * (signOutWipeState, round 12): no sign-in while a sync pass for the account
 * that left may still be running.
 */
import * as storage from './offline/storage';
import { PRIVACY_CHOICE_KEYS } from './privacyChoices';
import { settleRefusedNotes } from './rehearsalNotesOutbox';
import { markSignOutWipe } from './signOutWipeState';
import { supabase } from './supabase';

const KEEP_COPY_292 = ['bw:live_refused:', 'bw:rehearsal_notes_rejected:', 'bw:chat_outbox:'] as const;
export const keptOnSignOut = (): readonly string[] =>
  (storage as { KEEP_ON_SIGN_OUT_PREFIXES?: readonly string[] }).KEEP_ON_SIGN_OUT_PREFIXES ?? KEEP_COPY_292;
const AUDIO_KEYS = 'bw-regia-audio:';
/**
 * The push queue (#287): a revocation and a token deletion still waiting
 * (`bandwith.push-revoke`, `bandwith.push-delete-pending`). Wiped, the
 * server would keep sending this account's previews here (#287 r9; the same
 * rule as IdentityHub's).
 */
const PUSH_KEYS = 'bandwith.push-';
/**
 * Changes still waiting to be sent, per account, kept by prefix: the
 * rehearsal notes outbox and the Stage outbox (#291 review: IdentityHub's
 * wipe erased them). The offline queue is kept by accountQueue (below), per
 * account only. Together these are what #287's PENDING_WRITE_PREFIXES names
 * (#287 lands after this, merge order #292 → #296 → #287, so this is data
 * here, not an import).
 */
const PENDING_KEYS = ['bw:rehearsal_notes_outbox:', 'bw:live_outbox:'] as const;
const QUEUE_PREFIX = 'bw:offline_queue:';
/**
 * An account's own offline queue, `bw:offline_queue:<uid>` (#296 round 10).
 * Never the anonymous one (queued before the user was known) nor the legacy
 * global key: the next account to sign in adopts those (syncQueue
 * adoptOrphanQueue), so a bandmate would replay this person's edits as theirs.
 * Accepted trade-off: edits this person queued before their account was known
 * (in `:anonymous`) go with it.
 */
const accountQueue = (k: string): boolean => {
  if (!k.startsWith(QUEUE_PREFIX)) return false;
  const uid = k.slice(QUEUE_PREFIX.length);
  return uid !== '' && uid !== 'anonymous';
};
/**
 * The device's privacy choices stay too: the analytics answer and its
 * version, and the crash-report switch (#277: a missing key means "on", so
 * losing an opt-out would turn reports back on without asking).
 */
const PRIVACY_KEYS = PRIVACY_CHOICE_KEYS;
const kept = (k: string) =>
  k.startsWith(AUDIO_KEYS) ||
  k.startsWith(PUSH_KEYS) ||
  PRIVACY_KEYS.includes(k) ||
  accountQueue(k) ||
  PENDING_KEYS.some((p) => k.startsWith(p)) ||
  keptOnSignOut().some((p) => k.startsWith(p));

/** The entries sign-out keeps (localStorage), read now. */
const snapshot = (keep: (k: string) => boolean): [string, string][] => {
  const out: [string, string][] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && keep(k)) out.push([k, localStorage.getItem(k) ?? '']);
    }
  } catch {
    /* storage blocked */
  }
  return out;
};
const restore = (entries: [string, string][]) => {
  for (const [k, v] of entries) {
    try {
      // Written again meanwhile (a refusal answered during the sign-out): the newer one stays.
      if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  }
};

/**
 * A sign-out's clear of the offline cache that keeps what sign-out keeps
 * (#296 round 8, Codex r8 B1): the refused notes (and #292's other lists),
 * per account. Refused notes still in an outbox move to their list first.
 * Until #292 is on this build, clearOfflineCache drops every `bw:` key, so
 * they are read before and put back after; with #292 it keeps them itself.
 *
 * `gone`: a deleted account (#282, #287's discardPendingWrites). Its lists
 * are not moved, not put back, and go after the clear, also one written
 * meanwhile (a refusal answered during the sign-out), so a clear that isn't
 * awaited can't bring them back after #292's discardAccountWrites. Other
 * accounts' lists on the device stay.
 */
export async function keepingSignOutLists(clear: () => Promise<void>, opts?: { gone?: string | null }): Promise<void> {
  const gone = opts?.gone?.toLowerCase() || null;
  const mine = (k: string) => !!gone && k.toLowerCase().endsWith(`:${gone}`);
  settleRefusedNotes(undefined, gone);
  const keep = snapshot((k) => keptOnSignOut().some((p) => k.startsWith(p)) && !mine(k));
  try {
    await clear();
  } finally {
    restore(keep);
    if (gone) {
      for (const [k] of snapshot((k) => keptOnSignOut().some((p) => k.startsWith(p)) && mine(k))) {
        try {
          localStorage.removeItem(k);
        } catch {
          /* storage blocked */
        }
      }
    }
  }
}

/**
 * One step of the wipe, at most `ms`: whatever it does, throwing at once
 * included, the wipe goes on (#287 delta review: a step that threw used to
 * stop it before anything was cleared).
 */
const step = <T>(run: () => T | Promise<T>, ms = 3000): Promise<T | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve()
      .then(run)
      .catch(() => undefined),
    new Promise<undefined>((r) => {
      timer = setTimeout(r, ms);
    }),
  ]).finally(() => clearTimeout(timer));
};

/**
 * The accounts' offline queues as stored (#296 round 10): IndexedDB first,
 * so the localStorage snapshot alone doesn't keep them. Read before the clear,
 * never capped (round 11: the clear right after waits on the same storage
 * anyway). A key that can't be read is reported and skipped; the queues
 * already read are always kept.
 */
const readAccountQueues = async (): Promise<[string, unknown][]> => {
  const out: [string, unknown][] = [];
  let keys: string[] = [];
  try {
    keys = (await storage.listOfflineKeys(QUEUE_PREFIX)).filter(accountQueue);
  } catch (err) {
    console.warn('[signOutWipe] Could not list the offline queues:', err);
  }
  for (const k of keys) {
    try {
      const v = await storage.getOfflineItem<unknown>(k);
      if (v != null) out.push([k, v]);
    } catch (err) {
      console.warn(`[signOutWipe] Could not read ${k}; the other queues are kept:`, err);
    }
  }
  return out;
};

export async function wipeAfterFailedSignOut(): Promise<void> {
  // From here to the reload the app shows only "Signing out…" (round 12): the session ends next,
  // and nobody may sign in while a sync pass for this account can still be running (the hold
  // below waits for it 6 s, twice; a longer pass would go on under the next person's session).
  markSignOutWipe();
  // This device's session first (Codex r8 B3): the cleanup below must see this account signed out.
  await step(() => supabase.auth.signOut({ scope: 'local' }));
  await step(() => settleRefusedNotes());
  await step(() => import('./regiaAudio').then((m) => m.clearDownloadedAudio()));
  // Read, clear and write back with the offline queues held (round 11): a sync pass still running
  // lands first (what it sent is out of the queue), and none interleaves, so nothing it sent
  // comes back. If the module can't load, the same steps run unheld.
  const held = await import('./offline/syncQueue').then(
    (m) => m.withOfflineQueuesHeld,
    () => <T>(fn: () => Promise<T>) => fn(),
  );
  await held(async () => {
    // Kept entries, read before the offline cache is cleared (before #292 it clears every bw: key).
    const keep = snapshot(kept);
    const queues = await readAccountQueues();
    // Awaited in full, never capped: a clear that ended later could take the entries put back below.
    await Promise.resolve().then(() => storage.clearOfflineCache()).catch(() => {});
    // The anonymous and legacy queues go with it (clearOfflineCache removes both, and kept() keeps neither).
    try {
      const drop: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && !kept(k)) drop.push(k);
      }
      drop.forEach((k) => localStorage.removeItem(k));
      for (const [k, v] of keep) localStorage.setItem(k, v);
    } catch {
      /* storage blocked */
    }
    // Each account's unsent edits, back where they were stored (as AuthContext's sign-out does),
    // in full before the queues are let go.
    for (const [k, v] of queues) await storage.setOfflineItem(k, v).catch(() => {});
  });
}
