import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Capacitor } from '@capacitor/core';

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
  /** bw_stage_set_signer fails (the network drops between the two calls). */
  failSet: false,
  /** bw_stage_set_signer answers "busy, try again" (40001) this many times (190: the band's keys are changing). */
  busy: 0,
  /** The account may see the gig (else the server's no: SQL NULL). */
  member: true,
  /** Answers worked out when asked, held back until the test releases them (overlapping fetches). */
  slow: false,
  held: [] as Array<() => void>,
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
      const later = <T,>(answer: T): Promise<T> | T => (db.slow ? new Promise((resolve) => db.held.push(() => resolve(answer))) : answer);
      if (fn === 'bw_stage_verify_key') {
        // 190: SQL NULL is only the server's no; no pair yet is version 0 (Codex on #288).
        if (!db.member) return later({ data: null, error: null });
        if (db.pending) return later({ data: { public: null, version: db.version }, error: null });
        return later({ data: db.pair ? { public: db.pair.public, version: db.version } : { public: null, version: 0 }, error: null });
      }
      if (fn === 'bw_stage_signer') return later({ data: db.admin ? withVersion(db.pair) : null, error: null });
      if (fn === 'bw_stage_set_signer') {
        if (db.failSet) throw new TypeError('Failed to fetch');
        if (db.busy-- > 0) return { data: null, error: { code: '40001', message: 'stage keys are changing, try again' } };
        if (!db.admin) return { data: null, error: null };
        db.replaced.push(args.p_replace_public);
        if (db.pair && args.p_replace_public === db.pair.public) {
          db.pair = { public: args.p_public, private: args.p_private };
          db.version++;
        }
        db.pair ??= { public: args.p_public, private: args.p_private };
        return { data: withVersion(db.pair), error: null };
      }
      // 191: SQL NULL for an account that may not see the gig.
      if (fn === 'bw_stage_key') return { data: db.member ? 'a2V5' : null, error: null };
      return { data: null, error: null };
    }),
  },
}));
vi.mock('../livePackFiles', () => ({ removeAllPackFiles: async () => {} }));

const native = await import('../stageBleNative');
const { stageSigner, stageVerifyKey, clearStageCache } = native;
const KEY_FETCH_TIMEOUT_MS = (native as { KEY_FETCH_TIMEOUT_MS?: number }).KEY_FETCH_TIMEOUT_MS ?? 4000;
const { generateSigner, signBytes, verifyBytes } = await import('../stageSign');

// The test setup's localStorage is a plain object of methods: Object.keys/values would list those, not what's stored.
const storedKeys = () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!);
const storedValues = () => storedKeys().map((k) => localStorage.getItem(k));

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
  db.failSet = false;
  db.busy = 0;
  db.member = true;
  db.slow = false;
  db.held = [];
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
    db.member = false;
    expect(await stageVerifyKey('gig')).toBeNull();
    db.offline = true;
    expect(await stageVerifyKey('gig')).toBeNull();
  });

  it('no pair made yet (version 0) is an answer, not a no: the kept keys stay (Codex on #288)', async () => {
    db.admin = false;
    await native.stageKey('gig');
    const r = await native.fetchVerifyKey('gig');
    expect(r).toEqual({ answer: null, server: true, denied: false });
    db.offline = true;
    expect(await native.stageKey('gig')).toBe('a2V5');
  });

  it("the server's no drops every key kept for the gig: the band key, the public key, the private key (Codex on #288)", async () => {
    expect(await stageSigner('gig')).not.toBeNull();
    await native.stageKey('gig');
    expect(await stageVerifyKey('gig')).not.toBeNull();
    db.member = false;
    db.admin = false;
    const r = await native.fetchVerifyKey('gig');
    expect(r).toEqual({ answer: null, server: true, denied: true });
    expect(storedKeys().filter((k) => k.includes('gig'))).toEqual([]);
    db.offline = true;
    expect(await stageSigner('gig')).toBeNull();
    expect(await native.stageKey('gig')).toBeNull();
  });

  it("the server's no on the band key drops every key kept for the gig too, the private one included (Claude round 8 on #288)", async () => {
    const signer = await stageSigner('gig');
    await native.stageKey('gig');
    expect(await stageVerifyKey('gig')).not.toBeNull();
    db.member = false;
    db.admin = false;
    expect(await native.fetchStageKey('gig')).toEqual({ key: null, denied: true });
    expect(storedKeys().filter((k) => k.includes('gig'))).toEqual([]);
    expect(storedValues().some((v) => String(v).includes(signer!.private))).toBe(false);
  });

  it("an admin made a member: opening the gig asks the server, and its no deletes the private key kept on the phone; offline it stays (Claude round 8 on #288)", async () => {
    const native_ = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    try {
      const signer = await stageSigner('gig');
      const keptPrivate = () => storedValues().some((v) => String(v).includes(signer!.private));
      expect(keptPrivate()).toBe(true);
      // Offline (the role shown may be stale): nothing is deleted.
      db.offline = true;
      native.prefetchStageKey('gig', false);
      await new Promise((r) => setTimeout(r, 50));
      expect(keptPrivate()).toBe(true);
      // Online, still an admin after all (the role wasn't loaded yet): the pair stays.
      db.offline = false;
      native.prefetchStageKey('gig', false);
      await new Promise((r) => setTimeout(r, 50));
      expect(keptPrivate()).toBe(true);
      db.admin = false;
      db.calls.length = 0;
      native.prefetchStageKey('gig', false);
      await vi.waitFor(() => expect(keptPrivate()).toBe(false));
      // A member who never had a pair isn't asked for one.
      db.calls.length = 0;
      native.prefetchStageKey('gig', false);
      await new Promise((r) => setTimeout(r, 50));
      expect(db.calls).not.toContain('bw_stage_signer');
    } finally {
      native_.mockRestore();
    }
  });

  it("the server's no on the band key is one account's: another account on this phone isn't told no for that gig (Claude round 10 on #288)", async () => {
    db.member = false;
    expect(await native.fetchStageKey('gig')).toEqual({ key: null, denied: true });
    db.offline = true;
    expect(await native.fetchStageKey('gig')).toEqual({ key: null, denied: true });
    native.setStageCacheUser('u2');
    expect(await native.fetchStageKey('gig')).toEqual({ key: null, denied: false });
  });

  it("the server busy for a moment (40001: the band's keys are changing) is asked again, and the pair is made (Claude round 10 on #288)", async () => {
    db.busy = 1;
    const signer = await stageSigner('gig');
    expect(signer).not.toBeNull();
    expect(db.calls.filter((c) => c === 'bw_stage_set_signer')).toHaveLength(2);
  });

  it('still busy after the retries: no pair this time, as offline, and nothing stored (Claude round 10 on #288)', async () => {
    db.busy = 99;
    expect(await stageSigner('gig')).toBeNull();
    expect(db.calls.filter((c) => c === 'bw_stage_set_signer')).toHaveLength(3);
    expect(native.signerRefused('gig')).toBe(false);
  });

  it('overlapping fetches: an older answer arriving last never replaces a newer key (Codex on #288)', async () => {
    db.pair = await generateSigner();
    db.slow = true;
    const first = native.fetchVerifyKey('gig');
    // Rotated meanwhile: a new pair at version 2.
    db.pair = await generateSigner();
    db.version = 2;
    const second = native.fetchVerifyKey('gig');
    // The newer answer lands first, the older one after it.
    db.held[1]();
    await second;
    db.held[0]();
    await first;
    db.slow = false;
    db.offline = true;
    expect(native.keptVerifyKey('gig')).toEqual({ public: db.pair.public, version: 2 });
  });

  it("overlapping signer fetches: an older pair arriving last isn't kept over a newer one (Codex on #288)", async () => {
    const old = await generateSigner();
    db.pair = old;
    db.slow = true;
    const first = stageSigner('gig');
    await vi.waitFor(() => expect(db.held).toHaveLength(1));
    const fresh = await generateSigner();
    db.pair = fresh;
    db.version = 2;
    const second = stageSigner('gig');
    await vi.waitFor(() => expect(db.held).toHaveLength(2));
    db.held[1]();
    expect(await second).toEqual({ ...fresh, version: 2 });
    db.held[0]();
    await first;
    db.slow = false;
    db.offline = true;
    expect(await stageSigner('gig')).toEqual({ ...fresh, version: 2 });
    expect(native.keptVerifyKey('gig')).toEqual({ public: fresh.public, version: 2 });
  });

  it("tells the server's no (not an admin) apart from offline (Claude on #288)", async () => {
    expect(await stageSigner('gig')).not.toBeNull();
    expect(native.signerRefused('gig')).toBe(false);
    db.admin = false;
    expect(await stageSigner('gig')).toBeNull();
    expect(native.signerRefused('gig')).toBe(true);
    // Offline: no answer, nothing changes.
    db.offline = true;
    await stageSigner('gig');
    expect(native.signerRefused('gig')).toBe(true);
    db.offline = false;
    db.admin = true;
    expect(await stageSigner('gig')).not.toBeNull();
    expect(native.signerRefused('gig')).toBe(false);
    db.admin = false;
    await stageSigner('gig');
    clearStageCache();
    expect(native.signerRefused('gig')).toBe(false);
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
      expect(storedKeys().filter((k) => k.startsWith('bw-stage-key:'))).toEqual([]);
      db.gate = null;
      native.setStageCacheUser('u1');
    }
  });
  it('a private key kept for one account is never handed to another on this phone, and goes when another account signs in (Codex on #288)', async () => {
    const signer = await stageSigner('gig');
    expect(signer).not.toBeNull();
    native.setStageCacheUser('u2');
    db.offline = true;
    expect(await stageSigner('gig')).toBeNull();
    expect(await stageVerifyKey('gig')).toBeNull();
    expect(storedValues().some((v) => String(v).includes(signer!.private))).toBe(false);
    // Nor back to the first account later: it was deleted, not hidden.
    native.setStageCacheUser('u1');
    expect(await stageSigner('gig')).toBeNull();
  });

  it('the same account after an app restart (no account known yet in memory) still gets its kept pair offline', async () => {
    const signer = await stageSigner('gig');
    db.offline = true;
    native.setStageCacheUser('u1');
    expect(await stageSigner('gig')).toEqual(signer);
  });

  it('sign-out also empties the imported keys kept in memory (Claude on #288)', async () => {
    const signer = (await stageSigner('gig'))!;
    const data = new Uint8Array([1, 2, 3]);
    await signBytes(signer.private, data);
    const spy = vi.spyOn(crypto.subtle, 'importKey');
    await signBytes(signer.private, data);
    expect(spy).not.toHaveBeenCalled();
    clearStageCache();
    await signBytes(signer.private, data);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
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

  it('the server says the pair is gone (rotated) and making a new one fails: the kept private key goes and is never used, not even offline (Codex on #288)', async () => {
    const old = (await stageSigner('gig'))!;
    db.pair = null;
    db.version = 2;
    db.failSet = true;
    expect(await stageSigner('gig')).toBeNull();
    expect(storedValues().some((v) => String(v).includes(old.private))).toBe(false);
    db.offline = true;
    expect(await stageSigner('gig')).toBeNull();
  });

  it("making a pair that throws (WebCrypto missing or failing) gives no pair, not an error: the admin leads with the band key (Claude on #288)", async () => {
    const spy = vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValueOnce(new Error('NotSupportedError'));
    await expect(stageSigner('gig')).resolves.toBeNull();
    spy.mockRestore();
  });

  it('signed out while a stored pair is being checked: nothing is kept for the old account (Codex on #288)', async () => {
    db.pair = await generateSigner();
    const original = crypto.subtle.importKey.bind(crypto.subtle);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const spy = vi.spyOn(crypto.subtle, 'importKey').mockImplementation((async (...args: Parameters<typeof original>) => {
      await gate;
      return original(...args);
    }) as never);
    const signer = stageSigner('gig');
    await new Promise((r) => setTimeout(r, 20));
    clearStageCache();
    open();
    expect(await signer).toBeNull();
    spy.mockRestore();
    expect(storedKeys().filter((k) => k.startsWith('bw-stage-key:'))).toEqual([]);
  });

  it('a session that ends without the sign-out button (expired, or none at start-up) takes the private keys along (Codex on #288)', async () => {
    const signer = (await stageSigner('gig'))!;
    expect(native.keptVerifyKey('gig')).not.toBeNull();
    clearStageCache();
    expect(storedValues().some((v) => String(v).includes(signer.private))).toBe(false);
    expect(storedKeys().filter((k) => k.startsWith('bw-stage-key:'))).toEqual([]);
    native.setStageCacheUser('u1');
    db.offline = true;
    expect(await stageSigner('gig')).toBeNull();
  });

  it("the signed leaders seen are kept per account and gig across restarts, and go with the account (Claude on #288)", async () => {
    const mem = await import('../stageSignedMemory');
    mem.noteSignedSeen('gig', 1000);
    mem.noteSignedTop('gig', 'leader-a', 42);
    expect(mem.signedMemory('gig')).toEqual({ seen: 1000, tops: { 'leader-a': 42 } });
    expect(mem.signedMemory('gig-2')).toEqual({ seen: 0, tops: {} });
    // An app restart: this run's copy is gone, the stored one is found.
    mem.setSignedMemoryUser(null);
    native.setStageCacheUser('u1');
    expect(mem.signedMemory('gig')).toEqual({ seen: 1000, tops: { 'leader-a': 42 } });
    // A new leader id every opening: only the latest few are kept.
    for (let i = 0; i < mem.SIGNED_TOPS_KEPT + 4; i++) mem.noteSignedTop('gig', `open-${i}`, 100 + i);
    expect(Object.keys(mem.signedMemory('gig').tops)).toHaveLength(mem.SIGNED_TOPS_KEPT);
    expect(mem.signedMemory('gig').tops[`open-${mem.SIGNED_TOPS_KEPT + 3}`]).toBe(100 + mem.SIGNED_TOPS_KEPT + 3);
    // The gig's pack goes: so does this.
    mem.forgetSignedMemory('u1', 'gig');
    expect(mem.signedMemory('gig')).toEqual({ seen: 0, tops: {} });
    // Another account signs in: every kept one goes.
    mem.noteSignedSeen('gig', 2000);
    native.setStageCacheUser('u2');
    expect(mem.signedMemory('gig').seen).toBe(0);
    native.setStageCacheUser('u1');
    expect(mem.signedMemory('gig').seen).toBe(0);
    expect(storedKeys().filter((k) => k.startsWith('bw-stage-key:signed:'))).toEqual([]);
  });
});
