import { describe, it, expect, vi } from 'vitest';
import * as signOutOnDeletion from '../deletionSignOut';
import * as deletion from '../../../supabase/functions/_shared/account-deletion';
import * as gate from '../../../supabase/functions/_shared/deletion-gate';
import appSource from '../../app/App.tsx?raw';
import hookSource from '../useDeletionSignOut.ts?raw';
import chatsSource from '../services/chats.ts?raw';
import accountSource from '../services/account.ts?raw';

// A session token as the app's client sends it (only `sub` is read).
const jwt = (sub: string) => {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated' })}.sig`;
};
const refusal = async () =>
  new Response(JSON.stringify({ code: 'P0001', message: 'Your account is being deleted.', hint: 'account_being_deleted' }), { status: 400 });

// Codex r7 M1: a refusal belongs to the account that made the request.
describe('round 9: a refusal carries the user it was for', () => {
  it('reads the user from the request token (Headers, plain object, Request)', async () => {
    const hit = vi.fn();
    const f = signOutOnDeletion.deletionAwareFetch(refusal as typeof fetch, hit);
    await f('https://x.supabase.co/rest/v1/events', { headers: new Headers({ Authorization: `Bearer ${jwt('user-a')}` }) });
    await vi.waitFor(() => expect(hit).toHaveBeenLastCalledWith('user-a'));
    const g = signOutOnDeletion.deletionAwareFetch(refusal as typeof fetch, hit);
    await g('https://x.supabase.co/rest/v1/events', { headers: { authorization: `Bearer ${jwt('user-b')}` } });
    await vi.waitFor(() => expect(hit).toHaveBeenLastCalledWith('user-b'));
    const h = signOutOnDeletion.deletionAwareFetch(refusal as typeof fetch, hit);
    await h(new Request('https://x.supabase.co/rest/v1/events', { headers: { Authorization: `Bearer ${jwt('user-c')}` } }));
    await vi.waitFor(() => expect(hit).toHaveBeenLastCalledWith('user-c'));
  });

  it('a request with no session token has no user', async () => {
    const hit = vi.fn();
    const f = signOutOnDeletion.deletionAwareFetch(refusal as typeof fetch, hit);
    await f('https://x.supabase.co/rest/v1/events', { headers: { Authorization: 'Bearer sb_publishable_abc' } });
    await vi.waitFor(() => expect(hit).toHaveBeenCalledWith(null));
  });
});

// Codex r7 B1 + M1: the app's own sign-out, for the account refused only.
describe('round 9: signing out after a refusal', () => {
  const deps = (current: { id: string; email: string | null } | null) => {
    const calls: string[] = [];
    return {
      calls,
      d: {
        currentUser: async () => current,
        forgetQuickSignIn: async (id: string) => void calls.push(`forget:${id}`),
        signOut: async () => {
          calls.push('signOut');
          return { error: null };
        },
        reload: () => void calls.push('reload'),
      },
    };
  };

  it('another account signed in since: nothing happens', async () => {
    const { calls, d } = deps({ id: 'user-b', email: 'b@example.com' });
    expect(await signOutOnDeletion.deletionSignOutStep('user-a', d)).toBe('ignored');
    expect(await signOutOnDeletion.deletionSignOutStep(null, d)).toBe('ignored');
    expect(calls).toEqual([]);
  });

  it('the same account: quick sign-in forgotten, then the app sign-out, then a reload', async () => {
    const { calls, d } = deps({ id: 'user-a', email: 'a@example.com' });
    expect(await signOutOnDeletion.deletionSignOutStep('user-a', d)).toBe('signed_out');
    expect(calls).toEqual(['forget:user-a', 'signOut', 'reload']);
  });

  it('a registered handler gets the user; while the delete flow runs it is held', async () => {
    const seen: (string | null)[] = [];
    const off = signOutOnDeletion.onAccountBeingDeleted((uid) => void seen.push(uid));
    await signOutOnDeletion.signOutDeletingAccount('user-a');
    const release = signOutOnDeletion.holdDeletionSignOut();
    await signOutOnDeletion.signOutDeletingAccount('user-a');
    release();
    await signOutOnDeletion.signOutDeletingAccount('user-a');
    off();
    expect(seen).toEqual(['user-a', 'user-a']);
  });

  it('the app wires it to the sign-out IdentityHub uses (useAuth().signOut)', () => {
    expect(appSource).toMatch(/useDeletionSignOut\(signOut\)/);
    expect(hookSource).toMatch(/onAccountBeingDeleted\(/);
    expect(hookSource).toMatch(/forgetQuickSignInFor/);
    expect(hookSource).not.toMatch(/scope: 'global'/);
  });

  it('the delete flow holds it while it runs', () => {
    const flow = accountSource.slice(accountSource.indexOf('export async function deleteMyAccount'));
    expect(flow).toMatch(/holdDeletionSignOut\(\)/);
  });
});

// Codex r7 B3 + Claude r8 3: a short page is not the end (a row cap).
describe('round 9: paging until an empty page', () => {
  it('removes 150 files when the server caps a page at 100 rows', async () => {
    const files = new Set(Array.from({ length: 150 }, (_, i) => `b1/q${String(i).padStart(3, '0')}.pdf`));
    const server = {
      rpc: async (_: string, a: Record<string, unknown>) => ({
        data: [...files].sort().filter((n) => n > String(a.p_after ?? '')).slice(0, 100),
        error: null,
      }),
      store: () => ({ remove: async (ps: string[]) => (ps.forEach((p) => files.delete(p)), { error: null }) }),
    };
    expect(await deletion.removeObjects(server, 'quotes', 'b1')).toBe(true);
    expect(files.size).toBe(0);
  });
});

// Claude r8 2: the gate fails open; only a committed deletion refuses.
describe('round 9: the edge function gate', () => {
  const admin = (row: unknown, error: unknown = null) => ({
    from: () => ({ select: () => ({ eq: () => ({ not: () => ({ maybeSingle: async () => ({ data: row, error }) }) }) }) }),
  });
  it('a missing table (before 180) passes', async () => {
    for (const code of ['PGRST205', '42P01', '42703']) {
      expect(await gate.callerDeletionRefusal(admin(null, { code, message: 'missing' }), { kind: 'user', id: 'u1' })).toBeNull();
    }
  });
  it('any other lookup error passes with a warning (the database triggers still refuse)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await gate.callerDeletionRefusal(admin(null, { code: '57014', message: 'timeout' }), { kind: 'user', id: 'u1' })).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it('only a committed deletion gives 409', async () => {
    expect((await gate.callerDeletionRefusal(admin({ user_id: 'u1' }), { kind: 'user', id: 'u1' }))?.status).toBe(409);
  });
});

// Codex r7 M2: the chat header's rule needs the newest message's sender.
describe('round 9: getChat loads the last message of a direct chat', () => {
  it('reads the newest message and returns it as last_message', () => {
    const getChat = chatsSource.slice(chatsSource.indexOf('export const getChat = '), chatsSource.indexOf('// Find existing direct chat'));
    expect(getChat).toMatch(/from\('messages'\)[\s\S]*?\.order\('created_at', \{ ascending: false \}\)[\s\S]*?\.limit\(1\)/);
    expect(getChat).toMatch(/last_message: /);
  });
});
