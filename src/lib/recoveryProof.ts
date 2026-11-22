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
 *
 * Codex review #287 round 2: the library also re-sends PASSWORD_RECOVERY to
 * every other tab (BroadcastChannel). So the event counts only when THIS tab
 * exchanged a code itself on this page load (seen in the auth client's fetch,
 * `recoveryExchangeFetch`) and that exchange returned the same account and
 * session; the proof then names that code (a fingerprint), and the callback
 * accepts it only for the code in its own URL.
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

/** A short, one-way fingerprint of an auth code (the proof never stores the code). */
export function linkFingerprint(code: string | null | undefined): string | null {
  if (!code) return null;
  // cyrb53: 53 bits, enough to tell two links apart; no crypto.subtle needed.
  let h1 = 0xdeadbeef ^ code.length;
  let h2 = 0x41c6ce57 ^ code.length;
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * The auth code in the URL this page opened with, read when this module
 * loads: supabase.ts imports it before it creates the auth client, which
 * removes `code` from the URL once it has exchanged it (Codex review #287
 * round 3). The callback may render only after that.
 */
const PAGE_LINK_CODE: string | null = (() => {
  try {
    return typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('code') : null;
  } catch {
    return null;
  }
})();

/** The reset link of this page: the code in the URL now, else the one it opened with. */
export function pageLinkCode(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('code') ?? PAGE_LINK_CODE;
  } catch {
    return PAGE_LINK_CODE;
  }
}

/** The code exchange this tab made itself, on this page load (memory only). */
let ownExchange: { link: string; userId: string; accessToken: string | null } | null = null;

/** Noted by `recoveryExchangeFetch` when this tab's own code exchange succeeded. */
export function noteOwnExchange(code: string, userId: string, accessToken: string | null = null) {
  const link = linkFingerprint(code);
  if (link && userId) ownExchange = { link, userId, accessToken };
}

/** For tests: forget this page's exchange. */
export function resetOwnExchange() {
  ownExchange = null;
}

/**
 * Wraps the auth client's fetch: a successful PKCE exchange
 * (`/auth/v1/token?grant_type=pkce`) made by THIS tab is remembered with the
 * account and session it returned. The response is read before the library
 * gets it, so this is known before the library's PASSWORD_RECOVERY event.
 */
export function recoveryExchangeFetch(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const res = await inner(input, init);
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      if (res.ok && /\/auth\/v1\/token\?(?:.*&)?grant_type=pkce(?:&|$)/.test(url) && typeof init?.body === 'string') {
        const code = (JSON.parse(init.body) as { auth_code?: unknown }).auth_code;
        const body = (await res.clone().json()) as { access_token?: unknown; user?: { id?: unknown } } | null;
        if (typeof code === 'string' && typeof body?.user?.id === 'string') {
          noteOwnExchange(code, body.user.id, typeof body.access_token === 'string' ? body.access_token : null);
        }
      }
    } catch {
      /* not an exchange we can read: no proof */
    }
    return res;
  };
}

/**
 * Called on the auth library's PASSWORD_RECOVERY event. Recorded only when
 * this tab's own exchange signed `userId` in (with that session, when the
 * event carries it); a PASSWORD_RECOVERY broadcast from another tab, where
 * someone else finished a reset, records nothing (Codex review #287).
 */
export function noteRecovery(
  userId: string | null | undefined,
  store: Store | null = sessionStore(),
  now = Date.now(),
  accessToken?: string | null,
) {
  if (!userId || !store) return;
  const own = ownExchange;
  if (!own || own.userId !== userId) return;
  if (accessToken && own.accessToken && accessToken !== own.accessToken) return;
  try {
    // The session the exchange returned: the password change uses exactly
    // this token (Codex review #287 round 4), never the shared session.
    store.setItem(KEY, JSON.stringify({ userId, at: now, link: own.link, token: own.accessToken }));
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
 * The callback's check: the proof must name the reset link in this page's
 * URL. An older proof in this tab (Bob's unfinished reset), or one for
 * another link, can't vouch for a link the library didn't exchange here.
 */
export function hasRecoveryProofForLink(
  userId: string | null | undefined,
  code: string | null | undefined,
  store: Store | null = sessionStore(),
  now = Date.now(),
): boolean {
  const link = linkFingerprint(code);
  if (!link || !hasRecoveryProof(userId, store, now) || !store) return false;
  try {
    const v = JSON.parse(store.getItem(KEY) || 'null') as { link?: unknown } | null;
    return v?.link === link;
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

/** The `sub` of a JWT (no signature check: the server checks it). */
function tokenSubject(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const v = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { sub?: unknown };
    return typeof v.sub === 'string' ? v.sub : null;
  } catch {
    return null;
  }
}

/** The access token of the session the reset link's exchange returned, while the proof holds. */
function provenToken(userId: string, store: Store | null, now = Date.now()): string | null {
  if (!store || !hasRecoveryProof(userId, store, now)) return null;
  try {
    const v = JSON.parse(store.getItem(KEY) || 'null') as { token?: unknown } | null;
    const token = typeof v?.token === 'string' && v.token ? v.token : null;
    return token && tokenSubject(token) === userId ? token : null;
  } catch {
    return null;
  }
}

/**
 * The reset form's password change. Rounds 3 and 4 of Codex review #287: the
 * auth library changes the password of the session in shared storage, which
 * another tab can switch to someone else at any moment, even between a check
 * and the call. So the change carries exactly the session that this tab's
 * exchange of the reset link returned (kept with the proof), and the shared
 * session is never read. A proof without that token, or whose token is not
 * the proven account, changes nothing.
 */
export async function updatePasswordForProvenAccount<E>(
  newPassword: string,
  expectedUserId: string | null | undefined,
  deps: {
    update: (password: string, accessToken: string) => Promise<{ error: E | null }>;
    store?: Store | null;
  },
): Promise<{ error: E | Error | null }> {
  const store = deps.store === undefined ? sessionStore() : deps.store;
  const token = expectedUserId ? provenToken(expectedUserId, store) : null;
  if (!token) return { error: Object.assign(new Error('recovery_not_verified'), { code: 'recovery_not_verified' }) };
  return deps.update(newPassword, token);
}

/** An auth API refusal, shaped like the library's AuthError (message, status, code). */
export type PasswordUpdateError = Error & { status?: number; code?: string };

/**
 * `PUT /auth/v1/user` with one session's access token: the same call
 * `auth.updateUser` makes, without the shared session.
 */
export function passwordUpdateWithToken(baseUrl: string, apiKey: string, doFetch: typeof fetch = fetch.bind(globalThis)) {
  return async (password: string, accessToken: string): Promise<{ error: PasswordUpdateError | null }> => {
    try {
      const res = await doFetch(`${baseUrl.replace(/\/+$/, '')}/auth/v1/user`, {
        method: 'PUT',
        headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) return { error: null };
      type Refusal = { msg?: unknown; message?: unknown; error_description?: unknown; code?: unknown; error_code?: unknown };
      const body = (await res.json().catch(() => null)) as Refusal | null;
      const message = [body?.msg, body?.message, body?.error_description].find((m) => typeof m === 'string' && m) as string | undefined;
      const code = [body?.code, body?.error_code].find((c) => typeof c === 'string' && c) as string | undefined;
      return { error: Object.assign(new Error(message || `Password change failed (${res.status})`), { status: res.status, code }) };
    } catch (e) {
      return { error: Object.assign(new Error(e instanceof Error ? e.message : 'Network error'), { code: 'network' }) };
    }
  };
}

export function clearRecoveryProof(store: Store | null = sessionStore()) {
  try {
    store?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
