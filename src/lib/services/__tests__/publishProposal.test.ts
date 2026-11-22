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
            return res({ data: [], error: null });
          };
        }
        if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
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
