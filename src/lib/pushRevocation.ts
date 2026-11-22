/**
 * Signing out offline must still stop this device's pushes (audit 04 #6).
 *
 * Sign-out switches the device's token off on the server while the session
 * is valid. Offline that call fails, sign-out still succeeds on the device,
 * and the server kept sending chat previews to a phone nobody is signed in
 * on. Now, when the server can't be told:
 *   1. delivery stops on the device itself (APNs / FCM unregister);
 *   2. the revocation is kept outside the `bw:` cache that sign-out wipes,
 *      and sent as soon as the app is online again (migration 184:
 *      bw_revoke_push_token works without a session, for that token and
 *      account only, and never undoes a newer registration).
 *
 * Codex review #287: no device clock is ever compared, and the last saved
 * token is remembered here, so a sign-out right after an offline cold start
 * (before the native token arrives) still works. With no token known at all,
 * delivery still stops on the device.
 *
 * Round 4: signed out, the server takes a revocation only with the secret of
 * that registration. The device makes a random one for every save, keeps it
 * here before it sends it, and makes it the only one once the save answers.
 * A save whose answer was lost leaves both the new and the previous secret as
 * candidates (the server holds one of them). A revocation the server refuses
 * stays queued while the token is still on for that account, and only a save
 * the server confirmed (the token is now someone's current registration)
 * clears the queue for that token.
 */

export const PUSH_REVOKE_KEY = 'bandwith.push-revoke';
export const PUSH_TOKEN_KEY = 'bandwith.push-token';
/**
 * At most this many wait on one device (the oldest go first). Age alone never
 * drops one unsent (Codex review #287 round 2): the server registration has
 * no expiry, and its exact-stamp match makes a late call harmless.
 */
export const PUSH_REVOKE_MAX_QUEUED = 20;

export interface PendingRevocation {
  token: string;
  userId: string;
  /** push_tokens.updated_at of the registration, when the save answered. */
  registeredAt: string | null;
  /** The secret of the last save the server confirmed: never evicted (Codex review #287 round 5). */
  confirmed: string | null;
  /** Secrets of saves whose answer never came, newest first (at most 20; the newest is never dropped). */
  attempts: string[];
  /** When it was queued (device clock): only for the queue's order. */
  at: string;
}

/** The token this device last saved, for which account, its stamp and secrets. */
export interface SavedPushToken {
  token: string;
  userId: string;
  registeredAt: string | null;
  confirmed: string | null;
  attempts: string[];
}

/**
 * At most this many unanswered saves' secrets per registration. Any of them
 * may be the one the server holds (a lost answer, then saves that never got
 * out): none is dropped before that, the oldest first (Codex review #287
 * round 6).
 */
export const MAX_UNCONFIRMED_SECRETS = 20;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const isSecret = (x: unknown): x is string => typeof x === 'string' && x.length >= 32;
const secretOf = (v: unknown): string | null => (isSecret(v) ? v : null);
/** Unanswered saves' secrets: unique, never the confirmed one, newest first. */
const attemptList = (v: unknown, confirmed: string | null = null): string[] =>
  Array.isArray(v) ? v.filter(isSecret).filter((x, i, a) => x !== confirmed && a.indexOf(x) === i).slice(0, MAX_UNCONFIRMED_SECRETS) : [];

/** Every secret the server may hold for it: the unanswered saves first, then the confirmed one. */
export const candidateSecrets = (p: Pick<PendingRevocation, 'confirmed' | 'attempts'>): string[] =>
  p.confirmed ? [...p.attempts, p.confirmed] : [...p.attempts];

export function readPendingRevocations(store: Store | null): PendingRevocation[] {
  if (!store) return [];
  try {
    const v = JSON.parse(store.getItem(PUSH_REVOKE_KEY) || '[]');
    return Array.isArray(v)
      ? v
          .filter(
            (p) =>
              !!p && typeof p.token === 'string' && typeof p.userId === 'string' && (typeof p.registeredAt === 'string' || p.registeredAt === null) && typeof p.at === 'string',
          )
          .map((p) => {
            const confirmed = secretOf(p.confirmed);
            return { token: p.token, userId: p.userId, registeredAt: p.registeredAt, confirmed, attempts: attemptList(p.attempts, confirmed), at: p.at };
          })
      : [];
  } catch {
    return [];
  }
}

function writePending(store: Store | null, list: PendingRevocation[]) {
  if (!store) return;
  try {
    if (list.length) store.setItem(PUSH_REVOKE_KEY, JSON.stringify(list.slice(-PUSH_REVOKE_MAX_QUEUED)));
    else store.removeItem(PUSH_REVOKE_KEY);
  } catch {
    /* storage blocked: the device-side unregister still holds */
  }
}

/** A random revocation secret: 256 bits, hex. */
export function newRevokeSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Remember (or, with null, forget) the token this device last saved. */
export function rememberPushToken(store: Store | null, saved: SavedPushToken | null) {
  if (!store) return;
  try {
    if (saved) {
      const confirmed = secretOf(saved.confirmed);
      store.setItem(PUSH_TOKEN_KEY, JSON.stringify({ ...saved, confirmed, attempts: attemptList(saved.attempts, confirmed) }));
    }
    else store.removeItem(PUSH_TOKEN_KEY);
  } catch {
    /* storage blocked: sign-out falls back to the token in memory */
  }
}

/** The token last saved on this device for `userId`, if any. */
export function rememberedPushToken(store: Store | null, userId: string | null | undefined): SavedPushToken | null {
  if (!store || !userId) return null;
  try {
    const v = JSON.parse(store.getItem(PUSH_TOKEN_KEY) || 'null') as Partial<SavedPushToken> | null;
    if (!v || typeof v.token !== 'string' || v.userId !== userId) return null;
    const confirmed = secretOf(v.confirmed);
    return { token: v.token, userId, registeredAt: typeof v.registeredAt === 'string' ? v.registeredAt : null, confirmed, attempts: attemptList(v.attempts, confirmed) };
  } catch {
    return null;
  }
}

/**
 * Before a save goes out (Claude review #287 round 4): the old stamp is
 * cleared at once, and the new secret joins the unanswered ones (the save may
 * not arrive, or its answer may be lost). The confirmed secret stays pinned:
 * offline saves never push it out (Codex review #287 round 5).
 */
export function beginPushSave(store: Store | null, token: string, userId: string, secret: string) {
  const prev = rememberedPushToken(store, userId);
  const same = prev?.token === token ? prev : null;
  rememberPushToken(store, { token, userId, registeredAt: null, confirmed: same?.confirmed ?? null, attempts: [secret, ...(same?.attempts ?? [])] });
}

/**
 * The save answered: its stamp, and its secret as the only one (null: the
 * server stores none, an older database).
 */
export function confirmPushSave(store: Store | null, token: string, userId: string, secret: string | null, registeredAt: string | null) {
  rememberPushToken(store, { token, userId, registeredAt, confirmed: secret, attempts: [] });
}

/**
 * The server confirmed a save of this token (it is someone's current
 * registration now): no waiting revocation for it can apply any more. With
 * `userId`, only that account's.
 */
export function forgetRevocation(store: Store | null, token: string, userId?: string) {
  const list = readPendingRevocations(store);
  const kept = list.filter((p) => p.token !== token || (userId !== undefined && p.userId !== userId));
  if (kept.length !== list.length) writePending(store, kept);
}

/** push_tokens.updated_at as microseconds, for comparing two stamps (null if unreadable). */
export function stampMicros(stamp: string | null | undefined): number | null {
  if (!stamp) return null;
  const ms = Date.parse(stamp);
  if (Number.isNaN(ms)) return null;
  const frac = /\.(\d+)/.exec(stamp)?.[1] ?? '';
  return Math.floor(ms) * 1000 + Number((frac + '000000').slice(3, 6));
}

export interface SignOutRevokeDeps {
  store: Store | null;
  /** The signed-in revocation (bw_unregister_push_token); true when the server took it. */
  revokeOnServer: () => Promise<boolean>;
  /** Stop delivery on the device (PushNotifications.unregister). */
  unregisterDevice: () => Promise<void>;
  now?: () => Date;
}

/**
 * Run while the session is still valid. Delivery stops on the device in
 * every case. 'server' when the server switched the token off too; 'queued'
 * when it couldn't (offline, or the token is not this account's): the
 * revocation waits for the network, with the stamp and secrets known;
 * 'device' when the account isn't known: on the device only.
 */
export async function revokeOnSignOut(
  token: string,
  userId: string,
  saved: Pick<SavedPushToken, 'registeredAt' | 'confirmed' | 'attempts'> | null,
  deps: SignOutRevokeDeps,
): Promise<'server' | 'queued' | 'device'> {
  let ok = false;
  try {
    ok = await deps.revokeOnServer();
  } catch {
    ok = false;
  }
  if (ok) {
    forgetRevocation(deps.store, token, userId);
    // The device stops too, whatever the server answered (Codex review #287
    // round 6): another account's registration of this token may still be on.
    try {
      await deps.unregisterDevice();
    } catch {
      /* the server already switched it off */
    }
    return 'server';
  }
  const queue = !!userId;
  if (queue) {
    const at = (deps.now?.() ?? new Date()).toISOString();
    const list = readPendingRevocations(deps.store);
    // Another account's revocation for this token stays (Codex review #287
    // round 4); this account's earlier one is merged into the new one.
    const same = list.find((p) => p.token === token && p.userId === userId);
    const confirmed = saved?.confirmed ?? same?.confirmed ?? null;
    const attempts = attemptList([...(saved?.attempts ?? []), ...(same?.attempts ?? [])], confirmed);
    const entry: PendingRevocation = { token, userId, registeredAt: saved?.registeredAt ?? same?.registeredAt ?? null, confirmed, attempts, at };
    writePending(deps.store, [...list.filter((p) => p !== same), entry]);
  }
  try {
    await deps.unregisterDevice();
  } catch {
    /* the queued revocation still runs */
  }
  return queue ? 'queued' : 'device';
}

type Answer = { data?: unknown; error: unknown };

export interface FlushDeps {
  /** bw_revoke_push_token with one secret (null: none, only signed in). */
  revoke: (p: PendingRevocation, secret: string | null) => PromiseLike<Answer>;
  /** False once the session that started the flush is over: stop between entries. */
  alive?: () => boolean;
}

/**
 * Sends the waiting revocations, deciding on the device (main's decision on
 * #287 round 5: no lookup by token). Done: the server switched it off, or
 * refused every secret it may hold (had one still been valid, the revocation
 * would have succeeded: that registration is already off or replaced).
 * Kept: offline or an error, or no secret known (it waits for a confirmed
 * save of the token, or for its account to sign in again here).
 */
export async function flushPushRevocations(store: Store | null, deps: FlushDeps): Promise<number> {
  const list = readPendingRevocations(store);
  if (!list.length) return 0;
  const done = new Set<string>();
  let sent = 0;
  const call = async (fn: () => PromiseLike<Answer>): Promise<Answer> => {
    try {
      return await fn();
    } catch (e) {
      return { data: null, error: e };
    }
  };
  for (const p of list) {
    if (deps.alive && !deps.alive()) break;
    const secrets = candidateSecrets(p);
    let failed = false;
    let revoked = false;
    for (const secret of secrets.length ? secrets : [null]) {
      const r = await call(() => deps.revoke(p, secret));
      if (r.error) {
        failed = true;
        break;
      }
      if (r.data === true) {
        revoked = true;
        break;
      }
    }
    if (revoked) sent++;
    if (revoked || (!failed && secrets.length > 0)) done.add(`${p.token}|${p.userId}|${p.at}`);
  }
  // Something may have been queued or saved meanwhile: merge, don't overwrite.
  const current = readPendingRevocations(store);
  writePending(store, current.filter((p) => !done.has(`${p.token}|${p.userId}|${p.at}`)));
  return sent;
}
