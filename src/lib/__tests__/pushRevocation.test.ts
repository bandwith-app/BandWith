// Audit 04 #6: an offline sign-out still stops this device's pushes.
// Codex review #287: the server matches the registration it knows (no device
// clock), and a sign-out before the native token arrives still revokes.
import { describe, expect, it, vi } from 'vitest';
import {
  PUSH_REVOKE_MAX_AGE_MS,
  flushPushRevocations,
  forgetRevocation,
  readPendingRevocations,
  rememberPushToken,
  rememberedPushToken,
  revokeOnSignOut,
} from '../pushRevocation';
import push from '../services/pushNotifications.ts?raw';
import ctx from '../AuthContext.tsx?raw';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const TOKEN = 'device-token-0123456789';
const REG = '2026-11-22T09:59:58.123456+00:00'; // push_tokens.updated_at as the server stored it

describe('push revocation on sign-out', () => {
  it('online: the server takes it, nothing queued, device untouched', async () => {
    const store = mem();
    const unregisterDevice = vi.fn(async () => {});
    expect(await revokeOnSignOut(TOKEN, 'alice', REG, { store, revokeOnServer: async () => true, unregisterDevice })).toBe('server');
    expect(readPendingRevocations(store)).toEqual([]);
    expect(unregisterDevice).not.toHaveBeenCalled();
  });

  it('offline: delivery stops on the device and the revocation waits, with the server stamp', async () => {
    const store = mem();
    const unregisterDevice = vi.fn(async () => {});
    const now = () => new Date('2026-11-22T10:00:00Z');
    expect(await revokeOnSignOut(TOKEN, 'alice', REG, { store, revokeOnServer: async () => { throw new Error('offline'); }, unregisterDevice, now })).toBe('queued');
    expect(unregisterDevice).toHaveBeenCalledOnce();
    expect(readPendingRevocations(store)).toEqual([{ token: TOKEN, userId: 'alice', registeredAt: REG, at: '2026-11-22T10:00:00.000Z' }]);

    const t = Date.parse('2026-11-22T11:00:00Z');
    expect(await flushPushRevocations(store, async () => ({ error: new Error('offline') }), () => t)).toBe(0);
    expect(readPendingRevocations(store)).toHaveLength(1);
    const rpc = vi.fn(async () => ({ error: null }));
    expect(await flushPushRevocations(store, rpc, () => t)).toBe(1);
    expect(rpc).toHaveBeenCalledWith({ token: TOKEN, userId: 'alice', registeredAt: REG, at: '2026-11-22T10:00:00.000Z' });
    expect(readPendingRevocations(store)).toEqual([]);
  });

  it('no known registration: the device stops, nothing is queued for the server', async () => {
    const store = mem();
    const unregisterDevice = vi.fn(async () => {});
    expect(await revokeOnSignOut(TOKEN, 'alice', null, { store, revokeOnServer: async () => false, unregisterDevice })).toBe('device');
    expect(unregisterDevice).toHaveBeenCalledOnce();
    expect(readPendingRevocations(store)).toEqual([]);
  });

  it('a new sign-in on the device cancels it; very old ones are dropped', async () => {
    const store = mem();
    await revokeOnSignOut(TOKEN, 'alice', REG, { store, revokeOnServer: async () => false, unregisterDevice: async () => {}, now: () => new Date(0) });
    forgetRevocation(store, TOKEN);
    expect(readPendingRevocations(store)).toEqual([]);
    await revokeOnSignOut(TOKEN, 'alice', REG, { store, revokeOnServer: async () => false, unregisterDevice: async () => {}, now: () => new Date(0) });
    const rpc = vi.fn(async () => ({ error: null }));
    expect(await flushPushRevocations(store, rpc, () => PUSH_REVOKE_MAX_AGE_MS + 1)).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
    expect(readPendingRevocations(store)).toEqual([]);
  });

  it('the last saved token is remembered per account, across a cold start', () => {
    const store = mem();
    expect(rememberedPushToken(store, 'alice')).toBeNull();
    rememberPushToken(store, { token: TOKEN, userId: 'alice', registeredAt: REG });
    expect(rememberedPushToken(store, 'alice')).toEqual({ token: TOKEN, userId: 'alice', registeredAt: REG });
    expect(rememberedPushToken(store, 'bob')).toBeNull();
    rememberPushToken(store, null);
    expect(rememberedPushToken(store, 'alice')).toBeNull();
  });

  it('the app wires it: sign-out, token save and the online flush', () => {
    expect(push).toMatch(/revokeOnSignOut\(token, owner, registeredAt,/);
    // A sign-out before the native token arrives still knows the token.
    expect(push).toMatch(/const token = cachedToken \?\? remembered\?\.token/);
    expect(push).not.toMatch(/if \(!isNative\(\) \|\| !cachedToken\) return;/);
    expect(push).toMatch(/await PushNotifications\.unregister\(\)/);
    expect(push).toMatch(/rememberPushToken\(revokeStore\(\), \{ token, userId, registeredAt/);
    expect(push).toMatch(/forgetRevocation\(revokeStore\(\), token\)/);
    // Both save paths (RPC and the plain upsert) remember the token.
    expect(push.match(/await afterSave\(userId, token\)/g)?.length).toBe(2);
    // The rpc builder is only PromiseLike: an async callback makes it a Promise.
    expect(push).toMatch(/flushPushRevocations\(revokeStore\(\), async \(p\) =>/);
    expect(push).toMatch(/p_registered_at: p\.registeredAt/);
    expect(ctx).toMatch(/window\.addEventListener\('online', flush\)/);
    expect(ctx).toMatch(/await unregisterPushToken\(user\?\.id\)/);
  });
});
