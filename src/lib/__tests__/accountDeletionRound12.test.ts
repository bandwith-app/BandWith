import { describe, it, expect, vi } from 'vitest';
import * as deletion from '../../../supabase/functions/_shared/account-deletion';
import { clearDeviceSession } from '../deletionSignOut';

// Round 14 (main, Claude r11 1): no version purge (storage-js remove() has
// no versionId). Archived versions and delete markers left for the account
// are logged, never deleted, and never stop the deletion.
describe('round 14: archived versions are reported, not purged', () => {
  it('archived rows give the warning, and the deletion still finishes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const removed: unknown[][] = [];
    const calls: string[] = [];
    const files: Record<string, Set<string>> = {
      'personal-files': new Set(['u1/take.m4a']),
      avatars: new Set(['u1/me.png']),
      'song-files': new Set(['solo/chart.pdf']),
      'band-branding': new Set(),
      quotes: new Set(),
    };
    const s: deletion.DeletionServer = {
      rpc: async (name, args) => {
        calls.push(name);
        if (name === 'bw_account_storage_names') {
          const b = files[String(args.p_bucket)] ?? new Set<string>();
          const after = (args.p_after as string | null) ?? '';
          return { data: [...b].filter((n) => n.startsWith(`${args.p_prefix}/`) && n > after).sort(), error: null };
        }
        if (name === 'bw_account_storage_versions') {
          // One page (keyset: nothing after the last row).
          return args.p_bucket === 'personal-files' && !args.p_after_name
            ? { data: [{ name: 'u1/old.m4a', version: 'v0' }, { name: 'u1/old.m4a', version: 'v1' }], error: null }
            : { data: [], error: null };
        }
        if (name === 'bw_account_storage_release') {
          return { data: { released: 0, personal_left: files['personal-files'].size + files.avatars.size }, error: null };
        }
        return { data: null, error: null };
      },
      store: (bucket) => ({
        remove: async (paths) => {
          removed.push(paths);
          for (const p of paths) files[bucket].delete(p);
          return { error: null };
        },
      }),
      pendingBandIds: async () => ({ data: { band_ids: ['solo'] }, error: null }),
      bandsStillThere: async () => ({ data: [], error: null }),
      deleteUser: async () => {
        calls.push('deleteUser');
        return { error: null };
      },
    };
    expect(await deletion.finishCommitted(s, 'u1', [])).toEqual({ kind: 'done' });
    expect(calls).toContain('deleteUser');
    expect(Object.values(files).every((b) => b.size === 0)).toBe(true);
    // Only names go to remove(), never a { path, versionId }.
    expect(removed.flat().every((p) => typeof p === 'string')).toBe(true);
    expect(warn).toHaveBeenCalledWith('archived versions remain for personal-files/u1: 2');
    warn.mockRestore();
  });
});

// Claude r11 nit: the local sign-out's 3 s cap is cleared once it settles.
describe('round 14: no timer left behind', () => {
  it('clearDeviceSession clears its 3 s timer', async () => {
    vi.useFakeTimers();
    try {
      await clearDeviceSession({
        signOutLocal: async () => {},
        sessionStore: null,
        clearOfflineCache: async () => {},
        clearStageCache: () => {},
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
