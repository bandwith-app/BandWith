// Audit 04 #9: signing out keeps each account's unsent changes.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { clearOfflineCache } from '../offline/storage';

// The app's own sign-out (AuthProvider), rendered with the network mocked
// out: what it leaves in storage is the behaviour checked (#287 round 10).
const sess = vi.hoisted(() => ({ uid: '00000000-0000-0000-0000-00000000000b' as string | null }));
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: sess.uid ? { user: { id: sess.uid } } : null } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }), maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
  getSafeUser: async () => null,
  getSessionOfflineSafe: async () => ({ session: sess.uid ? { user: { id: sess.uid } } : null, offline: false }),
  signIn: vi.fn(), signUp: vi.fn(), resetPassword: vi.fn(), signInWithOAuth: vi.fn(), updatePasswordWithToken: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  RECOVERY_FLAG: 'bw_recovery',
}));
vi.mock('../services/presence', () => ({ cleanupPresence: vi.fn() }));
vi.mock('../services/pushNotifications', () => ({
  unregisterPushToken: vi.fn(async () => {}),
  flushQueuedPushRevocations: vi.fn(async () => 0),
  forgetPushAccount: vi.fn(async () => {}),
  subscribeToPush: vi.fn(async () => ({ success: true, error: null })),
}));
vi.mock('../services/appBadge', () => ({ syncAppBadge: vi.fn() }));
vi.mock('../stageBleNative', () => ({ clearStageCache: vi.fn() }));
vi.mock('../offline/syncQueue', () => ({
  processSyncQueue: vi.fn(async () => {}),
  getPendingMutations: vi.fn(async () => []),
  getOfflineQueueKey: (u: string) => `bw:offline_queue:${u}`,
}));

import { AuthProvider, useAuth } from '../AuthContext';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
// The app's cache and queues only (`bw:`): #296's sign-out also leaves its cross-tab mark `bw-regia-audio:cleared`.
const keys = () =>
  Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) as string)
    .filter((k) => k.startsWith('bw:'))
    .sort();

describe('sign-out and unsent changes', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(`bw:rehearsal_notes_outbox:${B}`, '[{"kind":"delete","id":"n1"}]');
    localStorage.setItem(`bw:offline_queue:${A}`, '[{"id":"m1"}]'); // kept at A's earlier sign-out
    localStorage.setItem(`bw:offline_queue:${B}`, '[{"id":"m2"}]');
    localStorage.setItem(`bw:live_outbox:${B}`, '[{"kind":"noteDelete","id":"x"}]');
    localStorage.setItem('bw:offline_queue:anonymous', '[{"id":"orphan"}]');
    localStorage.setItem('bw_offline_mutation_queue', '[{"id":"legacy"}]');
    localStorage.setItem(`bw:${B}:band:quotes`, '{"cached":true}');
  });

  it("keeps every account's outboxes, drops read caches and orphan queues", async () => {
    await clearOfflineCache('bw:', { keepPendingWrites: true });
    expect(keys()).toEqual([`bw:live_outbox:${B}`, `bw:offline_queue:${A}`, `bw:offline_queue:${B}`, `bw:rehearsal_notes_outbox:${B}`].sort());
  });

  it('a full wipe (deleted account) still clears everything', async () => {
    await clearOfflineCache();
    expect(keys()).toEqual([]);
  });

  // Codex review #287: deleting Bob's account must not erase Alice's notes.
  it("a deleted account's unsent changes go, nobody else's", async () => {
    await clearOfflineCache('bw:', { keepPendingWrites: true, discardPendingWritesOf: B });
    expect(keys()).toEqual([`bw:offline_queue:${A}`]);
  });

});

describe("the app's sign-out (AuthProvider)", () => {
  let signOutNow: ((opts?: { discardPendingWrites?: boolean }) => Promise<unknown>) | null = null;
  const Probe = () => {
    const { signOut, user } = useAuth();
    signOutNow = user ? signOut : null;
    return null;
  };
  const signedInAs = async (uid: string) => {
    sess.uid = uid;
    render(React.createElement(AuthProvider, null, React.createElement(Probe)));
    await waitFor(() => expect(signOutNow).not.toBeNull());
  };
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(`bw:offline_queue:${A}`, '[{"id":"m1"}]');
    localStorage.setItem(`bw:offline_queue:${B}`, '[{"id":"m2"}]');
    localStorage.setItem(`bw:rehearsal_notes_outbox:${B}`, '[{"kind":"delete","id":"n1"}]');
    localStorage.setItem(`bw:${B}:band:quotes`, '{"cached":true}');
    signOutNow = null;
  });
  afterEach(cleanup);

  it("a sign-out keeps every account's unsent changes and drops the read caches", async () => {
    await signedInAs(B);
    await act(async () => {
      await signOutNow!();
    });
    await waitFor(() => expect(localStorage.getItem(`bw:${B}:band:quotes`)).toBeNull());
    expect(keys()).toEqual([`bw:offline_queue:${A}`, `bw:offline_queue:${B}`, `bw:rehearsal_notes_outbox:${B}`].sort());
  });

  it("a deleted account's sign-out drops only its own unsent changes", async () => {
    await signedInAs(B);
    await act(async () => {
      await signOutNow!({ discardPendingWrites: true });
    });
    await waitFor(() => expect(localStorage.getItem(`bw:offline_queue:${B}`)).toBeNull());
    expect(keys()).toEqual([`bw:offline_queue:${A}`]);
  });
});
