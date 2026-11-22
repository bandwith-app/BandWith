/**
 * The server says this account is being deleted (180, hint
 * account_being_deleted: a write from another device after the deletion was
 * committed, or an edge function's refusal): sign out (Claude review #282,
 * round 6). The app client's fetch runs every response through this, so no
 * screen has to remember it. The response itself is returned untouched.
 *
 * Round 9 (Codex): the refusal is tied to the account whose request it was
 * (the request's session token), so a late answer for account A never signs
 * out B; and the sign-out is the app's own (App.tsx registers useAuth()'s
 * signOut through useDeletionSignOut), with everything it clears, never a
 * bare token revoke. While this device's own delete flow runs, it is held.
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

function authorizationOf(input: RequestInfo | URL, init?: RequestInit): string | null {
  const h = init?.headers;
  if (h) {
    if (typeof Headers !== 'undefined' && h instanceof Headers) return h.get('authorization');
    if (Array.isArray(h)) return h.find(([k]) => k.toLowerCase() === 'authorization')?.[1] ?? null;
    const rec = h as Record<string, string>;
    const key = Object.keys(rec).find((k) => k.toLowerCase() === 'authorization');
    if (key) return rec[key];
  }
  if (typeof Request !== 'undefined' && input instanceof Request) return input.headers.get('authorization');
  return null;
}

/** The user a request was made for: `sub` of its session token, else null. */
export function requestUserId(input: RequestInfo | URL, init?: RequestInit): string | null {
  const token = (authorizationOf(input, init) ?? '').replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export function deletionAwareFetch(base: typeof fetch, onDeleting: (userId: string | null) => void | Promise<void>): typeof fetch {
  return async (input, init) => {
    const userId = requestUserId(input, init);
    const res = await base(input, init);
    if (!res.ok) {
      void res
        .clone()
        .text()
        .then((body) => {
          // Returned, so a failing sign-out is caught below (round 10).
          if (bodySaysAccountBeingDeleted(body)) return onDeleting(userId);
        })
        .catch((e) => console.warn('[account] deletion sign-out:', e));
    }
    return res;
  };
}

type Handler = (userId: string | null) => void | Promise<void>;
let handler: Handler | null = null;
let clearLocal: (() => Promise<void>) | null = null;
let holds = 0;
let running = false;

/** The app's sign-out for a refusal (App.tsx, through useDeletionSignOut). */
export function onAccountBeingDeleted(fn: Handler, clearLocalSession?: () => Promise<void>): () => void {
  handler = fn;
  clearLocal = clearLocalSession ?? null;
  return () => {
    if (handler === fn) {
      handler = null;
      clearLocal = null;
    }
  };
}

/** This device's session only (round 10): when the app's sign-out failed. */
async function clearSessionHere(): Promise<void> {
  try {
    if (clearLocal) return await clearLocal();
    const { supabase } = await import('./supabase');
    await supabase.auth.signOut({ scope: 'local' });
  } catch (e) {
    console.warn('[account] local sign-out failed:', e);
  }
}

/** This device's own delete flow is running: its refusals sign nothing out. */
export function holdDeletionSignOut(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
  };
}

/** Called for every refusal (planAwareFetch). One sign-out at a time. */
export async function signOutDeletingAccount(userId: string | null): Promise<void> {
  if (holds > 0 || running || !handler) return;
  running = true;
  try {
    await handler(userId);
  } catch (e) {
    // Round 10: never an unhandled rejection; the session still ends here.
    console.warn('[account] sign-out after a deletion refusal failed:', e);
    await clearSessionHere();
  } finally {
    running = false;
  }
}

export interface DeletionSignOutDeps {
  currentUser(): Promise<{ id: string; email: string | null } | null>;
  forgetQuickSignIn(id: string, email: string | null): Promise<void>;
  signOut(): Promise<{ error: unknown }>;
  /** This device's session only, when signOut failed (round 10). */
  clearLocal?(): Promise<void>;
  reload(): void;
}

/**
 * Only for the account the refused request was for, and still signed in:
 * its quick sign-in (Face ID) is forgotten first, so the app's sign-out
 * revokes the session instead of keeping it, then the same sign-out as
 * IdentityHub's, then a reload to the welcome screen, as there.
 */
export async function deletionSignOutStep(
  refusedUserId: string | null,
  deps: DeletionSignOutDeps,
): Promise<'ignored' | 'signed_out' | 'failed'> {
  if (!refusedUserId) return 'ignored';
  const current = await deps.currentUser().catch(() => null);
  if (!current || current.id !== refusedUserId) return 'ignored';
  await deps.forgetQuickSignIn(current.id, current.email).catch(() => {});
  const { error } = await deps.signOut();
  if (error) {
    console.warn('[account] sign-out after a deletion refusal failed:', error);
    await (deps.clearLocal ? deps.clearLocal().catch(() => {}) : clearSessionHere());
    deps.reload();
    return 'failed';
  }
  deps.reload();
  return 'signed_out';
}
