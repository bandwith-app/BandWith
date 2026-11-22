/**
 * Proof that a password-reset link really signed this account in (audit 04 #2).
 *
 * A reset link carries `?bw_recovery=1`. Opened in a browser that has no code
 * verifier for it (another browser, or one where someone else is signed in),
 * the auth library skips the code and keeps whatever session is there: the
 * callback then took that session for a successful reset and asked for a new
 * password, which changed the other person's password.
 *
 * Now only the library's own PASSWORD_RECOVERY event (a code exchange that
 * succeeded for a reset request started on this device) counts: it is noted
 * here for that account, in sessionStorage (it survives the callback's
 * redirect to the app root, not the tab), and the reset screen and the
 * password change both require it for the account that is signed in.
 */

const KEY = 'bandwith.recovery-proof';
/** A reset screen left open longer than this needs a new link. */
export const RECOVERY_PROOF_TTL_MS = 60 * 60 * 1000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const sessionStore = (): Store | null => {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
};

/** Called on the auth library's PASSWORD_RECOVERY event. */
export function noteRecovery(userId: string | null | undefined, store: Store | null = sessionStore(), now = Date.now()) {
  if (!userId || !store) return;
  try {
    store.setItem(KEY, JSON.stringify({ userId, at: now }));
  } catch {
    /* storage blocked: the reset screen won't open, the link can be asked again */
  }
}

/** True when a reset link signed `userId` in on this tab within the last hour. */
export function hasRecoveryProof(userId: string | null | undefined, store: Store | null = sessionStore(), now = Date.now()): boolean {
  if (!userId || !store) return false;
  try {
    const v = JSON.parse(store.getItem(KEY) || 'null') as { userId?: unknown; at?: unknown } | null;
    return !!v && v.userId === userId && typeof v.at === 'number' && now - v.at >= 0 && now - v.at <= RECOVERY_PROOF_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * When this page started (supabase.ts imports this module before it creates
 * the auth client, so a reset link's PASSWORD_RECOVERY comes after it).
 */
export const RECOVERY_PAGE_LOADED_AT = Date.now();

/**
 * The callback's check (Codex review #287): the proof must come from THIS
 * page load. An older one (Bob's unfinished reset in the same tab) can't
 * vouch for a reset link the library didn't exchange here (Alice's).
 */
export function hasRecoveryProofSince(
  userId: string | null | undefined,
  since: number,
  store: Store | null = sessionStore(),
  now = Date.now(),
): boolean {
  if (!hasRecoveryProof(userId, store, now) || !store) return false;
  try {
    const v = JSON.parse(store.getItem(KEY) || 'null') as { at?: unknown } | null;
    return typeof v?.at === 'number' && v.at >= since;
  } catch {
    return false;
  }
}

/** True when any account has a fresh proof (the user isn't known yet at start). */
export function hasAnyRecoveryProof(store: Store | null = sessionStore(), now = Date.now()): boolean {
  if (!store) return false;
  try {
    const v = JSON.parse(store.getItem(KEY) || 'null') as { userId?: unknown } | null;
    return typeof v?.userId === 'string' && hasRecoveryProof(v.userId, store, now);
  } catch {
    return false;
  }
}

export function clearRecoveryProof(store: Store | null = sessionStore()) {
  try {
    store?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
