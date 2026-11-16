import { describe, expect, it } from 'vitest';
import { isProposalExpired, proposalLastDay } from '../proposalExpiry';

// Local times: 17 Nov 2026 is a Tuesday.
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h, 0).toISOString();
const tue = at(2026, 11, 17);

describe('proposalLastDay', () => {
  it('is the last of the next occurrences of the preferred weekdays', () => {
    expect(proposalLastDay(tue, ['Wed', 'Sat'])).toBe('2026-11-21');
    expect(proposalLastDay(tue, ['Mon'])).toBe('2026-11-23');
    expect(proposalLastDay(tue, ['Wed'])).toBe('2026-11-18');
  });

  it('reads the same weekday as next week’s', () => {
    expect(proposalLastDay(tue, ['Tue'])).toBe('2026-11-24');
    expect(proposalLastDay(tue, ['Tue', 'Wed'])).toBe('2026-11-24');
  });

  it('is 7 days later with no (valid) day picked', () => {
    expect(proposalLastDay(tue, [])).toBe('2026-11-24');
    expect(proposalLastDay(tue, null)).toBe('2026-11-24');
    expect(proposalLastDay(tue, ['someday'])).toBe('2026-11-24');
  });

  it('accepts full or lower-case names and crosses month ends', () => {
    expect(proposalLastDay(tue, ['thursday'])).toBe('2026-11-19');
    expect(proposalLastDay(at(2026, 11, 30), ['Sun'])).toBe('2026-12-06');
  });

  it('is null for a bad date', () => {
    expect(proposalLastDay('nope', ['Mon'])).toBeNull();
  });
});

describe('isProposalExpired', () => {
  const proposal = { status: 'proposed', created_at: tue, preferred_days: ['Wed', 'Sat'] };

  it('stays open through its last day and expires the day after', () => {
    expect(isProposalExpired(proposal, new Date(2026, 10, 18, 9))).toBe(false);
    expect(isProposalExpired(proposal, new Date(2026, 10, 21, 23, 59))).toBe(false);
    expect(isProposalExpired(proposal, new Date(2026, 10, 22, 0, 1))).toBe(true);
  });

  it('never expires a poll or a confirmed rehearsal', () => {
    const late = new Date(2027, 0, 1);
    expect(isProposalExpired({ ...proposal, status: 'polling' }, late)).toBe(false);
    expect(isProposalExpired({ ...proposal, status: 'confirmed' }, late)).toBe(false);
    expect(isProposalExpired({ status: 'proposed', created_at: null }, late)).toBe(false);
  });
});
