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
  /** The network hangs (a venue with one bar): calls never answer. */
  hang: false,
  version: 1,
  /** Rotated, the new pair not made yet: members are told the version with no key (rule C). */
  pending: false,
  /** What bw_stage_set_signer was asked to replace. */
  replaced: [] as Array<string | undefined>,
  /** Calls wait for this (an answer still on its way). */
  gate: null as Promise<void> | null,
}));

vi.mock('../supabase', () => ({
  isDemoMode: false,
  supabase: {
    rpc: vi.fn(async (fn: string, args: Record<string, string>) => {
      db.calls.push(fn);
      if (db.offline) throw new TypeError('Failed to fetch');
      if (db.hang) return new Promise(() => {});
      if (db.gate) await db.gate;
      const withVersion = (p: object | null) => (p ? { ...p, version: db.version } : null);
      if (fn === 'bw_stage_verify_key') {
        if (db.pending) return { data: { public: null, version: db.version }, error: null };
        return { data: db.pair ? { public: db.pair.public, version: db.version } : null, error: null };
      }
      if (fn === 'bw_stage_signer') return { data: db.admin ? withVersion(db.pair) : null, error: null };
      if (fn === 'bw_stage_set_signer') {
        if (!db.admin) return { data: null, error: null };
        db.replaced.push(args.p_replace_public);
        if (db.pair && args.p_replace_public === db.pair.public) {
          db.pair = { public: args.p_public, private: args.p_private };
          db.version++;
        }
        db.pair ??= { public: args.p_public, private: args.p_private };
        return { data: withVersion(db.pair), error: null };
      }
      if (fn === 'bw_stage_key') return { data: 'a2V5', error: null };
      return { data: null, error: null };
    }),
  },
}));
vi.mock('../livePackFiles', () => ({ removeAllPackFiles: async () => {} }));

const native = await import('../stageBleNative');
const { stageSigner, stageVerifyKey, clearStageCache } = native;
const KEY_FETCH_TIMEOUT_MS = (native as { KEY_FETCH_TIMEOUT_MS?: number }).KEY_FETCH_TIMEOUT_MS ?? 4000;
const { generateSigner, signBytes, verifyBytes } = await import('../stageSign');

beforeEach(() => {
  localStorage.clear();
  db.admin = true;
  db.pair = null;
  db.calls = [];
  db.offline = false;
  db.hang = false;
  db.version = 1;
  db.pending = false;
  db.replaced = [];
  db.gate = null;
  native.setStageCacheUser('u1');
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
    expect(await stageVerifyKey('gig')).toEqual({ public: first!.public, version: 1 });
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
    expect(await stageSigner('gig')).toEqual({ ...other, version: 1 });
  });

  it('kept on the phone for offline gigs, and gone on sign-out', async () => {
    const signer = await stageSigner('gig');
    db.offline = true;
    expect(await stageSigner('gig')).toEqual(signer);
    expect(await stageVerifyKey('gig')).toEqual({ public: signer!.public, version: 1 });
    clearStageCache();
    expect(await stageSigner('gig')).toBeNull();
    expect(await stageVerifyKey('gig')).toBeNull();
  });

  it('no pair made yet: members get null and ask again next time', async () => {
    db.admin = false;
    expect(await stageVerifyKey('gig')).toBeNull();
    db.pair = await generateSigner();
    expect(await stageVerifyKey('gig')).toEqual({ public: db.pair.public, version: 1 });
  });

  it('an admin who is no longer one: the server says no, and the private key kept on the phone goes', async () => {
    expect(await stageSigner('gig')).not.toBeNull();
    db.admin = false;
    expect(await stageSigner('gig')).toBeNull();
    // Offline afterwards: nothing left to sign with.
    db.offline = true;
    expect(await stageSigner('gig')).toBeNull();
  });

  it('a rotated pair: admins and members get the new one even with an old copy kept', async () => {
    const old = await stageSigner('gig');
    expect(await stageVerifyKey('gig')).toEqual({ public: old!.public, version: 1 });
    // An admin was demoted: the server cleared the pair and bumped the version; a new admin made a new pair.
    db.pair = await generateSigner();
    db.version = 2;
    expect(await stageSigner('gig')).toEqual({ ...db.pair, version: 2 });
    expect(await stageVerifyKey('gig')).toEqual({ public: db.pair.public, version: 2 });
  });

  it('members whose band no longer shows them the gig lose the kept public key', async () => {
    db.pair = await generateSigner();
    expect(await stageVerifyKey('gig')).not.toBeNull();
    db.pair = null;
    expect(await stageVerifyKey('gig')).toBeNull();
    db.offline = true;
    expect(await stageVerifyKey('gig')).toBeNull();
  });

  it('a network that hangs falls back to the kept copy in a few seconds', async () => {
    const signer = await stageSigner('gig');
    db.hang = true;
    vi.useFakeTimers();
    try {
      const pending = Promise.all([stageSigner('gig'), stageVerifyKey('gig')]);
      await vi.advanceTimersByTimeAsync(KEY_FETCH_TIMEOUT_MS + 100);
      expect(await pending).toEqual([signer, { public: signer!.public, version: 1 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an answer that arrives after sign-out (or another account signed in) is dropped, not kept', async () => {
    for (const change of ['sign-out', 'other account'] as const) {
      localStorage.clear();
      db.pair = null;
      let open!: () => void;
      db.gate = new Promise<void>((r) => (open = r));
      const signer = stageSigner('gig');
      const verify = stageVerifyKey('gig');
      const band = native.stageKey('gig');
      await new Promise((r) => setTimeout(r, 0));
      if (change === 'sign-out') clearStageCache();
      else native.setStageCacheUser('u2');
      open();
      expect(await signer).toBeNull();
      expect(await verify).toBeNull();
      expect(await band).toBeNull();
      expect(Object.keys(localStorage).filter((k) => k.startsWith('bw-stage-key:'))).toEqual([]);
      db.gate = null;
      native.setStageCacheUser('u1');
    }
  });
  it("a stored pair whose private key doesn't sign for its public one is replaced by naming it, and the new pair (new version) is used (Claude on #288)", async () => {
    const a = await generateSigner();
    const b = await generateSigner();
    db.pair = { public: a.public, private: b.private };
    const signer = await stageSigner('gig-1');
    expect(db.replaced).toContain(a.public);
    expect(signer?.public).not.toBe(a.public);
    expect(signer?.version).toBe(2);
    const probe = new TextEncoder().encode('x');
    expect(await verifyBytes(signer!.public, probe, await signBytes(signer!.private, probe))).toBe(true);
  });

  it('after a rotation with no new pair yet, members are told "pending" (the version, no key), and it is kept for offline (rule C)', async () => {
    db.pending = true;
    db.version = 3;
    expect(await stageVerifyKey('gig-1')).toEqual({ public: null, version: 3 });
    db.offline = true;
    expect(await stageVerifyKey('gig-1')).toEqual({ public: null, version: 3 });
    expect(native.keptVerifyKey('gig-1')).toEqual({ public: null, version: 3 });
  });
});
