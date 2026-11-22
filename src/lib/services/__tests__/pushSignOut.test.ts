// Codex review #287 round 2: sign-out must stop this device's pushes in every
// case the app can reach (audit 04 #6), driven through the real push service.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  platform: 'ios',
  listeners: {} as Record<string, ((v: unknown) => unknown)[]>,
  registerFires: true,
  unregister: vi.fn(async () => {}),
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => h.platform },
  registerPlugin: () => ({}),
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
    checkPermissions: async () => ({ receive: 'granted' }),
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

const load = async () => {
  vi.resetModules();
  return import('../pushNotifications');
};
const pending = () => JSON.parse(localStorage.getItem('bandwith.push-revoke') || '[]') as { token: string; userId: string; registeredAt: string | null; secrets: string[] }[];
const remembered = () => JSON.parse(localStorage.getItem('bandwith.push-token') || 'null') as { registeredAt: string | null; secrets: string[] } | null;
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
    h.listeners = {};
    h.unregister.mockClear();
    h.rpc.mockReset();
    h.from.mockReset();
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
    expect((await push.subscribeToPush('alice')).success).toBe(true);
    const secret = lastSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(h.rpc).toHaveBeenCalledWith('bw_register_push_token_stamped', { p_token: TOKEN, p_platform: 'ios', p_secret: secret });

    h.rpc.mockImplementation(offline);
    await push.unregisterPushToken('alice');
    expect(pending()).toEqual([expect.objectContaining({ registeredAt: STAMP, secrets: [secret] })]);
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
    expect((await push.subscribeToPush('alice')).success).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith('bw_register_push_token', { p_token: TOKEN, p_platform: 'ios' });
    expect(remembered()).toMatchObject({ registeredAt: STAMP, secrets: [] });
  });

  it('the fallback update matching no row is not a revocation', async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : { data: null, error: { message: 'JWT expired' } }));
    h.from.mockImplementation(() => builder(async () => ({ data: [], error: null, count: 0 })));
    await push.subscribeToPush('alice');
    await push.unregisterPushToken('alice');
    expect(pending().map((p) => p.registeredAt)).toEqual([STAMP]);
    expect(h.unregister).toHaveBeenCalledOnce();
  });

  it('online: the server switches it off, the device registration is left alone', async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : { data: null, error: null }));
    await push.subscribeToPush('alice');
    await push.unregisterPushToken('alice');
    expect(h.rpc).toHaveBeenCalledWith('bw_unregister_push_token', { p_token: TOKEN });
    expect(pending()).toEqual([]);
    expect(h.unregister).not.toHaveBeenCalled();
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
  it('no token remembered: queued from the plugin token, and kept while the token is still on', async () => {
    const push = await load();
    h.rpc.mockImplementation(offline);
    await push.unregisterPushToken('alice');
    expect(pending()).toEqual([expect.objectContaining({ token: TOKEN, userId: 'alice', registeredAt: null, secrets: [] })]);
    expect(h.unregister).toHaveBeenCalledOnce();
    h.rpc.mockReset();
    h.rpc.mockImplementation(async (fn: string) => ({ data: fn === 'bw_push_token_registered', error: null }));
    expect(await push.flushQueuedPushRevocations()).toBe(0);
    expect(h.rpc).toHaveBeenCalledWith('bw_push_token_registered', { p_token: TOKEN, p_user_id: 'alice' });
    expect(pending()).toHaveLength(1);
    h.rpc.mockImplementation(async () => ({ data: false, error: null }));
    await push.flushQueuedPushRevocations();
    expect(pending()).toEqual([]);
  });

  // Round 4 (B4): the save's reply was lost. The secret it sent may be the
  // one the server holds now: it goes into the revocation too.
  it("a save whose reply was lost: its secret is still tried", async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : offline()));
    h.from.mockImplementation(() => builder(offline));
    await push.subscribeToPush('alice');
    const first = lastSecret();
    h.rpc.mockImplementation(offline); // the next save goes out, its reply never comes back
    await push.subscribeToPush('alice');
    const second = lastSecret();
    expect(second && second !== first).toBe(true);
    expect(remembered()).toMatchObject({ registeredAt: null, secrets: [second, first] });
    await push.unregisterPushToken('alice');
    expect(pending()).toEqual([expect.objectContaining({ registeredAt: null, secrets: [second, first] })]);
  });

  // Round 4 (B3): Bob signing in and out offline on the same device must not
  // wipe Alice's waiting revocation; only a save the server confirmed does.
  it("Bob's sign-in and offline sign-out keep Alice's revocation until the server confirms Bob's save", async () => {
    const push = await load();
    h.rpc.mockImplementation(offline);
    h.from.mockImplementation(() => builder(offline));
    await push.unregisterPushToken('alice');
    expect(pending().map((p) => p.userId)).toEqual(['alice']);
    await push.subscribeToPush('bob'); // offline: not saved
    await push.unregisterPushToken('bob');
    expect(pending().map((p) => p.userId).sort()).toEqual(['alice', 'bob']);
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? SAVED : { data: false, error: null }));
    await push.subscribeToPush('bob'); // online: the token is Bob's now
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
    await push.subscribeToPush('alice');
    await new Promise((r) => setTimeout(r, 60));
    expect(n).toBe(2);
    expect(overlap).toBe(false);
    expect(remembered()).toMatchObject({ registeredAt: NEWER, secrets: [lastSecret()] });
  });

  // Claude review #287 round 4: tokenFromPlugin's register() also answers
  // the registration handler of a subscribe still waiting for the old
  // account; that late save must not switch the token back on.
  it('a registration answering after sign-out does not save the token for the old account', async () => {
    const push = await load();
    h.rpc.mockImplementation(offline);
    h.registerFires = false; // subscribe waits for the native token
    const sub = push.subscribeToPush('alice');
    await new Promise((r) => setTimeout(r, 5));
    h.registerFires = true; // sign-out asks the plugin, which answers both listeners
    await push.unregisterPushToken('alice');
    h.rpc.mockImplementation(async () => SAVED);
    await new Promise((r) => setTimeout(r, 10));
    expect(h.rpc.mock.calls.filter((c) => c[0] === 'bw_register_push_token_stamped')).toHaveLength(0);
    expect((await sub).success).toBe(false);
  });
});
