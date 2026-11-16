import { describe, expect, it } from 'vitest';
import { lineupCleared, newEventInvites } from '../eventLineup';

describe('lineupCleared', () => {
  it('is true only when an edit takes everyone off a lineup that had people', () => {
    expect(lineupCleared(true, 2, 0)).toBe(true);
    expect(lineupCleared(true, 2, 1)).toBe(false);
    // Lineup not loaded when the form opened: an empty one means "unchanged".
    expect(lineupCleared(true, 0, 0)).toBe(false);
    expect(lineupCleared(false, 0, 0)).toBe(false);
  });
});

describe('newEventInvites', () => {
  it('invites the lineup, never the creator', () => {
    expect(newEventInvites(false, ['admin', 'm1', 'm2'], 'admin', 5)).toEqual({ send: true, pendingCount: 2 });
  });

  it('a gig without the admin invites only who plays', () => {
    expect(newEventInvites(false, ['m1'], 'admin', 5)).toEqual({ send: true, pendingCount: 1 });
  });

  it('a gig with nobody on it invites no one (not the whole band)', () => {
    expect(newEventInvites(false, [], 'admin', 5)).toEqual({ send: false, pendingCount: 0 });
  });

  it('a rehearsal with no list still goes to the whole band', () => {
    expect(newEventInvites(true, [], 'admin', 5)).toEqual({ send: true, pendingCount: 4 });
  });
});
