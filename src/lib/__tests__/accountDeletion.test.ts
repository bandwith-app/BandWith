import { describe, it, expect } from 'vitest';
import { bandsToClean } from '../../../supabase/functions/_shared/account-deletion';

// Audit 02 #1 / 04 #1: if the "which bands still exist" lookup fails after the
// deletion RPC, the files of bands that go on (song files, branding, quote
// PDFs) must not be deleted.
describe('delete-account: whose band files go', () => {
  const mine = ['band-solo', 'band-shared'];

  it('only bands that are really gone', () => {
    expect(bandsToClean(mine, { data: [{ id: 'band-shared' }], error: null })).toEqual(['band-solo']);
  });

  // Codex review #282: a failed lookup must stop the deletion (retry), not
  // skip the cleanup and delete the account anyway.
  it('no answer when the lookup failed (data is null): stop and retry', () => {
    expect(bandsToClean(mine, { data: null, error: { message: 'canceling statement due to statement timeout' } })).toBeNull();
  });

  it('no answer when the lookup returned no rows object at all', () => {
    expect(bandsToClean(mine, { data: null, error: null })).toBeNull();
  });
});

import { storageReady } from '../../../supabase/functions/_shared/account-deletion';

// Audit 02 #2 / 04 #4: a personal file left in Storage blocks the Auth
// deletion after the data is gone; stop before deleting anything instead.
describe('delete-account: storage first', () => {
  it('goes on when no personal file is left', () => {
    expect(storageReady({ released: 3, personal_left: 0 }, null)).toBe(true);
  });
  it('stops when a personal file is still there', () => {
    expect(storageReady({ released: 0, personal_left: 1 }, null)).toBe(false);
  });
  it('stops when the check failed or answered nothing', () => {
    expect(storageReady(null, { message: 'boom' })).toBe(false);
    expect(storageReady({}, null)).toBe(false);
  });
});

import { beginOutcome, removeFolder, type FolderStore } from '../../../supabase/functions/_shared/account-deletion';
import fn from '../../../supabase/functions/delete-account/index.ts?raw';

// A Storage bucket in memory: list() shows one level, 100 entries, sorted.
const bucket = (paths: string[]) => {
  const files = new Set(paths);
  const store: FolderStore = {
    async list(prefix) {
      const seen = new Map<string, boolean>();
      for (const f of [...files].sort()) {
        if (!f.startsWith(prefix + '/')) continue;
        const rest = f.slice(prefix.length + 1);
        const [head, ...more] = rest.split('/');
        if (!seen.has(head)) seen.set(head, more.length === 0);
      }
      return { data: [...seen].slice(0, 100).map(([name, isFile]) => ({ name, id: isFile ? `id-${name}` : null })), error: null };
    },
    async remove(ps) {
      ps.forEach((p) => files.delete(p));
      return { error: null };
    },
  };
  return { store, files };
};

describe('delete-account: Codex review #282', () => {
  it('removes attachments of more than 100 songs', async () => {
    const paths = Array.from({ length: 101 }, (_, i) => `u1/song-${String(i).padStart(3, '0')}/take.m4a`);
    const { store, files } = bucket([...paths, 'u2/song-1/keep.m4a']);
    expect(await removeFolder(store, 'u1')).toBe(true);
    expect([...files]).toEqual(['u2/song-1/keep.m4a']);
  });

  it('reports a folder it could not empty', async () => {
    const { store } = bucket(['u1/a.m4a']);
    const stuck: FolderStore = { list: store.list, remove: async () => ({ error: { message: 'denied' } }) };
    expect(await removeFolder(stuck, 'u1')).toBe(false);
    const failing: FolderStore = { list: async () => ({ data: null, error: { message: 'timeout' } }), remove: store.remove };
    expect(await removeFolder(failing, 'u1')).toBe(false);
  });

  it('reads the begin answer', () => {
    expect(beginOutcome({ ok: true, band_ids: ['b1'] }, null)).toEqual({ kind: 'ok', bandIds: ['b1'] });
    expect(beginOutcome({ ok: false, bands: ['Hudson Horns'] }, null)).toEqual({ kind: 'blocked', bands: ['Hudson Horns'] });
    expect(beginOutcome(null, { message: 'missing' })).toEqual({ kind: 'not_ready' });
  });

  it('the function: band check held before any file goes, nothing skipped', () => {
    const begin = fn.indexOf("rpc('bw_account_deletion_begin'");
    const firstRemove = fn.indexOf('removeFolder(');
    expect(begin).toBeGreaterThan(0);
    expect(begin).toBeLessThan(firstRemove);
    // Avatars go through removeFolder and the SQL readiness count (180).
    expect(fn).toMatch(/removeFolder\(bucketStore\(admin, "avatars"\), caller\.id\)/);
    // A failed band lookup or band cleanup stops before Auth deletes the user.
    expect(fn).toMatch(/if \(toClean === null\) return notReady\(/);
    expect(fn).toMatch(/if \(!cleaned\) return notReady\(/);
    expect(fn).not.toMatch(/async function removeFolder/);
  });
});
