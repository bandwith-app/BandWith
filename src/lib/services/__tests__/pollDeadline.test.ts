import { describe, it, expect, vi } from 'vitest';

/**
 * Audit 05 #11: a poll closes when the database says, not hours early for a
 * member whose phone is in another time zone than the creator's.
 */
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'America/New_York';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: async (name: string) =>
      name === 'bw_poll_vote_deadlines'
        ? { data: [{ poll_id: 'p1', vote_deadline: '2099-12-12T02:00:00+00:00' }, { poll_id: 'p2', vote_deadline: null }], error: null }
        : { data: null, error: null },
  },
}));
vi.mock('../events', () => ({ createEvent: vi.fn() }));
vi.mock('../songs', () => ({ createSetlist: vi.fn(), deleteSetlist: vi.fn() }));
vi.mock('../notifications', () => ({ createBulkNotifications: vi.fn(), createNotification: vi.fn() }));

import * as polls from '../rehearsalPolls';

// Creator in Los Angeles: "vote by Fri 11 Dec, 18:00" = 02:00 UTC on the 12th.
const poll = { vote_by: '2099-12-11', vote_by_time: '18:00', vote_deadline: '2099-12-12T02:00:00+00:00' };

describe('vote-by deadline (audit 05 #11)', () => {
  it('uses the server deadline: still open at 01:00 UTC for a member in New York', () => {
    expect(polls.isPollVotingClosed(poll, new Date('2099-12-12T01:00:00Z'))).toBe(false);
    expect(polls.isPollVotingClosed(poll, new Date('2099-12-12T02:00:01Z'))).toBe(true);
  });

  it('no deadline from the server means none, whatever vote_by says', () => {
    expect(polls.pollVoteDeadline({ ...poll, vote_deadline: null })).toBeNull();
  });

  it('loads the server deadlines for the polls', async () => {
    const getPollVoteDeadlines = (polls as any).getPollVoteDeadlines;
    const map: Map<string, string | null> = await getPollVoteDeadlines(['p1', 'p2']);
    expect(map.get('p1')).toBe('2099-12-12T02:00:00+00:00');
    expect(map.has('p2') && map.get('p2')).toBeNull();
  });
});
