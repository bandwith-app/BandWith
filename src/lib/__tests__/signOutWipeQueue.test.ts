// #296 round 10 (Claude delta review of a2c8d493): the offline queue lives in
// IndexedDB first, and the anonymous / legacy queues are adopted by the next
// account to sign in. The failed-sign-out wipe keeps each account's own queue
// where it is stored, and nothing a bandmate could replay as theirs.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// IndexedDB, as the offline storage sees it (jsdom has none).
const idb = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../offline/storage', () => ({
  KEEP_ON_SIGN_OUT_PREFIXES: ['bw:live_refused:', 'bw:rehearsal_notes_rejected:', 'bw:chat_outbox:'],
  LEGACY_MUTATION_QUEUE_KEY: 'bw_offline_mutation_queue',
  listOfflineKeys: vi.fn(async (prefix: string) => [...idb.keys()].filter((k) => k.startsWith(prefix))),
  getOfflineItem: vi.fn(async (k: string) => (idb.has(k) ? idb.get(k) : null)),
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
  }),
}));
vi.mock('../regiaAudio', () => ({ clearDownloadedAudio: vi.fn(async () => {}) }));

import { wipeAfterFailedSignOut } from '../signOutWipe';

const A = '6f1c2a4e-1111-4a5b-9c3d-aaaaaaaaaaaa';
const edit = (id: string, type = 'update_event') => [{ id, type, timestamp: 1, payload: { id: 'ev1' }, retryCount: 0 }];

describe('#296 round 10: the failed-sign-out wipe and the offline queue', () => {
  beforeEach(() => {
    idb.clear();
    localStorage.clear();
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
});
