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
 * push_tokens.updated_at, read back when the token was saved), never a device
 * clock; and the last saved token is remembered here, so a sign-out right
 * after an offline cold start (before the native token arrives) still works.
 */

export const PUSH_REVOKE_KEY = 'bandwith.push-revoke';
export const PUSH_TOKEN_KEY = 'bandwith.push-token';
/** Give up after this long: the token has surely been replaced by then. */
export const PUSH_REVOKE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface PendingRevocation {
  token: string;
  userId: string;
  /** The registration to switch off: push_tokens.updated_at as the server stored it. */
  registeredAt: string;
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
            !!p && typeof p.token === 'string' && typeof p.userId === 'string' && typeof p.registeredAt === 'string' && typeof p.at === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

function writePending(store: Store | null, list: PendingRevocation[]) {
  if (!store) return;
  try {
    if (list.length) store.setItem(PUSH_REVOKE_KEY, JSON.stringify(list));
    else store.removeItem(PUSH_REVOKE_KEY);
  } catch {
    /* storage blocked: the device-side unregister still holds */
  }
}

/** Remember (or, with null, forget) the token this device last saved. */
export function rememberPushToken(store: Store | null, saved: SavedPushToken | null) {
  if (!store) return;
  try {
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

/** A token saved again (someone signed in on this device): nothing to revoke. */
export function forgetRevocation(store: Store | null, token: string) {
  const list = readPendingRevocations(store);
  const kept = list.filter((p) => p.token !== token);
  if (kept.length !== list.length) writePending(store, kept);
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
 * the device and the revocation waits for the network; 'device' when the
 * registration isn't known (no stamp): delivery stopped on the device only.
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
  const queue = !!registeredAt && !!userId;
  if (queue) {
    const at = (deps.now?.() ?? new Date()).toISOString();
    const list = readPendingRevocations(deps.store).filter((p) => p.token !== token);
    writePending(deps.store, [...list, { token, userId, registeredAt: registeredAt as string, at }]);
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
  now: () => number = Date.now,
): Promise<number> {
  const list = readPendingRevocations(store);
  if (!list.length) return 0;
  const left: PendingRevocation[] = [];
  let sent = 0;
  for (const p of list) {
    if (now() - Date.parse(p.at) > PUSH_REVOKE_MAX_AGE_MS) continue;
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
  writePending(store, current.filter((p) => !done.has(`${p.token}|${p.at}`) && now() - Date.parse(p.at) <= PUSH_REVOKE_MAX_AGE_MS));
  return sent;
}
