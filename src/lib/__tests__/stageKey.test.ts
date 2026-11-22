import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/** The server side of 087/191: the gig's band key, changed when someone may no longer see the gig. */
const db = vi.hoisted(() => ({
  key: 'a2V5MQ==' as string | null,
  offline: false,
  hang: false,
  calls: 0,
  /** Answers held back until the test releases them (a slow network). */
  slow: false,
  held: [] as Array<() => void>,
}));

vi.mock('../supabase', () => ({
  isDemoMode: false,
  supabase: {
    rpc: vi.fn(async (fn: string) => {
      db.calls++;
      if (db.offline) throw new TypeError('Failed to fetch');
      if (db.hang) return new Promise(() => {});
      const answer = fn === 'bw_stage_key' ? { data: db.key, error: null } : { data: null, error: null };
      if (db.slow) return new Promise((resolve) => db.held.push(() => resolve(answer)));
      return answer;
    }),
  },
}));
vi.mock('../livePackFiles', () => ({ removeAllPackFiles: async () => {} }));

const { stageKey, fetchStageKey, clearStageCache, previousStageKey } = await import('../stageBleNative');

describe('stageKey: the server first, the kept copy offline', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(db, { key: 'a2V5MQ==', offline: false, hang: false, calls: 0, slow: false, held: [] });
  });
  afterEach(() => vi.useRealTimers());

  it('a key changed on the server (191) replaces the kept one', async () => {
    expect(await stageKey('e1')).toBe('a2V5MQ==');
    db.key = 'a2V5Mg==';
    expect(await stageKey('e1')).toBe('a2V5Mg==');
    // Kept for offline too.
    db.offline = true;
    expect(await stageKey('e1')).toBe('a2V5Mg==');
  });

  it('keeps the key it replaced for the gig day (Claude on #283: phones that missed the change still link, signed only)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    expect(previousStageKey('e1')).toBeNull();
    expect(await stageKey('e1')).toBe('a2V5MQ==');
    // Same key again: nothing replaced.
    expect(await stageKey('e1')).toBe('a2V5MQ==');
    expect(previousStageKey('e1')).toBeNull();
    db.key = 'a2V5Mg==';
    expect(await stageKey('e1')).toBe('a2V5Mg==');
    expect(previousStageKey('e1')).toBe('a2V5MQ==');
    expect(previousStageKey('e2')).toBeNull();
    // Gone after the gig day.
    vi.advanceTimersByTime(36 * 3600_000 + 1);
    expect(previousStageKey('e1')).toBeNull();
  });

  it('a no from the server, or sign-out, also drops the replaced key', async () => {
    expect(await stageKey('e1')).toBe('a2V5MQ==');
    db.key = 'a2V5Mg==';
    await stageKey('e1');
    expect(previousStageKey('e1')).toBe('a2V5MQ==');
    db.key = null;
    await stageKey('e1');
    expect(previousStageKey('e1')).toBeNull();
    db.key = 'a2V5Mw==';
    await stageKey('e1');
    db.key = 'a2V5NA==';
    await stageKey('e1');
    expect(previousStageKey('e1')).toBe('a2V5Mw==');
    clearStageCache();
    expect(previousStageKey('e1')).toBeNull();
  });

  it('a no from the server (no longer sees the gig) deletes the kept key', async () => {
    expect(await stageKey('e1')).toBe('a2V5MQ==');
    db.key = null;
    expect(await stageKey('e1')).toBeNull();
    db.offline = true;
    expect(await stageKey('e1')).toBeNull();
  });

  it('a hung network falls back to the kept copy in a few seconds', async () => {
    expect(await stageKey('e1')).toBe('a2V5MQ==');
    vi.useFakeTimers();
    db.hang = true;
    const answer = stageKey('e1');
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await answer).toBe('a2V5MQ==');
  });

  it('an answer after the timeout still fills the kept copy (Codex on #283)', async () => {
    expect(await stageKey('e1')).toBe('a2V5MQ==');
    vi.useFakeTimers();
    Object.assign(db, { slow: true, key: 'a2V5Mg==' });
    const answer = stageKey('e1');
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await answer).toBe('a2V5MQ==');
    const heard: string[] = [];
    const onKey = (e: Event) => heard.push((e as CustomEvent<string>).detail);
    window.addEventListener('bw:stage-key', onKey);
    db.held.forEach((go) => go());
    await vi.advanceTimersByTimeAsync(0);
    window.removeEventListener('bw:stage-key', onKey);
    // Stage hears of it, and starts with it (a first fetch answered late: Codex on 642676fc).
    expect(heard).toEqual(['e1']);
    db.offline = true;
    expect(await stageKey('e1')).toBe('a2V5Mg==');
  });

  it('a late answer after sign-out, or one older than an answer already kept, writes nothing', async () => {
    expect(await stageKey('e1')).toBe('a2V5MQ==');
    vi.useFakeTimers();
    Object.assign(db, { slow: true, key: 'b2xk' });
    const late = stageKey('e1');
    await vi.advanceTimersByTimeAsync(4_000);
    await late;
    clearStageCache();
    db.held.splice(0).forEach((go) => go());
    await vi.advanceTimersByTimeAsync(0);
    expect(localStorage.getItem('bw-stage-key:e1')).toBeNull();

    // An older ask answered after a newer one.
    const older = stageKey('e1');
    await vi.advanceTimersByTimeAsync(4_000);
    await older;
    const releaseOlder = db.held.splice(0);
    Object.assign(db, { slow: false, key: 'bmV3' });
    expect(await stageKey('e1')).toBe('bmV3');
    releaseOlder.forEach((go) => go());
    await vi.advanceTimersByTimeAsync(0);
    expect(localStorage.getItem('bw-stage-key:e1')).toBe('bmV3');
  });

  it('an older ask answered after a newer one returns the kept (newer) key, not its own (Claude on #283)', async () => {
    Object.assign(db, { slow: true, key: 'b2xk' });
    const older = fetchStageKey('e1');
    await Promise.resolve();
    const releaseOlder = db.held.splice(0);
    Object.assign(db, { slow: false, key: 'bmV3' });
    expect((await fetchStageKey('e1')).key).toBe('bmV3');
    releaseOlder.forEach((go) => go());
    // Within the wait: the caller gets what is kept, never the stale key (the pack keeps what it's told).
    expect(await older).toEqual({ key: 'bmV3', denied: false });
    expect(localStorage.getItem('bw-stage-key:e1')).toBe('bmV3');
  });

  it("an older ask's no, answered after a newer key was kept, is not a no: the kept key comes back (Claude round 8 on #283)", async () => {
    Object.assign(db, { slow: true, key: null });
    const older = fetchStageKey('e1');
    await Promise.resolve();
    const releaseOlder = db.held.splice(0);
    Object.assign(db, { slow: false, key: 'bmV3' });
    expect((await fetchStageKey('e1')).key).toBe('bmV3');
    releaseOlder.forEach((go) => go());
    expect(await older).toEqual({ key: 'bmV3', denied: false });
    expect(localStorage.getItem('bw-stage-key:e1')).toBe('bmV3');
  });

  it("tells a no from the server apart from no answer (Claude on #283: the live pack doesn't keep a refused key)", async () => {
    expect(await fetchStageKey('e1')).toEqual({ key: 'a2V5MQ==', denied: false });
    db.offline = true;
    expect(await fetchStageKey('e1')).toEqual({ key: 'a2V5MQ==', denied: false });
    db.offline = false;
    db.key = null;
    expect(await fetchStageKey('e1')).toEqual({ key: null, denied: true });
  });
});
