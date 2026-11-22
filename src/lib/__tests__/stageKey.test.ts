import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/** The server side of 087/191: the gig's band key, changed when someone may no longer see the gig. */
const db = vi.hoisted(() => ({ key: 'a2V5MQ==' as string | null, offline: false, hang: false, calls: 0 }));

vi.mock('../supabase', () => ({
  isDemoMode: false,
  supabase: {
    rpc: vi.fn(async (fn: string) => {
      db.calls++;
      if (db.offline) throw new TypeError('Failed to fetch');
      if (db.hang) return new Promise(() => {});
      return fn === 'bw_stage_key' ? { data: db.key, error: null } : { data: null, error: null };
    }),
  },
}));
vi.mock('../livePackFiles', () => ({ removeAllPackFiles: async () => {} }));

const { stageKey } = await import('../stageBleNative');

describe('stageKey: the server first, the kept copy offline', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(db, { key: 'a2V5MQ==', offline: false, hang: false, calls: 0 });
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
});
