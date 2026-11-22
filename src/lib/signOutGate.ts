/**
 * Signing out with changes still waiting on this phone (notes, suggestions,
 * a setlist order, rehearsal notes: liveOutbox.ts, rehearsalNotesOutbox.ts;
 * chat messages, #291):
 * the person is asked first ("Send now" / "Sign out anyway"), never left to
 * lose them without a word. The sheet that asks registers itself here
 * (UnsentChangesSignOut); AuthContext asks before every sign-out.
 */
import { refusedChanges, waitingChanges } from './liveOutbox';
import { readChatOutboxCount, signOutKeeps } from './offline/storage';

/**
 * 'erase': sign out and erase the refused changes; 'keep-queued': sign out
 * from the lock screen, the waiting changes kept as refused (the wipe would
 * delete them). Both are carried out by AuthContext only once the session
 * check passed, never before.
 */
export type SignOutChoice = 'signout' | 'cancel' | 'erase' | 'keep-queued';
/** `messages`: chat messages not sent (readChatOutboxCount), counted by the caller. */
type Gate = (userId: string, messages: number) => Promise<SignOutChoice>;

let gate: Gate | null = null;

/** The sheet that asks; returns its unregister. */
export function setSignOutGate(next: Gate): () => void {
  gate = next;
  return () => {
    if (gate === next) gate = null;
  };
}

/**
 * true: go on signing out (nothing waits or was refused, or the person chose
 * to). Refused changes alone ask too: they stay on this phone for the
 * account, or "Erase them and sign out".
 */
export async function askBeforeSignOut(userId: string | null | undefined): Promise<boolean> {
  return (await askSignOutChoice(userId)) !== 'cancel';
}

/** The person's answer ('signout' when nothing needed asking). */
export async function askSignOutChoice(userId: string | null | undefined): Promise<SignOutChoice> {
  if (!userId || !gate) return 'signout';
  const messages = await readChatOutboxCount(userId);
  if (!gate || waitingChanges(userId) + messages + refusedChanges(userId) === 0) return 'signout';
  return gate(userId, messages);
}

/** A sign-out the person called off in that sheet: still signed in. */
export const signOutCancelled = (res: unknown): boolean =>
  !!res && typeof res === 'object' && (res as { cancelled?: unknown }).cancelled === true;

/** What "Sign out anyway" does to the queued changes, as the sheet says it. */
export const QUEUED_DELETED =
  'Notes, suggestions or a setlist order made on this phone haven’t reached the band yet. Send them before you sign out: “Sign out anyway” deletes them from this phone.';
export const QUEUED_KEPT =
  'Notes, suggestions or a setlist order made on this phone haven’t reached the band yet. “Sign out anyway” keeps them on this phone, and they’re sent when you sign in again.';

/**
 * The sheet's sentences, from what sign-out really keeps (signOutKeeps asks
 * clearOfflineCache): never a promise the wipe doesn't keep. `clear`: tests.
 */
export function signOutCopy(userId: string, clear?: Parameters<typeof signOutKeeps>[1]) {
  const keeps = (key: string) => signOutKeeps(key, clear);
  const queuedKept = keeps(`bw:live_outbox:${userId}`) && keeps(`bw:rehearsal_notes_outbox:${userId}`);
  return {
    queued: queuedKept ? QUEUED_KEPT : QUEUED_DELETED,
    chatKept: keeps(`bw:chat_outbox:${userId}`),
    refusedKept: keeps(`bw:live_refused:${userId}`) && keeps(`bw:rehearsal_notes_rejected:${userId}`),
  };
}

