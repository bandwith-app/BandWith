import { beforeEach, describe, expect, it } from 'vitest';
import {
  RECOVERY_PROOF_TTL_MS,
  clearRecoveryProof,
  hasAnyRecoveryProof,
  hasRecoveryProof,
  hasRecoveryProofForLink,
  noteOwnExchange,
  noteRecovery,
  recoveryExchangeFetch,
  resetOwnExchange,
} from '../recoveryProof';
import callback from '../../app/auth/callback.tsx?raw';
import sb from '../supabase.ts?raw';
import ctx from '../AuthContext.tsx?raw';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

// What this tab's own exchange of a reset link leaves (recoveryExchangeFetch).
const exchanged = (code: string, userId: string, token: string | null = null) => noteOwnExchange(code, userId, token);
const forLink = (userId: string, code: string, s: ReturnType<typeof mem>, now: number) => hasRecoveryProofForLink(userId, code, s, now);

describe('recovery proof (audit 04 #2)', () => {
  beforeEach(() => resetOwnExchange());

  it('belongs to the account the reset link signed in, for an hour', () => {
    const s = mem();
    exchanged('alice-code', 'alice');
    expect(hasAnyRecoveryProof(s)).toBe(false);
    noteRecovery('alice', s, 1000);
    expect(hasRecoveryProof('alice', s, 1000 + 60_000)).toBe(true);
    expect(hasRecoveryProof('bob', s, 1000 + 60_000)).toBe(false);
    expect(hasRecoveryProof('alice', s, 1000 + RECOVERY_PROOF_TTL_MS + 1)).toBe(false);
    expect(hasAnyRecoveryProof(s, 2000)).toBe(true);
    clearRecoveryProof(s);
    expect(hasRecoveryProof('alice', s, 2000)).toBe(false);
  });

  it('the app records it on PASSWORD_RECOVERY and checks it before changing a password', () => {
    expect(sb).toMatch(/event === 'PASSWORD_RECOVERY'\) noteRecovery\(session\?\.user\?\.id, undefined, undefined, session\?\.access_token\)/);
    expect(sb).toMatch(/fetch: planAwareFetch\(recoveryExchangeFetch\(fetch/);
    expect(ctx).toMatch(/if \(!hasRecoveryProof\(user\?\.id\)\) \{\s*return \{ error:/);
    expect(ctx).toMatch(/isPasswordRecovery: isPasswordRecovery && \(user \? hasRecoveryProof\(user\.id\)/);
  });

  // Codex review #287: Bob's unfinished reset must not vouch for Alice's link
  // opened later in the same tab.
  it('the callback only accepts a proof for the link in its own URL', () => {
    const s = mem();
    exchanged('bob-code', 'bob');
    noteRecovery('bob', s, 1000);
    expect(forLink('bob', 'bob-code', s, 3000)).toBe(true);
    expect(forLink('bob', 'alice-code', s, 3000)).toBe(false);
    expect(forLink('alice', 'bob-code', s, 3000)).toBe(false);
    expect(callback).toMatch(/hasRecoveryProofForLink\(now\?\.user\?\.id, code\)/);
    expect(callback).toMatch(/clearRecoveryProof\(\);\s*fail\(\{ code: 'pkce_code_verifier_not_found' \}\)/);
  });

  // Codex review #287 round 2 (B1): the library re-sends PASSWORD_RECOVERY to
  // every other tab. Bob finishing his reset in one tab must not leave a proof
  // in the tab that holds Alice's link.
  it('a PASSWORD_RECOVERY broadcast from another tab records nothing', () => {
    const s = mem();
    noteRecovery('bob', s, 1000); // the broadcast: this tab exchanged nothing
    expect(hasRecoveryProof('bob', s, 2000)).toBe(false);
    expect(hasAnyRecoveryProof(s, 2000)).toBe(false);
    // This tab exchanged Alice's code: Bob's broadcast still doesn't count.
    exchanged('alice-code', 'alice', 'alice-at');
    noteRecovery('bob', s, 1000, 'bob-at');
    expect(hasRecoveryProof('bob', s, 2000)).toBe(false);
    // Nor another session of the same account than the one this tab got.
    noteRecovery('alice', s, 1000, 'other-at');
    expect(hasRecoveryProof('alice', s, 2000)).toBe(false);
    noteRecovery('alice', s, 1000, 'alice-at');
    expect(forLink('alice', 'alice-code', s, 2000)).toBe(true);
  });

  it("only this tab's successful PKCE exchange is noted, read before the library gets the response", async () => {
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const s = mem();
    const url = 'https://x.supabase.co/auth/v1/token?grant_type=pkce';
    const post = (code: string) => ({ method: 'POST', body: JSON.stringify({ auth_code: code, code_verifier: 'v' }) });
    // A failed exchange (wrong verifier) proves nothing.
    await recoveryExchangeFetch(async () => reply(400, { error: 'bad_code_verifier' }))(url, post('alice-code'));
    noteRecovery('alice', s, 1000);
    expect(hasRecoveryProof('alice', s, 2000)).toBe(false);
    // Another endpoint returning a user proves nothing.
    await recoveryExchangeFetch(async () => reply(200, { access_token: 'at', user: { id: 'alice' } }))('https://x.supabase.co/auth/v1/token?grant_type=refresh_token', post('alice-code'));
    noteRecovery('alice', s, 1000, 'at');
    expect(hasRecoveryProof('alice', s, 2000)).toBe(false);
    const res = await recoveryExchangeFetch(async () => reply(200, { access_token: 'at', user: { id: 'alice' } }))(url, post('alice-code'));
    expect(((await res.json()) as { user: { id: string } }).user.id).toBe('alice'); // body still readable by the library
    noteRecovery('alice', s, 1000, 'at');
    expect(forLink('alice', 'alice-code', s, 2000)).toBe(true);
  });
});
