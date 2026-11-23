/**
 * "A failed sign-out is wiping this device" (#296 round 12), as a flag the
 * app's root reads (App.tsx shows only "Signing out…" while it is set).
 *
 * Why: the wipe ends this device's session first, then waits for a sync pass
 * still running for the account that left (syncQueue withOfflineQueuesHeld,
 * twice, 6 s each) before the reload. With the sign-in form on screen for
 * that time, a bandmate could sign in, and the pass would go on under the
 * bandmate's session: the first account's edits saved as theirs.
 *
 * Set when the wipe starts, never cleared: only the reload ends it. On its
 * own, with no imports: the root reads it without loading the wipe itself
 * (AuthContext loads signOutWipe on demand).
 */
let running = false;
const listeners = new Set<() => void>();

export const signOutWipeRunning = (): boolean => running;

/** Called when the wipe starts. Returns the unsubscribe (useSyncExternalStore). */
export const onSignOutWipe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const markSignOutWipe = (): void => {
  if (running) return;
  running = true;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* a listener never stops the wipe */
    }
  }
};
