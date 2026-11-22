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
const pending = () => JSON.parse(localStorage.getItem('bandwith.push-revoke') || '[]') as { token: string; userId: string; registeredAt: string | null }[];

describe('sign-out stops pushes (Codex review #287 round 2)', () => {
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

  // B2: an existing registration from an older build, signed out on a cold
  // start before the native token callback: no token is known at all.
  it('no token known yet: delivery still stops on the device', async () => {
    const push = await load();
    h.rpc.mockImplementation(offline);
    await push.unregisterPushToken('alice');
    expect(h.unregister).toHaveBeenCalledOnce();
  });

  // B3: the save worked, then the network dropped before a separate read of
  // the row's stamp. The stamp now comes back with the save itself.
  it('the registration stamp comes back with the save, so an offline sign-out can queue it', async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) =>
      fn === 'bw_register_push_token_stamped' ? { data: STAMP, error: null } : fn === 'bw_register_push_token' ? { data: null, error: null } : offline(),
    );
    h.from.mockImplementation(() => builder(offline)); // the read-back never arrives
    expect((await push.subscribeToPush('alice')).success).toBe(true);

    h.rpc.mockImplementation(offline);
    await push.unregisterPushToken('alice');
    expect(pending().map((p) => p.registeredAt)).toEqual([STAMP]);
    expect(h.unregister).toHaveBeenCalledOnce();
  });

  it('a server without the stamped save (older database) still works through the old one', async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) =>
      fn === 'bw_register_push_token_stamped'
        ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.bw_register_push_token_stamped' } }
        : { data: null, error: null },
    );
    h.from.mockImplementation(() => builder(async () => ({ data: { updated_at: STAMP }, error: null })));
    expect((await push.subscribeToPush('alice')).success).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith('bw_register_push_token', { p_token: TOKEN, p_platform: 'ios' });
    expect(JSON.parse(localStorage.getItem('bandwith.push-token') || 'null')?.registeredAt).toBe(STAMP);
  });

  // Claude review: the fallback update answering "no error" for 0 rows did
  // not switch anything off.
  it('the fallback update matching no row is not a revocation', async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) =>
      fn === 'bw_register_push_token_stamped' ? { data: STAMP, error: null } : { data: null, error: { message: 'JWT expired' } },
    );
    h.from.mockImplementation(() => builder(async () => ({ data: [], error: null, count: 0 })));
    await push.subscribeToPush('alice');
    await push.unregisterPushToken('alice');
    expect(pending().map((p) => p.registeredAt)).toEqual([STAMP]);
    expect(h.unregister).toHaveBeenCalledOnce();
  });

  it('online: the server switches it off, the device registration is left alone', async () => {
    const push = await load();
    h.rpc.mockImplementation(async (fn: string) => (fn === 'bw_register_push_token_stamped' ? { data: STAMP, error: null } : { data: null, error: null }));
    await push.subscribeToPush('alice');
    await push.unregisterPushToken('alice');
    expect(h.rpc).toHaveBeenCalledWith('bw_unregister_push_token', { p_token: TOKEN });
    expect(pending()).toEqual([]);
    expect(h.unregister).not.toHaveBeenCalled();
  });

  // Round 3 (B3): Android built without google-services.json never registers;
  // the plugin's unregister() then crashes on an uninitialised Firebase.
  it('Android without Firebase: sign-out never calls the native unregister', async () => {
    h.platform = 'android';
    vi.stubEnv('VITE_ANDROID_PUSH', '');
    const push = await load();
    h.rpc.mockImplementation(offline);
    await push.unregisterPushToken('alice');
    expect(h.unregister).not.toHaveBeenCalled();
  });

  // Round 3 (B4): the first offline start after an upgrade knows no token
  // and no stamp. The plugin still has the token: the revocation is queued
  // for that token and account, and sent once online.
  it('no token remembered: the token comes from the plugin and the revocation waits for the network', async () => {
    const push = await load();
    h.rpc.mockImplementation(offline);
    await push.unregisterPushToken('alice');
    expect(pending()).toEqual([expect.objectContaining({ token: TOKEN, userId: 'alice', registeredAt: null })]);
    expect(h.unregister).toHaveBeenCalledOnce();
    h.rpc.mockReset();
    h.rpc.mockResolvedValue({ data: true, error: null });
    expect(await push.flushQueuedPushRevocations()).toBe(1);
    expect(h.rpc).toHaveBeenCalledWith('bw_revoke_push_token', { p_token: TOKEN, p_user_id: 'alice', p_registered_at: null });
    expect(pending()).toEqual([]);
  });

  it('a token whose save never got through (offline) is queued too, without a stamp', async () => {
    const push = await load();
    h.rpc.mockImplementation(offline);
    h.from.mockImplementation(() => builder(offline));
    expect((await push.subscribeToPush('alice')).success).toBe(false);
    await push.unregisterPushToken('alice');
    expect(pending()).toEqual([expect.objectContaining({ token: TOKEN, userId: 'alice', registeredAt: null })]);
  });

  it('signing in again as the same account drops its own waiting revocation before saving', async () => {
    const push = await load();
    h.rpc.mockImplementation(offline);
    await push.unregisterPushToken('alice');
    expect(pending()).toHaveLength(1);
    h.listeners = {};
    const push2 = await load(); // next start
    h.from.mockImplementation(() => builder(offline));
    await push2.subscribeToPush('bob'); // another account: Alice's revocation still has to go
    expect(pending()).toHaveLength(1);
    await push2.subscribeToPush('alice'); // Alice again: nothing to revoke any more
    expect(pending()).toEqual([]);
  });

  // Round 3 (MINOR): both registration listeners save the new token; the
  // replies can come back in either order. The newest stamp is kept.
  it('two saves of the same token keep the newer stamp, whatever order the replies come in', async () => {
    const OLDER = '2026-11-22T09:59:58.1234+00:00';
    const NEWER = '2026-11-22T09:59:58.123456+00:00';
    const push = await load();
    let n = 0;
    h.rpc.mockImplementation(async (fn: string) => {
      if (fn !== 'bw_register_push_token_stamped') return { data: null, error: null };
      n += 1;
      if (n === 1) {
        await new Promise((r) => setTimeout(r, 20)); // first save, its reply arrives last
        return { data: OLDER, error: null };
      }
      return { data: NEWER, error: null };
    });
    await push.subscribeToPush('alice');
    await new Promise((r) => setTimeout(r, 40));
    expect(n).toBe(2);
    expect(JSON.parse(localStorage.getItem('bandwith.push-token') || 'null')?.registeredAt).toBe(NEWER);
  });

  // Claude review round 3: iOS keeps the same token. Signed out offline,
  // then signed in again (still not saved): the later flush must not switch
  // off the account's own current registration.
  it('signing in again drops the waiting revocations of that account, even before any save', async () => {
    const push = await load();
    h.rpc.mockImplementation(offline);
    await push.unregisterPushToken('alice');
    await push.unregisterPushToken('bob'); // another account's stays
    push.forgetQueuedPushRevocationsFor('alice');
    expect(pending().map((p) => p.userId)).toEqual(['bob']);
    const ctx = (await import('../../AuthContext.tsx?raw')).default;
    expect(ctx).toMatch(/if \(user\?\.id\) forgetQueuedPushRevocationsFor\(user\.id\)/);
  });
});
