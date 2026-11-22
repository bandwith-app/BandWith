// #296 round 10 (Claude delta review of a2c8d493): the offline queue lives in
// IndexedDB first, and the anonymous / legacy queues are adopted by the next
// account to sign in. The failed-sign-out wipe keeps each account's own queue
// where it is stored, and nothing a bandmate could replay as theirs.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// IndexedDB, as the offline storage sees it (jsdom has none).
const idb = vi.hoisted(() => new Map<string, unknown>());
// Round 11: a read that takes this long (ms, per key), a clear that takes this long.
const slow = vi.hoisted(() => ({ read: new Map<string, number>(), clearMs: 0 }));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const events = vi.hoisted(() => ({ updateMs: 0, updated: [] as string[] }));
vi.mock('@/lib/services/events', () => ({
  updateEvent: vi.fn(async (id: string) => {
    await new Promise((r) => setTimeout(r, events.updateMs));
    events.updated.push(id);
    return { error: null };
  }),
}));
vi.mock('../offline/storage', () => ({
  KEEP_ON_SIGN_OUT_PREFIXES: ['bw:live_refused:', 'bw:rehearsal_notes_rejected:', 'bw:chat_outbox:'],
  LEGACY_MUTATION_QUEUE_KEY: 'bw_offline_mutation_queue',
  listOfflineKeys: vi.fn(async (prefix: string) => [...idb.keys()].filter((k) => k.startsWith(prefix))),
  getOfflineItem: vi.fn(async (k: string) => {
    const ms = slow.read.get(k);
    if (ms) await new Promise((r) => setTimeout(r, ms));
    return idb.has(k) ? idb.get(k) : null;
  }),
  setOfflineItem: vi.fn(async (k: string, v: unknown) => {
    idb.set(k, v);
  }),
  removeOfflineItem: vi.fn(async (k: string) => {
    idb.delete(k);
  }),
  // As the real one: the legacy queue and every bw: entry, in IndexedDB and localStorage.
  clearOfflineCache: vi.fn(async () => {
    idb.delete('bw_offline_mutation_queue');
    for (const k of [...idb.keys()]) if (k.startsWith('bw:')) idb.delete(k);
    const ls = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '');
    localStorage.removeItem('bw_offline_mutation_queue');
    for (const k of ls) if (k.startsWith('bw:')) localStorage.removeItem(k);
    // Removed at once, done later (IndexedDB transactions).
    if (slow.clearMs) await new Promise((r) => setTimeout(r, slow.clearMs));
  }),
}));
vi.mock('../regiaAudio', () => ({ clearDownloadedAudio: vi.fn(async () => {}) }));

import { wipeAfterFailedSignOut } from '../signOutWipe';
import { processSyncQueue, setOfflineQueueUser, withOfflineQueuesHeld } from '../offline/syncQueue';

const A = '6f1c2a4e-1111-4a5b-9c3d-aaaaaaaaaaaa';
const edit = (id: string, type = 'update_event') => [{ id, type, timestamp: 1, payload: { eventId: 'ev1', updates: { title: 'Late set' } }, retryCount: 0 }];

describe('#296 round 10: the failed-sign-out wipe and the offline queue', () => {
  beforeEach(() => {
    idb.clear();
    localStorage.clear();
    slow.read.clear();
    slow.clearMs = 0;
    events.updateMs = 0;
    events.updated.length = 0;
  });

  it("A's unsent edits in IndexedDB stay for A's next sign-in; the read caches go", async () => {
    idb.set(`bw:offline_queue:${A}`, edit('m1'));
    idb.set(`bw:${A}:band:quotes`, { cached: true });
    await wipeAfterFailedSignOut();
    expect(idb.get(`bw:offline_queue:${A}`)).toEqual(edit('m1'));
    expect(idb.has(`bw:${A}:band:quotes`)).toBe(false);
  });

  it('the anonymous and legacy queues go, in IndexedDB and in localStorage: the next account would adopt them', async () => {
    idb.set('bw:offline_queue:anonymous', edit('m2', 'delete_event'));
    idb.set('bw_offline_mutation_queue', edit('m3'));
    localStorage.setItem('bw:offline_queue:anonymous', JSON.stringify(edit('m4', 'delete_event')));
    localStorage.setItem('bw:offline_queue:', JSON.stringify(edit('m5')));
    localStorage.setItem('bw_offline_mutation_queue', JSON.stringify(edit('m6')));
    localStorage.setItem(`bw:offline_queue:${A}`, JSON.stringify(edit('m7')));
    await wipeAfterFailedSignOut();
    expect([...idb.keys()].filter((k) => k !== `bw:offline_queue:${A}`)).toEqual([]);
    expect(localStorage.getItem('bw:offline_queue:anonymous')).toBeNull();
    expect(localStorage.getItem('bw:offline_queue:')).toBeNull();
    expect(localStorage.getItem('bw_offline_mutation_queue')).toBeNull();
    expect(localStorage.getItem(`bw:offline_queue:${A}`)).toBe(JSON.stringify(edit('m7')));
  });

  it('round 11: a slow read of one queue never loses the queues: both stay, both are written back', async () => {
    const B = '6f1c2a4e-2222-4a5b-9c3d-bbbbbbbbbbbb';
    idb.set(`bw:offline_queue:${A}`, edit('a1'));
    idb.set(`bw:offline_queue:${B}`, edit('b1'));
    slow.read.set(`bw:offline_queue:${B}`, 3500);
    await wipeAfterFailedSignOut();
    expect(idb.get(`bw:offline_queue:${A}`)).toEqual(edit('a1'));
    expect(idb.get(`bw:offline_queue:${B}`)).toEqual(edit('b1'));
  }, 15_000);

  it('round 11: a queue that can’t be read is reported; the ones read are still kept', async () => {
    const B = '6f1c2a4e-2222-4a5b-9c3d-bbbbbbbbbbbb';
    idb.set(`bw:offline_queue:${A}`, edit('a1'));
    idb.set(`bw:offline_queue:${B}`, edit('b1'));
    const storage = await import('../offline/storage');
    vi.mocked(storage.getOfflineItem).mockImplementationOnce(async (k: string) => idb.get(k) as never).mockRejectedValueOnce(new Error('read failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await wipeAfterFailedSignOut();
    expect(idb.get(`bw:offline_queue:${A}`)).toEqual(edit('a1'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not read'), expect.any(Error));
    warn.mockRestore();
  });

  it('round 11: a mutation a sync pass sends during the wipe never comes back', async () => {
    setOfflineQueueUser(A);
    idb.set(`bw:offline_queue:${A}`, edit('m1'));
    // The pass sends m1 while the wipe runs; the clear takes a while.
    events.updateMs = 300;
    slow.clearMs = 600;
    const pass = processSyncQueue();
    await wait(20);
    await wipeAfterFailedSignOut();
    await pass;
    expect(events.updated).toEqual(['ev1']);
    expect(((idb.get(`bw:offline_queue:${A}`) as { id: string }[] | undefined) ?? []).map((m) => m.id)).toEqual([]);
  });

  it('round 12: a pass that outlives both waits reconciles on the queue written back: what it sent goes', async () => {
    const key = `bw:offline_queue:${A}`;
    const ids = () => ((idb.get(key) as { id: string }[] | undefined) ?? []).map((m) => m.id);
    setOfflineQueueUser(A);
    idb.set(key, edit('m1'));
    // The update takes longer than the 50 ms the hold waits, before and after.
    events.updateMs = 400;
    const pass = processSyncQueue();
    await wait(20);
    // As the wipe: read, clear, write back.
    await withOfflineQueuesHeld(async () => {
      const read = idb.get(key);
      idb.delete(key);
      await wait(10);
      idb.set(key, read);
    }, 50);
    // The hold is over, the pass is not: m1 is still being sent and is back in the queue.
    expect(events.updated).toEqual([]);
    expect(ids()).toEqual(['m1']);
    const result = await pass;
    expect(events.updated).toEqual(['ev1']);
    expect(result.synced).toBe(1);
    expect(ids()).toEqual([]);
  });
});
