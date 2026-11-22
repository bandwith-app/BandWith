import { describe, expect, it, vi, beforeEach } from 'vitest';

// jsdom has no WebCrypto; the app runs where it does (WKWebView, Android WebView).
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

/** The server side of migration 190: one stored pair per gig, first one wins; `admin` decides access. */
const db = vi.hoisted(() => ({
  admin: true,
  pair: null as { public: string; private: string } | null,
  calls: [] as string[],
  offline: false,
}));

vi.mock('../supabase', () => ({
  isDemoMode: false,
  supabase: {
    rpc: vi.fn(async (fn: string, args: Record<string, string>) => {
      db.calls.push(fn);
      if (db.offline) throw new TypeError('Failed to fetch');
      if (fn === 'bw_stage_verify_key') return { data: db.pair?.public ?? null, error: null };
      if (fn === 'bw_stage_signer') return { data: db.admin ? db.pair : null, error: null };
      if (fn === 'bw_stage_set_signer') {
        if (!db.admin) return { data: null, error: null };
        db.pair ??= { public: args.p_public, private: args.p_private };
        return { data: db.pair, error: null };
      }
      if (fn === 'bw_stage_key') return { data: 'a2V5', error: null };
      return { data: null, error: null };
    }),
  },
}));
vi.mock('../livePackFiles', () => ({ removeAllPackFiles: async () => {} }));

const { stageSigner, stageVerifyKey, clearStageCache } = await import('../stageBleNative');
const { generateSigner, signBytes, verifyBytes } = await import('../stageSign');

beforeEach(() => {
  localStorage.clear();
  db.admin = true;
  db.pair = null;
  db.calls = [];
  db.offline = false;
});

describe('stageSigner / stageVerifyKey (migration 190)', () => {
  it('the first admin makes the key pair; a second admin gets the same one; members only the public key', async () => {
    const first = await stageSigner('gig');
    expect(first).not.toBeNull();
    expect(db.calls).toEqual(['bw_stage_signer', 'bw_stage_set_signer']);
    localStorage.clear();
    expect(await stageSigner('gig')).toEqual(first);
    localStorage.clear();
    db.admin = false;
    expect(await stageSigner('gig')).toBeNull();
    expect(await stageVerifyKey('gig')).toBe(first!.public);
    // What the admin signs, the member's key checks.
    const data = new Uint8Array([1, 2, 3]);
    expect(await verifyBytes(first!.public, data, await signBytes(first!.private, data))).toBe(true);
  });

  it('two admins making one at once agree on the stored one', async () => {
    const other = await generateSigner();
    db.pair = other;
    db.admin = true;
    // bw_stage_signer says none yet (a race): set_signer returns the stored pair, not ours.
    const { supabase } = await import('../supabase');
    vi.mocked(supabase.rpc).mockImplementationOnce((async () => ({ data: null, error: null })) as never);
    expect(await stageSigner('gig')).toEqual(other);
  });

  it('kept on the phone for offline gigs, and gone on sign-out', async () => {
    const signer = await stageSigner('gig');
    db.offline = true;
    expect(await stageSigner('gig')).toEqual(signer);
    expect(await stageVerifyKey('gig')).toBe(signer!.public);
    clearStageCache();
    expect(await stageSigner('gig')).toBeNull();
    expect(await stageVerifyKey('gig')).toBeNull();
  });

  it('no pair made yet: members get null and ask again next time', async () => {
    db.admin = false;
    expect(await stageVerifyKey('gig')).toBeNull();
    db.pair = await generateSigner();
    expect(await stageVerifyKey('gig')).toBe(db.pair.public);
  });
});
