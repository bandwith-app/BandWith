// Codex review #287 round 2: sign-out must stop this device's pushes in every
// case the app can reach (audit 04 #6), driven through the real push service.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listeners: {} as Record<string, (v: unknown) => unknown>,
  unregister: vi.fn(async () => {}),
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
  registerPlugin: () => ({}),
}));
vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    addListener: (name: string, fn: (v: unknown) => unknown) => {
      h.listeners[name] = fn;
      return Promise.resolve({ remove: async () => undefined });
    },
    requestPermissions: async () => ({ receive: 'granted' }),
    register: async () => {
      await h.listeners.registration?.({ value: TOKEN });
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
const pending = () => JSON.parse(localStorage.getItem('bandwith.push-revoke') || '[]') as { registeredAt: string }[];

describe('sign-out stops pushes (Codex review #287 round 2)', () => {
  beforeEach(() => {
    localStorage.clear();
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
});
