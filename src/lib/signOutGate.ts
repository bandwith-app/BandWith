/**
 * Signing out with changes still waiting on this phone (notes, suggestions,
 * a setlist order, rehearsal notes: liveOutbox.ts, rehearsalNotesOutbox.ts):
 * the person is asked first ("Send now" / "Sign out anyway"), never left to
 * lose them without a word. The sheet that asks registers itself here
 * (UnsentChangesSignOut); AuthContext asks before every sign-out.
 */
import { waitingChanges } from './liveOutbox';

export type SignOutChoice = 'signout' | 'cancel';
type Gate = (userId: string) => Promise<SignOutChoice>;

let gate: Gate | null = null;

/** The sheet that asks; returns its unregister. */
export function setSignOutGate(next: Gate): () => void {
  gate = next;
  return () => {
    if (gate === next) gate = null;
  };
}

/** true: go on signing out (nothing waits, or the person chose to). */
export async function askBeforeSignOut(userId: string | null | undefined): Promise<boolean> {
  if (!userId || !gate || waitingChanges(userId) === 0) return true;
  return (await gate(userId)) === 'signout';
}

/** A sign-out the person called off in that sheet: still signed in. */
export const signOutCancelled = (res: unknown): boolean =>
  !!res && typeof res === 'object' && (res as { cancelled?: unknown }).cancelled === true;
