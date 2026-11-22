import { describe, it, expect, vi, beforeEach } from 'vitest';

// The app's client, caches and Stage keys, for the hook's device clear (F2).
const h = vi.hoisted(() => ({
  signOut: vi.fn(async () => {
    throw new Error('_removeSession failed');
  }),
  removeItem: vi.fn(async (k: string) => {
    localStorage.removeItem(k);
  }),
  clearOfflineCache: vi.fn(async () => {}),
  clearStageCache: vi.fn(() => {}),
}));
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      signOut: h.signOut,
      getSession: async () => ({ data: { session: null } }),
      storage: { removeItem: h.removeItem },
      storageKey: 'sb-test-auth-token',
    },
  },
}));
vi.mock('../offline/storage', () => ({ clearOfflineCache: h.clearOfflineCache }));
vi.mock('../stageBleNative', () => ({ clearStageCache: h.clearStageCache }));

import * as signOutOnDeletion from '../deletionSignOut';
import { clearThisDevice } from '../useDeletionSignOut';
import * as gate from '../../../supabase/functions/_shared/deletion-gate';
import { removeObjects, type ObjectServer, type RemoveEntry } from '../../../supabase/functions/_shared/account-deletion';
import sendPush from '../../../supabase/functions/send-push/index.ts?raw';
import mig180 from '../../../supabase/migrations/180_account_deletion_safety.sql?raw';

// Claude r10 F1: the push's actors as 180's trigger reads them.
describe('round 11: send-push rechecks every actor', () => {
  // committed: ids with a committed deletion; profiles: ids that still exist.
  const admin = (committed: string[], profiles: string[]) => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_c: string, v: string) => ({
          not: () => ({
            maybeSingle: async () => ({ data: table === 'account_deletions_pending' && committed.includes(v) ? { user_id: v } : null, error: null }),
          }),
          maybeSingle: async () => ({ data: table === 'profiles' && profiles.includes(v) ? { id: v } : null, error: null }),
        }),
      }),
    }),
  });

  it("a suggestion author (by) being deleted: no push", async () => {
    expect(await gate.pushActorBeingDeleted(admin(['author'], ['me', 'author']), { sender: 'me', by: 'author' })).toBe(true);
  });

  it('by counts only when committed; a live sender and author push', async () => {
    expect(await gate.pushActorBeingDeleted(admin([], ['me']), { sender: 'me', by: 'not-a-profile' })).toBe(false);
    expect(await gate.pushActorBeingDeleted(admin([], ['me', 'author']), { sender: 'me', by: 'author' })).toBe(false);
    expect(await gate.pushActorBeingDeleted(admin(['me'], ['me']), { sender: 'me', by: null })).toBe(true);
  });

  it('F3: no early return; the push runs on with no device, so claims settle as for no device', () => {
    const at = sendPush.indexOf('pushActorBeingDeleted(supabase');
    const block = sendPush.slice(at, sendPush.indexOf('const tokenUserIds', at));
    expect(block).toMatch(/tokens\.splice\(0, tokens\.length\);/);
    expect(block).not.toMatch(/return new Response/);
  });

  it("a user call's sender is the caller, never the sender_id it sent", () => {
    expect(sendPush).toMatch(/const pushSender = caller\.kind === 'user' \? caller\.id : \(data\?\.sender_id \|\| data\?\.senderId \|\| null\);/);
    expect(sendPush).toMatch(/pushActorBeingDeleted\(supabase, \{ sender: pushSender, by: data\?\.by \?\? null \}\)/);
  });
});

// Claude r10 F2: a sign-out that fails still leaves this device signed out.
describe('round 11: the failed path clears the device and reloads', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('clearDeviceSession removes the stored session even when the local sign-out throws, then the caches', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('sb-x-auth-token', '{"access_token":"a"}');
    localStorage.setItem('sb-x-auth-token-code-verifier', 'v');
    const removed: string[] = [];
    const calls: string[] = [];
    await signOutOnDeletion.clearDeviceSession({
      signOutLocal: async () => {
        throw new Error('_removeSession failed');
      },
      sessionStore: { key: 'sb-x-auth-token', removeItem: (k) => void removed.push(k) },
      clearOfflineCache: async () => void calls.push('offline'),
      clearStageCache: () => void calls.push('stage'),
    });
    expect(removed).toEqual(['sb-x-auth-token', 'sb-x-auth-token-code-verifier', 'sb-x-auth-token-user']);
    expect(localStorage.getItem('sb-x-auth-token')).toBeNull();
    expect(localStorage.getItem('sb-x-auth-token-code-verifier')).toBeNull();
    expect(calls).toEqual(['offline', 'stage']);
    warn.mockRestore();
  });

  it("the app's device clear: session key, offline cache and Stage cache", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('sb-test-auth-token', '{"access_token":"a"}');
    await clearThisDevice();
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(localStorage.getItem('sb-test-auth-token')).toBeNull();
    expect(h.clearOfflineCache).toHaveBeenCalledTimes(1);
    expect(h.clearStageCache).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a handler that throws: cleared, then reloaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls: string[] = [];
    const off = signOutOnDeletion.onAccountBeingDeleted(
      async () => {
        throw new Error('sign-out failed');
      },
      async () => void calls.push('clear'),
      () => void calls.push('reload'),
    );
    await signOutOnDeletion.signOutDeletingAccount('user-a');
    expect(calls).toEqual(['clear', 'reload']);
    off();
    warn.mockRestore();
  });

  it('a sign-out answering an error: the same clear, then reloaded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('sb-test-auth-token', '{"access_token":"a"}');
    const calls: string[] = [];
    const r = await signOutOnDeletion.deletionSignOutStep('user-a', {
      currentUser: async () => ({ id: 'user-a', email: null }),
      forgetQuickSignIn: async () => {},
      signOut: async () => ({ error: new Error('offline') }),
      clearLocal: clearThisDevice,
      reload: () => void calls.push('reload'),
    });
    expect(r).toBe('failed');
    expect(localStorage.getItem('sb-test-auth-token')).toBeNull();
    expect(h.clearOfflineCache).toHaveBeenCalledTimes(1);
    expect(h.clearStageCache).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['reload']);
    warn.mockRestore();
  });
});

// Claude r10 F6: remove() by name deletes only the current row; old
// versions and delete markers are purged by version.
describe('round 11: old versions are purged by version', () => {
  const server = (versions: { data: unknown; error: unknown }[], removeError: unknown = null) => {
    const removed: RemoveEntry[][] = [];
    let page = 0;
    let vpage = 0;
    const s: ObjectServer = {
      rpc: async (fn) => {
        if (fn === 'bw_account_storage_names') return { data: page++ === 0 ? ['u/live.m4a'] : [], error: null };
        if (fn === 'bw_account_storage_versions') return versions[vpage++] ?? { data: [], error: null };
        return { data: null, error: { message: 'unknown' } };
      },
      store: () => ({
        remove: async (paths) => {
          removed.push(paths);
          return { error: typeof paths[0] === 'object' ? removeError : null };
        },
      }),
    };
    return { s, removed };
  };

  it('the files by name, their archived versions and markers by { path, versionId }', async () => {
    const { s, removed } = server([{ data: [{ name: 'u/live.m4a', version: 'v0' }, { name: 'u/old.m4a', version: 'v-old' }], error: null }]);
    expect(await removeObjects(s, 'personal-files', 'u')).toBe(true);
    expect(removed).toEqual([
      ['u/live.m4a'],
      [{ path: 'u/live.m4a', versionId: 'v0' }, { path: 'u/old.m4a', versionId: 'v-old' }],
    ]);
    // A name with only archived rows is never removed by name.
    expect(removed.flat().filter((e) => typeof e === 'string')).not.toContain('u/old.m4a');
  });

  it('an older 180 without the listing: nothing to purge; a failed purge is not ready', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await removeObjects(server([{ data: null, error: { code: 'PGRST202' } }]).s, 'avatars', 'u')).toBe(true);
    expect(await removeObjects(server([{ data: [{ name: 'u/a', version: 'v' }], error: null }], { message: 'denied' }).s, 'avatars', 'u')).toBe(false);
    warn.mockRestore();
  });
});

// Claude r10 F5: one wording for the guarded tables.
describe('round 11: the author-column count, said once', () => {
  it('rehearsal_polls is among the 14, never "plus"', () => {
    expect(mig180).not.toMatch(/plus rehearsal_polls/);
    expect(mig180.match(/14 on prod, rehearsal_polls among them/g)?.length).toBe(2);
  });
});
