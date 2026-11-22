/**
 * Sign-out that threw (IdentityHub): this device is wiped so the reload
 * comes back signed out, but never what sign-out itself keeps (#296 round
 * 7, Claude r6 M3; it used to be localStorage.clear()):
 * - the Stage recordings go first, by their own cleanup (clearDownloadedAudio
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

const KEEP_COPY_292 = ['bw:live_refused:', 'bw:rehearsal_notes_rejected:', 'bw:chat_outbox:'] as const;
export const keptOnSignOut = (): readonly string[] =>
  (storage as { KEEP_ON_SIGN_OUT_PREFIXES?: readonly string[] }).KEEP_ON_SIGN_OUT_PREFIXES ?? KEEP_COPY_292;
const AUDIO_KEYS = 'bw-regia-audio:';
/** The device's privacy choices stay too (an analytics answer is never lost by a failed sign-out). */
const PRIVACY_KEYS = [ANALYTICS_CONSENT_KEY];
const kept = (k: string) => k.startsWith(AUDIO_KEYS) || PRIVACY_KEYS.includes(k) || keptOnSignOut().some((p) => k.startsWith(p));

export async function wipeAfterFailedSignOut(): Promise<void> {
  await Promise.race([
    import('./regiaAudio').then((m) => m.clearDownloadedAudio()).catch(() => {}),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  // Kept entries, read before the offline cache is cleared (before #292 it clears every bw: key).
  const keep: [string, string][] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && kept(k)) keep.push([k, localStorage.getItem(k) ?? '']);
    }
  } catch {
    /* storage blocked */
  }
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
