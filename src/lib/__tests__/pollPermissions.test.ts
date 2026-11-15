import { describe, expect, it } from 'vitest';
import { canDeletePoll, canVoteInPoll, canWithdrawProposal, pollNotifyTargets } from '../pollPermissions';

describe('canDeletePoll (073)', () => {
  it('lets admins delete any poll', () => {
    expect(canDeletePoll({ status: 'polling', created_by: 'm1' }, 'a1', true)).toBe(true);
  });

  it('lets the creator delete only while it is a proposal', () => {
    expect(canDeletePoll({ status: 'proposed', created_by: 'm1' }, 'm1', false)).toBe(true);
    expect(canDeletePoll({ status: 'polling', created_by: 'm1' }, 'm1', false)).toBe(false);
    expect(canDeletePoll({ status: 'proposed', created_by: 'm1' }, 'm2', false)).toBe(false);
  });
});

describe('canWithdrawProposal', () => {
  it('is for the proposer of a pending proposal', () => {
    expect(canWithdrawProposal({ status: 'proposed', created_by: 'm1' }, 'm1')).toBe(true);
    expect(canWithdrawProposal({ status: 'cancelled', created_by: 'm1' }, 'm1')).toBe(false);
    expect(canWithdrawProposal({ status: 'proposed', created_by: 'm1' }, 'm2')).toBe(false);
  });
});

describe('canVoteInPoll (098)', () => {
  it('lets everyone vote on a poll without an invite list', () => {
    expect(canVoteInPoll({ invited_user_ids: [] }, 'x')).toBe(true);
    expect(canVoteInPoll({}, 'x')).toBe(true);
  });

  it('lets only invitees vote, admins included', () => {
    const poll = { invited_user_ids: ['a1', 'm1'] };
    expect(canVoteInPoll(poll, 'm1')).toBe(true);
    expect(canVoteInPoll(poll, 'a2')).toBe(false);
    expect(canVoteInPoll(poll, null)).toBe(false);
  });
});

describe('pollNotifyTargets', () => {
  it('leaves out the admin who published the poll', () => {
    expect(pollNotifyTargets(['a1', 'm1', 'm2', 'm1'], [], 'a1')).toEqual(['m1', 'm2']);
  });

  it('keeps to the invite list', () => {
    expect(pollNotifyTargets(['a1', 'm1', 'm2'], ['a1', 'm2'], 'a1')).toEqual(['m2']);
  });
});
