// Audit 04 #6: an offline sign-out still stops this device's pushes.
// Codex review #287: the server matches the registration (never a device
// clock); round 4: signed out, only with the registration's own secret;
// round 5: no lookup by token, the confirmed secret is pinned.
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_UNCONFIRMED_SECRETS,
  PUSH_REVOKE_MAX_QUEUED,
  REVOKE_RETRY_BASE_MS,
  REVOKE_RETRY_MAX_MS,
  beginPushSave,
  confirmPushSave,
  flushPushRevocations,
  forgetAccountPushState,
  forgetRevocation,
  newRevokeSecret,
  nextRevocationRetry,
  queueRevocation,
  readPendingRevocations,
  reclaimRevocation,
  rememberPushToken,
  rememberedPushToken,
  rememberedPushTokenAny,
  revokeOnSignOut,
  revokeRetryDelay,
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
const S3 = 'c'.repeat(64);
const S4 = 'd'.repeat(64);
const saved = (registeredAt: string | null, confirmed: string | null, attempts: string[] = []) => ({ registeredAt, confirmed, attempts });
const offline = async () => {
  throw new Error('offline');
};
const server = (revoked: boolean | 'offline') => ({
  revoke: vi.fn(async (_p: unknown, _secret: string | null) => (revoked === 'offline' ? { data: null, error: new Error('offline') } : { data: revoked, error: null })),
});

describe('push revocation on sign-out', () => {
  // Codex review #287 round 6 (B2): the device stops too, whatever the
  // server answered.
  it('online: the server takes it, nothing queued, and the device stops too', async () => {
    const store = mem();
    const unregisterDevice = vi.fn(async () => {});
    expect(await revokeOnSignOut(TOKEN, 'alice', saved(REG, S1), { store, revokeOnServer: async () => true, unregisterDevice })).toBe('server');
    expect(readPendingRevocations(store)).toEqual([]);
    expect(unregisterDevice).toHaveBeenCalledOnce();
  });

  it('offline: delivery stops on the device and the revocation waits, with the stamp and the secret', async () => {
    const store = mem();
    const unregisterDevice = vi.fn(async () => {});
    const now = () => new Date('2026-11-22T10:00:00Z');
    expect(await revokeOnSignOut(TOKEN, 'alice', saved(REG, S1), { store, revokeOnServer: offline, unregisterDevice, now })).toBe('queued');
    expect(unregisterDevice).toHaveBeenCalledOnce();
    const entry = { token: TOKEN, userId: 'alice', registeredAt: REG, confirmed: S1, attempts: [], at: '2026-11-22T10:00:00.000Z', tries: 0, fails: 0, retryAt: null };
    expect(readPendingRevocations(store)).toEqual([entry]);

    expect(await flushPushRevocations(store, server('offline'))).toBe(0);
    expect(readPendingRevocations(store)).toHaveLength(1);
    // The network is back: tried at once.
    const s = server(true);
    expect(await flushPushRevocations(store, { ...s, online: true })).toBe(1);
    expect(s.revoke).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN, userId: 'alice', registeredAt: REG, confirmed: S1, tries: 0, fails: 1 }), S1);
    expect(readPendingRevocations(store)).toEqual([]);
  });

  // Main's decision (#287 round 6, B2): every secret the server may hold is
  // tried; refused by all of them, it is never dropped: kept, and tried
  // again with a backoff that doubles, until the server takes it.
  it('refused for every secret it may hold: kept and retried with backoff; offline: kept as is', async () => {
    const store = mem();
    await revokeOnSignOut(TOKEN, 'alice', saved(null, S1, [S2]), { store, revokeOnServer: offline, unregisterDevice: async () => {}, now: () => new Date(0) });
    const T0 = 1_000_000;
    expect(await flushPushRevocations(store, { ...server('offline'), now: () => T0 })).toBe(0);
    // Round 8 (M1): an error backs off too, without counting as a refusal.
    expect(readPendingRevocations(store)).toEqual([expect.objectContaining({ tries: 0, fails: 1, retryAt: T0 + REVOKE_RETRY_BASE_MS })]);
    const refused = server(false);
    expect(await flushPushRevocations(store, { ...refused, now: () => T0, online: true })).toBe(0);
    expect(refused.revoke.mock.calls.map((c) => c[1])).toEqual([S2, S1]);
    expect(readPendingRevocations(store)).toEqual([expect.objectContaining({ tries: 1, fails: 0, retryAt: T0 + REVOKE_RETRY_BASE_MS })]);
    expect(nextRevocationRetry(store)).toBe(T0 + REVOKE_RETRY_BASE_MS);
    // Not due yet: not sent.
    const early = server(true);
    expect(await flushPushRevocations(store, { ...early, now: () => T0 + REVOKE_RETRY_BASE_MS - 1 })).toBe(0);
    expect(early.revoke).not.toHaveBeenCalled();
    // Refused again: the wait doubles, and never grows past the ceiling.
    expect(await flushPushRevocations(store, { ...server(false), now: () => T0 + REVOKE_RETRY_BASE_MS })).toBe(0);
    expect(readPendingRevocations(store)[0]).toMatchObject({ tries: 2, retryAt: T0 + 3 * REVOKE_RETRY_BASE_MS });
    expect(revokeRetryDelay(50)).toBe(REVOKE_RETRY_MAX_MS);
    // Taken at last: gone.
    expect(await flushPushRevocations(store, { ...server(true), now: () => T0 + 3 * REVOKE_RETRY_BASE_MS })).toBe(1);
    expect(readPendingRevocations(store)).toEqual([]);
  });

  it('no secret known: a refusal keeps it, until the token is saved again or the owner path takes it', async () => {
    const store = mem();
    expect(await revokeOnSignOut(TOKEN, 'alice', null, { store, revokeOnServer: async () => false, unregisterDevice: async () => {}, now: () => new Date(0) })).toBe('queued');
    expect(readPendingRevocations(store)).toEqual([{ token: TOKEN, userId: 'alice', registeredAt: null, confirmed: null, attempts: [], at: '1970-01-01T00:00:00.000Z', tries: 0, fails: 0, retryAt: null }]);
    const s = server(false);
    await flushPushRevocations(store, { ...s, now: () => 0 });
    expect(s.revoke).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN }), null);
    expect(readPendingRevocations(store)).toHaveLength(1);
    // Alice signs in again here (after the backoff): the owner path switches it off.
    expect(await flushPushRevocations(store, { ...server(true), now: () => REVOKE_RETRY_MAX_MS })).toBe(1);
    expect(readPendingRevocations(store)).toEqual([]);
  });

  // Claude review #287 round 5: a sign-out waiting for the flush stops it
  // between entries; what is left stays queued.
  it('the flush stops between entries once its session is over', async () => {
    const store = mem();
    const deps = { store, revokeOnServer: async () => false, unregisterDevice: async () => {}, now: () => new Date(0) };
    await revokeOnSignOut(`${TOKEN}-1`, 'alice', saved(REG, S1), deps);
    await revokeOnSignOut(`${TOKEN}-2`, 'alice', saved(REG, S2), deps);
    let live = true;
    const s = { revoke: vi.fn(async () => { live = false; return { data: true, error: null }; }) };
    expect(await flushPushRevocations(store, { ...s, alive: () => live })).toBe(1);
    expect(s.revoke).toHaveBeenCalledTimes(1);
    expect(readPendingRevocations(store).map((p) => p.token)).toEqual([`${TOKEN}-2`]);
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
    await revokeOnSignOut(TOKEN, 'alice', saved(REG, S1), deps);
    await revokeOnSignOut(TOKEN, 'bob', null, deps);
    await revokeOnSignOut(TOKEN, 'alice', saved(null, S1, [S2]), deps);
    const list = readPendingRevocations(store);
    expect(list.map((p) => p.userId).sort()).toEqual(['alice', 'bob']);
    expect(list.find((p) => p.userId === 'alice')).toMatchObject({ registeredAt: REG, confirmed: S1, attempts: [S2] });
    // Only a save the server confirmed moves the token: then none is left.
    forgetRevocation(store, TOKEN);
    expect(readPendingRevocations(store)).toEqual([]);
  });

  it('an old revocation is still sent, never dropped unsent', async () => {
    const store = mem();
    await revokeOnSignOut(TOKEN, 'alice', saved(REG, S1), { store, revokeOnServer: async () => false, unregisterDevice: async () => {}, now: () => new Date(0) });
    expect(await flushPushRevocations(store, server('offline'))).toBe(0);
    expect(readPendingRevocations(store)).toHaveLength(1);
    expect(await flushPushRevocations(store, { ...server(true), online: true })).toBe(1);
    expect(readPendingRevocations(store)).toEqual([]);
  });

  // Codex review #287 round 8 (M1, Claude 1): offline, an overdue entry
  // waits for the backoff instead of being tried every second.
  it('a network error advances the retry with the same backoff, and online tries at once', async () => {
    const store = mem();
    await revokeOnSignOut(TOKEN, 'alice', saved(REG, S1), { store, revokeOnServer: offline, unregisterDevice: async () => {}, now: () => new Date(0) });
    const T0 = 5_000_000;
    const down = server('offline');
    await flushPushRevocations(store, { ...down, now: () => T0 });
    expect(readPendingRevocations(store)[0]).toMatchObject({ tries: 0, fails: 1, retryAt: T0 + REVOKE_RETRY_BASE_MS });
    expect(nextRevocationRetry(store)).toBe(T0 + REVOKE_RETRY_BASE_MS);
    // A timer firing a second later: not tried.
    await flushPushRevocations(store, { ...down, now: () => T0 + 1000 });
    expect(down.revoke).toHaveBeenCalledTimes(1);
    // Due: tried, and the wait doubles.
    await flushPushRevocations(store, { ...down, now: () => T0 + REVOKE_RETRY_BASE_MS });
    expect(readPendingRevocations(store)[0]).toMatchObject({ tries: 0, fails: 2, retryAt: T0 + 3 * REVOKE_RETRY_BASE_MS });
    // The 'online' event: at once, whatever the wait.
    expect(await flushPushRevocations(store, { ...server(true), now: () => T0 + REVOKE_RETRY_BASE_MS + 1, online: true })).toBe(1);
    expect(readPendingRevocations(store)).toEqual([]);
  });

  it('the queue stays bounded: the oldest go first', async () => {
    const store = mem();
    for (let i = 0; i < PUSH_REVOKE_MAX_QUEUED + 5; i++) {
      await revokeOnSignOut(`${TOKEN}-${i}`, 'alice', saved(REG, S1), { store, revokeOnServer: async () => false, unregisterDevice: async () => {}, now: () => new Date(i * 1000) });
    }
    const list = readPendingRevocations(store);
    expect(list).toHaveLength(PUSH_REVOKE_MAX_QUEUED);
    expect(list[0].token).toBe(`${TOKEN}-5`);
  });

  // The new secret is an attempt until the answer arrives; the answer makes
  // it the confirmed one. Codex round 5 (B2): offline attempts never evict
  // the confirmed secret. Codex round 8 (B3): nor the confirmed stamp.
  it('a re-save keeps the confirmed stamp until the answer sets the new one', () => {
    const store = mem();
    expect(rememberedPushToken(store, 'alice')).toBeNull();
    beginPushSave(store, TOKEN, 'alice', S1);
    confirmPushSave(store, TOKEN, 'alice', S1, REG);
    expect(rememberedPushToken(store, 'alice')).toEqual({ token: TOKEN, userId: 'alice', registeredAt: REG, confirmed: S1, attempts: [] });
    beginPushSave(store, TOKEN, 'alice', S2);
    expect(rememberedPushToken(store, 'alice')).toEqual({ token: TOKEN, userId: 'alice', registeredAt: REG, confirmed: S1, attempts: [S2] });
    confirmPushSave(store, TOKEN, 'alice', S2, '2026-11-22T10:00:00+00:00');
    expect(rememberedPushToken(store, 'alice')).toEqual({ token: TOKEN, userId: 'alice', registeredAt: '2026-11-22T10:00:00+00:00', confirmed: S2, attempts: [] });
    // A server without secrets (046): none is kept.
    beginPushSave(store, TOKEN, 'alice', S1);
    confirmPushSave(store, TOKEN, 'alice', null, REG);
    expect(rememberedPushToken(store, 'alice')).toMatchObject({ confirmed: null, attempts: [] });
    expect(rememberedPushToken(store, 'bob')).toBeNull();
    rememberPushToken(store, null);
    expect(rememberedPushToken(store, 'alice')).toBeNull();
  });

  it('three offline saves never evict the confirmed secret, in the device or the queue', async () => {
    const store = mem();
    beginPushSave(store, TOKEN, 'alice', S1);
    confirmPushSave(store, TOKEN, 'alice', S1, REG);
    for (const s of [S2, S3, S4, 'e'.repeat(64)]) beginPushSave(store, TOKEN, 'alice', s);
    const kept = rememberedPushToken(store, 'alice');
    // Round 6: no unconfirmed secret is dropped either (cap 20).
    expect(kept).toMatchObject({ confirmed: S1, attempts: ['e'.repeat(64), S4, S3, S2] });
    await revokeOnSignOut(TOKEN, 'alice', kept, { store, revokeOnServer: offline, unregisterDevice: async () => {}, now: () => new Date(0) });
    await revokeOnSignOut(TOKEN, 'alice', saved(null, null, ['f'.repeat(64), S2]), { store, revokeOnServer: offline, unregisterDevice: async () => {}, now: () => new Date(1) });
    expect(readPendingRevocations(store)[0].confirmed).toBe(S1);
    const s = server(false);
    await flushPushRevocations(store, s);
    expect(s.revoke.mock.calls.map((c) => c[1])).toContain(S1);
  });

  // Codex review #287 round 6 (minor): the answer of a save is lost (the
  // server holds its secret), then 3 saves never get out: that secret must
  // still be tried once the network is back.
  it('a lost answer plus 3 offline saves: the revocation still works on reconnect', async () => {
    const store = mem();
    const LOST = 'f'.repeat(64);
    beginPushSave(store, TOKEN, 'alice', S1);
    confirmPushSave(store, TOKEN, 'alice', S1, REG);
    beginPushSave(store, TOKEN, 'alice', LOST); // reached the server, the answer didn't come back
    for (const s of [S2, S3, S4]) beginPushSave(store, TOKEN, 'alice', s); // never got out
    await revokeOnSignOut(TOKEN, 'alice', rememberedPushToken(store, 'alice'), { store, revokeOnServer: offline, unregisterDevice: async () => {}, now: () => new Date(0) });
    const holds = { revoke: vi.fn(async (_p: unknown, secret: string | null) => ({ data: secret === LOST, error: null })) };
    expect(await flushPushRevocations(store, holds)).toBe(1);
    expect(holds.revoke.mock.calls.map((c) => c[1])).toContain(LOST);
    expect(readPendingRevocations(store)).toEqual([]);
  });

  it('unconfirmed secrets are kept up to 20, the newest never dropped', () => {
    const store = mem();
    const many = Array.from({ length: MAX_UNCONFIRMED_SECRETS + 5 }, (_, i) => i.toString(16).padStart(64, '0'));
    for (const s of many) beginPushSave(store, TOKEN, 'alice', s);
    const kept = rememberedPushToken(store, 'alice')!.attempts;
    expect(MAX_UNCONFIRMED_SECRETS).toBe(20);
    expect(kept).toHaveLength(20);
    expect(kept[0]).toBe(many[many.length - 1]);
  });

  // Codex review #287 round 7 (B4): a session that ended elsewhere still
  // finds the registration, whichever account it was for.
  it('the remembered registration is found without knowing its account', () => {
    const store = mem();
    expect(rememberedPushTokenAny(store)).toBeNull();
    confirmPushSave(store, TOKEN, 'alice', S1, REG);
    expect(rememberedPushTokenAny(store)).toEqual({ token: TOKEN, userId: 'alice', registeredAt: REG, confirmed: S1, attempts: [] });
    expect(rememberedPushToken(store, 'bob')).toBeNull();
    expect(rememberedPushToken(store, 'alice')?.confirmed).toBe(S1);
  });

  // Codex review #287 round 8 (B3): a registration from before 184 has no
  // secret: its stamp is the only signed-out credential. An offline save,
  // then an offline sign-out: the revocation still carries the stamp, and
  // each call presents both (the new secret and the stamp).
  it('an offline save before an offline sign-out still revokes a pre-184 registration by its stamp', async () => {
    const store = mem();
    confirmPushSave(store, TOKEN, 'alice', null, REG); // saved through 046: no secret
    beginPushSave(store, TOKEN, 'alice', S2); // never got out
    await revokeOnSignOut(TOKEN, 'alice', rememberedPushToken(store, 'alice'), { store, revokeOnServer: offline, unregisterDevice: async () => {}, now: () => new Date(0) });
    expect(readPendingRevocations(store)[0]).toMatchObject({ registeredAt: REG, confirmed: null, attempts: [S2] });
    const byStamp = { revoke: vi.fn(async (p: { registeredAt: string | null }, _s: string | null) => ({ data: p.registeredAt === REG, error: null })) };
    expect(await flushPushRevocations(store, byStamp)).toBe(1);
    expect(byStamp.revoke).toHaveBeenCalledWith(expect.objectContaining({ registeredAt: REG }), S2);
  });

  // Claude review #287 round 7 (C3): Alice signs in again on the same token
  // (iOS): her own queued revocation leaves the queue (it would switch her
  // new session's registration off), and its credentials go back to the
  // record for her next sign-out. Bob's stays.
  it("the same account back on the token takes its revocation back; other accounts' stay", () => {
    const store = mem();
    queueRevocation(store, TOKEN, 'alice', saved(REG, S1), new Date(0));
    queueRevocation(store, TOKEN, 'bob', saved(null, S3), new Date(1));
    expect(reclaimRevocation(store, TOKEN, 'alice')).toBe(true);
    expect(readPendingRevocations(store).map((p) => p.userId)).toEqual(['bob']);
    expect(rememberedPushToken(store, 'alice')).toEqual({ token: TOKEN, userId: 'alice', registeredAt: REG, confirmed: S1, attempts: [] });
    beginPushSave(store, TOKEN, 'alice', S2);
    expect(rememberedPushToken(store, 'alice')).toMatchObject({ registeredAt: REG, confirmed: S1, attempts: [S2] });
    expect(reclaimRevocation(store, TOKEN, 'alice')).toBe(false);
  });

  // Codex review #287 round 8 (M2): a deleted account leaves nothing.
  it("a deleted account's queued revocations and saved registration are cleared, others' kept", () => {
    const store = mem();
    queueRevocation(store, TOKEN, 'alice', saved(REG, S1), new Date(0));
    queueRevocation(store, TOKEN, 'bob', saved(null, S3), new Date(1));
    confirmPushSave(store, TOKEN, 'alice', S1, REG);
    forgetAccountPushState(store, 'alice');
    expect(readPendingRevocations(store).map((p) => p.userId)).toEqual(['bob']);
    expect(rememberedPushTokenAny(store)).toBeNull();
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
    expect(push).not.toMatch(/bw_push_token_registered/);
    expect(ctx).toMatch(/window\.addEventListener\('online', flushOnline\)/);
    // Round 8 (M1): back online, what waited after an error goes at once.
    expect(ctx).toMatch(/flushQueuedPushRevocations\(\{ online: true \}\)/);
    expect(ctx).toMatch(/await unregisterPushToken\(user\?\.id, \{ accountGone: !!opts\?\.discardPendingWrites \}\)/);
    // Round 4 (B3): a sign-in no longer drops anyone's revocation.
    expect(ctx).not.toMatch(/forgetQueuedPushRevocationsFor/);
    // Round 6 (B1): every end of a session clears the native push account.
    expect(ctx).toMatch(/if \(event === 'SIGNED_OUT'\) void forgetPushAccount\(\)/);
    // Claude r5 (M3): a failed signOut() subscribes again (identity restored).
    expect(ctx).toMatch(/\} else if \(user\?\.id\) \{[\s\S]{0,200}void subscribeToPush\(user\.id\)/);
    expect(ctx).toMatch(/\} else \{\s*\/\/ No session at start[\s\S]{0,120}forgetPushAccount\(\)/);
  });
});
