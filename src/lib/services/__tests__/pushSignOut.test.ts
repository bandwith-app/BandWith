// Codex review #287 round 2: sign-out must stop this device's pushes in every
// case the app can reach (audit 04 #6), driven through the real push service.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  platform: 'ios',
  listeners: {} as Record<string, ((v: unknown) => unknown)[]>,
  registerFires: true,
  checkPermissions: (async () => ({ receive: 'granted' })) as () => Promise<{ receive: string }>,
  unregister: vi.fn(async () => {}),
  rpc: vi.fn(),
  from: vi.fn(),
  /** What happened, in order: native identity calls and server calls. */
  log: [] as string[],
  identityAvailable: false,
  /** The account on the saved session (sessionUserId). */
  sessionUid: null as string | null,
  identity: {
    setUser: vi.fn(async (_o: { uid: string }) => {}),
    clear: vi.fn(async () => {}),
    deleteToken: vi.fn(async () => {}),
  },
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => h.platform,
    isPluginAvailable: (name: string) => name === 'BwPushIdentity' && h.identityAvailable,
  },
  registerPlugin: (name: string) => (name === 'BwPushIdentity' ? h.identity : {}),
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: (name: string, fn: (v: unknown) => unknown) => {
      (h.listeners[name] ??= []).push(fn);
      return Promise.resolve({
        remove: async () => {
          h.listeners[name] = (h.listeners[name] ?? []).filter((f) => f !== fn);
        },
      });
    },
    requestPermissions: async () => ({ receive: 'granted' }),
    checkPermissions: () => h.checkPermissions(),
    register: async () => {
      if (!h.registerFires) return;
      await Promise.all([...(h.listeners.registration ?? [])].map((f) => f({ value: TOKEN })));
    },
    unregister: h.unregister,
  },
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { requestPermissions: async () => ({}), schedule: async () => {}, addListener: () => Promise.resolve({ remove: async () => undefined }) },
}));
vi.mock('../../supabase', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
vi.mock('@/lib/sessionUser', () => ({ sessionUserId: async () => h.sessionUid }));

const TOKEN = 'device-token-0123456789abcdef';
const STAMP = '2026-11-22T09:59:58.123456+00:00';
const offline = () => Promise.reject(new TypeError('Load failed'));

/** A query builder: every step chains, awaiting it gives `result`. */
const builder = (result: () => Promise<unknown>) => {
  const b: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'update', 'upsert', 'maybeSingle']) b[k] = vi.fn(() => b);
  b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => result().then(ok, ko);
  return b;
};

/** Signs `uid` in (the saved session) and subscribes, as AuthContext does. */
const signedIn = (push: { subscribeToPush: (u: string) => Promise<{ success: boolean; error: Error | null }> }, uid: string) => {
  h.sessionUid = uid;
  return push.subscribeToPush(uid);
};

const load = async () => {
  vi.resetModules();
  return import('../pushNotifications');
};
const pending = () => JSON.parse(localStorage.getItem('bandwith.push-revoke') || '[]') as { token: string; userId: string; registeredAt: string | null; confirmed: string | null; attempts: string[] }[];
const remembered = () => JSON.parse(localStorage.getItem('bandwith.push-token') || 'null') as { registeredAt: string | null; confirmed: string | null; attempts: string[] } | null;
const SAVED = { data: { registered_at: STAMP, secret: null }, error: null };
/** The secrets the app sent with its stamped saves, in order (both registration listeners save). */
const sentSecrets = () => h.rpc.mock.calls.filter((c) => c[0] === 'bw_register_push_token_stamped').map((c) => c[1]?.p_secret as string);
const lastSecret = () => sentSecrets().slice(-1)[0];

describe('sign-out stops pushes (Codex review #287 rounds 2-4)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    h.platform = 'ios';
    h.registerFires = true;
    h.checkPermissions = async () => ({ receive: 'granted' });
    h.listeners = {};
    h.unregister.mockClear();
    h.rpc.mockReset();
    h.from.mockReset();
    h.log = [];
    h.identityAvailable = false;
    h.sessionUid = null;
    h.identity.setUser.mockReset().mockImplementation(async () => void h.log.push('setUser'));
    h.identity.clear.mockReset().mockImplementation(async () => void h.log.push('clear'));
    h.identity.deleteToken.mockReset().mockImplementation(async () => void h.log.push('deleteToken'));
  });

  it('no token known yet: delivery still stops on the device', async () => {
    const push = await load();
    h.rpc.mockImplementation(offline);
    h.registerFires = false;
    await push.unregisterPushToken('alice');
    expect(h.unregister).toHaveBeenCalledOnce();
  });

  // Round 4 (B2): the save sends a random secret; an offline sign-out queues
  // it with the stamp, and the flush presents it.
  it('the save sends a secret; an offline sign-out queues it and the flush presents it', async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : offline()));
    h.from.mockImplementation(() => builder(offline));
    expect((await signedIn(push, 'alice')).success).toBe(true);
    const secret = lastSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(h.rpc).toHaveBeenCalledWith('bw_register_push_token_stamped', { p_token: TOKEN, p_platform: 'ios', p_secret: secret, p_uid_gated: false });

    h.rpc.mockImplementation(offline);
    await push.unregisterPushToken('alice');
    expect(pending()).toEqual([expect.objectContaining({ registeredAt: STAMP, confirmed: secret, attempts: [] })]);
    expect(h.unregister).toHaveBeenCalledOnce();

    h.rpc.mockReset();
    h.rpc.mockResolvedValue({ data: true, error: null });
    expect(await push.flushQueuedPushRevocations()).toBe(1);
    expect(h.rpc).toHaveBeenCalledWith('bw_revoke_push_token', { p_token: TOKEN, p_user_id: 'alice', p_registered_at: STAMP, p_secret: secret });
    expect(pending()).toEqual([]);
  });

  it('a server without the stamped save (older database) still works through the old one, without a secret', async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) =>
      fn === 'bw_register_push_token_stamped'
        ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.bw_register_push_token_stamped' } }
        : { data: null, error: null },
    );
    h.from.mockImplementation(() => builder(async () => ({ data: { updated_at: STAMP }, error: null })));
    expect((await signedIn(push, 'alice')).success).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith('bw_register_push_token', { p_token: TOKEN, p_platform: 'ios' });
    expect(remembered()).toMatchObject({ registeredAt: STAMP, confirmed: null, attempts: [] });
  });

  // Codex review #287 round 5 (B3): a 5xx or a timeout is not an older
  // database: the save fails and is tried again, never through 046 or the
  // table, which would leave the token with no secret.
  it('a server error or a timeout never falls back to the older saves', async () => {
    const push = await load();
    for (const error of [{ code: '', message: 'FetchError: upstream timeout' }, { code: '503', message: 'Service Unavailable' }]) {
      h.rpc.mockReset();
      h.from.mockReset();
      h.rpc.mockImplementation(async () => ({ data: null, error }));
      h.from.mockImplementation(() => builder(async () => ({ data: null, error: null })));
      expect((await signedIn(push, 'alice')).success).toBe(false);
      expect(h.rpc.mock.calls.map((c) => c[0]).filter((f) => f !== 'bw_register_push_token_stamped')).toEqual([]);
      expect(h.from).not.toHaveBeenCalled();
    }
    // 046 there but failing for now: no table upsert either.
    h.rpc.mockReset();
    h.from.mockReset();
    h.rpc.mockImplementation(async (fn: string) =>
      fn === 'bw_register_push_token_stamped'
        ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
        : { data: null, error: { code: '', message: 'Load failed' } },
    );
    h.from.mockImplementation(() => builder(async () => ({ data: null, error: null })));
    expect((await signedIn(push, 'alice')).success).toBe(false);
    expect(h.from).not.toHaveBeenCalled();
  });

  it('the fallback update matching no row is not a revocation', async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : { data: null, error: { message: 'JWT expired' } }));
    h.from.mockImplementation(() => builder(async () => ({ data: [], error: null, count: 0 })));
    await signedIn(push, 'alice');
    await push.unregisterPushToken('alice');
    expect(pending().map((p) => p.registeredAt)).toEqual([STAMP]);
    expect(h.unregister).toHaveBeenCalledOnce();
  });

  it('online: the server switches it off, and the device stops too', async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : { data: true, error: null }));
    await signedIn(push, 'alice');
    await push.unregisterPushToken('alice');
    expect(h.rpc).toHaveBeenCalledWith('bw_unregister_push_token', { p_token: TOKEN });
    expect(pending()).toEqual([]);
    expect(h.unregister).toHaveBeenCalledOnce();
  });

  // Codex review #287 round 6 (B2): Bob's save never got through, so the
  // token is still Alice's. The server's "no error" switched nothing off; the
  // device must stop anyway, or Alice's previews keep coming.
  it("the token is still Alice's, Bob signs out: the native unregistration runs anyway", async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) =>
      fn === 'bw_register_push_token_stamped' ? offline() : fn === 'bw_unregister_push_token' ? { data: false, error: null } : offline(),
    );
    h.from.mockImplementation(() => builder(offline));
    await signedIn(push, 'bob');
    await push.unregisterPushToken('bob');
    expect(h.unregister).toHaveBeenCalledOnce();
    expect(h.from).not.toHaveBeenCalled(); // false is an answer: no table fallback
    expect(pending()).toEqual([expect.objectContaining({ token: TOKEN, userId: 'bob' })]);
  });

  it('Android without Firebase: sign-out never calls the native unregister', async () => {
    h.platform = 'android';
    vi.stubEnv('VITE_ANDROID_PUSH', '');
    const push = await load();
    h.rpc.mockImplementation(offline);
    await push.unregisterPushToken('alice');
    expect(h.unregister).not.toHaveBeenCalled();
  });

  // Round 4 (B4): no token or secret remembered (first offline start after
  // an upgrade): the token comes from the plugin, and the revocation stays
  // queued while the server says it is still on for that account.
  it('no token remembered: queued from the plugin token, kept until the owner path takes it', async () => {
    const push = await load();
    h.rpc.mockImplementation(offline);
    await push.unregisterPushToken('alice');
    expect(pending()).toEqual([expect.objectContaining({ token: TOKEN, userId: 'alice', registeredAt: null, confirmed: null, attempts: [] })]);
    expect(h.unregister).toHaveBeenCalledOnce();
    h.rpc.mockReset();
    // Refused signed out, no secret: it stays (main's decisions, rounds 5-6:
    // no lookup by token, never dropped), tried again after a backoff.
    h.rpc.mockImplementation(async () => ({ data: false, error: null }));
    expect(await push.flushQueuedPushRevocations()).toBe(0);
    expect(pending()).toEqual([expect.objectContaining({ tries: 1 })]);
    // Alice signs in again on the device, past the backoff: the owner path switches it off.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 60 * 60_000);
      h.rpc.mockImplementation(async () => ({ data: true, error: null }));
      expect(await push.flushQueuedPushRevocations()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
    expect(pending()).toEqual([]);
    expect(h.rpc.mock.calls.map((c) => c[0])).not.toContain('bw_push_token_registered');
  });

  // Round 4 (B4): the save's reply was lost. The secret it sent may be the
  // one the server holds now: it goes into the revocation too.
  it("a save whose reply was lost: its secret is still tried", async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : offline()));
    h.from.mockImplementation(() => builder(offline));
    await signedIn(push, 'alice');
    const first = lastSecret();
    h.rpc.mockImplementation(offline); // the next save goes out, its reply never comes back
    await signedIn(push, 'alice');
    const second = lastSecret();
    expect(second && second !== first).toBe(true);
    // Round 8 (B3): the confirmed stamp stays until the new save is confirmed.
    expect(remembered()).toMatchObject({ registeredAt: STAMP, confirmed: first, attempts: [second] });
    await push.unregisterPushToken('alice');
    expect(pending()).toEqual([expect.objectContaining({ registeredAt: STAMP, confirmed: first, attempts: [second] })]);
  });

  // Round 4 (B3): Bob signing in and out offline on the same device must not
  // wipe Alice's waiting revocation; only a save the server confirmed does.
  it("Bob's sign-in and offline sign-out keep Alice's revocation until the server confirms Bob's save", async () => {
    const push = await load();
    h.rpc.mockImplementation(offline);
    h.from.mockImplementation(() => builder(offline));
    await push.unregisterPushToken('alice');
    expect(pending().map((p) => p.userId)).toEqual(['alice']);
    await signedIn(push, 'bob'); // offline: not saved
    await push.unregisterPushToken('bob');
    expect(pending().map((p) => p.userId).sort()).toEqual(['alice', 'bob']);
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : { data: false, error: null }));
    await signedIn(push, 'bob'); // online: the token is Bob's now
    expect(pending()).toEqual([]);
  });

  // Rounds 3-4: both registration listeners save the token; the saves run
  // one after the other, so the last answer is the newest registration.
  it('two saves of the same token run one after the other; the last answer wins', async () => {
    const NEWER = '2026-11-22T10:00:00.5+00:00';
    const push = await load();
    let n = 0;
    let inFlight = 0;
    let overlap = false;
    h.rpc.mockImplementation(async (fn: string) => {
      if (fn !== 'bw_register_push_token_stamped') return { data: null, error: null };
      n += 1;
      inFlight += 1;
      if (inFlight > 1) overlap = true;
      const mine = n;
      await new Promise((r) => setTimeout(r, mine === 1 ? 20 : 1));
      inFlight -= 1;
      return { data: { registered_at: mine === 1 ? STAMP : NEWER, secret: null }, error: null };
    });
    await signedIn(push, 'alice');
    await new Promise((r) => setTimeout(r, 60));
    expect(n).toBe(2);
    expect(overlap).toBe(false);
    expect(remembered()).toMatchObject({ registeredAt: NEWER, confirmed: lastSecret(), attempts: [] });
  });

  // Claude review #287 round 4: tokenFromPlugin's register() also answers
  // the registration handler of a subscribe still waiting for the old
  // account; that late save must not switch the token back on.
  it('a registration answering after sign-out does not save the token for the old account', async () => {
    const push = await load();
    h.rpc.mockImplementation(offline);
    h.registerFires = false; // subscribe waits for the native token
    const sub = signedIn(push, 'alice');
    await new Promise((r) => setTimeout(r, 5));
    h.registerFires = true; // sign-out asks the plugin, which answers both listeners
    await push.unregisterPushToken('alice');
    h.rpc.mockImplementation(async () => SAVED);
    await new Promise((r) => setTimeout(r, 10));
    expect(h.rpc.mock.calls.filter((c) => c[0] === 'bw_register_push_token_stamped')).toHaveLength(0);
    expect((await sub).success).toBe(false);
  });

  // Claude review #287 round 5: a save whose request never answers holds the
  // push lock; sign-out waits 5 s at most, then queues the revocation (with
  // that save's secret) and stops the device. The late answer forgets nothing.
  it('a sign-out stuck behind a save that never answers goes ahead after 5 s', async () => {
    vi.useFakeTimers();
    try {
      const push = await load();
      let answer: (v: unknown) => void = () => {};
      h.rpc.mockImplementation((fn: string) =>
        fn === 'bw_register_push_token_stamped' ? new Promise((r) => (answer = r)) : offline(),
      );
      h.from.mockImplementation(() => builder(offline));
      void signedIn(push, 'alice');
      await vi.advanceTimersByTimeAsync(0);
      const secret = lastSecret();
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      let done = false;
      const out = push.unregisterPushToken('alice').then(() => (done = true));
      await vi.advanceTimersByTimeAsync(4900);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      await out;
      expect(done).toBe(true);
      expect(pending()).toEqual([expect.objectContaining({ token: TOKEN, userId: 'alice', attempts: [secret] })]);
      expect(h.unregister).toHaveBeenCalledOnce();
      // The hung save lands after all: the revocation that holds its secret stays.
      answer(SAVED);
      await vi.advanceTimersByTimeAsync(10);
      expect(pending()).toHaveLength(1);
      expect(remembered()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // Codex review #287 round 5 (B1): on Android the device itself decides,
  // without the network: the account is kept natively, cleared first at
  // sign-out, and the token is marked only when the native side holds it.
  it('Android: the account is kept natively, the token marked, and cleared before anything at sign-out', async () => {
    h.platform = 'android';
    vi.stubEnv('VITE_ANDROID_PUSH', 'true');
    h.identityAvailable = true;
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) => {
      h.log.push(fn);
      return fn === 'bw_register_push_token_stamped' ? SAVED : offline();
    });
    h.from.mockImplementation(() => builder(offline));
    expect((await signedIn(push, 'alice')).success).toBe(true);
    expect(h.identity.setUser).toHaveBeenCalledWith({ uid: 'alice' });
    const saves = h.rpc.mock.calls.filter((c) => c[0] === 'bw_register_push_token_stamped');
    expect(saves.every((c) => c[1].p_uid_gated === true && c[1].p_platform === 'android')).toBe(true);
    expect(h.log.indexOf('setUser')).toBeLessThan(h.log.indexOf('bw_register_push_token_stamped'));

    h.log = [];
    await push.unregisterPushToken('alice');
    expect(h.log[0]).toBe('clear');
    expect(h.log).toContain('bw_unregister_push_token');
    // Offline: the FCM token deletion is awaited natively, not the plugin's fire-and-forget.
    expect(h.identity.deleteToken).toHaveBeenCalledOnce();
    expect(h.unregister).not.toHaveBeenCalled();
  });

  it('Android: a token is marked only when the native side holds the account', async () => {
    h.platform = 'android';
    vi.stubEnv('VITE_ANDROID_PUSH', 'true');
    h.identityAvailable = true;
    h.identity.setUser.mockRejectedValue(new Error('native failed'));
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : offline()));
    h.from.mockImplementation(() => builder(offline));
    await signedIn(push, 'alice');
    expect(h.rpc.mock.calls.filter((c) => c[0] === 'bw_register_push_token_stamped').every((c) => c[1].p_uid_gated === false)).toBe(true);
    // An older APK (no native plugin): never marked, the plugin's unregister.
    h.identityAvailable = false;
    h.rpc.mockReset();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : offline()));
    await signedIn(push, 'bob');
    expect(h.rpc.mock.calls.filter((c) => c[0] === 'bw_register_push_token_stamped').every((c) => c[1].p_uid_gated === false)).toBe(true);
    await push.unregisterPushToken('bob');
    expect(h.identity.deleteToken).not.toHaveBeenCalled();
    expect(h.unregister).toHaveBeenCalledOnce();
  });

  // Codex review #287 round 6 (B3): FCM's deletion never finishes. Sign-out
  // still completes within the 5 s; the deletion goes on in the background.
  it('a deleteToken that never resolves still lets the session close within about 5 s', async () => {
    vi.useFakeTimers();
    try {
      h.platform = 'android';
      vi.stubEnv('VITE_ANDROID_PUSH', 'true');
      h.identityAvailable = true;
      h.identity.deleteToken.mockImplementation(() => new Promise(() => {}));
      const push = await load();
      h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : { data: true, error: null }));
      h.from.mockImplementation(() => builder(offline));
      await signedIn(push, 'alice');
      let done = false;
      const out = push.unregisterPushToken('alice').then(() => (done = true));
      await vi.advanceTimersByTimeAsync(5100); // the 5 s ceiling (the deletion itself is waited 2.5 s)
      await out;
      expect(done).toBe(true);
      expect(h.identity.deleteToken).toHaveBeenCalled();
      // The server took it: nothing queued although the device's part is still running.
      expect(pending()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  // Codex review #287 round 6 (B1): a refused refresh (or a deleted account)
  // ends the session without the sign-out button: the native account goes
  // too, so a push still tagged for it is dropped on the phone
  // (PushIdentity.decide(target, null) == DROP, PushIdentityTest).
  it('a session that ends without sign-out (refused refresh) empties the native account', async () => {
    h.platform = 'android';
    vi.stubEnv('VITE_ANDROID_PUSH', 'true');
    h.identityAvailable = true;
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : offline()));
    h.from.mockImplementation(() => builder(offline));
    await signedIn(push, 'alice');
    expect(h.identity.setUser).toHaveBeenCalledWith({ uid: 'alice' });
    h.log = [];
    await push.forgetPushAccount();
    expect(h.log[0]).toBe('clear');
    // A registration answering afterwards saves nothing for the old account.
    h.rpc.mockClear();
    await Promise.all([...(h.listeners.registration ?? [])].map((f) => f({ value: 'device-token-rotated-0123456789' })));
    expect(h.rpc.mock.calls.filter((c) => c[0] === 'bw_register_push_token_stamped')).toHaveLength(0);
  });

  // Claude review #287 round 5 (M1): the device's own deletion is waited for
  // 2.5 s at most; the server already took the revocation.
  it('the native token deletion is waited for 2.5 s at most', async () => {
    vi.useFakeTimers();
    try {
      h.platform = 'android';
      vi.stubEnv('VITE_ANDROID_PUSH', 'true');
      h.identityAvailable = true;
      h.identity.deleteToken.mockImplementation(() => new Promise(() => {}));
      const push = await load();
      h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : { data: true, error: null }));
      h.from.mockImplementation(() => builder(offline));
      await signedIn(push, 'alice');
      let done = false;
      const out = push.unregisterPushToken('alice').then(() => (done = true));
      await vi.advanceTimersByTimeAsync(2400);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      await out;
      expect(done).toBe(true);
      expect(h.unregister).not.toHaveBeenCalled(); // late is not failed: no second unregister
    } finally {
      vi.useRealTimers();
    }
  });

  // Claude review #287 round 5 (M3): signOut() failed, so the person is
  // still signed in. Subscribing again (AuthContext) gives the device its
  // native account and registration back.
  it('a failed sign-out: subscribing again restores the native account and the registration', async () => {
    h.platform = 'android';
    vi.stubEnv('VITE_ANDROID_PUSH', 'true');
    h.identityAvailable = true;
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : { data: true, error: null }));
    h.from.mockImplementation(() => builder(offline));
    await signedIn(push, 'alice');
    await push.unregisterPushToken('alice');
    expect(h.identity.clear).toHaveBeenCalled();
    h.identity.setUser.mockClear();
    h.rpc.mockClear();
    expect((await signedIn(push, 'alice')).success).toBe(true);
    expect(h.identity.setUser).toHaveBeenCalledWith({ uid: 'alice' });
    expect(h.rpc.mock.calls.filter((c) => c[0] === 'bw_register_push_token_stamped').some((c) => c[1].p_uid_gated === true)).toBe(true);
    expect(pending()).toEqual([]);
  });

  // Codex review #287 round 7 (B4): a refused refresh ends the session
  // without the sign-out button, on every platform: delivery stops natively
  // and the revocation is queued with the remembered secret, then sent.
  it('a session that ends without sign-out stops the device and queues the revocation (iOS)', async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : offline()));
    h.from.mockImplementation(() => builder(offline));
    await signedIn(push, 'alice');
    const secret = lastSecret();
    h.rpc.mockReset();
    h.rpc.mockImplementation(offline);
    await push.forgetPushAccount();
    expect(h.unregister).toHaveBeenCalledOnce();
    // No signed-in call: the session is gone.
    expect(h.rpc.mock.calls.map((c) => c[0])).not.toContain('bw_unregister_push_token');
    expect(pending()).toEqual([expect.objectContaining({ token: TOKEN, userId: 'alice', registeredAt: STAMP, confirmed: secret })]);
    expect(h.rpc).toHaveBeenCalledWith('bw_revoke_push_token', { p_token: TOKEN, p_user_id: 'alice', p_registered_at: STAMP, p_secret: secret });
    expect(remembered()).toBeNull();
  });

  it('an app start with no session revokes the registration left from before', async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : offline()));
    h.from.mockImplementation(() => builder(offline));
    await signedIn(push, 'alice');
    const secret = lastSecret();
    // The app is killed; the refresh token expires meanwhile; a cold start.
    const fresh = await load();
    h.unregister.mockClear();
    h.rpc.mockReset();
    h.rpc.mockResolvedValue({ data: true, error: null });
    await fresh.forgetPushAccount();
    expect(h.unregister).toHaveBeenCalledOnce();
    expect(h.rpc).toHaveBeenCalledWith('bw_revoke_push_token', { p_token: TOKEN, p_user_id: 'alice', p_registered_at: STAMP, p_secret: secret });
    expect(pending()).toEqual([]);
    // Nothing left from before: a later start without a session does nothing native.
    h.unregister.mockClear();
    await (await load()).forgetPushAccount();
    expect(h.unregister).not.toHaveBeenCalled();
  });

  // Codex review #287 round 7 (B3): Alice's sign-out times out at 5 s while
  // its server call hangs; Bob signs in. When Alice's call finally answers,
  // her late job must not stop the device again (that would take Bob's
  // registration).
  it("a late answer of Alice's sign-out does not unregister Bob", async () => {
    vi.useFakeTimers();
    try {
      const push = await load();
      let answer: (v: unknown) => void = () => {};
      h.rpc.mockImplementation((fn: string) =>
        fn === 'bw_register_push_token_stamped' ? Promise.resolve(SAVED) : fn === 'bw_unregister_push_token' ? new Promise((r) => (answer = r)) : offline(),
      );
      h.from.mockImplementation(() => builder(offline));
      await signedIn(push, 'alice');
      const out = push.unregisterPushToken('alice');
      await vi.advanceTimersByTimeAsync(5100);
      await out;
      expect(h.unregister).toHaveBeenCalledOnce(); // the deadline's own device stop
      expect(pending()).toEqual([expect.objectContaining({ userId: 'alice' })]);
      // Bob signs in on the device.
      const bob = signedIn(push, 'bob');
      await vi.advanceTimersByTimeAsync(10);
      answer({ data: false, error: null });
      await vi.advanceTimersByTimeAsync(10);
      expect((await bob).success).toBe(true);
      expect(h.unregister).toHaveBeenCalledOnce();
      expect(h.rpc.mock.calls.filter((c) => c[0] === 'bw_register_push_token_stamped').some((c) => c[1].p_token === TOKEN)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('one device stop at a time: the deadline does not start a second one', async () => {
    vi.useFakeTimers();
    try {
      h.platform = 'android';
      vi.stubEnv('VITE_ANDROID_PUSH', 'true');
      h.identityAvailable = true;
      const push = await load();
      h.rpc.mockImplementation(async (fn: string) =>
        fn === 'bw_register_push_token_stamped' ? SAVED : fn === 'bw_unregister_push_token' ? new Promise((r) => setTimeout(() => r({ data: false, error: null }), 4000)) : offline(),
      );
      h.from.mockImplementation(() => builder(offline));
      await signedIn(push, 'alice');
      // The server answers at 4 s (not this account's), FCM's deletion then
      // hangs past the deadline, where the late path stops the device too.
      h.identity.deleteToken.mockImplementation(() => new Promise(() => {}));
      const out = push.unregisterPushToken('alice');
      await vi.advanceTimersByTimeAsync(5100);
      await out;
      expect(h.identity.deleteToken).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  // Claude review #287 round 7 (M1): the whole sign-out path is capped,
  // the permission check of the token lookup included.
  it('a permission check that never answers still lets sign-out finish within 5 s', async () => {
    vi.useFakeTimers();
    try {
      h.checkPermissions = () => new Promise(() => {});
      const push = await load();
      h.rpc.mockImplementation(offline);
      let done = false;
      const out = push.unregisterPushToken('alice').then(() => (done = true));
      await vi.advanceTimersByTimeAsync(4900);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      await out;
      expect(done).toBe(true);
      expect(h.unregister).toHaveBeenCalledOnce(); // no token known: the device still stops
    } finally {
      vi.useRealTimers();
    }
  });

  // Codex review #287 round 8 (B1): the app is killed while the sign-out
  // waits for the push lock. The revocation must already be on disk, and the
  // saved registration still there, so the next start revokes it.
  it('killed during the lock wait: the revocation is already queued and the next start sends it', async () => {
    vi.useFakeTimers();
    try {
      const push = await load();
      h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : offline()));
      h.from.mockImplementation(() => builder(offline));
      await signedIn(push, 'alice');
      const secret = lastSecret();
      // A save that never answers holds the lock.
      h.rpc.mockImplementation((fn: string) => (fn === 'bw_register_push_token_stamped' ? new Promise(() => {}) : offline()));
      void signedIn(push, 'alice');
      await vi.advanceTimersByTimeAsync(0);
      void push.unregisterPushToken('alice');
      await vi.advanceTimersByTimeAsync(10);
      // The app dies here.
      expect(pending()).toEqual([expect.objectContaining({ token: TOKEN, userId: 'alice', registeredAt: STAMP, confirmed: secret })]);
      expect(remembered()).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
    const next = await load();
    h.unregister.mockClear();
    h.rpc.mockReset();
    h.rpc.mockResolvedValue({ data: true, error: null });
    await next.forgetPushAccount();
    expect(h.unregister).toHaveBeenCalledOnce();
    expect(h.rpc).toHaveBeenCalledWith('bw_revoke_push_token', expect.objectContaining({ p_token: TOKEN, p_user_id: 'alice', p_registered_at: STAMP }));
    expect(pending()).toEqual([]);
  });

  it('a start with no saved registration but a queued revocation stops the device and sends it', async () => {
    localStorage.setItem(
      'bandwith.push-revoke',
      JSON.stringify([{ token: TOKEN, userId: 'alice', registeredAt: STAMP, confirmed: 'a'.repeat(64), attempts: [], at: '2026-11-22T10:00:00.000Z' }]),
    );
    const push = await load();
    h.rpc.mockResolvedValue({ data: true, error: null });
    await push.forgetPushAccount();
    expect(h.unregister).toHaveBeenCalledOnce();
    expect(h.rpc).toHaveBeenCalledWith('bw_revoke_push_token', { p_token: TOKEN, p_user_id: 'alice', p_registered_at: STAMP, p_secret: 'a'.repeat(64) });
    expect(pending()).toEqual([]);
  });

  // Codex review #287 round 8 (B2): FCM is still deleting Alice's token when
  // Bob signs in. Bob must not register before the deletion ends (he would
  // get the old token, dead once it lands); after 15 s it is put off, and
  // done once the deletion finishes.
  it('Android: a new registration waits for the token deletion still running', async () => {
    vi.useFakeTimers();
    try {
      h.platform = 'android';
      vi.stubEnv('VITE_ANDROID_PUSH', 'true');
      h.identityAvailable = true;
      const push = await load();
      h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : { data: true, error: null }));
      h.from.mockImplementation(() => builder(offline));
      await signedIn(push, 'alice');
      let deleted: () => void = () => {};
      h.identity.deleteToken.mockImplementation(() => new Promise<void>((r) => (deleted = () => (h.log.push('deleted'), r()))));
      const out = push.unregisterPushToken('alice');
      await vi.advanceTimersByTimeAsync(2600);
      await out;
      h.log = [];
      h.rpc.mockClear();
      h.rpc.mockImplementation(async (fn: string) => {
        h.log.push(fn);
        return fn === 'bw_register_push_token_stamped' ? SAVED : { data: true, error: null };
      });
      const bob = signedIn(push, 'bob');
      await vi.advanceTimersByTimeAsync(3000);
      expect(h.log).not.toContain('bw_register_push_token_stamped');
      deleted();
      await vi.advanceTimersByTimeAsync(10);
      expect((await bob).success).toBe(true);
      expect(h.log.indexOf('deleted')).toBeLessThan(h.log.indexOf('bw_register_push_token_stamped'));

      // Past 15 s: put off, then registered once the deletion ends.
      h.identity.deleteToken.mockImplementation(() => new Promise<void>((r) => (deleted = r)));
      await (async () => {
        const o = push.unregisterPushToken('bob');
        await vi.advanceTimersByTimeAsync(2600);
        await o;
      })();
      h.rpc.mockClear();
      const carol = signedIn(push, 'carol');
      await vi.advanceTimersByTimeAsync(15_100);
      expect(await carol).toEqual({ success: false, error: expect.any(Error) });
      expect(h.rpc.mock.calls.filter((c) => c[0] === 'bw_register_push_token_stamped')).toHaveLength(0);
      deleted();
      await vi.advanceTimersByTimeAsync(50);
      expect(h.rpc.mock.calls.filter((c) => c[0] === 'bw_register_push_token_stamped').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // Claude review #287 round 7 (C3): iOS keeps the token. Alice signs out
  // offline, signs in again (the save fails), then the network is back: her
  // old revocation must not switch off the registration she is using. Her
  // next sign-out still has its secret.
  it("the same account back on the device: its own old revocation doesn't switch it off", async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : offline()));
    h.from.mockImplementation(() => builder(offline));
    await signedIn(push, 'alice');
    const first = lastSecret();
    await push.unregisterPushToken('alice');
    expect(pending().map((p) => p.userId)).toEqual(['alice']);
    h.rpc.mockImplementation(async () => ({ data: null, error: { code: '503', message: 'Service Unavailable' } }));
    expect((await signedIn(push, 'alice')).success).toBe(false);
    h.rpc.mockReset();
    h.rpc.mockResolvedValue({ data: true, error: null });
    expect(await push.flushQueuedPushRevocations({ online: true })).toBe(0);
    expect(h.rpc.mock.calls.map((c) => c[0])).not.toContain('bw_revoke_push_token');
    h.rpc.mockImplementation(offline);
    await push.unregisterPushToken('alice');
    expect(pending()).toEqual([expect.objectContaining({ userId: 'alice', registeredAt: STAMP, confirmed: first })]);
  });

  // Codex review #287 round 8 (M2): after an account deletion the token row
  // is gone: no server call, and nothing of that account stays on the device.
  it('a deleted account: the device stops, no server call, no push state left', async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : offline()));
    h.from.mockImplementation(() => builder(offline));
    await signedIn(push, 'alice');
    await push.unregisterPushToken('alice'); // an earlier offline sign-out left one queued
    await signedIn(push, 'alice');
    h.rpc.mockClear();
    await push.unregisterPushToken('alice', { accountGone: true });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalledWith('push_tokens');
    expect(h.unregister).toHaveBeenCalledTimes(2);
    expect(pending()).toEqual([]);
    expect(remembered()).toBeNull();
  });

  // Codex review #287 round 8 (B3): the deletion still running lives only in
  // memory; a reload loses it. A marker on disk makes the next start delete
  // again (idempotent) and wait for it before registering, then clear it.
  it('Android: a deletion a reload interrupted runs again before the next registration', async () => {
    vi.useFakeTimers();
    try {
      h.platform = 'android';
      vi.stubEnv('VITE_ANDROID_PUSH', 'true');
      h.identityAvailable = true;
      const push = await load();
      h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : { data: true, error: null }));
      h.from.mockImplementation(() => builder(offline));
      await signedIn(push, 'alice');
      h.identity.deleteToken.mockImplementation(() => new Promise<void>(() => {})); // the app reloads before it ends
      const out = push.unregisterPushToken('alice');
      await vi.advanceTimersByTimeAsync(2600);
      await out;
      expect(localStorage.getItem('bandwith.push-delete-pending')).toBe('1');
      // The reload: a fresh module knows nothing in memory.
      const fresh = await load();
      h.log = [];
      h.identity.deleteToken.mockReset().mockImplementation(
        () => new Promise<void>((r) => setTimeout(() => (h.log.push('deleted'), r()), 1000)),
      );
      h.rpc.mockImplementation(async (fn: string) => {
        h.log.push(fn);
        return fn === 'bw_register_push_token_stamped' ? SAVED : { data: true, error: null };
      });
      const bob = signedIn(fresh, 'bob');
      await vi.advanceTimersByTimeAsync(1100);
      expect((await bob).success).toBe(true);
      expect(h.identity.deleteToken).toHaveBeenCalledOnce();
      expect(h.log.indexOf('deleted')).toBeGreaterThanOrEqual(0);
      expect(h.log.indexOf('deleted')).toBeLessThan(h.log.indexOf('bw_register_push_token_stamped'));
      expect(localStorage.getItem('bandwith.push-delete-pending')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // Codex review #287 round 8 (B4): Bob's subscription waits for the
  // deletion; Bob signs out meanwhile. When the deletion ends, nothing may
  // write Bob back into the native account or save his token.
  it('Android: a subscription waiting on the deletion does nothing once its user signed out', async () => {
    vi.useFakeTimers();
    try {
      h.platform = 'android';
      vi.stubEnv('VITE_ANDROID_PUSH', 'true');
      h.identityAvailable = true;
      const push = await load();
      h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : { data: true, error: null }));
      h.from.mockImplementation(() => builder(offline));
      await signedIn(push, 'alice');
      let deleted: () => void = () => {};
      h.identity.deleteToken.mockImplementation(() => new Promise<void>((r) => (deleted = r)));
      const out = push.unregisterPushToken('alice');
      await vi.advanceTimersByTimeAsync(2600);
      await out;
      h.identity.setUser.mockClear();
      h.rpc.mockClear();
      const bob = signedIn(push, 'bob');
      await vi.advanceTimersByTimeAsync(1000);
      // Bob's session ends (another tab, a refused refresh) before the deletion lands.
      h.sessionUid = null;
      deleted();
      await vi.advanceTimersByTimeAsync(50);
      expect((await bob).success).toBe(false);
      expect(h.identity.setUser).not.toHaveBeenCalled();
      expect(h.rpc.mock.calls.filter((c) => c[0] === 'bw_register_push_token_stamped')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // Claude review #287 round 8: during Bob's wait for the deletion, a late
  // register() answer still carries Alice's old FCM token. It must not be
  // saved for Bob (nor kept as the cached token); after the deletion, Bob
  // registers with the fresh token.
  it('Android: a late answer with the old token during the wait is not saved for the new account', async () => {
    vi.useFakeTimers();
    try {
      h.platform = 'android';
      vi.stubEnv('VITE_ANDROID_PUSH', 'true');
      h.identityAvailable = true;
      const push = await load();
      h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : { data: true, error: null }));
      h.from.mockImplementation(() => builder(offline));
      await signedIn(push, 'alice');
      let deleted: () => void = () => {};
      h.identity.deleteToken.mockImplementation(() => new Promise<void>((r) => (deleted = r)));
      const out = push.unregisterPushToken('alice');
      await vi.advanceTimersByTimeAsync(2600);
      await out;
      h.rpc.mockClear();
      const bob = signedIn(push, 'bob');
      await vi.advanceTimersByTimeAsync(500);
      const OLD = 'old-fcm-token-0123456789abcdef';
      await Promise.all([...(h.listeners.registration ?? [])].map((f) => f({ value: OLD })));
      await vi.advanceTimersByTimeAsync(10);
      const saved = () => h.rpc.mock.calls.filter((c) => c[0] === 'bw_register_push_token_stamped').map((c) => c[1].p_token);
      expect(saved()).toEqual([]);
      deleted();
      await vi.advanceTimersByTimeAsync(50);
      expect((await bob).success).toBe(true);
      expect(saved()).not.toContain(OLD);
      expect(saved()).toContain(TOKEN);
    } finally {
      vi.useRealTimers();
    }
  });
});
