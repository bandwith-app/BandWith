import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Every call: "<table>.<op>[filters]"; `fail` maps "<table>.<op>" to the error it returns. */
const log: string[] = [];
let fail: Record<string, { code?: string; message: string }> = {};

const query = (table: string) => {
  let op = 'select';
  const filters: string[] = [];
  const q: any = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (res: (v: unknown) => void) => {
          log.push(`${table}.${op}${filters.length ? `[${filters.join(',')}]` : ''}`);
          return res({ data: null, error: fail[`${table}.${op}`] ?? null });
        };
      }
      return (...args: unknown[]) => {
        if (prop === 'insert' || prop === 'delete') op = String(prop);
        else if (prop === 'eq') filters.push(`${String(args[0])}:${String(args[1])}`);
        return q;
      };
    },
  });
  return q;
};

vi.mock('../../supabase', () => ({ supabase: { from: (t: string) => query(t) } }));
vi.mock('../events', () => ({ createEvent: vi.fn() }));
vi.mock('../songs', () => ({ createSetlist: vi.fn(), deleteSetlist: vi.fn() }));
vi.mock('../notifications', () => ({ createBulkNotifications: vi.fn() }));

import { setPollVote } from '../rehearsalPolls';

beforeEach(() => {
  log.length = 0;
  fail = {};
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('setPollVote (a set, not a toggle)', () => {
  it('voting inserts the vote and drops "None work"', async () => {
    expect(await setPollVote('p1', 'o1', 'u1', true)).toEqual({ error: null });
    expect(log).toEqual([
      'rehearsal_poll_votes.insert',
      'rehearsal_poll_unavailable.delete[poll_id:p1,user_id:u1]',
    ]);
  });

  it('a vote already there counts as done', async () => {
    fail['rehearsal_poll_votes.insert'] = { code: '23505', message: 'duplicate key' };
    expect((await setPollVote('p1', 'o1', 'u1', true)).error).toBeNull();
  });

  it('taking a vote back deletes only that option\'s vote, even when it is already gone', async () => {
    expect(await setPollVote('p1', 'o1', 'u1', false)).toEqual({ error: null });
    expect(log).toEqual(['rehearsal_poll_votes.delete[option_id:o1,user_id:u1]']);
  });

  it('returns the error a refused write gives', async () => {
    fail['rehearsal_poll_votes.insert'] = { code: '42501', message: 'voting closed' };
    const { error } = await setPollVote('p1', 'o1', 'u1', true);
    expect(error).toMatchObject({ code: '42501' });
  });
});
