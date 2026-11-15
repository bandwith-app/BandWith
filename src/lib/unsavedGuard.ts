import { useEffect, useRef } from 'react';

/**
 * Edits waiting for Save (a gig's setlist, a setlist in the library) must not
 * vanish when the user moves elsewhere through a control that lives outside
 * the editing screen: the tab bar, another event in the list, another
 * setlist. Each screen with changes registers a guard; navigation runs
 * through `runGuarded`, and the first guard with changes asks first
 * (Save / Discard / Keep editing) and runs the navigation only once the user
 * chooses to leave.
 */
type Guard = (proceed: () => void) => boolean;

const guards = new Set<Guard>();

/** Adds a guard; returns the function that removes it. */
export function registerUnsavedGuard(guard: Guard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

/** Runs `action` now, or hands it to the screen with unsaved changes to run after it asks. */
export function runGuarded(action: () => void): void {
  for (const guard of [...guards].reverse()) {
    if (guard(action)) return;
  }
  action();
}

/**
 * While `dirty`, navigation through `runGuarded` calls `ask(proceed)` instead
 * of leaving; the screen shows its "Unsaved changes" sheet and calls
 * `proceed` after Save or Discard.
 */
export function useUnsavedGuard(dirty: boolean, ask: (proceed: () => void) => void): void {
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    if (!dirty) return;
    return registerUnsavedGuard((proceed) => {
      askRef.current(proceed);
      return true;
    });
  }, [dirty]);
}
