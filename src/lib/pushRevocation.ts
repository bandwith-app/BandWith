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
 * Codex review #287: the server matches the registration itself (its own
 * push_tokens.updated_at, returned by the save), never a device clock; and
 * the last saved token is remembered here, so a sign-out right after an
 * offline cold start (before the native token arrives) still works. With no
 * token known at all, delivery still stops on the device.
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
  /**
   * The registration to switch off: push_tokens.updated_at as the server
   * stored it. null: this device never learned it (a registration made by an
   * older build, or a save whose reply was lost); 184 then matches the token
   * and account only (Codex review #287 round 3).
   */
  registeredAt: string | null;
  /** When it was queued (device clock): only for dropping very old ones. */
  at: string;
}

/** The token this device last saved, for which account, and the server's stamp. */
export interface SavedPushToken {
  token: string;
  userId: string;
  registeredAt: string | null;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readPendingRevocations(store: Store | null): PendingRevocation[] {
  if (!store) return [];
  try {
    const v = JSON.parse(store.getItem(PUSH_REVOKE_KEY) || '[]');
    return Array.isArray(v)
      ? v.filter(
          (p): p is PendingRevocation =>
            !!p && typeof p.token === 'string' && typeof p.userId === 'string' && (typeof p.registeredAt === 'string' || p.registeredAt === null) && typeof p.at === 'string',
        )
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

/**
 * Remember (or, with null, forget) the token this device last saved. Two
 * saves of the same token can answer in either order: the newer stamp is
 * kept (Codex review #287 round 3).
 */
export function rememberPushToken(store: Store | null, saved: SavedPushToken | null) {
  if (!store) return;
  try {
    if (saved) {
      const prev = rememberedPushToken(store, saved.userId);
      if (prev?.token === saved.token) {
        const a = stampMicros(prev.registeredAt);
        const b = stampMicros(saved.registeredAt);
        if (a !== null && (b === null || a > b)) return;
      }
    }
    if (saved) store.setItem(PUSH_TOKEN_KEY, JSON.stringify(saved));
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
    return { token: v.token, userId, registeredAt: typeof v.registeredAt === 'string' ? v.registeredAt : null };
  } catch {
    return null;
  }
}

/**
 * A token saved again (someone signed in on this device): nothing to revoke.
 * With `userId`, only that account's revocation (another account's must
 * still go until the save has moved the token).
 */
export function forgetRevocation(store: Store | null, token: string, userId?: string) {
  const list = readPendingRevocations(store);
  const kept = list.filter((p) => p.token !== token || (userId !== undefined && p.userId !== userId));
  if (kept.length !== list.length) writePending(store, kept);
}

/** The account signed in again on this device: none of its revocations may go. */
export function forgetRevocationsOf(store: Store | null, userId: string) {
  const list = readPendingRevocations(store);
  const kept = list.filter((p) => p.userId !== userId);
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
 * Run while the session is still valid. 'server' when the server switched
 * the token off; 'queued' when it couldn't (offline): delivery stopped on
 * the device and the revocation waits for the network (with the stamp when
 * known, else token and account only); 'device' when the account isn't
 * known: delivery stopped on the device only.
 */
export async function revokeOnSignOut(
  token: string,
  userId: string,
  registeredAt: string | null,
  deps: SignOutRevokeDeps,
): Promise<'server' | 'queued' | 'device'> {
  let ok = false;
  try {
    ok = await deps.revokeOnServer();
  } catch {
    ok = false;
  }
  if (ok) {
    forgetRevocation(deps.store, token);
    return 'server';
  }
  const queue = !!userId;
  if (queue) {
    const at = (deps.now?.() ?? new Date()).toISOString();
    const list = readPendingRevocations(deps.store).filter((p) => p.token !== token);
    writePending(deps.store, [...list, { token, userId, registeredAt: registeredAt ?? null, at }]);
  }
  try {
    await deps.unregisterDevice();
  } catch {
    /* the queued revocation still runs */
  }
  return queue ? 'queued' : 'device';
}

/** Sends the waiting revocations; keeps those the server couldn't take yet. */
export async function flushPushRevocations(
  store: Store | null,
  rpc: (p: PendingRevocation) => Promise<{ error: unknown }>,
): Promise<number> {
  const list = readPendingRevocations(store);
  if (!list.length) return 0;
  const left: PendingRevocation[] = [];
  let sent = 0;
  for (const p of list) {
    let error: unknown = null;
    try {
      ({ error } = await rpc(p));
    } catch (e) {
      error = e;
    }
    if (error) left.push(p);
    else sent++;
  }
  // Something may have been queued or saved meanwhile: merge, don't overwrite.
  const current = readPendingRevocations(store);
  const done = new Set(list.filter((p) => !left.includes(p)).map((p) => `${p.token}|${p.at}`));
  writePending(store, current.filter((p) => !done.has(`${p.token}|${p.at}`)));
  return sent;
}
