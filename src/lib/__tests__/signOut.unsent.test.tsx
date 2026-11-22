import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

// Round 4 (Claude MINOR 3): signing out wiped the changes still waiting on
// this phone (notes, suggestions, a setlist order) without a word. Now it
// asks first: "Send now" or "Sign out anyway"; closed, still signed in.
// Made-up note (New York).

const auth = vi.hoisted(() => ({ signOut: vi.fn(async () => ({ error: null })), left: 0, refused: 0 }));
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
// The account's offline queue, as stored (deleting the account must not write it back).
vi.mock('../offline/syncQueue', async () => {
  const st = await import('../offline/storage');
  return {
    processSyncQueue: vi.fn(async () => {}),
    getPendingMutations: vi.fn(async () => ((await st.getOfflineItem<unknown[]>('bw:offline_queue:u-a')) ?? [])),
    getOfflineQueueKey: (u: string) => `bw:offline_queue:${u}`,
  };
});
const packs = vi.hoisted(() => ({ deleteAllPacks: vi.fn(async () => {}) }));
vi.mock('../livePackStore', () => ({ deleteAllPacks: packs.deleteAllPacks, LIVE_PACK_CHANGED: 'bw:live-pack-changed' }));
vi.mock('@/app/hooks/useLiveOutbox', () => ({ sendWaitingNow: vi.fn(async () => ({ left: auth.left, refused: auth.refused })) }));

import { AuthProvider, useAuth } from '../AuthContext';
import { queueLiveOp, readRefusedLiveOps, writeLiveOutbox } from '../liveOutbox';
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
  auth.refused = 0;
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

  // Round 5 (Codex B1): Send now, and the band refused one: not signed out;
  // it says where the refused change is kept.
  it('"Send now" with a change refused: stays signed in and points to Offline & live', async () => {
    queueLiveOp('u-a', note('n1'));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    auth.left = 0;
    auth.refused = 1;
    fireEvent.click(await screen.findByRole('button', { name: /send now/i }));
    expect(await screen.findByText(/1 change was refused/i)).toBeTruthy();
    expect(screen.getByText(/settings & account › offline & live/i)).toBeTruthy();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  // Round 5 (Codex B3): a deleted account is signed out without asking, and
  // everything it left on this device goes: its queues, its refused changes,
  // its offline setlists. Nothing is written back.
  it('account deleted: no question, its unsent and refused changes and packs go', async () => {
    const st = await import('../offline/storage');
    queueLiveOp('u-a', note('n1'));
    localStorage.setItem('bw:live_refused:u-a', JSON.stringify([note('n0')]));
    localStorage.setItem('bw:rehearsal_notes_outbox:u-a', JSON.stringify([{ kind: 'delete', id: 'r1' }]));
    localStorage.setItem('bw:live_refused:u-other', JSON.stringify([note('x')]));
    await st.setOfflineItem('bw:offline_queue:u-a', [{ id: 'm1', table: 'events' }]);
    let res: unknown;
    const Delete = () => {
      const { signOut, user } = useAuth();
      return (
        <button type="button" disabled={!user} onClick={async () => (res = await signOut({ discardPendingWrites: true }))}>
          delete me
        </button>
      );
    };
    render(
      <AuthProvider>
        <Delete />
        <UnsentChangesSignOut />
      </AuthProvider>,
    );
    await waitFor(() => expect((screen.getByText('delete me') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('delete me'));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(res).toBeTruthy());
    expect(screen.queryByText(/unsent change/i)).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(localStorage.getItem('bw:live_outbox:u-a')).toBeNull();
    expect(localStorage.getItem('bw:live_refused:u-a')).toBeNull();
    expect(localStorage.getItem('bw:rehearsal_notes_outbox:u-a')).toBeNull();
    expect(await st.getOfflineItem('bw:offline_queue:u-a')).toBeNull();
    expect(packs.deleteAllPacks).toHaveBeenCalledWith('u-a');
    // Another account's refused changes on this device stay.
    expect(localStorage.getItem('bw:live_refused:u-other')).toBeTruthy();
  });

  // Round 5 (Claude BLOCKER): changes the band refused stay on the phone
  // through sign-out and the next sign-in; nothing waiting, so no question.
  it('0 waiting + 3 refused: signs out without asking, and all 3 are still there after signing in again', async () => {
    localStorage.setItem('bw:live_refused:u-a', JSON.stringify([note('r1'), note('r2'), note('r3')]));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result).toBeTruthy());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/unsent change/i)).toBeNull();
    cleanup();
    await renderApp();
    expect(readRefusedLiveOps('u-a').map((o) => (o as { id?: string }).id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('the sheet says "Sign out anyway" deletes them from this phone', async () => {
    queueLiveOp('u-a', note('n1'));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText(/sign out anyway.{0,3} deletes them from this phone/i)).toBeTruthy();
  });

  // Round 5 (Claude MINOR 6): never "You have 0 unsent changes".
  it('sent in the background while asking: the sheet closes and the sign-out goes on', async () => {
    queueLiveOp('u-a', note('n1'));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('You have 1 unsent change')).toBeTruthy();
    act(() => writeLiveOutbox('u-a', []));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/0 unsent changes/i)).toBeNull();
  });

  it('refused in the background while asking: stays signed in and says where it is', async () => {
    queueLiveOp('u-a', note('n1'));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('You have 1 unsent change')).toBeTruthy();
    act(() => {
      localStorage.setItem('bw:live_refused:u-a', JSON.stringify([note('n1')]));
      writeLiveOutbox('u-a', []);
    });
    expect(await screen.findByText(/1 change was refused/i)).toBeTruthy();
    expect(screen.queryByText(/0 unsent changes/i)).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('"Send now", all refused: the title never reads 0 unsent changes', async () => {
    queueLiveOp('u-a', note('n1'));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    auth.left = 0;
    auth.refused = 1;
    fireEvent.click(await screen.findByRole('button', { name: /send now/i }));
    expect(await screen.findByText(/1 change was refused/i)).toBeTruthy();
    expect(screen.queryByText(/0 unsent changes/i)).toBeNull();
  });

  // The chat outbox (#291): counted by the gate; "Sign out anyway" keeps it
  // on this phone for the account; Send now doesn't send chat messages.
  const chatMsg = (n: number) => ({ chatId: 'c1', clientId: `m${n}`, body: 'Load-in at 6 in Brooklyn', createdAt: '2026-11-22T18:00:00Z' });
  it('2 unsent chat messages: asks first, says they stay on this phone, Sign out anyway keeps them', async () => {
    localStorage.setItem('bw:chat_outbox:u-a', JSON.stringify([chatMsg(1), chatMsg(2)]));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('You have 2 unsent messages')).toBeTruthy();
    expect(screen.getByText(/stay on this phone for your account/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /send now/i }));
    expect(await screen.findByText(/sent when the chat opens or the app is back online/i)).toBeTruthy();
    expect(auth.signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /sign out anyway/i }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(JSON.parse(localStorage.getItem('bw:chat_outbox:u-a') || '[]')).toHaveLength(2);
  });

  it('bad chat outbox JSON counts 0: no question', async () => {
    localStorage.setItem('bw:chat_outbox:u-a', '{oops');
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
  });
});

