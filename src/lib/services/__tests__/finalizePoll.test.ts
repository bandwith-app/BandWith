import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Every call in order: "<table>.<op>" plus the filters, so ordering can be checked. */
const log: string[] = [];
let claimRows: { id: string }[] = [{ id: 'p1' }];
let pollStatus = 'polling';
let invitedIds: string[] = [];
let bandRows: { user_id: string; role: string }[] = [];
let adminVotes: { id: string }[] = [];

const query = (table: string) => {
  let op = 'select';
  let payload: any = null;
  const filters: string[] = [];
  const q: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (res: (v: unknown) => void) => {
          log.push(`${table}.${op}${payload?.status ? `:${payload.status}` : ''}${filters.length ? `[${filters.join(',')}]` : ''}`);
          if (table === 'rehearsal_polls' && op === 'update' && payload?.status === 'confirmed') return res({ data: claimRows, error: null });
          if (table === 'band_members') return res({ data: bandRows, error: null });
          if (table === 'rehearsal_poll_votes' && op === 'select') return res({ data: adminVotes, error: null });
          return res({ data: [], error: null });
        };
      }
      if (prop === 'single') {
        return async () => {
          log.push(`${table}.single`);
          if (table === 'rehearsal_poll_options') return { data: { id: 'o1', proposed_date: '2026-12-01', start_time: '20:00' }, error: null };
          return { data: { id: 'p1', band_id: 'b1', title: 'Practice', status: pollStatus, invited_user_ids: invitedIds }, error: null };
        };
      }
      return (...args: unknown[]) => {
        if (prop === 'update' || prop === 'insert' || prop === 'delete' || prop === 'upsert') {
          op = String(prop);
          payload = args[0];
        } else if (prop === 'eq' || prop === 'not' || prop === 'is') {
          filters.push(`${String(prop)}:${args.map(String).join(':')}`);
        }
        return q;
      };
    },
  });
  return q;
};

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (t: string) => query(t), rpc: vi.fn() },
  getSafeUser: async () => ({ data: { user: { id: 'admin' } } }),
}));
vi.mock('../supabase', () => ({
  supabase: { from: (t: string) => query(t), rpc: vi.fn() },
  getSafeUser: async () => ({ data: { user: { id: 'admin' } } }),
}));

const createEvent = vi.fn();
vi.mock('../events', () => ({ createEvent: (...a: unknown[]) => createEvent(...a) }));
vi.mock('../bandMemberFees', () => ({ attachMemberFees: async (rows: unknown[]) => rows }));
vi.mock('../songs', () => ({ createSetlist: vi.fn(), deleteSetlist: vi.fn(async () => ({ error: null })) }));
vi.mock('../notifications', () => ({ createBulkNotifications: vi.fn(async () => ({ error: null })) }));

import { finalizePollIntoRehearsal, POLL_CLOSED } from '../rehearsalPolls';

const args = { pollId: 'p1', winningOptionId: 'o1', bandId: 'b1', location: 'Studio', adminId: 'admin' };

beforeEach(() => {
  log.length = 0;
  claimRows = [{ id: 'p1' }];
  pollStatus = 'polling';
  invitedIds = [];
  bandRows = [];
  adminVotes = [];
  createEvent.mockReset();
  createEvent.mockImplementation(async () => {
    log.push('createEvent');
    return { data: { id: 'e1' }, error: null };
  });
});

describe('finalizePollIntoRehearsal (lock in once)', () => {
  it('claims the poll before creating the rehearsal', async () => {
    const { error } = await finalizePollIntoRehearsal(args);
    expect(error).toBeNull();
    const claim = log.findIndex((l) => l.startsWith('rehearsal_polls.update:confirmed'));
    expect(claim).toBeGreaterThan(-1);
    expect(log[claim]).toContain('not:status:in:(confirmed,cancelled)');
    expect(claim).toBeLessThan(log.indexOf('createEvent'));
  });

  it('creates nothing when another admin locked it in first', async () => {
    claimRows = [];
    const { error } = await finalizePollIntoRehearsal(args);
    expect((error as { code?: string }).code).toBe(POLL_CLOSED);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('creates nothing on a poll that is already confirmed', async () => {
    pollStatus = 'confirmed';
    const { error } = await finalizePollIntoRehearsal(args);
    expect((error as { code?: string }).code).toBe(POLL_CLOSED);
    expect(createEvent).not.toHaveBeenCalled();
    expect(log.some((l) => l.startsWith('rehearsal_polls.update'))).toBe(false);
  });

  it('opens the poll again when the rehearsal cannot be created', async () => {
    createEvent.mockImplementation(async () => ({ data: null, error: new Error('boom') }));
    const { error } = await finalizePollIntoRehearsal(args);
    expect(error?.message).toBe('boom');
    expect(log.some((l) => l.startsWith('rehearsal_polls.update:polling'))).toBe(true);
  });
});

describe('finalizePollIntoRehearsal (who is on the rehearsal)', () => {
  const lineup = () => ((createEvent.mock.calls[0] as unknown[])[1] as { user_id: string; status: string }[]).map((r) => `${r.user_id}:${r.status}`);

  beforeEach(() => {
    bandRows = [
      { user_id: 'admin', role: 'admin' },
      { user_id: 'm1', role: 'member' },
      { user_id: 'm2', role: 'member' },
    ];
  });

  it('a poll for everyone puts the whole band on it, the admin confirmed', async () => {
    await finalizePollIntoRehearsal(args);
    expect(lineup()).toEqual(['admin:confirmed', 'm1:pending', 'm2:pending']);
  });

  it('an admin who was not invited and did not vote is not put on it', async () => {
    invitedIds = ['m1'];
    await finalizePollIntoRehearsal(args);
    expect(lineup()).toEqual(['m1:pending']);
  });

  it('an invited admin is on it', async () => {
    invitedIds = ['m1', 'admin'];
    await finalizePollIntoRehearsal(args);
    expect(lineup()).toEqual(['admin:confirmed', 'm1:pending']);
  });

  it('an admin who voted is on it', async () => {
    invitedIds = ['m1'];
    adminVotes = [{ id: 'v1' }];
    await finalizePollIntoRehearsal(args);
    expect(lineup()).toEqual(['admin:confirmed', 'm1:pending']);
  });
});

describe('finalizePollIntoRehearsal (notification)', () => {
  it('the locked-in notification shows a readable date, not the stored one', async () => {
    bandRows = [{ user_id: 'm1', role: 'member' }];
    const { createBulkNotifications } = await import('../notifications');
    await finalizePollIntoRehearsal(args);
    const calls = vi.mocked(createBulkNotifications).mock.calls;
    const rows = calls[calls.length - 1][0] as unknown as { body: string }[];
    expect(rows[0].body).toBe('Rehearsal locked in for Tue, Dec 1 at 20:00 (Studio).');
  });
});
