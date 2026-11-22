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
 * - the device's privacy choices (the analytics answer).
 */
import * as storage from './offline/storage';
import { ANALYTICS_CONSENT_KEY } from './appAnalytics';
import { settleRefusedNotes } from './rehearsalNotesOutbox';
import { supabase } from './supabase';

const KEEP_COPY_292 = ['bw:live_refused:', 'bw:rehearsal_notes_rejected:', 'bw:chat_outbox:'] as const;
export const keptOnSignOut = (): readonly string[] =>
  (storage as { KEEP_ON_SIGN_OUT_PREFIXES?: readonly string[] }).KEEP_ON_SIGN_OUT_PREFIXES ?? KEEP_COPY_292;
const AUDIO_KEYS = 'bw-regia-audio:';
/** The device's privacy choices stay too (an analytics answer is never lost by a failed sign-out). */
const PRIVACY_KEYS = [ANALYTICS_CONSENT_KEY];
const kept = (k: string) => k.startsWith(AUDIO_KEYS) || PRIVACY_KEYS.includes(k) || keptOnSignOut().some((p) => k.startsWith(p));

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
 */
export async function keepingSignOutLists(clear: () => Promise<void>): Promise<void> {
  settleRefusedNotes();
  const keep = snapshot((k) => keptOnSignOut().some((p) => k.startsWith(p)));
  try {
    await clear();
  } finally {
    restore(keep);
  }
}

export async function wipeAfterFailedSignOut(): Promise<void> {
  // This device's session first (Codex r8 B3): the cleanup below must see this account signed out.
  await Promise.race([supabase.auth.signOut({ scope: 'local' }).catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  settleRefusedNotes();
  await Promise.race([
    import('./regiaAudio').then((m) => m.clearDownloadedAudio()).catch(() => {}),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  // Kept entries, read before the offline cache is cleared (before #292 it clears every bw: key).
  const keep = snapshot(kept);
  await storage.clearOfflineCache().catch(() => {});
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
}
