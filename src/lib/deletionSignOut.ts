/**
 * The server says this account is being deleted (180, hint
 * account_being_deleted: a write from another device after the deletion was
 * committed, or an edge function's refusal): sign out (Claude review #282,
 * round 6). The app client's fetch runs every response through this, so no
 * screen has to remember it. The response itself is returned untouched.
 */
const HINT = 'account_being_deleted';

/** Whether a response body (JSON text) carries the hint. */
export function bodySaysAccountBeingDeleted(body: string): boolean {
  if (!body || !body.includes(HINT)) return false;
  try {
    const parsed = JSON.parse(body) as { hint?: unknown; code?: unknown } | null;
    return !!parsed && (parsed.hint === HINT || parsed.code === HINT);
  } catch {
    return false;
  }
}

export function deletionAwareFetch(base: typeof fetch, onDeleting: () => void): typeof fetch {
  let signingOut = false;
  return async (input, init) => {
    const res = await base(input, init);
    if (!res.ok && !signingOut) {
      void res
        .clone()
        .text()
        .then((body) => {
          if (signingOut || !bodySaysAccountBeingDeleted(body)) return;
          signingOut = true;
          try {
            onDeleting();
          } finally {
            // Another sign-in later (a new account) may hit it again.
            setTimeout(() => {
              signingOut = false;
            }, 30_000);
          }
        })
        .catch(() => {});
    }
    return res;
  };
}

/**
 * The account is being deleted (another device committed it, 180): end
 * every session of it, Face ID's kept one included, then this device's.
 * Loaded lazily: the client's own fetch runs through this module.
 */
export async function signOutDeletingAccount(): Promise<void> {
  const { supabase } = await import('./supabase');
  const auth = supabase.auth as unknown as { _removeSession?: () => Promise<void> };
  const { error } = await supabase.auth.signOut({ scope: 'global' });
  if (error && typeof auth._removeSession === 'function') {
    await auth._removeSession().catch(() => {});
  }
}
