import { describe, it, expect, vi } from 'vitest';
import * as signOutOnDeletion from '../deletionSignOut';
import * as gate from '../../../supabase/functions/_shared/deletion-gate';
import quotesSource from '../services/quotes.ts?raw';
import quotesScreen from '../../app/components/dashboard/expanded/QuotesExpanded.tsx?raw';
import planLimitSource from '../planLimit.ts?raw';
import signOutSource from '../deletionSignOut.ts?raw';
import inviteMember from '../../../supabase/functions/invite-member/index.ts?raw';
import sendEmail from '../../../supabase/functions/send-email/index.ts?raw';
import sendPush from '../../../supabase/functions/send-push/index.ts?raw';

// Claude round 6 (M6): any response saying the account is being deleted
// signs this device out, everywhere (every session of the account).
describe('round 8: a response with account_being_deleted signs out', () => {
  const respond = (status: number, body: unknown) => async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

  it('calls the sign-out once for a refusal with that hint', async () => {
    const hit = vi.fn();
    const f = signOutOnDeletion.deletionAwareFetch(
      respond(400, { code: 'P0001', message: 'Your account is being deleted.', hint: 'account_being_deleted' }) as typeof fetch,
      hit,
    );
    const res = await f('https://x.supabase.co/rest/v1/events', {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ hint: 'account_being_deleted' }); // the caller still reads it
    await vi.waitFor(() => expect(hit).toHaveBeenCalledTimes(1));
  });

  it('an edge function refusal (code) counts too', async () => {
    const hit = vi.fn();
    const f = signOutOnDeletion.deletionAwareFetch(
      respond(409, { success: false, code: 'account_being_deleted', hint: 'account_being_deleted', error: 'Your account is being deleted.' }) as typeof fetch,
      hit,
    );
    await f('https://x.supabase.co/functions/v1/invite-member', {});
    await vi.waitFor(() => expect(hit).toHaveBeenCalledTimes(1));
  });

  it('other errors and successes do not', async () => {
    const hit = vi.fn();
    await signOutOnDeletion.deletionAwareFetch(respond(400, { hint: 'account_deletion_in_progress' }) as typeof fetch, hit)('https://x/rest/v1/a', {});
    await signOutOnDeletion.deletionAwareFetch(respond(500, 'not json') as typeof fetch, hit)('https://x/rest/v1/a', {});
    await signOutOnDeletion.deletionAwareFetch(respond(200, { hint: 'account_being_deleted' }) as typeof fetch, hit)('https://x/rest/v1/a', {});
    await new Promise((r) => setTimeout(r, 10));
    expect(hit).not.toHaveBeenCalled();
  });

  it('the app client is wired to it (through planAwareFetch)', () => {
    const plan = planLimitSource.slice(planLimitSource.indexOf('export function planAwareFetch'));
    expect(plan).toMatch(/return deletionAwareFetch\(/);
    expect(plan).toMatch(/\}, signOutDeletingAccount\);/);
    // Round 9: through the app's own sign-out (accountDeletionRound9.test.ts).
    expect(signOutSource).toMatch(/export async function signOutDeletingAccount\(userId: string \| null\)/);
  });
});

// Claude round 6 (M2): a gig made from a quote is the current user's, not
// the quote author's (who may be deleting their account).
describe('round 8: quote to gig', () => {
  it('the gig takes the current user as its creator', () => {
    const insert = quotesSource.slice(quotesSource.indexOf("export const convertQuoteToEvent"), quotesSource.indexOf('export const gigFromAcceptedQuote'));
    expect(insert).not.toMatch(/created_by: quote\.created_by/);
    expect(insert).toMatch(/created_by: user\.id/);
  });

  it('the quotes screen shows a deletion refusal in its own words', () => {
    const createGig = quotesScreen.slice(quotesScreen.indexOf('const handleCreateGig = '), quotesScreen.indexOf('const handlePrepareContract'));
    expect(createGig).toMatch(/deletionRefusalMessage\(error\) \?\? errorText\(/);
  });
});

// Claude round 6 (M3): edge functions that act for the caller with the
// service key refuse once the caller's deletion is committed.
describe('round 8: edge functions refuse a caller who is being deleted', () => {
  const admin = (row: unknown, error: unknown = null) => ({
    from: (table: string) => {
      expect(table).toBe('account_deletions_pending');
      return {
        select: () => ({
          eq: () => ({
            not: () => ({ maybeSingle: async () => ({ data: row, error }) }),
          }),
        }),
      };
    },
  });

  it('a committed deletion: 409 with the hint', async () => {
    const refusal = await gate.callerDeletionRefusal(admin({ user_id: 'u1' }), { kind: 'user', id: 'u1' });
    expect(refusal?.status).toBe(409);
    expect(refusal?.body).toMatchObject({ code: 'account_being_deleted', hint: 'account_being_deleted' });
  });

  it('nobody deleting, or the server itself: no refusal', async () => {
    expect(await gate.callerDeletionRefusal(admin(null), { kind: 'user', id: 'u1' })).toBeNull();
    expect(await gate.callerDeletionRefusal(admin({ user_id: 'u1' }), { kind: 'service' })).toBeNull();
  });

  it('a failed lookup lets the call through (round 9: the triggers are the hard guard)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await gate.callerDeletionRefusal(admin(null, { message: 'timeout' }), { kind: 'user', id: 'u1' })).toBeNull();
    warn.mockRestore();
  });

  it.each([
    ['invite-member', inviteMember],
    ['send-email', sendEmail],
    ['send-push', sendPush],
  ])('%s checks the caller right after resolving it', (_name, src) => {
    expect(src).toMatch(/from ['"]\.\.\/_shared\/deletion-gate\.ts['"]/);
    const at = src.indexOf('callerDeletionRefusal(');
    expect(at).toBeGreaterThan(src.indexOf('requireCaller(req'));
  });
});
