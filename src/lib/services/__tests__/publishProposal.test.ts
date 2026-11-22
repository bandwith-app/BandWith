import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    expect(db.calls.some((c) => /^rehearsal_poll_options\.(delete|insert)/.test(c))).toBe(false);
  });

  it('the poll builder opened from a proposal works in the proposal\'s band', () => {
    expect(appSource).toMatch(/bandId=\{pollModalInitialProposal\?\.band_id \|\| realBand\.id\}/);
  });
});

describe('a publish cut off half-way on a database before 195 (Codex #297, Claude round 3)', () => {
  const mine = { ...args, clientId: 'req-1' };
  const mark = (suggestionIds: string[]) =>
    localStorage.setItem('bw-poll-publish:p1', JSON.stringify({ clientId: 'req-1', suggestionIds }));
  beforeEach(() => {
    localStorage.clear();
    db.updatedRows = []; // no longer 'proposed': the first try changed the status
    db.pollRow = { id: 'p1', band_id: 'band-B', status: 'polling' };
  });

  it('this device\'s own try, left with no options, is finished', async () => {
    mark(['s1']);
    db.options = [];
    const { error } = await createOrPublishAdminPoll(mine as any);
    expect(error).toBeNull();
    expect(db.calls).toContain('rehearsal_poll_options.insert');
    expect(notify).toHaveBeenCalled();
    expect(localStorage.getItem('bw-poll-publish:p1')).toBeNull();
  });

  it('its leftover suggestions (the ones it saw, no votes) are cleared, then the options go in', async () => {
    mark(['s1']);
    db.options = [{ id: 's1', proposed_date: '2099-12-01', start_time: '19:00:00', end_time: null }];
    const { error } = await createOrPublishAdminPoll(mine as any);
    expect(error).toBeNull();
    const del = db.calls.findIndex((c) => c.startsWith('rehearsal_poll_options.delete'));
    expect(del).toBeGreaterThan(-1);
    expect(db.calls.indexOf('rehearsal_poll_options.insert')).toBeGreaterThan(del);
  });

  it('its own options already in (the answer was lost): notifies, adds nothing', async () => {
    mark(['s1']);
    db.options = [{ id: 'o1', proposed_date: '2099-12-07', start_time: '20:00:00', end_time: '22:00:00' }];
    const { error } = await createOrPublishAdminPoll(mine as any);
    expect(error).toBeNull();
    expect(db.calls).not.toContain('rehearsal_poll_options.insert');
    expect(notify).toHaveBeenCalled();
  });

  it('live options (another admin\'s, or after a released lock-in) are never cleared', async () => {
    mark(['s1']);
    db.options = [{ id: 'o9', proposed_date: '2099-12-20', start_time: '19:00:00', end_time: null }];
    const { error } = await createOrPublishAdminPoll(mine as any);
    expect((error as any)?.code).toBe('poll_already_published');
    expect(db.calls.some((c) => c.startsWith('rehearsal_poll_options.delete'))).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('no marker of this request on this device: "already published", nothing sent', async () => {
    db.options = [];
    const { error } = await createOrPublishAdminPoll({ ...args, clientId: 'req-2' } as any);
    expect((error as any)?.code).toBe('poll_already_published');
    expect(db.calls).not.toContain('rehearsal_poll_options.insert');
    expect(notify).not.toHaveBeenCalled();
  });

  it('a declined proposal does not say "turned into a poll"', async () => {
    mark(['s1']);
    db.pollRow = { id: 'p1', band_id: 'band-B', status: 'cancelled' };
    const { error } = await createOrPublishAdminPoll(mine as any);
    expect((error as any)?.code).toBe('poll_already_published');
    expect(String((error as any)?.message)).not.toMatch(/turned this proposal into a poll/);
  });
});

describe('195: the request id decides (Codex #297 round 3 B1)', () => {
  it('sends the form\'s request id', async () => {
    db.rpc = { data: { published: true, poll_id: 'p1', band_id: 'band-B', status: 'polling' }, error: null };
    await createOrPublishAdminPoll({ ...args, clientId: 'req-1' } as any);
    expect(db.calls.find((c) => c.startsWith('rpc:bw_publish_rehearsal_proposal'))).toContain('"p_client_id":"req-1"');
  });

  it('another request with the same slots and other invitees: "already published", nothing sent', async () => {
    db.rpc = { data: { published: false, poll_id: 'p1', band_id: 'band-B', status: 'polling' }, error: null };
    db.pollRow = { id: 'p1', band_id: 'band-B', status: 'polling' };
    db.options = [{ id: 'o1', proposed_date: '2099-12-07', start_time: '20:00:00', end_time: '22:00:00' }];
    const { error } = await createOrPublishAdminPoll({ ...args, clientId: 'req-2', invitedUserIds: ['b-member'] } as any);
    expect((error as any)?.code).toBe('poll_already_published');
    expect(notify).not.toHaveBeenCalled();
    expect(db.calls.some((c) => /^rehearsal_poll_options\./.test(c))).toBe(false);
  });

  it('its own request replayed after a lost answer: notifies, adds nothing', async () => {
    db.rpc = { data: { published: true, replayed: true, poll_id: 'p1', band_id: 'band-B', status: 'polling' }, error: null };
    const { error } = await createOrPublishAdminPoll({ ...args, clientId: 'req-1' } as any);
    expect(error).toBeNull();
    expect(db.calls).not.toContain('rehearsal_poll_options.insert');
    expect(notify).toHaveBeenCalled();
  });

  it('declined or expired: says it is no longer open', async () => {
    db.rpc = { data: { published: false, poll_id: 'p1', band_id: 'band-B', status: 'expired' }, error: null };
    const { error } = await createOrPublishAdminPoll({ ...args, clientId: 'req-1' } as any);
    expect(String((error as any)?.message)).toMatch(/no longer open/);
  });
});

describe('who is told: the invite list stored with the poll (Claude #297 r5 minor 8)', () => {
  const { invitedUserIds: _omit, ...noInvitees } = args;
  const bandB = db.members['band-B'];
  afterEach(() => { db.members['band-B'] = bandB; });

  it('195: a publish that leaves invitees out tells only the invitees the database kept', async () => {
    db.members['band-B'] = ['a-admin', 'b-member', 'b-other'];
    db.rpc = { data: { published: true, poll_id: 'p1', band_id: 'band-B', status: 'polling', invited_user_ids: ['b-member', 'a-admin'] }, error: null };
    await createOrPublishAdminPoll(noInvitees as any);
    const sent = (notify.mock.calls[0] as unknown[])[0] as { user_id: string }[];
    expect(sent.map((n) => n.user_id)).toEqual(['b-member']);
  });

  it('195: its own request replayed tells the stored invitees too', async () => {
    db.members['band-B'] = ['a-admin', 'b-member', 'b-other'];
    db.rpc = { data: { published: true, replayed: true, poll_id: 'p1', band_id: 'band-B', status: 'polling', invited_user_ids: ['b-other'] }, error: null };
    await createOrPublishAdminPoll({ ...noInvitees, clientId: 'req-1' } as any);
    const sent = (notify.mock.calls[0] as unknown[])[0] as { user_id: string }[];
    expect(sent.map((n) => n.user_id)).toEqual(['b-other']);
  });

  it('older database: reads the stored list before telling anyone', async () => {
    db.members['band-B'] = ['a-admin', 'b-member', 'b-other'];
    db.rpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    db.pollRow = { id: 'p1', band_id: 'band-B', status: 'polling', invited_user_ids: ['b-member', 'a-admin'] } as any;
    await createOrPublishAdminPoll(noInvitees as any);
    const sent = (notify.mock.calls[0] as unknown[])[0] as { user_id: string }[];
    expect(sent.map((n) => n.user_id)).toEqual(['b-member']);
  });

  it('a stored list that is empty means the whole band', async () => {
    db.members['band-B'] = ['a-admin', 'b-member', 'b-other'];
    db.rpc = { data: { published: true, poll_id: 'p1', band_id: 'band-B', status: 'polling', invited_user_ids: [] }, error: null };
    await createOrPublishAdminPoll(noInvitees as any);
    const sent = (notify.mock.calls[0] as unknown[])[0] as { user_id: string }[];
    expect(sent.map((n) => n.user_id).sort()).toEqual(['b-member', 'b-other']);
  });
});
