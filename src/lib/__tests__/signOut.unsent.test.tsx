import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

// Round 4 (Claude MINOR 3): signing out wiped the changes still waiting on
// this phone (notes, suggestions, a setlist order) without a word. Now it
// asks first: "Send now" or "Sign out anyway"; closed, still signed in.
// Made-up note (New York).

const auth = vi.hoisted(() => ({ signOut: vi.fn(async () => ({ error: null })), left: 0 }));
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: { user: { id: 'u-a' } } } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }), maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
  getSafeUser: async () => null,
  getSessionOfflineSafe: async () => ({ session: { user: { id: 'u-a' } } }),
  signIn: vi.fn(), signUp: vi.fn(), signOut: auth.signOut, resetPassword: vi.fn(),
  signInWithOAuth: vi.fn(), updatePassword: vi.fn(), RECOVERY_FLAG: 'recovery',
}));
vi.mock('../services/presence', () => ({ cleanupPresence: vi.fn() }));
vi.mock('../services/pushNotifications', () => ({ unregisterPushToken: vi.fn(async () => {}) }));
vi.mock('../services/appBadge', () => ({ syncAppBadge: vi.fn() }));
vi.mock('../stageBleNative', () => ({ clearStageCache: vi.fn() }));
vi.mock('../offline/syncQueue', () => ({
  processSyncQueue: vi.fn(async () => {}), getPendingMutations: vi.fn(async () => []), getOfflineQueueKey: (u: string) => `bw:offline_queue:${u}`,
}));
vi.mock('@/app/hooks/useLiveOutbox', () => ({ sendWaitingNow: vi.fn(async () => auth.left) }));

import { AuthProvider, useAuth } from '../AuthContext';
import { queueLiveOp } from '../liveOutbox';
import { UnsentChangesSignOut } from '@/app/components/layout/UnsentChangesSignOut';

let result: unknown = undefined;
const SignOutButton = () => {
  const { signOut, user } = useAuth();
  return (
    <button type="button" disabled={!user} onClick={async () => (result = await signOut())}>
      sign me out
    </button>
  );
};
const renderApp = async () => {
  render(
    <AuthProvider>
      <SignOutButton />
      <UnsentChangesSignOut />
    </AuthProvider>,
  );
  await waitFor(() => expect((screen.getByText('sign me out') as HTMLButtonElement).disabled).toBe(false));
};
const note = (id: string) => ({ kind: 'note' as const, id, songId: 's1', anchor: { type: 'song' as const }, body: 'Watch the drummer before the bridge', isNew: true });

beforeEach(() => {
  localStorage.clear();
  auth.signOut.mockClear();
  auth.left = 0;
  result = undefined;
});
afterEach(cleanup);

describe('signing out with changes not sent yet', () => {
  it('asks first; "Sign out anyway" signs out', async () => {
    queueLiveOp('u-a', note('n1'));
    queueLiveOp('u-a', note('n2'));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('You have 2 unsent changes')).toBeTruthy();
    expect(auth.signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /sign out anyway/i }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
  });

  it('closed: still signed in, nothing lost', async () => {
    queueLiveOp('u-a', note('n1'));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('You have 1 unsent change')).toBeTruthy();
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
    await waitFor(() => expect(result).toMatchObject({ cancelled: true }));
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem('bw:live_outbox:u-a')).toContain('n1');
  });

  it('"Send now": everything sent, then signed out; still no signal, it says so and waits', async () => {
    queueLiveOp('u-a', note('n1'));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    auth.left = 1;
    fireEvent.click(await screen.findByRole('button', { name: /send now/i }));
    expect(await screen.findByText(/no connection/i)).toBeTruthy();
    expect(auth.signOut).not.toHaveBeenCalled();
    auth.left = 0;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send now/i }));
    });
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
  });

  it('nothing waiting: signs out without asking', async () => {
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/unsent change/i)).toBeNull();
  });
});
