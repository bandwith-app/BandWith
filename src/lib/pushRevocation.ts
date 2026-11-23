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
 *
 * Round 7 (main's decision on #287 round 6): a refused revocation is never
 * dropped. It is tried again with backoff (REVOKE_RETRY_BASE_MS doubling, at
 * most REVOKE_RETRY_MAX_MS) until the server takes it; signed out, the server
 * also matches the registration by token, account and the stamp its save
 * returned, when no secret does.
 */

export const PUSH_REVOKE_KEY = 'bandwith.push-revoke';
export const PUSH_TOKEN_KEY = 'bandwith.push-token';
/**
 * At most this many wait on one device (the oldest go first).
 */
export const PUSH_REVOKE_MAX_QUEUED = 20;
/**
 * Signed out, the server answers true only for a credential that matches
 * (Codex review #287 round 8, B1), so a revocation whose registration was
 * replaced or cleared is refused for good: it is dropped 30 days after its
 * first refusal (never counted from the queue time: an unsent one always
 * gets its tries, Claude review r9), or as soon as this device's token is
 * another one (the old token no longer delivers here).
 */
export const PUSH_REVOKE_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
/** The first retry of a refused revocation; each refusal doubles it. */
export const REVOKE_RETRY_BASE_MS = 30_000;
/** The longest wait between two tries of one revocation. */
export const REVOKE_RETRY_MAX_MS = 60 * 60_000;

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
  /** Refusals so far (round 7): the backoff grows with them. */
  tries: number;
  /** Network errors in a row (round 8, M1): they back off too, but are no refusal. */
  fails: number;
  /** When the server first refused it (device clock, ms): the 30 days count from here. */
  firstRefusedAt: number | null;
  /** Not tried again before this (device clock, ms); null: at the next flush. */
  retryAt: number | null;
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
            const tries = Number.isInteger(p.tries) && p.tries > 0 ? p.tries : 0;
            const fails = Number.isInteger(p.fails) && p.fails > 0 ? p.fails : 0;
            const retryAt = typeof p.retryAt === 'number' && Number.isFinite(p.retryAt) ? p.retryAt : null;
            const firstRefusedAt = typeof p.firstRefusedAt === 'number' && Number.isFinite(p.firstRefusedAt) ? p.firstRefusedAt : null;
            return { token: p.token, userId: p.userId, registeredAt: p.registeredAt, confirmed, attempts: attemptList(p.attempts, confirmed), at: p.at, tries, fails, retryAt, firstRefusedAt };
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
  if (!userId) return null;
  const v = rememberedPushTokenAny(store);
  return v && v.userId === userId ? v : null;
}

/**
 * The token last saved on this device, whichever account it was for: a
 * session that ended without a sign-out here still revokes it (Codex review
 * #287 round 7, B4).
 */
export function rememberedPushTokenAny(store: Store | null): SavedPushToken | null {
  if (!store) return null;
  try {
    const v = JSON.parse(store.getItem(PUSH_TOKEN_KEY) || 'null') as Partial<SavedPushToken> | null;
    if (!v || typeof v.token !== 'string' || typeof v.userId !== 'string' || !v.userId) return null;
    const confirmed = secretOf(v.confirmed);
    return { token: v.token, userId: v.userId, registeredAt: typeof v.registeredAt === 'string' ? v.registeredAt : null, confirmed, attempts: attemptList(v.attempts, confirmed) };
  } catch {
    return null;
  }
}

/**
 * Before a save goes out: the new secret joins the unanswered ones (the save
 * may not arrive, or its answer may be lost). The confirmed secret stays
 * pinned: offline saves never push it out (Codex review #287 round 5). So
 * does the last confirmed stamp, until the new save is confirmed (Codex
 * review #287 round 8, B3): for a registration from before 184 it is the
 * only credential signed out, and the revocation tries both (the server
 * takes whichever it knows; a save that did land changed the stamp, so the
 * old one then matches nothing).
 */
export function beginPushSave(store: Store | null, token: string, userId: string, secret: string) {
  const prev = rememberedPushToken(store, userId);
  const same = prev?.token === token ? prev : null;
  rememberPushToken(store, { token, userId, registeredAt: same?.registeredAt ?? null, confirmed: same?.confirmed ?? null, attempts: [secret, ...(same?.attempts ?? [])] });
}

/**
 * The same account signs in again with the same token (iOS keeps it): its
 * own waiting revocation must not switch off the registration it is now
 * using (Claude review #287 round 7, C3). It leaves the queue, and what it
 * knew (stamp, secrets) goes back to the remembered registration, so the
 * next sign-out still holds every credential. Other accounts' entries stay.
 */
export function reclaimRevocation(store: Store | null, token: string, userId: string): boolean {
  const list = readPendingRevocations(store);
  const mine = list.find((p) => p.token === token && p.userId === userId);
  if (!mine) return false;
  writePending(store, list.filter((p) => p !== mine));
  const prev = rememberedPushToken(store, userId);
  const same = prev?.token === token ? prev : null;
  const confirmed = same?.confirmed ?? mine.confirmed;
  rememberPushToken(store, {
    token,
    userId,
    registeredAt: same?.registeredAt ?? mine.registeredAt,
    confirmed,
    // The queued confirmed secret stays a candidate when the record has another one.
    attempts: attemptList([...(same?.attempts ?? []), ...mine.attempts, ...(mine.confirmed && mine.confirmed !== confirmed ? [mine.confirmed] : [])], confirmed),
  });
  return true;
}

/** The account was deleted (Codex review #287 round 8, M2): nothing of it is kept on the device. */
export function forgetAccountPushState(store: Store | null, userId: string) {
  const list = readPendingRevocations(store);
  const kept = list.filter((p) => p.userId !== userId);
  if (kept.length !== list.length) writePending(store, kept);
  if (rememberedPushTokenAny(store)?.userId === userId) rememberPushToken(store, null);
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
/**
 * Writes this account's revocation for the token to the queue (merged with
 * an earlier one of the same account): done first, before any wait, so an
 * app killed mid sign-out still has it (Codex review #287 round 8, B1).
 */
export function queueRevocation(
  store: Store | null,
  token: string,
  userId: string,
  saved: Pick<SavedPushToken, 'registeredAt' | 'confirmed' | 'attempts'> | null,
  now: Date = new Date(),
) {
  if (!userId) return;
  const at = now.toISOString();
  const list = readPendingRevocations(store);
  // Another account's revocation for this token stays (Codex review #287
  // round 4); this account's earlier one is merged into the new one.
  const same = list.find((p) => p.token === token && p.userId === userId);
  const confirmed = saved?.confirmed ?? same?.confirmed ?? null;
  const attempts = attemptList([...(saved?.attempts ?? []), ...(same?.attempts ?? [])], confirmed);
  // A new sign-out is a new chance: tried at the next flush.
  const entry: PendingRevocation = { token, userId, registeredAt: saved?.registeredAt ?? same?.registeredAt ?? null, confirmed, attempts, at, tries: 0, fails: 0, retryAt: null, firstRefusedAt: null };
  writePending(store, [...list.filter((p) => p !== same), entry]);
}

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
  if (queue) queueRevocation(deps.store, token, userId, saved, deps.now?.() ?? new Date());
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
  /** Device clock in ms, for the backoff. */
  now?: () => number;
  /** The network just came back: what waits only after a network error is tried now. */
  online?: boolean;
  /** This device's current token, when known: a revocation for another token is dropped. */
  currentToken?: string | null;
}

/** The wait after the n-th refusal (n >= 1). */
export const revokeRetryDelay = (tries: number): number =>
  Math.min(REVOKE_RETRY_MAX_MS, REVOKE_RETRY_BASE_MS * 2 ** Math.max(0, Math.min(tries - 1, 20)));

/** When the next refused revocation is due (ms, device clock), or null with none in backoff. */
export function nextRevocationRetry(store: Store | null): number | null {
  const due = readPendingRevocations(store).flatMap((p) => (p.retryAt === null ? [] : [p.retryAt]));
  return due.length ? Math.min(...due) : null;
}

/**
 * Sends the waiting revocations (main's decision on #287 round 5: no lookup
 * by token). Done when the server took it (its credential matched). Refused:
 * kept, and tried again after a backoff that doubles with every refusal
 * (main's decision, round 6), until a save of the token the server confirmed
 * clears it (forgetRevocation), or 30 days after its first refusal, or once
 * this device's token changed (round 8, B1). Offline or an error: kept, with
 * the same backoff (not counted as a refusal); the 'online' event tries it
 * at once.
 */
export async function flushPushRevocations(store: Store | null, deps: FlushDeps): Promise<number> {
  const list = readPendingRevocations(store);
  if (!list.length) return 0;
  const done = new Set<string>();
  const refused = new Set<string>();
  const errored = new Set<string>();
  const now = deps.now?.() ?? Date.now();
  const keyOf = (p: PendingRevocation) => `${p.token}|${p.userId}|${p.at}`;
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
    // Device clock: set back after a refusal, the age never goes negative (Claude delta review #287 r10).
    const refusedFor = p.tries > 0 && p.firstRefusedAt !== null ? Math.max(0, now - p.firstRefusedAt) : 0;
    if (refusedFor > PUSH_REVOKE_MAX_AGE_MS || (deps.currentToken && p.token !== deps.currentToken)) {
      done.add(keyOf(p));
      continue;
    }
    // A backoff further off than the longest one is from a clock set back: due now.
    const waiting = p.retryAt !== null && p.retryAt > now && p.retryAt - now <= REVOKE_RETRY_MAX_MS;
    if (waiting && !(deps.online && p.fails > 0)) continue;
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
    if (revoked) {
      sent++;
      done.add(keyOf(p));
    } else if (!failed) refused.add(keyOf(p));
    else errored.add(keyOf(p));
  }
  // Something may have been queued or saved meanwhile: merge, don't overwrite.
  const current = readPendingRevocations(store);
  writePending(
    store,
    current
      .filter((p) => !done.has(keyOf(p)))
      .map((p) => {
        if (refused.has(keyOf(p))) return { ...p, tries: p.tries + 1, fails: 0, retryAt: now + revokeRetryDelay(p.tries + 1), firstRefusedAt: p.firstRefusedAt !== null && p.firstRefusedAt <= now ? p.firstRefusedAt : now };
        // Offline or an error (Codex review #287 round 8, M1): the same
        // backoff, so an overdue entry isn't retried every second, but no
        // refusal; the 'online' event still tries at once.
        if (errored.has(keyOf(p))) return { ...p, fails: p.fails + 1, retryAt: now + revokeRetryDelay(p.fails + 1) };
        return p;
      }),
  );
  return sent;
}

/**
 * What this device keeps about push across any wipe (Claude review #287 r9):
 * the queued revocations, the saved registration and the token deletion
 * still pending. The same rule as #296's signOutWipe: the `bandwith.push-`
 * prefix.
 */
export const PUSH_STATE_PREFIX = 'bandwith.push-';

/** The push state read when a sign-out failed, and whose it is. */
let heldPushState: { entries: [string, string][]; owner: string | null; stopWatch: () => void } | null = null;

const dropHeldPushState = () => {
  const held = heldPushState;
  heldPushState = null;
  held?.stopWatch();
};

const pushStateNow = (): [string, string][] => {
  const out: [string, string][] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PUSH_STATE_PREFIX)) out.push([k, localStorage.getItem(k) ?? '']);
    }
  } catch {
    /* storage blocked */
  }
  return out;
};

/**
 * A sign-out whose failure the caller answers by wiping the device
 * (IdentityHub): the push state is read the moment it fails, after the
 * sign-out queued its revocation, so restorePushStateAfterWipe can put it
 * back once the wipe ran. It is the failing account's (`owner`): if anyone
 * else is signed in before the restore (this tab or another one, reported by
 * `watchSignedIn`), it is dropped, never given to that session (main's
 * condition on #287 round 10). Memory only: it never outlives the page.
 */
export function holdPushStateOnFailure<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  opts: {
    owner: () => string | null | undefined;
    /** Calls back with the signed-in account (null: none) now and on every change; returns the unsubscribe. */
    watchSignedIn?: (onUser: (uid: string | null) => void) => () => void;
  },
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      dropHeldPushState();
      const held = { entries: pushStateNow(), owner: opts.owner() ?? null, stopWatch: () => {} };
      heldPushState = held;
      let watching = true;
      let stop: () => void = () => {};
      try {
        stop = opts.watchSignedIn?.((uid) => {
          if (watching && heldPushState === held && uid && uid !== held.owner) dropHeldPushState();
        }) ?? (() => {});
      } catch {
        stop = () => {};
      }
      held.stopWatch = () => {
        watching = false;
        try {
          stop();
        } catch {
          /* already gone */
        }
      };
      // Someone else signed in while subscribing: already dropped.
      if (heldPushState !== held) held.stopWatch();
      throw e;
    }
  };
}

/**
 * After that wipe: the push state read at the failure comes back (a newer
 * value stays), unless another account is signed in now (its own registration
 * on the device, or a sign-in seen meanwhile): then nothing comes back.
 */
export function restorePushStateAfterWipe() {
  const held = heldPushState;
  dropHeldPushState();
  if (!held) return;
  const current = rememberedPushTokenAny(localStorageOrNull());
  if (current && current.userId !== held.owner) return;
  for (const [k, v] of held.entries) {
    try {
      if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  }
}

const localStorageOrNull = (): Store | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};
