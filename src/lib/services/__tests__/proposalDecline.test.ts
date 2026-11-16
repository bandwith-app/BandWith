import { describe, it, expect, vi, beforeEach } from 'vitest';

/** What rehearsal_polls.update(...) was asked, and the rows it "updated". */
let updated: { id: string }[] = [{ id: 'p1' }];
let updateError: unknown = null;
const calls: string[] = [];

vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const q: any = {
      update: (payload: any) => (calls.push(`${table}.update:${payload.status}`), q),
      eq: (col: string, v: unknown) => (calls.push(`eq:${col}=${String(v)}`), q),
      select: () => Promise.resolve({ data: updateError ? null : updated, error: updateError }),
    };
    return q;
  };
  return { supabase: { from: (t: string) => builder(t) } };
});
vi.mock('../events', () => ({ createEvent: vi.fn() }));
vi.mock('../songs', () => ({ createSetlist: vi.fn(), deleteSetlist: vi.fn() }));

const createNotification = vi.fn(async () => ({ data: null, error: null }));
vi.mock('../notifications', () => ({
  createNotification: (...a: unknown[]) => (createNotification as any)(...a),
  createBulkNotifications: vi.fn(),
}));
const langs = new Map<string, string>();
vi.mock('@/lib/recipientLocale', () => ({ recipientLocales: async () => langs }));

import { declineProposal } from '../rehearsalPolls';
import { notifyProposalDeclined } from '../pollNotices';

beforeEach(() => {
  updated = [{ id: 'p1' }];
  updateError = null;
  calls.length = 0;
  createNotification.mockClear();
  langs.clear();
});

describe('declineProposal', () => {
  it('cancels the poll only while it is still a proposal', async () => {
    expect(await declineProposal('p1')).toEqual({ declined: true, error: null });
    expect(calls).toEqual(['rehearsal_polls.update:cancelled', 'eq:id=p1', 'eq:status=proposed']);
  });

  it('says so when it was withdrawn or became a poll meanwhile', async () => {
    updated = [];
    expect(await declineProposal('p1')).toEqual({ declined: false, error: null });
  });

  it('returns the error', async () => {
    updateError = new Error('offline');
    const res = await declineProposal('p1');
    expect(res.declined).toBe(false);
    expect(res.error).toBeTruthy();
  });
});

describe('notifyProposalDeclined', () => {
  const poll = { id: 'p1', band_id: 'b1', title: 'New set', created_by: 'member' };

  it('tells the proposer in their language, with the reason, and lets the server push it', async () => {
    langs.set('member', 'it');
    await notifyProposalDeclined(poll, 'admin', '  The room is booked  ');
    expect(createNotification).toHaveBeenCalledTimes(1);
    const [to, n, opts] = createNotification.mock.calls[0] as unknown as [string, any, unknown];
    expect(to).toBe('member');
    expect(n.type).toBe('system');
    expect(n.title).toBe('Proposta di prova rifiutata');
    expect(n.body).toBe('Un admin ha rifiutato la tua proposta di prova "New set". Motivo: The room is booked');
    expect(n.data).toEqual({ kind: 'proposal_declined', poll_id: 'p1', band_id: 'b1', reason: 'The room is booked' });
    // No sendPush: false, so the row is not marked skip_push (migration 123 pushes it).
    expect(opts).toBeUndefined();
  });

  it('English without a reason', async () => {
    await notifyProposalDeclined({ ...poll, title: '' }, 'admin', '');
    const n = (createNotification.mock.calls[0] as unknown as [string, any])[1];
    expect(n.title).toBe('Rehearsal proposal declined');
    expect(n.body).toBe('An admin declined your rehearsal proposal.');
    expect(n.data.reason).toBeUndefined();
  });

  it('never notifies the admin about their own proposal', async () => {
    await notifyProposalDeclined({ ...poll, created_by: 'admin' }, 'admin', 'x');
    expect(createNotification).not.toHaveBeenCalled();
  });
});
