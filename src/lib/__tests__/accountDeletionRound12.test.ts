import { describe, it, expect, vi } from 'vitest';
import * as deletion from '../../../supabase/functions/_shared/account-deletion';
import type { RemoveEntry } from '../../../supabase/functions/_shared/account-deletion';

// Round 12 (main's F6 condition): the version purge is defensive (prod has
// no versioned bucket). Failing or refused, it logs and the deletion goes on.
type Failure = 'rpc-error' | 'rpc-throws' | 'remove-error' | 'remove-throws';

const server = (failure: Failure) => {
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
        if (failure === 'rpc-throws') throw new Error('network down');
        if (failure === 'rpc-error') return { data: null, error: { code: '42501', message: 'permission denied' } };
        return args.p_after_name ? { data: [], error: null } : { data: [{ name: `${args.p_prefix}/old`, version: 'v0' }], error: null };
      }
      if (name === 'bw_account_storage_release') {
        const left = files['personal-files'].size + files.avatars.size;
        return { data: { released: 0, personal_left: left }, error: null };
      }
      return { data: null, error: null };
    },
    store: (bucket) => ({
      remove: async (paths: RemoveEntry[]) => {
        if (typeof paths[0] === 'object') {
          if (failure === 'remove-throws') throw new Error('versionId not supported');
          if (failure === 'remove-error') return { error: { statusCode: '400', message: 'Invalid body' } };
          return { error: null };
        }
        for (const p of paths) files[bucket].delete(p as string);
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
  return { s, calls, files };
};

describe('round 12: a failing version purge never blocks the deletion', () => {
  for (const failure of ['rpc-error', 'rpc-throws', 'remove-error', 'remove-throws'] as const) {
    it(`${failure}: the files go, it logs, and the deletion completes`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { s, calls, files } = server(failure);
      expect(await deletion.removeObjects(s, 'song-files', 'solo')).toBe(true);
      expect(await deletion.finishCommitted(s, 'u1', [])).toEqual({ kind: 'done' });
      expect(calls).toContain('deleteUser');
      expect(Object.values(files).every((b) => b.size === 0)).toBe(true);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  }
});
