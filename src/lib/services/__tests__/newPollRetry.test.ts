/**
 * Codex #297 r7 B4 (= Claude r6 #3): a brand-new poll is saved, then the
 * member lookup for its notices fails; the form says "Try again". The retry
 * used to insert a second poll with the same options. Now the poll's id is
 * the form's request id: a retry finds it (23505, or the row already there)
 * and only sends the notices.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  polls: new Map<string, Record<string, unknown>>(),
  options: [] as Record<string, unknown>[],
  membersFail: 0,
  inserts: [] as string[],
}));

vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    let op = 'select';
    let payload: any = null;
    const filters: Record<string, unknown> = {};
    const run = () => {
      if (table === 'rehearsal_polls' && op === 'insert') {
        db.inserts.push('poll');
        const row = { id: payload.id ?? `gen-${db.polls.size + 1}`, ...payload };
        if (db.polls.has(row.id)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "rehearsal_polls_pkey"' } };
        db.polls.set(row.id, row);
        return { data: { id: row.id }, error: null };
      }
      if (table === 'rehearsal_polls') return { data: db.polls.get(filters.id as string) ?? null, error: null };
      if (table === 'rehearsal_poll_options' && op === 'insert') {
        db.inserts.push('options');
        db.options.push(...payload);
        return { data: payload, error: null };
      }
      if (table === 'rehearsal_poll_options') return { data: db.options.filter((o) => o.poll_id === filters.poll_id), error: null };
      if (table === 'band_members') {
        if (db.membersFail > 0) { db.membersFail--; return { data: null, error: { message: 'network' } }; }
        return { data: [{ user_id: 'admin' }, { user_id: 'bass' }, { user_id: 'drums' }], error: null };
      }
      return { data: [], error: null };
    };
    const q: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') return (res: (v: unknown) => void) => res(run());
        if (prop === 'single' || prop === 'maybeSingle') return async () => run();
        return (...args: unknown[]) => {
          if (prop === 'insert' || prop === 'update' || prop === 'delete') { op = String(prop); payload = args[0]; }
          if (prop === 'eq') filters[String(args[0])] = args[1];
          return q;
        };
      },
    });
    return q;
  };
  return { supabase: { from, rpc: async () => ({ data: null, error: null }) } };
});
vi.mock('../events', () => ({ createEvent: vi.fn() }));
vi.mock('../songs', () => ({ createSetlist: vi.fn(), deleteSetlist: vi.fn() }));
const notify = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock('../notifications', () => ({ createBulkNotifications: notify, createNotification: vi.fn() }));

import { createOrPublishAdminPoll } from '../rehearsalPolls';

const REQ = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const args = {
  bandId: 'band-A',
  adminId: 'admin',
  title: 'Thursday rehearsal',
  invitedUserIds: [] as string[],
  clientId: REQ,
  timeSlots: [{ proposed_date: '2099-12-07', start_time: '20:00', end_time: '22:00' }, { proposed_date: '2099-12-08', start_time: '20:00' }],
};

beforeEach(() => {
  db.polls.clear();
  db.options.length = 0;
  db.inserts.length = 0;
  db.membersFail = 0;
  notify.mockClear();
});

describe('a new poll whose notices failed, published again (Codex #297 r7 B4)', () => {
  it('the poll is saved under the request id', async () => {
    await createOrPublishAdminPoll(args);
    expect([...db.polls.keys()]).toEqual([REQ]);
  });

  it('Try again makes no second poll and no second set of options; it only sends the notices', async () => {
    db.membersFail = 1;
    const first = await createOrPublishAdminPoll(args);
    expect((first.error as { code?: string } | null)?.code).toBe('poll_notify_failed');
    expect(notify).not.toHaveBeenCalled();

    const retry = await createOrPublishAdminPoll(args);
    expect(retry.error).toBeNull();
    expect(db.polls.size).toBe(1);
    expect(db.options).toHaveLength(2);
    expect(notify).toHaveBeenCalledTimes(1);
    const sent = (notify.mock.calls[0] as unknown[])[0] as Array<{ user_id: string; data: { poll_id: string } }>;
    expect(sent.map((n) => n.user_id).sort()).toEqual(['bass', 'drums']);
    expect(sent.every((n) => n.data.poll_id === REQ)).toBe(true);
  });

  it('a retry after the options were lost adds them once', async () => {
    db.polls.set(REQ, { id: REQ, band_id: 'band-A', created_by: 'admin', status: 'polling', invited_user_ids: [] });
    const retry = await createOrPublishAdminPoll(args);
    expect(retry.error).toBeNull();
    expect(db.polls.size).toBe(1);
    expect(db.options).toHaveLength(2);
    expect(db.options.every((o) => o.poll_id === REQ)).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('an id taken by another admin\'s poll is not a replay', async () => {
    db.polls.set(REQ, { id: REQ, band_id: 'band-A', created_by: 'someone-else', status: 'polling', invited_user_ids: [] });
    const out = await createOrPublishAdminPoll(args);
    expect(out.error).not.toBeNull();
    expect(notify).not.toHaveBeenCalled();
    expect(db.options).toHaveLength(0);
  });
});
