import { describe, it, expect, vi } from 'vitest';
import * as signOutOnDeletion from '../deletionSignOut';
import * as gate from '../../../supabase/functions/_shared/deletion-gate';
import hookSource from '../useDeletionSignOut.ts?raw';
import sendPush from '../../../supabase/functions/send-push/index.ts?raw';

// Claude r9 1: a sender whose deletion committed after the gate gets no
// device push either (the inbox row was already dropped by 180's trigger).
describe('round 10: no device push for a sender being deleted', () => {
  const admin = (pending: unknown, profile: unknown, error: unknown = null) => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          not: () => ({ maybeSingle: async () => ({ data: table === 'account_deletions_pending' ? pending : null, error }) }),
          maybeSingle: async () => ({ data: table === 'profiles' ? profile : null, error }),
        }),
      }),
    }),
  });

  it('committed, or gone: no push', async () => {
    expect(await gate.senderBeingDeleted(admin({ user_id: 'u1' }, { id: 'u1' }), 'u1')).toBe(true);
    expect(await gate.senderBeingDeleted(admin(null, null), 'u1')).toBe(true);
  });

  it('a live sender, no sender, or a failed lookup: the push goes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await gate.senderBeingDeleted(admin(null, { id: 'u1' }), 'u1')).toBe(false);
    expect(await gate.senderBeingDeleted(admin(null, null), null)).toBe(false);
    expect(await gate.senderBeingDeleted(admin(null, null, { message: 'timeout' }), 'u1')).toBe(false);
    warn.mockRestore();
  });

  it('send-push checks again right before any device rings', () => {
    const at = sendPush.indexOf('senderBeingDeleted(supabase');
    expect(at).toBeGreaterThan(sendPush.indexOf("from('notifications').insert"));
    expect(at).toBeGreaterThan(sendPush.indexOf('const tokenUserIds'));
    expect(at).toBeLessThan(sendPush.indexOf('const badgeByUser'));
  });
});

// Claude r9 4: a failing sign-out never leaves an unhandled rejection, and
// the session is still cleared on this device.
describe('round 10: a sign-out that fails', () => {
  it('a rejecting handler is caught by the fetch wrapper', async () => {
    const unhandled = vi.fn();
    // Node's process, without pulling node types into the app's tsconfig.
    const proc = (globalThis as unknown as { process: { on(e: string, f: () => void): void; off(e: string, f: () => void): void } }).process;
    proc.on('unhandledRejection', unhandled);
    // A plain function: vi.fn would handle the promise itself (settledResults).
    let called = 0;
    const onDeleting = () => {
      called++;
      return Promise.reject(new Error('offline'));
    };
    const f = signOutOnDeletion.deletionAwareFetch(
      (async () => new Response(JSON.stringify({ hint: 'account_being_deleted' }), { status: 400 })) as typeof fetch,
      onDeleting,
    );
    await f('https://x.supabase.co/rest/v1/events', {});
    await vi.waitFor(() => expect(called).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    proc.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('signOutDeletingAccount logs, and clears the session locally', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clearLocal = vi.fn(async () => {});
    const off = signOutOnDeletion.onAccountBeingDeleted(async () => {
      throw new Error('sign-out failed');
    }, clearLocal);
    await expect(signOutOnDeletion.signOutDeletingAccount('user-a')).resolves.toBeUndefined();
    expect(clearLocal).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    off();
    warn.mockRestore();
  });

  it('a sign-out answering an error clears the session locally too', async () => {
    const calls: string[] = [];
    const r = await signOutOnDeletion.deletionSignOutStep('user-a', {
      currentUser: async () => ({ id: 'user-a', email: null }),
      forgetQuickSignIn: async () => {},
      signOut: async () => ({ error: new Error('offline') }),
      clearLocal: async () => void calls.push('clearLocal'),
      reload: () => void calls.push('reload'),
    });
    expect(r).toBe('failed');
    expect(calls).toEqual(['clearLocal', 'reload']);
  });
});

// Claude r9 5: the account is gone: its unsent changes go with it (the
// sign-out's own flag, #287 / #292's discardPendingWrites).
describe('round 10: the refusal sign-out drops the account\'s pending writes', () => {
  it('passes discardPendingWrites to the app sign-out', () => {
    expect(hookSource).toMatch(/latest\.current\(\{ discardPendingWrites: true \}\)/);
  });
});
