import { describe, it, expect, vi, beforeEach } from 'vitest';
import appSource from '@/app/AuthenticatedApp.tsx?raw';

/**
 * Audit 05 #1 and #8: publishing a member's proposal.
 * #1 the proposal's own band is told, not the band the app has selected.
 * #8 a second admin's stale form never deletes the options members voted on.
 */
const db = vi.hoisted(() => ({
  rpc: null as null | { data?: unknown; error?: unknown },
  calls: [] as string[],
  updatedRows: [{ id: 'p1', band_id: 'band-B' }] as unknown[],
  members: { 'band-A': ['a-admin', 'a-member'], 'band-B': ['a-admin', 'b-member'] } as Record<string, string[]>,
  // The stored poll, for the "cut off half-way" check (Codex #297).
  pollRow: null as null | { id: string; band_id: string; status: string; updated_at?: string },
  options: [{ proposed_date: '2099-12-01', start_time: '19:00:00', end_time: null, created_at: '2099-01-02T00:00:00Z' }] as Record<string, unknown>[],
  voteCount: 0,
}));

vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    let op = 'select';
    const filters: Record<string, unknown> = {};
    const q: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (res: (v: unknown) => void) => {
            db.calls.push(`${table}.${op}${Object.keys(filters).length ? ':' + Object.entries(filters).map(([k, v]) => `${k}=${v}`).join(',') : ''}`);
            if (table === 'band_members') return res({ data: (db.members[filters.band_id as string] || []).map((user_id) => ({ user_id })), error: null });
            if (table === 'rehearsal_polls' && op === 'update') return res({ data: db.updatedRows, error: null });
            if (table === 'rehearsal_poll_options' && op === 'select') return res({ data: db.options, count: db.options.length, error: null });
            if (table === 'rehearsal_poll_votes' && op === 'select') return res({ data: [], count: db.voteCount, error: null });
            return res({ data: [], error: null });
          };
        }
        if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: table === 'rehearsal_polls' ? db.pollRow : null, error: null });
        return (...args: unknown[]) => {
          if (prop === 'update' || prop === 'delete' || prop === 'insert') op = String(prop);
          if (prop === 'eq') filters[String(args[0])] = args[1];
          return q;
        };
      },
    });
    return q;
  };
  return {
    supabase: {
      from,
      rpc: async (name: string, args: unknown) => {
        db.calls.push(`rpc:${name}:${JSON.stringify(args)}`);
        return db.rpc ?? { data: null, error: null };
      },
    },
  };
});
vi.mock('../events', () => ({ createEvent: vi.fn() }));
vi.mock('../songs', () => ({ createSetlist: vi.fn(), deleteSetlist: vi.fn() }));
const notify = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock('../notifications', () => ({ createBulkNotifications: notify, createNotification: vi.fn() }));

import { createOrPublishAdminPoll } from '../rehearsalPolls';

const args = {
  pollId: 'p1',
  // The band selected in the app (A); the proposal is band B's.
  bandId: 'band-A',
  adminId: 'a-admin',
  title: 'Band B rehearsal',
  notes: '',
  voteBy: null,
  location: 'Rehearsal Room 2, Queens',
  roomCost: null,
  focusSongIds: [],
  invitedUserIds: [],
  voteByTime: null,
  timeSlots: [{ proposed_date: '2099-12-07', start_time: '20:00', end_time: '22:00' }],
};

beforeEach(() => {
  db.rpc = null;
  db.calls.length = 0;
  db.updatedRows = [{ id: 'p1', band_id: 'band-B' }];
  db.pollRow = null;
  db.options = [{ proposed_date: '2099-12-01', start_time: '19:00:00', end_time: null, created_at: '2099-01-02T00:00:00Z' }];
  db.voteCount = 0;
  notify.mockClear();
});

describe('publishing a proposal (audit 05 #1 #8)', () => {
  it('publishes in one call and tells the proposal\'s band, not the selected one', async () => {
    db.rpc = { data: { published: true, poll_id: 'p1', band_id: 'band-B', status: 'polling' }, error: null };
    await createOrPublishAdminPoll(args);
    const rpc = db.calls.find((c) => c.startsWith('rpc:bw_publish_rehearsal_proposal'));
    expect(rpc).toBeTruthy();
    expect(JSON.parse(rpc!.split(':').slice(2).join(':'))).toMatchObject({
      p_poll_id: 'p1',
      p_options: [{ proposed_date: '2099-12-07', start_time: '20:00', end_time: '22:00' }],
    });
    // No separate update / option delete / option insert that could run on a poll already voted on.
    expect(db.calls.some((c) => /^rehearsal_poll(s|_options)\.(update|delete|insert)/.test(c))).toBe(false);
    expect(db.calls).toContain('band_members.select:band_id=band-B,is_active=true');
    const sent = (notify.mock.calls[0] as unknown[])[0] as { user_id: string; band_id: string }[];
    expect(sent.map((n) => n.user_id)).toEqual(['b-member']);
    expect(sent.every((n) => n.band_id === 'band-B')).toBe(true);
  });

  it('a stale second publish changes nothing and says another admin did it', async () => {
    db.rpc = { data: { published: false, poll_id: 'p1', band_id: 'band-B', status: 'polling' }, error: null };
    const { error } = await createOrPublishAdminPoll(args);
    expect((error as any)?.code).toBe('poll_already_published');
    expect(notify).not.toHaveBeenCalled();
    expect(db.calls.some((c) => /^rehearsal_poll_options\./.test(c))).toBe(false);
  });

  it('older database: updates only while it is a proposal, and the stored band is told', async () => {
    db.rpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    await createOrPublishAdminPoll(args);
    expect(db.calls).toContain('rehearsal_polls.update:id=p1,status=proposed');
    expect(db.calls).toContain('band_members.select:band_id=band-B,is_active=true');
    db.calls.length = 0;
    db.updatedRows = [];
    const { error } = await createOrPublishAdminPoll(args);
    expect((error as any)?.code).toBe('poll_already_published');
    expect(db.calls.some((c) => /^rehearsal_poll_options\./.test(c))).toBe(false);
  });

  it('the poll builder opened from a proposal works in the proposal\'s band', () => {
    expect(appSource).toMatch(/bandId=\{pollModalInitialProposal\?\.band_id \|\| realBand\.id\}/);
  });
});

describe('a publish cut off half-way on a database before 195 (Codex #297)', () => {
  it('a poll left with no options is finished on retry, not reported as already published', async () => {
    db.updatedRows = []; // no longer 'proposed': the first try changed the status
    db.pollRow = { id: 'p1', band_id: 'band-B', status: 'polling', updated_at: '2099-01-03T00:00:00Z' };
    db.options = [];
    const { error } = await createOrPublishAdminPoll(args as any);
    expect(error).toBeNull();
    expect(db.calls).toContain('rehearsal_poll_options.insert');
    expect(db.calls.some((c) => c.startsWith('rehearsal_poll_options.delete'))).toBe(false);
    expect(notify).toHaveBeenCalled();
  });

  it('a poll that has its options is still "already published"', async () => {
    db.updatedRows = [];
    // Another admin's poll: its own options, added after it was published, with votes.
    db.pollRow = { id: 'p1', band_id: 'band-B', status: 'polling', updated_at: '2099-01-03T00:00:00Z' };
    db.options = [{ proposed_date: '2099-12-20', start_time: '19:00:00', end_time: null, created_at: '2099-01-03T00:00:01Z' }];
    db.voteCount = 2;
    const { error } = await createOrPublishAdminPoll(args as any);
    expect((error as any)?.code ?? (error as any)?.message).toMatch(/poll_already_published|already/i);
    expect(db.calls).not.toContain('rehearsal_poll_options.insert');
  });
});

describe('a publish whose answer was lost (Codex / Claude #297 round 3)', () => {
  it('195: the retry sees its own poll (same options), notifies, and does not say "Another admin"', async () => {
    db.rpc = { data: { published: false, poll_id: 'p1', band_id: 'band-B', status: 'polling' }, error: null };
    db.pollRow = { id: 'p1', band_id: 'band-B', status: 'polling', updated_at: '2099-01-03T00:00:00Z' };
    db.options = [{ proposed_date: '2099-12-07', start_time: '20:00:00', end_time: '22:00:00', created_at: '2099-01-03T00:00:00Z' }];
    const { error } = await createOrPublishAdminPoll(args as any);
    expect(error).toBeNull();
    expect(db.calls).not.toContain('rehearsal_poll_options.insert');
    expect(notify).toHaveBeenCalled();
  });

  it("before 195: the proposal's suggestions left behind are cleared and the poll's options go in", async () => {
    db.updatedRows = [];
    db.pollRow = { id: 'p1', band_id: 'band-B', status: 'polling', updated_at: '2099-01-03T00:00:00Z' };
    // The member's suggestion, from before the status change; nobody voted.
    db.options = [{ proposed_date: '2099-12-01', start_time: '19:00:00', end_time: null, created_at: '2099-01-02T00:00:00Z' }];
    const { error } = await createOrPublishAdminPoll(args as any);
    expect(error).toBeNull();
    const del = db.calls.findIndex((c) => c.startsWith('rehearsal_poll_options.delete'));
    const ins = db.calls.indexOf('rehearsal_poll_options.insert');
    expect(del).toBeGreaterThan(-1);
    expect(ins).toBeGreaterThan(del);
    expect(notify).toHaveBeenCalled();
  });
});
