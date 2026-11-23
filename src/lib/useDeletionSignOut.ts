import { useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { clearDeviceSession, deletionSignOutStep, onAccountBeingDeleted } from './deletionSignOut';
import { clearOfflineCache } from './offline/storage';
import { clearStageCache } from './stageBleNative';

/** The client's session storage and its key (supabase-js keeps both on auth). */
const sessionStore = () => {
  const auth = supabase.auth as unknown as {
    storage?: { removeItem(key: string): unknown };
    storageKey?: string;
  };
  return auth.storage && auth.storageKey
    ? { key: auth.storageKey, removeItem: (k: string) => auth.storage!.removeItem(k) }
    : null;
};

/**
 * This device only, when the app's sign-out failed (round 10; round 11,
 * Claude r10 F2): the stored session, then the offline and Stage caches,
 * as the app's sign-out clears them; the reload drops the user state.
 */
export const clearThisDevice = (): Promise<void> =>
  clearDeviceSession({
    signOutLocal: () => supabase.auth.signOut({ scope: 'local' }),
    sessionStore: sessionStore(),
    clearOfflineCache: () => clearOfflineCache(),
    clearStageCache,
  });

const reloadToWelcome = () => {
  window.location.href = '/';
};

/**
 * A server answer saying this account is being deleted (180) signs out
 * through `signOut`, the app's own (useAuth().signOut, as IdentityHub's
 * Sign out): push, badge, presence, offline and Stage caches, all it clears
 * (Codex review #282, round 9). Mounted once, in App. Round 10: with
 * `discardPendingWrites` (#287 / #292's sign-out flag, ignored before
 * them): the account is gone, so its unsent changes, chat outbox and
 * refused list go too.
 */
export function useDeletionSignOut(signOut: (opts?: { discardPendingWrites?: boolean }) => Promise<{ error: unknown }>): void {
  const latest = useRef(signOut);
  latest.current = signOut;
  useEffect(
    () =>
      onAccountBeingDeleted(async (userId) => {
        await deletionSignOutStep(userId, {
          currentUser: async () => {
            const { data } = await supabase.auth.getSession();
            const u = data.session?.user;
            return u ? { id: u.id, email: u.email ?? null } : null;
          },
          forgetQuickSignIn: (id, email) => import('./services/biometric').then((m) => m.forgetQuickSignInFor(id, email)),
          signOut: () => latest.current({ discardPendingWrites: true }),
          clearLocal: clearThisDevice,
          reload: reloadToWelcome,
        });
      }, clearThisDevice, reloadToWelcome),
    [],
  );
}
