import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';

/**
 * #296 round 8 (main's decision, three-way sign-out with #287 and #292): the
 * sign-out is one awaited pipeline. The refused notes are put back before
 * handleSignOut resolves, so whatever runs after it (#292's
 * discardAccountWrites for a deleted account) always comes last.
 */
const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const LIST = `bw:rehearsal_notes_rejected:${U}`;
const q = vi.hoisted(() => ({ pending: [] as unknown[], put: [] as string[] }));
const chain: Record<string, unknown> = {};
for (const m of ['select', 'eq', 'update', 'insert', 'upsert']) chain[m] = () => chain;
chain.single = async () => ({ data: { id: U, email: 'a@example.test', full_name: 'A' }, error: null });
chain.maybeSingle = chain.single;
vi.mock('../supabase', () => ({
  supabase: {
    from: () => chain,
    rpc: async () => ({ data: null, error: null }),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: async () => ({ data: { session: null } }),
      signOut: async () => ({ error: null }),
    },
  },
  getSafeUser: async () => ({ data: { user: { id: U } } }),
  getSessionOfflineSafe: async () => ({ session: { user: { id: U, email: 'a@example.test' } } }),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: async () => ({ error: null }),
  resetPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  updatePassword: vi.fn(),
  updatePasswordWithToken: vi.fn(),
  RECOVERY_FLAG: 'bw_recovery',
}));
vi.mock('../services/presence', () => ({ cleanupPresence: () => {} }));
vi.mock('../stageBleNative', () => ({ clearStageCache: () => {} }));
// With #287's exports too, so this survives that merge.
vi.mock('../services/pushNotifications', () => ({
  unregisterPushToken: async () => {},
  flushQueuedPushRevocations: async () => {},
  forgetPushAccount: async () => {},
  subscribeToPush: async () => {},
}));
vi.mock('../services/appBadge', () => ({ syncAppBadge: () => {} }));
vi.mock('../regiaAudio', () => ({
  clearDownloadedAudio: async () => {},
  finishPendingAudioCleanup: async () => {},
  legacyAudioSignedIn: async () => {},
}));
vi.mock('../offline/syncQueue', () => ({
  processSyncQueue: async () => {},
  getPendingMutations: async () => q.pending,
  getOfflineQueueKey: (u: string) => `bw:offline_queue:${u}`,
}));
/** This build's clear (before #292): every bw: key, a moment later (IndexedDB is async). */
vi.mock('../offline/storage', () => ({
  clearOfflineCache: async () => {
    await new Promise((r) => setTimeout(r, 30));
    const all = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '');
    for (const k of all) if (k.startsWith('bw:')) localStorage.removeItem(k);
  },
  getOfflineItem: async () => null,
  setOfflineItem: async (k: string) => {
    q.put.push(k);
  },
  getCacheKey: (u: string, b: string, k: string) => `bw:${u}:${b}:${k}`,
  listOfflineKeys: async () => [],
  // Before #292: no keep list of its own (signOutWipe uses its copy).
  KEEP_ON_SIGN_OUT_PREFIXES: undefined,
}));

import { AuthProvider, useAuth } from '../AuthContext';

describe('#296 round 8: sign-out is awaited end to end', () => {
  beforeEach(() => {
    localStorage.clear();
    q.pending = [];
    q.put = [];
  });

  it('the refused notes are back before signOut() resolves (nothing of the clear runs after it)', async () => {
    localStorage.setItem(LIST, '[{"id":"x"}]');
    const CACHE = `bw:${U}:global:events`;
    let auth!: ReturnType<typeof useAuth>;
    const Probe = () => {
      auth = useAuth();
      return null;
    };
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(auth.user?.id).toBe(U));
    await act(async () => {
      localStorage.setItem(CACHE, '[]');
      await auth.signOut();
      // Right as it resolves: the clear is done (the cache is gone) and the list is back.
      expect(localStorage.getItem(CACHE)).toBeNull();
      expect(localStorage.getItem(LIST)).toBe('[{"id":"x"}]');
    });
  });

  it('Claude r8 M2: a deleted account (discardPendingWrites): its refused notes are not put back; another account’s stay', async () => {
    const V = 'bbbbbbbb-2222-4222-8222-222222222222';
    localStorage.setItem(LIST, '[{"id":"x"}]');
    localStorage.setItem(`bw:rehearsal_notes_rejected:${V}`, '[{"id":"y"}]');
    let auth!: ReturnType<typeof useAuth>;
    const Probe = () => {
      auth = useAuth();
      return null;
    };
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(auth.user?.id).toBe(U));
    await act(async () => {
      await auth.signOut({ discardPendingWrites: true });
    });
    expect(localStorage.getItem(LIST)).toBeNull();
    expect(localStorage.getItem(`bw:rehearsal_notes_rejected:${V}`)).toBe('[{"id":"y"}]');
  });

  it('Claude r8 M2: the offline queue left unsent is put back for its next sign-in, never for a deleted account', async () => {
    const mount = async () => {
      let auth!: ReturnType<typeof useAuth>;
      const Probe = () => {
        auth = useAuth();
        return null;
      };
      const view = render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );
      await waitFor(() => expect(auth.user?.id).toBe(U));
      return { auth: () => auth, view };
    };
    q.pending = [{ table: 'events', op: 'update' }];
    let m = await mount();
    await act(async () => {
      await m.auth().signOut();
    });
    expect(q.put.filter((k) => k.startsWith('bw:offline_queue:'))).toEqual([`bw:offline_queue:${U}`]);
    m.view.unmount();
    q.put = [];
    m = await mount();
    await act(async () => {
      await m.auth().signOut({ discardPendingWrites: true });
    });
    expect(q.put.filter((k) => k.startsWith('bw:offline_queue:'))).toEqual([]);
  });
});
