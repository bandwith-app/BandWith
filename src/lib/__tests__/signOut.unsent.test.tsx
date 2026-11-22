import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

// Round 4 (Claude MINOR 3): signing out wiped the changes still waiting on
// this phone (notes, suggestions, a setlist order) without a word. Now it
// asks first: "Send now" or "Sign out anyway"; closed, still signed in.
// Made-up note (New York).

const auth = vi.hoisted(() => ({ signOut: vi.fn(async () => ({ error: null })), left: 0, refused: 0, notes: 0, busy: false, session: 'u-a' as string | null, sessionThrows: false, locked: false, beforeSession: null as null | (() => void) }));
vi.mock('../appLock', () => ({ isAppLockedNow: () => auth.locked }));
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: auth.session ? { user: { id: auth.session } } : null } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }), maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
  getSafeUser: async () => null,
  getSessionOfflineSafe: async () => {
    auth.beforeSession?.();
    if (auth.sessionThrows) throw new Error('Failed to fetch');
    return { session: auth.session ? { user: { id: auth.session } } : null };
  },
  signIn: vi.fn(), signUp: vi.fn(), signOut: auth.signOut, resetPassword: vi.fn(),
  signInWithOAuth: vi.fn(), updatePassword: vi.fn(), RECOVERY_FLAG: 'recovery',
}));
vi.mock('../services/presence', () => ({ cleanupPresence: vi.fn() }));
vi.mock('../services/pushNotifications', () => ({ unregisterPushToken: vi.fn(async () => {}) }));
vi.mock('../services/appBadge', () => ({ syncAppBadge: vi.fn() }));
vi.mock('../stageBleNative', () => ({ clearStageCache: vi.fn() }));
// #296's sign-out steps (audio on this device): no-ops here.
vi.mock('../regiaAudio', () => ({ clearDownloadedAudio: async () => {}, finishPendingAudioCleanup: async () => {}, legacyAudioSignedIn: async () => {} }));
// The account's offline queue, as stored (deleting the account must not write it back).
vi.mock('../offline/syncQueue', async () => {
  const st = await import('../offline/storage');
  return {
    processSyncQueue: vi.fn(async () => {}),
    getPendingMutations: vi.fn(async () => ((await st.getOfflineItem<unknown[]>('bw:offline_queue:u-a')) ?? [])),
    getOfflineQueueKey: (u: string) => `bw:offline_queue:${u}`,
    clearOfflineQueue: vi.fn(async (u: string) => st.removeOfflineItem(`bw:offline_queue:${u}`)),
  };
});
const packs = vi.hoisted(() => ({ deleteAllPacks: vi.fn(async () => {}) }));
vi.mock('../livePackStore', () => ({ deleteAllPacks: packs.deleteAllPacks, LIVE_PACK_CHANGED: 'bw:live-pack-changed' }));
// The chats the person is in now (null: the list can't be had, e.g. no signal).
const chats = vi.hoisted(() => ({ ids: ['c1'] as string[] | null }));
vi.mock('../services/chats', () => ({
  getChats: async () => (chats.ids ? { data: chats.ids.map((id) => ({ id })), error: null } : { data: null, error: new Error('Failed to fetch') }),
}));
const sendWaitingNowMock = vi.hoisted(() => vi.fn(async () => ({ left: auth.left, refused: auth.refused, refusedNotes: auth.notes, busy: auth.busy })));
vi.mock('@/app/hooks/useLiveOutbox', () => ({ sendWaitingNow: sendWaitingNowMock }));

import { AuthProvider, useAuth } from '../AuthContext';
import { queueLiveOp, readRefusedLiveOps, writeLiveOutbox } from '../liveOutbox';
import { UnsentChangesSignOut } from '@/app/components/layout/UnsentChangesSignOut';

let result: unknown = undefined;
// The sign-out a test started: finished before the next test starts (its
// clear would otherwise run then and remove that test's queue).
let inFlight: Promise<unknown> = Promise.resolve();
const SignOutButton = () => {
  const { signOut, user } = useAuth();
  return (
    <button type="button" disabled={!user} onClick={() => (inFlight = signOut().then((r) => (result = r)))}>
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
  auth.notes = 0;
  auth.busy = false;
  chats.ids = ['c1'];
  auth.session = 'u-a';
  auth.sessionThrows = false;
  auth.locked = false;
  auth.beforeSession = null;
  sendWaitingNowMock.mockClear();
  result = undefined;
});
afterEach(async () => {
  await Promise.race([inFlight, new Promise((r) => setTimeout(r, 400))]);
  cleanup();
});

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

  // Round 6 (Claude r5 M2): a send already on its way when the account is
  // deleted is answered while signing out (refused: kept in the refused
  // list). It goes too: nothing of the deleted account stays.
  it('account deleted: a refusal answered during the sign-out leaves no refused list', async () => {
    auth.signOut.mockImplementationOnce(async () => {
      localStorage.setItem('bw:live_refused:u-a', JSON.stringify([note('late')]));
      return { error: null };
    });
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
      </AuthProvider>,
    );
    await waitFor(() => expect((screen.getByText('delete me') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('delete me'));
    await waitFor(() => expect(res).toBeTruthy());
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('bw:live_refused:u-a')).toBeNull();
  });

  // Round 5 (Claude BLOCKER): changes the band refused stay on the phone
  // through sign-out and the next sign-in. Round 6 (Claude r5 M6): asked
  // first, they stay, or "Erase them and sign out".
  it('0 waiting + 3 refused: asks, says they stay for my account; "Sign out" keeps all 3 for the next sign-in', async () => {
    localStorage.setItem('bw:live_refused:u-a', JSON.stringify([note('r1'), note('r2'), note('r3')]));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('Some changes were refused')).toBeTruthy();
    expect(screen.getByText('3 changes not sent stay on this phone for your account.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /send now/i })).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result).toBeTruthy());
    await new Promise((r) => setTimeout(r, 50));
    cleanup();
    await renderApp();
    expect(readRefusedLiveOps('u-a').map((o) => (o as { id?: string }).id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('0 waiting + refused: "Erase them and sign out" erases this account’s only, then signs out', async () => {
    localStorage.setItem('bw:live_refused:u-a', JSON.stringify([note('r1')]));
    localStorage.setItem('bw:rehearsal_notes_rejected:u-a', JSON.stringify([{ id: 'rn1', body: 'Tighter ending' }]));
    localStorage.setItem('bw:live_refused:u-other', JSON.stringify([note('x')]));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('1 change not sent stays on this phone for your account.')).toBeTruthy();
    expect(screen.getByText('1 note not saved stays on this phone for your account.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /erase them and sign out/i }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('bw:live_refused:u-a')).toBeNull();
    expect(localStorage.getItem('bw:rehearsal_notes_rejected:u-a')).toBeNull();
    expect(localStorage.getItem('bw:live_refused:u-other')).toBeTruthy();
  });

  // Round 7 (Claude r6 minor 2): erased only once the session check passed:
  // another tab signed someone else in meanwhile, nothing is erased.
  it('"Erase them and sign out" after another tab switched account: nothing erased, not signed out', async () => {
    localStorage.setItem('bw:live_refused:u-a', JSON.stringify([note('r1')]));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('1 change not sent stays on this phone for your account.')).toBeTruthy();
    auth.session = 'u-b';
    fireEvent.click(screen.getByRole('button', { name: /erase them and sign out/i }));
    await waitFor(() => expect(result).toMatchObject({ cancelled: true }));
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem('bw:live_refused:u-a')).toContain('r1');
  });

  // Round 7 (Claude r6 minor 3): "Sign out" from the lock screen, when the
  // wipe would delete what waits: kept with the refused changes instead.
  it('locked "Sign out" with changes waiting: kept with the refused ones, nothing destroyed', async () => {
    queueLiveOp('u-a', note('n1'));
    localStorage.setItem(
      'bw:rehearsal_notes_outbox:u-a',
      JSON.stringify([{ kind: 'save', note: { id: 'rn9', body: 'Start the bridge on the snare fill', section: 'Bridge' }, before: [] }]),
    );
    auth.locked = true;
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText(/“Sign out” keeps them on this phone for your account/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(readRefusedLiveOps('u-a').map((o) => (o as { id?: string }).id)).toEqual(['n1']);
    expect(JSON.parse(localStorage.getItem('bw:rehearsal_notes_rejected:u-a') || '[]')).toMatchObject([{ id: 'rn9', body: 'Start the bridge on the snare fill' }]);
  });

  // Round 8 (Claude r7): what can't be kept as refused (a rehearsal note
  // deleted or ticked, a Stage change once the refused list is full) stayed
  // queued and the wipe still deleted it. Now "Sign out" stays put and says
  // unlock to send; nothing is wiped.
  it('locked "Sign out" with a rehearsal note delete waiting: not signed out, unlock to send, still queued', async () => {
    localStorage.setItem('bw:rehearsal_notes_outbox:u-a', JSON.stringify([{ kind: 'delete', id: 'rn4' }]));
    auth.locked = true;
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    fireEvent.click(await screen.findByRole('button', { name: /^sign out$/i }));
    expect(await screen.findByText(/Unlock to send them before you sign out/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('bw:rehearsal_notes_outbox:u-a') || '[]')).toEqual([{ kind: 'delete', id: 'rn4' }]);
  });

  it('locked "Sign out" with the refused list full and a Stage change waiting: not signed out, the change still queued', async () => {
    localStorage.setItem('bw:live_refused:u-a', JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ ...note(`r${i}`), rid: `rid-${i}` }))));
    queueLiveOp('u-a', note('n1'));
    auth.locked = true;
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    fireEvent.click(await screen.findByRole('button', { name: /^sign out$/i }));
    expect(await screen.findByText(/Unlock to send them before you sign out/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('bw:live_outbox:u-a') || '[]')).toMatchObject([{ id: 'n1' }]);
  });

  // Round 9 (Claude r8 nit): another tab fills the refused list between the
  // sheet's check and the move. Before, some changes moved and the sign-out
  // was called off without a word; now the room is checked before anything
  // moves, and the sheet opens again saying why.
  it('another tab fills the refused list meanwhile: nothing moves, the sheet says unlock to send, not signed out', async () => {
    const refused = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ ...note(`r${i}`), rid: `rid-${i}` })));
    localStorage.setItem('bw:live_refused:u-a', refused(97));
    queueLiveOp('u-a', note('n1'));
    queueLiveOp('u-a', note('n2'));
    auth.locked = true;
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    // Room for 1 left once the sheet's check passed (AuthContext's session re-check).
    auth.beforeSession = () => {
      auth.beforeSession = null;
      localStorage.setItem('bw:live_refused:u-a', refused(99));
    };
    fireEvent.click(await screen.findByRole('button', { name: /^sign out$/i }));
    expect(await screen.findByText(/Unlock to send them before you sign out/)).toBeTruthy();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('bw:live_outbox:u-a') || '[]')).toMatchObject([{ id: 'n1' }, { id: 'n2' }]);
    expect(readRefusedLiveOps('u-a')).toHaveLength(99);
    fireEvent.click(screen.getByRole('button', { name: /unlock to send/i }));
    await waitFor(() => expect(result).toMatchObject({ cancelled: true }));
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  // Round 10 (Claude r9 nit): unlocked between the two asks, the sheet
  // offers "Send now" again: no "Unlock to send" error under it.
  it('unlocked before the sheet opens again: Send now, no unlock error', async () => {
    const refused = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ ...note(`r${i}`), rid: `rid-${i}` })));
    localStorage.setItem('bw:live_refused:u-a', refused(99));
    queueLiveOp('u-a', note('n1'));
    auth.locked = true;
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    auth.beforeSession = () => {
      auth.beforeSession = null;
      auth.locked = false;
      localStorage.setItem('bw:live_refused:u-a', refused(100));
    };
    fireEvent.click(await screen.findByRole('button', { name: /^sign out$/i }));
    expect(await screen.findByRole('button', { name: /^send now$/i })).toBeTruthy();
    expect(screen.queryByText(/Unlock to send them before you sign out/)).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('bw:live_outbox:u-a') || '[]')).toMatchObject([{ id: 'n1' }]);
  });

  it('refused only, from the lock screen: "Sign out" keeps them, no Erase', async () => {
    localStorage.setItem('bw:live_refused:u-a', JSON.stringify([note('r1')]));
    auth.locked = true;
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('1 change not sent stays on this phone for your account.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /erase/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('bw:live_refused:u-a')).toBeTruthy();
  });

  // Round 6 (#296 review M6): rehearsal notes not saved (#296's list, an
  // array of notes, one entry per refused version: entries count, not note
  // ids) are counted, read defensively, and can be erased.
  it('0 waiting + 2 rehearsal notes not saved: asks, "2 notes not saved stay…"; junk entries don’t count', async () => {
    const rn = (id: string) => ({ id, eventId: 'e1', body: 'Tighter ending on Superstition', createdBy: 'u-a' });
    localStorage.setItem('bw:rehearsal_notes_rejected:u-a', JSON.stringify([rn('rn1'), { ...rn('rn1'), body: 'Tighter ending, count it in' }, 1, 'x', null, { body: 'no id' }]));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('2 notes not saved stay on this phone for your account.')).toBeTruthy();
    expect(screen.queryByText(/changes? not sent stay/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /erase them and sign out/i }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem('bw:rehearsal_notes_rejected:u-a')).toBeNull();
  });

  it('rehearsal notes list with junk only (or bad JSON): nothing to ask, signs out', async () => {
    localStorage.setItem('bw:rehearsal_notes_rejected:u-a', JSON.stringify([1, 'x', null]));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    cleanup();
    auth.signOut.mockClear();
    localStorage.setItem('bw:rehearsal_notes_rejected:u-a', '{oops');
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
  });

  // Round 6 (#291 review 4): a refused chat message whose chat is gone can't
  // be seen in any chat: listed here with Delete. Waiting ones and refused
  // ones in a chat still there aren't (the chat shows them).
  it('a refused message in a chat that is gone: listed with Delete; Delete removes only it', async () => {
    localStorage.setItem(
      'bw:chat_outbox:u-a',
      JSON.stringify([
        chatMsg(1),
        { ...chatMsg(2), refused: '' },
        { ...chatMsg(3), chatId: 'c-gone', body: 'Parking is on 5th Ave', refused: 'Not allowed' },
      ]),
    );
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('You have 3 unsent messages')).toBeTruthy();
    expect(await screen.findByText('Not sent: this chat is no longer available.')).toBeTruthy();
    expect(screen.getByText('Parking is on 5th Ave')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /delete message not sent/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete message not sent: Parking is on 5th Ave' }));
    expect(await screen.findByText('You have 2 unsent messages')).toBeTruthy();
    expect(screen.queryByText('Parking is on 5th Ave')).toBeNull();
    expect(JSON.parse(localStorage.getItem('bw:chat_outbox:u-a') || '[]').map((m: { clientId: string }) => m.clientId)).toEqual(['m1', 'm2']);
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  // Round 7 (Claude r6 minor 5): deleting the last one goes back to the
  // sheet with "Sign out"; it never signs out on its own.
  it('chat list not available: every refused message is listed as not sent, with Delete; after the last one, "Sign out" is mine to tap', async () => {
    chats.ids = null;
    localStorage.setItem('bw:chat_outbox:u-a', JSON.stringify([{ ...chatMsg(1), refused: '' }]));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('Message not sent')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /delete message not sent: load-in at 6 in brooklyn/i }));
    await waitFor(() => expect(localStorage.getItem('bw:chat_outbox:u-a')).toBeNull());
    await new Promise((r) => setTimeout(r, 30));
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(screen.getByText('Nothing is waiting any more')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /erase/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^sign out$/i }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
  });

  // Round 7 (Claude r6 minor 5): opened with refused changes only, a change
  // another tab queues meanwhile shows, with "Send now".
  it('refused only, then another tab queues a change: the sheet follows, with Send now', async () => {
    localStorage.setItem('bw:live_refused:u-a', JSON.stringify([note('r1')]));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('Some changes were refused')).toBeTruthy();
    act(() => queueLiveOp('u-a', note('n2')));
    expect(await screen.findByText('You have 1 unsent change')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^send now$/i })).toBeTruthy();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('from the lock screen: refused messages are listed, but not deleted from there', async () => {
    chats.ids = null;
    auth.locked = true;
    localStorage.setItem('bw:chat_outbox:u-a', JSON.stringify([{ ...chatMsg(1), refused: '' }]));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('Message not sent')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /delete message not sent/i })).toBeNull();
  });

  // Round 6 (Claude r5 M4): refused rehearsal notes aren't listed in Settings
  // before #296, so the sheet doesn't send the person there.
  it('"Send now", a rehearsal note refused: says it stays on this phone, no Settings place', async () => {
    queueLiveOp('u-a', note('n1'));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    auth.left = 0;
    auth.refused = 1;
    auth.notes = 1;
    fireEvent.click(await screen.findByRole('button', { name: /send now/i }));
    expect(await screen.findByText('1 change was refused. It stays on this phone for your account.')).toBeTruthy();
    expect(screen.queryByText(/settings & account/i)).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  // Round 6 (Claude r5 nit): another tab holds the send lock: not "No connection".
  it('"Send now" while another tab is sending: says so, not "No connection"', async () => {
    queueLiveOp('u-a', note('n1'));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    auth.left = 1;
    auth.busy = true;
    fireEvent.click(await screen.findByRole('button', { name: /send now/i }));
    expect(await screen.findByText('Another tab is sending your changes. Try again in a moment.')).toBeTruthy();
    expect(screen.queryByText(/no connection/i)).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
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

  // Round 6 (Codex B2): the sheet was opened for A; another tab signed B in.
  // "Sign out anyway" then does nothing: no sign-out, nothing cleared.
  it('confirmed after another tab switched account: not signed out, nothing cleared', async () => {
    queueLiveOp('u-a', note('n1'));
    localStorage.setItem('bw:u-a:global:songs', '[]');
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('You have 1 unsent change')).toBeTruthy();
    auth.session = 'u-b';
    fireEvent.click(screen.getByRole('button', { name: /sign out anyway/i }));
    await waitFor(() => expect(result).toMatchObject({ cancelled: true }));
    expect(auth.signOut).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(/unsent change/i)).toBeNull());
    expect(localStorage.getItem('bw:live_outbox:u-a')).toContain('n1');
    expect(localStorage.getItem('bw:u-a:global:songs')).toBe('[]');
  });

  // Codex r6 review B2: token expired with no signal, so the account can't be
  // checked: a confirmed sign-out still goes ahead (on this device), never
  // called off without a word; what the keep list keeps stays.
  for (const [what, set] of [
    ['no session readable', () => (auth.session = null)],
    ['the check fails', () => (auth.sessionThrows = true)],
  ] as const) {
    it(`confirmed, ${what}: signs out anyway and keeps the unsent chat messages`, async () => {
      queueLiveOp('u-a', note('n1'));
      localStorage.setItem('bw:chat_outbox:u-a', JSON.stringify([chatMsg(1)]));
      await renderApp();
      fireEvent.click(screen.getByText('sign me out'));
      expect(await screen.findByText('You have 1 unsent change')).toBeTruthy();
      set();
      fireEvent.click(screen.getByRole('button', { name: /sign out anyway/i }));
      await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
      expect(result).not.toMatchObject({ cancelled: true });
      await new Promise((r) => setTimeout(r, 50));
      expect(JSON.parse(localStorage.getItem('bw:chat_outbox:u-a') || '[]')).toHaveLength(1);
    });
  }

  // Codex r6 review B1: on the lock screen the sheet shows no message text,
  // only counts and kinds; the text shows after unlocking.
  it('locked: a refused message is listed without its text', async () => {
    chats.ids = null;
    auth.locked = true;
    localStorage.setItem('bw:chat_outbox:u-a', JSON.stringify([{ ...chatMsg(1), body: 'Gate code for the loft is 4417', refused: '' }]));
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('Message not sent')).toBeTruthy();
    expect(screen.queryByText(/gate code/i)).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/gate code/i);
  });

  // Round 6 (Codex B8): from the lock screen nothing is sent: unlock first.
  it('locked: no Send now; "Unlock to send" sends nothing and keeps me signed in; "Sign out" signs out', async () => {
    queueLiveOp('u-a', note('n1'));
    auth.locked = true;
    await renderApp();
    fireEvent.click(screen.getByText('sign me out'));
    expect(await screen.findByText('You have 1 unsent change')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^send now$/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /unlock to send/i }));
    await waitFor(() => expect(result).toMatchObject({ cancelled: true }));
    expect(sendWaitingNowMock).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('sign me out'));
    fireEvent.click(await screen.findByRole('button', { name: /^sign out$/i }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    expect(sendWaitingNowMock).not.toHaveBeenCalled();
  });
});

