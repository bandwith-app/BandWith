// Audit 04 #6: an offline sign-out still stops this device's pushes.
// Codex review #287: the server matches the registration (never a device
// clock); round 4: signed out, only with the registration's own secret.
import { describe, expect, it, vi } from 'vitest';
import {
  PUSH_REVOKE_MAX_QUEUED,
  beginPushSave,
  confirmPushSave,
  flushPushRevocations,
  forgetRevocation,
  newRevokeSecret,
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
const S1 = 'a'.repeat(64);
const S2 = 'b'.repeat(64);
const saved = (registeredAt: string | null, secrets: string[]) => ({ registeredAt, secrets });
const offline = async () => {
  throw new Error('offline');
};
const server = (revoked: boolean | 'offline', registered: boolean | 'offline' = false) => ({
  revoke: vi.fn(async (_p: unknown, _secret: string | null) => (revoked === 'offline' ? { data: null, error: new Error('offline') } : { data: revoked, error: null })),
  registered: vi.fn(async (_p: unknown) => (registered === 'offline' ? { data: null, error: new Error('offline') } : { data: registered, error: null })),
});

describe('push revocation on sign-out', () => {
  it('online: the server takes it, nothing queued, device untouched', async () => {
    const store = mem();
    const unregisterDevice = vi.fn(async () => {});
    expect(await revokeOnSignOut(TOKEN, 'alice', saved(REG, [S1]), { store, revokeOnServer: async () => true, unregisterDevice })).toBe('server');
    expect(readPendingRevocations(store)).toEqual([]);
    expect(unregisterDevice).not.toHaveBeenCalled();
  });

  it('offline: delivery stops on the device and the revocation waits, with the stamp and the secret', async () => {
    const store = mem();
    const unregisterDevice = vi.fn(async () => {});
    const now = () => new Date('2026-11-22T10:00:00Z');
    expect(await revokeOnSignOut(TOKEN, 'alice', saved(REG, [S1]), { store, revokeOnServer: offline, unregisterDevice, now })).toBe('queued');
    expect(unregisterDevice).toHaveBeenCalledOnce();
    const entry = { token: TOKEN, userId: 'alice', registeredAt: REG, secrets: [S1], at: '2026-11-22T10:00:00.000Z' };
    expect(readPendingRevocations(store)).toEqual([entry]);

    expect(await flushPushRevocations(store, server('offline'))).toBe(0);
    expect(readPendingRevocations(store)).toHaveLength(1);
    const s = server(true);
    expect(await flushPushRevocations(store, s)).toBe(1);
    expect(s.revoke).toHaveBeenCalledWith(entry, S1);
    expect(readPendingRevocations(store)).toEqual([]);
  });

  // Codex review #287 round 4 (B4): a false answer may only mean the device
  // lost the save's reply. While the token is still on for that account the
  // revocation stays, and every secret the device may have sent is tried.
  it('a refused revocation stays while the token is still on for that account', async () => {
    const store = mem();
    await revokeOnSignOut(TOKEN, 'alice', saved(null, [S2, S1]), { store, revokeOnServer: offline, unregisterDevice: async () => {}, now: () => new Date(0) });
    const still = server(false, true);
    expect(await flushPushRevocations(store, still)).toBe(0);
    expect(still.revoke.mock.calls.map((c) => c[1])).toEqual([S2, S1]);
    expect(readPendingRevocations(store)).toHaveLength(1);
    expect(await flushPushRevocations(store, server(false, 'offline'))).toBe(0);
    expect(readPendingRevocations(store)).toHaveLength(1);
    // Off, or moved to another account: nothing left to do.
    expect(await flushPushRevocations(store, server(false, false))).toBe(0);
    expect(readPendingRevocations(store)).toEqual([]);
  });

  it('no secret known: the revocation waits until it can go (signed in again) or the token moves', async () => {
    const store = mem();
    expect(await revokeOnSignOut(TOKEN, 'alice', null, { store, revokeOnServer: async () => false, unregisterDevice: async () => {}, now: () => new Date(0) })).toBe('queued');
    expect(readPendingRevocations(store)).toEqual([{ token: TOKEN, userId: 'alice', registeredAt: null, secrets: [], at: '1970-01-01T00:00:00.000Z' }]);
    const s = server(false, true);
    await flushPushRevocations(store, s);
    expect(s.revoke).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN }), null);
    expect(readPendingRevocations(store)).toHaveLength(1);
  });

  it('no account known: the device stops, nothing is queued for the server', async () => {
    const store = mem();
    const unregisterDevice = vi.fn(async () => {});
    expect(await revokeOnSignOut(TOKEN, '', null, { store, revokeOnServer: async () => false, unregisterDevice })).toBe('device');
    expect(unregisterDevice).toHaveBeenCalledOnce();
    expect(readPendingRevocations(store)).toEqual([]);
  });

  // Codex review #287 round 4 (B3): Bob signing out offline on the same
  // device must not replace Alice's waiting revocation for that token.
  it("another account's revocation for the same token is kept; the same account's is merged", async () => {
    const store = mem();
    const deps = { store, revokeOnServer: async () => false, unregisterDevice: async () => {}, now: () => new Date(0) };
    await revokeOnSignOut(TOKEN, 'alice', saved(REG, [S1]), deps);
    await revokeOnSignOut(TOKEN, 'bob', null, deps);
    await revokeOnSignOut(TOKEN, 'alice', saved(null, [S2]), deps);
    const list = readPendingRevocations(store);
    expect(list.map((p) => p.userId).sort()).toEqual(['alice', 'bob']);
    expect(list.find((p) => p.userId === 'alice')).toMatchObject({ registeredAt: REG, secrets: [S2, S1] });
    // Only a save the server confirmed moves the token: then none is left.
    forgetRevocation(store, TOKEN);
    expect(readPendingRevocations(store)).toEqual([]);
  });

  it('an old revocation is still sent, never dropped unsent', async () => {
    const store = mem();
    await revokeOnSignOut(TOKEN, 'alice', saved(REG, [S1]), { store, revokeOnServer: async () => false, unregisterDevice: async () => {}, now: () => new Date(0) });
    expect(await flushPushRevocations(store, server('offline'))).toBe(0);
    expect(readPendingRevocations(store)).toHaveLength(1);
    expect(await flushPushRevocations(store, server(true))).toBe(1);
    expect(readPendingRevocations(store)).toEqual([]);
  });

  it('the queue stays bounded: the oldest go first', async () => {
    const store = mem();
    for (let i = 0; i < PUSH_REVOKE_MAX_QUEUED + 5; i++) {
      await revokeOnSignOut(`${TOKEN}-${i}`, 'alice', saved(REG, [S1]), { store, revokeOnServer: async () => false, unregisterDevice: async () => {}, now: () => new Date(i * 1000) });
    }
    const list = readPendingRevocations(store);
    expect(list).toHaveLength(PUSH_REVOKE_MAX_QUEUED);
    expect(list[0].token).toBe(`${TOKEN}-5`);
  });

  // Claude review #287 round 4: a re-save clears the stamp at once and keeps
  // the new secret only as a candidate until the answer arrives; the answer
  // makes it the only one. A lost answer leaves both candidates.
  it('a re-save clears the stamp, and the answer alone sets the new one', () => {
    const store = mem();
    expect(rememberedPushToken(store, 'alice')).toBeNull();
    beginPushSave(store, TOKEN, 'alice', S1);
    confirmPushSave(store, TOKEN, 'alice', S1, REG);
    expect(rememberedPushToken(store, 'alice')).toEqual({ token: TOKEN, userId: 'alice', registeredAt: REG, secrets: [S1] });
    beginPushSave(store, TOKEN, 'alice', S2);
    expect(rememberedPushToken(store, 'alice')).toEqual({ token: TOKEN, userId: 'alice', registeredAt: null, secrets: [S2, S1] });
    confirmPushSave(store, TOKEN, 'alice', S2, '2026-11-22T10:00:00+00:00');
    expect(rememberedPushToken(store, 'alice')).toEqual({ token: TOKEN, userId: 'alice', registeredAt: '2026-11-22T10:00:00+00:00', secrets: [S2] });
    // A server without secrets (046): none is kept.
    beginPushSave(store, TOKEN, 'alice', S1);
    confirmPushSave(store, TOKEN, 'alice', null, REG);
    expect(rememberedPushToken(store, 'alice')?.secrets).toEqual([]);
    expect(rememberedPushToken(store, 'bob')).toBeNull();
    rememberPushToken(store, null);
    expect(rememberedPushToken(store, 'alice')).toBeNull();
  });

  it('secrets are random, 256 bits', () => {
    const a = newRevokeSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newRevokeSecret()).not.toBe(a);
  });

  it('the app wires it: sign-out, token save and the online flush', () => {
    expect(push).toMatch(/const known = cachedToken \?\? remembered\?\.token/);
    expect(push).toMatch(/await PushNotifications\.unregister\(\)/);
    expect(push).toMatch(/p_secret: secret/);
    expect(push).toMatch(/bw_push_token_registered/);
    expect(ctx).toMatch(/window\.addEventListener\('online', flush\)/);
    expect(ctx).toMatch(/await unregisterPushToken\(user\?\.id\)/);
    // Round 4 (B3): a sign-in no longer drops anyone's revocation.
    expect(ctx).not.toMatch(/forgetQueuedPushRevocationsFor/);
  });
});
