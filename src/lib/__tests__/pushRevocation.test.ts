// Audit 04 #6: an offline sign-out still stops this device's pushes.
// Codex review #287: the server matches the registration it knows (no device
// clock), and a sign-out before the native token arrives still revokes.
import { describe, expect, it, vi } from 'vitest';
import {
  PUSH_REVOKE_MAX_QUEUED,
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

    expect(await flushPushRevocations(store, async () => ({ error: new Error('offline') }))).toBe(0);
    expect(readPendingRevocations(store)).toHaveLength(1);
    const rpc = vi.fn(async () => ({ error: null }));
    expect(await flushPushRevocations(store, rpc)).toBe(1);
    expect(rpc).toHaveBeenCalledWith({ token: TOKEN, userId: 'alice', registeredAt: REG, at: '2026-11-22T10:00:00.000Z' });
    expect(readPendingRevocations(store)).toEqual([]);
  });

  // Round 3 (B4): no stamp known still queues, for that token and account.
  it('no known stamp: the device stops and the revocation waits, without a stamp', async () => {
    const store = mem();
    const unregisterDevice = vi.fn(async () => {});
    expect(await revokeOnSignOut(TOKEN, 'alice', null, { store, revokeOnServer: async () => false, unregisterDevice, now: () => new Date(0) })).toBe('queued');
    expect(unregisterDevice).toHaveBeenCalledOnce();
    expect(readPendingRevocations(store)).toEqual([{ token: TOKEN, userId: 'alice', registeredAt: null, at: '1970-01-01T00:00:00.000Z' }]);
  });

  it('no account known: the device stops, nothing is queued for the server', async () => {
    const store = mem();
    const unregisterDevice = vi.fn(async () => {});
    expect(await revokeOnSignOut(TOKEN, '', null, { store, revokeOnServer: async () => false, unregisterDevice })).toBe('device');
    expect(unregisterDevice).toHaveBeenCalledOnce();
    expect(readPendingRevocations(store)).toEqual([]);
  });

  it('a new sign-in on the device cancels it', async () => {
    const store = mem();
    await revokeOnSignOut(TOKEN, 'alice', REG, { store, revokeOnServer: async () => false, unregisterDevice: async () => {}, now: () => new Date(0) });
    forgetRevocation(store, TOKEN);
    expect(readPendingRevocations(store)).toEqual([]);
  });

  // Codex review #287 round 2 (MINOR): a phone opened again after a month
  // must still tell the server; the server's exact-stamp match makes a late
  // call harmless, so age alone never drops one.
  it('an old revocation is still sent, never dropped unsent', async () => {
    const store = mem();
    await revokeOnSignOut(TOKEN, 'alice', REG, { store, revokeOnServer: async () => false, unregisterDevice: async () => {}, now: () => new Date(0) });
    const rpc = vi.fn(async () => ({ error: null }));
    // Queued at the epoch: far older than any former cut-off.
    expect(await flushPushRevocations(store, async () => ({ error: new Error('offline') }))).toBe(0);
    expect(readPendingRevocations(store)).toHaveLength(1);
    expect(await flushPushRevocations(store, rpc)).toBe(1);
    expect(rpc).toHaveBeenCalledOnce();
    expect(readPendingRevocations(store)).toEqual([]);
  });

  it('the queue stays bounded: the oldest go first', async () => {
    const store = mem();
    for (let i = 0; i < PUSH_REVOKE_MAX_QUEUED + 5; i++) {
      await revokeOnSignOut(`${TOKEN}-${i}`, 'alice', REG, { store, revokeOnServer: async () => false, unregisterDevice: async () => {}, now: () => new Date(i * 1000) });
    }
    const list = readPendingRevocations(store);
    expect(list).toHaveLength(PUSH_REVOKE_MAX_QUEUED);
    expect(list[0].token).toBe(`${TOKEN}-5`);
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
    expect(push).toMatch(/const known = cachedToken \?\? remembered\?\.token/);
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
