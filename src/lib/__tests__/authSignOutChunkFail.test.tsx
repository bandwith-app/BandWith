import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';

/**
 * #296 round 8 (Claude r8 M2): signOutWipe's chunk can't load (offline, an
 * old cache): the plain clear still runs, and a deleted account's lists
 * still go. Other accounts' lists stay.
 */
const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const V = 'bbbbbbbb-2222-4222-8222-222222222222';
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
  getPendingMutations: async () => [],
  getOfflineQueueKey: (u: string) => `bw:offline_queue:${u}`,
}));
// The chunk fails to load.
vi.mock('../signOutWipe', () => {
  throw new Error('Failed to fetch dynamically imported module');
});
/** A clear that keeps the kept lists itself (as with #292): the deleted account's must still go. */
vi.mock('../offline/storage', () => ({
  clearOfflineCache: async () => {
    const all = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '');
    for (const k of all) if (k.startsWith('bw:') && !k.startsWith('bw:rehearsal_notes_rejected:')) localStorage.removeItem(k);
  },
  getOfflineItem: async () => null,
  setOfflineItem: async () => {},
  getCacheKey: (u: string, b: string, k: string) => `bw:${u}:${b}:${k}`,
  listOfflineKeys: async () => [],
}));

import { AuthProvider, useAuth } from '../AuthContext';

describe('#296 round 8: signOutWipe can’t load', () => {
  beforeEach(() => localStorage.clear());

  it('a deleted account’s refused notes still go; another account’s stay; the cache goes', async () => {
    localStorage.setItem(`bw:rehearsal_notes_rejected:${U}`, '[{"id":"x"}]');
    localStorage.setItem(`bw:rehearsal_notes_rejected:${V}`, '[{"id":"y"}]');
    localStorage.setItem(`bw:${U}:global:events`, '[]');
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
    expect(localStorage.getItem(`bw:rehearsal_notes_rejected:${U}`)).toBeNull();
    expect(localStorage.getItem(`bw:rehearsal_notes_rejected:${V}`)).toBe('[{"id":"y"}]');
    expect(localStorage.getItem(`bw:${U}:global:events`)).toBeNull();
  });
});
