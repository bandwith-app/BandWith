import { useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { deletionSignOutStep, onAccountBeingDeleted } from './deletionSignOut';

// This device's session only, when the app's sign-out failed (round 10).
const clearLocalSession = async (): Promise<void> => {
  await supabase.auth.signOut({ scope: 'local' });
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
          clearLocal: clearLocalSession,
          reload: () => {
            window.location.href = '/';
          },
        });
      }, clearLocalSession),
    [],
  );
}
