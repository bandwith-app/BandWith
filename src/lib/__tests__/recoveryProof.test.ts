import { describe, expect, it } from 'vitest';
import { RECOVERY_PROOF_TTL_MS, clearRecoveryProof, hasAnyRecoveryProof, hasRecoveryProof, hasRecoveryProofSince, noteRecovery } from '../recoveryProof';
import callback from '../../app/auth/callback.tsx?raw';
import sb from '../supabase.ts?raw';
import ctx from '../AuthContext.tsx?raw';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe('recovery proof (audit 04 #2)', () => {
  it('belongs to the account the reset link signed in, for an hour', () => {
    const s = mem();
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
    expect(sb).toMatch(/event === 'PASSWORD_RECOVERY'\) noteRecovery\(session\?\.user\?\.id\)/);
    expect(ctx).toMatch(/if \(!hasRecoveryProof\(user\?\.id\)\) \{\s*return \{ error:/);
    expect(ctx).toMatch(/isPasswordRecovery: isPasswordRecovery && \(user \? hasRecoveryProof\(user\.id\)/);
  });

  // Codex review #287: Bob's unfinished reset must not vouch for Alice's link
  // opened later in the same tab.
  it('the callback only accepts a proof noted on this page load', () => {
    const s = mem();
    noteRecovery('bob', s, 1000);
    expect(hasRecoveryProofSince('bob', 2000, s, 3000)).toBe(false);
    noteRecovery('bob', s, 2500);
    expect(hasRecoveryProofSince('bob', 2000, s, 3000)).toBe(true);
    expect(hasRecoveryProofSince('alice', 2000, s, 3000)).toBe(false);
    expect(callback).toMatch(/hasRecoveryProofSince\(now\?\.user\?\.id, RECOVERY_PAGE_LOADED_AT\)/);
    expect(callback).toMatch(/clearRecoveryProof\(\);\s*fail\(\{ code: 'pkce_code_verifier_not_found' \}\)/);
  });
});
