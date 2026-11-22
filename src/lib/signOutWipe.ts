/**
 * Sign-out that threw (IdentityHub): this device is wiped so the reload
 * comes back signed out, but never what sign-out itself keeps (#296 round
 * 7, Claude r6 M3; it used to be localStorage.clear()):
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
 * - the device's privacy choices (the analytics answer);
 * - the push queue, `bandwith.push-*` (#287: a revocation or a token
 *   deletion still waiting);
 * - the changes still waiting to be sent (offline queue, rehearsal notes and
 *   Stage outboxes), per account, sent at its next sign-in; the offline
 *   queue where it is stored (IndexedDB first), and never the anonymous or
 *   legacy queue, which the next account would adopt.
 */
import * as storage from './offline/storage';
import { ANALYTICS_CONSENT_KEY } from './appAnalytics';
import { settleRefusedNotes } from './rehearsalNotesOutbox';
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
 * Changes still waiting to be sent, per account: the rehearsal notes outbox
 * and the Stage outbox (#291 review: IdentityHub's wipe erased them), and
 * the offline queue (accountQueue, below). The same list as #287's
 * PENDING_WRITE_PREFIXES, which lands after this (merge order #292 → #296 →
 * #287), so copied as data.
 */
const PENDING_KEYS = ['bw:rehearsal_notes_outbox:', 'bw:live_outbox:'] as const;
const QUEUE_PREFIX = 'bw:offline_queue:';
/**
 * An account's own offline queue, `bw:offline_queue:<uid>` (#296 round 10).
 * Never the anonymous one (queued before the user was known) nor the legacy
 * global key: the next account to sign in adopts those (syncQueue
 * adoptOrphanQueue), so a bandmate would replay this person's edits as theirs.
 */
const accountQueue = (k: string): boolean => {
  if (!k.startsWith(QUEUE_PREFIX)) return false;
  const uid = k.slice(QUEUE_PREFIX.length);
  return uid !== '' && uid !== 'anonymous';
};
/** The device's privacy choices stay too (an analytics answer is never lost by a failed sign-out). */
const PRIVACY_KEYS = [ANALYTICS_CONSENT_KEY];
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
 * so the localStorage snapshot alone doesn't keep them. Read before the clear.
 */
const readAccountQueues = async (): Promise<[string, unknown][]> => {
  const keys = (await storage.listOfflineKeys(QUEUE_PREFIX)).filter(accountQueue);
  const out: [string, unknown][] = [];
  for (const k of keys) {
    const v = await storage.getOfflineItem<unknown>(k).catch(() => null);
    if (v != null) out.push([k, v]);
  }
  return out;
};

export async function wipeAfterFailedSignOut(): Promise<void> {
  // This device's session first (Codex r8 B3): the cleanup below must see this account signed out.
  await step(() => supabase.auth.signOut({ scope: 'local' }));
  await step(() => settleRefusedNotes());
  await step(() => import('./regiaAudio').then((m) => m.clearDownloadedAudio()));
  // Kept entries, read before the offline cache is cleared (before #292 it clears every bw: key).
  const keep = snapshot(kept);
  const queues = (await step(readAccountQueues)) ?? [];
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
  // Each account's unsent edits, back where they were stored (as AuthContext's sign-out does).
  for (const [k, v] of queues) await step(() => storage.setOfflineItem(k, v), 10_000);
}
