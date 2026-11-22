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
// Round 5: everything after the commit lives in finishCommitted.
import shared from '../../../supabase/functions/_shared/account-deletion.ts?raw';
const finishSrc = shared.slice(shared.indexOf('export async function finishCommitted'));

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
    const firstRemove = fn.indexOf('finishCommitted(deletionServer(admin), caller.id');
    expect(begin).toBeGreaterThan(0);
    expect(begin).toBeLessThan(firstRemove);
    // Avatars go through removeFolder and the SQL readiness count (180).
    expect(finishSrc).toMatch(/removeFolder\(server\.store\('avatars'\), uid\)/);
    // A failed band lookup or band cleanup stops before Auth deletes the user.
    expect(finishSrc).toMatch(/if \(toClean === null\) return notReady\(/);
    expect(finishSrc).toMatch(/if \(!cleaned\) return notReady\(/);
    expect(fn).not.toMatch(/async function removeFolder/);
  });
});

import * as deletion from '../../../supabase/functions/_shared/account-deletion';

// Codex review #282, round 2.
describe('delete-account: round 2', () => {
  // B5: older builds saved quote PDFs to avatars/quotes/<bandId>/ when the
  // quotes bucket failed. A band that goes with the account loses those too.
  it("cleans every folder of a band that goes, old quote PDFs in avatars too", () => {
    const folders = (deletion as any).bandFolders?.('b1');
    expect(folders).toEqual(expect.arrayContaining([
      { bucket: 'song-files', prefix: 'b1' },
      { bucket: 'band-branding', prefix: 'b1' },
      { bucket: 'quotes', prefix: 'quotes/b1' },
      { bucket: 'avatars', prefix: 'quotes/b1' },
    ]));
  });

  it('the function cleans the folders bandFolders lists', () => {
    expect(finishSrc).toMatch(/for \(const \{ bucket, prefix \} of bandFolders\(bandId\)\)/);
  });

  // Coordinator (Claude review): prepare refusing must answer 409 with the
  // bands, not a generic error.
  it('reads the prepare answer', () => {
    const prepareOutcome = (deletion as any).prepareOutcome;
    expect(prepareOutcome?.(null)).toEqual({ kind: 'ok' });
    expect(prepareOutcome?.({ message: 'account_has_bands', code: 'P0001' })).toEqual({ kind: 'blocked' });
    expect(prepareOutcome?.({ message: 'canceling statement due to statement timeout' })).toEqual({ kind: 'error' });
  });

  it('the function answers 409 when prepare refuses', () => {
    expect(fn).toMatch(/prepare\.kind === "blocked"[\s\S]{0,400}409/);
  });

  // Everyone else in a band deleting at once: wait, never a generic 500.
  it('reads a begin that waits for another deletion', () => {
    expect(beginOutcome({ ok: false, code: 'deletion_in_progress', bands: [] } as any, null)).toEqual({ kind: 'busy' });
    expect(fn).toMatch(/begin\.kind === "busy"[\s\S]{0,200}409/);
  });
});

import chatsSource from '../services/chats.ts?raw';
import settingsSource from '../../app/views/SettingsView.tsx?raw';
import itDict from '../i18n/locales/it';
import esDict from '../i18n/locales/es';
import frDict from '../i18n/locales/fr';
import deDict from '../i18n/locales/de';
import ptDict from '../i18n/locales/pt';

// Codex review #282, round 3.
describe('delete-account: round 3', () => {
  // B2: a direct message sent from another device while prepare ran is
  // handled once more right before Auth deletes the user.
  it('the function runs the last message step right before Auth', () => {
    const finish = finishSrc.indexOf("rpc('bw_account_deletion_finish'");
    const auth = finishSrc.indexOf('server.deleteUser(uid)');
    expect(finish).toBeGreaterThan(0);
    expect(finish).toBeLessThan(auth);
    expect(finishSrc).toMatch(/bw_account_deletion_finish'[\s\S]{0,200}return notReady\('finish'/);
  });

  // MINOR 2: a former member's message (sender NULL) counts as unread.
  it("the chat list counts a former member's messages as unread", () => {
    const unread = chatsSource.slice(chatsSource.indexOf('let unreadQuery'), chatsSource.indexOf('let unreadQuery') + 300);
    expect(unread).not.toMatch(/\.neq\('sender_id', user\.id\)/);
    expect(unread).toMatch(/\.or\(`sender_id\.is\.null,sender_id\.neq\.\$\{user\.id\}`\)/);
  });

  // B3: the confirmation says what really goes and what stays.
  it('the confirmation says direct messages go and band and gig messages stay', () => {
    // Round 4 (Claude review): group chats stay too.
    const key = "This can't be undone. Your profile, personal gigs and direct messages will be deleted. Your messages in band, gig and group chats stay, shown as from a former member.";
    expect(settingsSource).toContain(`t(${JSON.stringify(key)})`);
    expect(settingsSource).not.toContain("personal gigs and messages will be deleted.\")");
    for (const [lang, dict] of Object.entries({ it: itDict, es: esDict, fr: frDict, de: deDict, pt: ptDict })) {
      expect(dict[key], lang).toBeTruthy();
    }
  });
});

// Claude review #282, round 4.
describe('delete-account: round 4', () => {
  // A retry after prepare must not stop at the old band check before begin:
  // begin is the band check, and it answers "prepared" on a retry.
  it('the function asks begin first (no separate band check before it)', () => {
    const begin = fn.indexOf("rpc('bw_account_deletion_begin'");
    const blockers = fn.indexOf('"bw_account_deletion_blockers"');
    expect(begin).toBeGreaterThan(0);
    expect(blockers === -1 || blockers > begin).toBe(true);
  });

  // A deadlock aborts the whole RPC transaction (rolled back), so the
  // function tries it once more.
  it('retries an RPC once on a deadlock', async () => {
    const retryOnDeadlock = (deletion as any).retryOnDeadlock;
    expect(typeof retryOnDeadlock).toBe('function');
    const answers = [{ data: null, error: { code: '40P01', message: 'deadlock detected' } }, { data: 1, error: null }];
    let calls = 0;
    expect(await retryOnDeadlock(async () => answers[calls++])).toEqual({ data: 1, error: null });
    expect(calls).toBe(2);
    calls = 0;
    const other = await retryOnDeadlock(async () => { calls++; return { data: null, error: { code: '57014' } }; });
    expect(calls).toBe(1);
    expect(other.error.code).toBe('57014');
    calls = 0;
    const twice = await retryOnDeadlock(async () => { calls++; return { data: null, error: { code: '40P01' } }; });
    expect(calls).toBe(2);
    expect(twice.error.code).toBe('40P01');
  });

  it('the function retries begin, storage release, prepare and the last step', () => {
    for (const name of ['bw_account_deletion_begin', 'bw_prepare_account_deletion']) {
      expect(fn, name).toMatch(new RegExp(`retryOnDeadlock\\(\\(\\) => admin\\.rpc\\(["']${name}["']`));
    }
    for (const name of ['bw_account_storage_release', 'bw_account_deletion_finish']) {
      expect(finishSrc, name).toMatch(new RegExp(`retryOnDeadlock\\(\\(\\) => server\\.rpc\\(["']${name}["']`));
    }
  });
});

// Codex and Claude reviews #282, round 4 (second part).
describe('delete-account: round 4, files and texts', () => {
  // B3: another device can upload after the storage step: the personal
  // folders are emptied again right before the last step, which re-checks.
  it('empties the personal folders again right before the last step', () => {
    const bandFiles = finishSrc.indexOf('bandFolders(bandId)');
    const finish = finishSrc.indexOf("'bw_account_deletion_finish'");
    const between = finishSrc.slice(bandFiles, finish);
    expect(between).toMatch(/removeFolder\(server\.store\('personal-files'\), uid\)/);
    expect(between).toMatch(/removeFolder\(server\.store\('avatars'\), uid\)/);
  });

  it('the busy answer is readable for older builds', () => {
    expect(fn).toMatch(/code: "account_deletion_in_progress", error: "A bandmate is deleting their account\. Try again in a few minutes\."/);
  });

  it('the Settings description counts group chats among the ones that stay', () => {
    const key = 'Permanently removes your profile, personal gigs and direct messages. Your messages in band, gig and group chats stay, shown as from a former member. If you are the only admin of a band with other members, make someone else admin first; bands where you are alone are deleted with your account.';
    expect(settingsSource).toContain(`t('${key}')`);
    for (const [lang, dict] of Object.entries({ it: itDict, es: esDict, fr: frDict, de: deDict, pt: ptDict })) {
      expect(dict[key], lang).toBeTruthy();
    }
  });
});
