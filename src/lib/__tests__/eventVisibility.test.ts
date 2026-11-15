import { describe, it, expect } from 'vitest';
import { canSeeEvent, eventWarningKeys, visibleEventsFor } from '../eventVisibility';

const ME = 'me';
const lineups: Record<string, { userId: string; status?: string }[]> = {
  onIt: [{ userId: ME, status: 'confirmed' }],
  declined: [{ userId: ME, status: 'declined' }],
  notOnIt: [{ userId: 'other', status: 'pending' }],
  ownBandGig: [],
};
const ctx = {
  userId: ME,
  membersOf: (id: string) => lineups[id] || [],
  // Admin of band A, member of band M.
  isAdminOfBand: (bandId?: string | null) => bandId === 'A',
};

describe('calendar visibility (calendar and its search)', () => {
  it('members see only the band events they are on and haven’t declined', () => {
    expect(canSeeEvent({ eventId: 'onIt', band_id: 'M', status: 'CONFIRMED' }, ctx)).toBe(true);
    expect(canSeeEvent({ eventId: 'notOnIt', band_id: 'M', status: 'CONFIRMED' }, ctx)).toBe(false);
    expect(canSeeEvent({ eventId: 'declined', band_id: 'M', status: 'CONFIRMED' }, ctx)).toBe(false);
  });

  it('never shows quotes to members, by the role in each event’s band', () => {
    expect(canSeeEvent({ eventId: 'onIt', band_id: 'M', status: 'QUOTE' }, ctx)).toBe(false);
    expect(canSeeEvent({ eventId: 'onIt', band_id: 'M', eventType: 'quote' }, ctx)).toBe(false);
    // Same user, band they manage: quotes and gigs they aren't on show.
    expect(canSeeEvent({ eventId: 'ownBandGig', band_id: 'A', status: 'QUOTE' }, ctx)).toBe(true);
    expect(canSeeEvent({ eventId: 'notOnIt', band_id: 'A', status: 'CONFIRMED' }, ctx)).toBe(true);
    expect(canSeeEvent({ eventId: 'declined', band_id: 'A', status: 'CONFIRMED' }, ctx)).toBe(false);
  });

  it('keeps own personal gigs and pending offline rows', () => {
    expect(canSeeEvent({ eventId: 'x', band_id: null, createdBy: ME }, ctx)).toBe(true);
    expect(canSeeEvent({ band_id: 'M', status: 'CONFIRMED' }, ctx)).toBe(true);
  });

  it('builds the search pool from every band with the same rule', () => {
    const pool = visibleEventsFor(
      [
        { eventId: 'onIt', band_id: 'M', status: 'CONFIRMED' },
        { eventId: 'notOnIt', band_id: 'M', status: 'CONFIRMED' },
        { eventId: 'ownBandGig', band_id: 'A', status: 'QUOTE' },
      ],
      ctx,
    );
    expect(pool.map((e) => e.eventId)).toEqual(['onIt', 'ownBandGig']);
  });
});

describe('card warnings', () => {
  const gig = { status: 'CONFIRMED', location: 'Blue Note', date: '2026-12-12', price: '' };
  it('shows Missing fee only to who manages the gig (the fee is admin-only)', () => {
    expect(eventWarningKeys(gig, true)).toEqual(['Missing fee']);
    expect(eventWarningKeys(gig, false)).toEqual([]);
  });
  it('keeps venue and date warnings for everyone, and no fee warning on rehearsals', () => {
    expect(eventWarningKeys({ status: 'REHEARSAL', eventType: 'rehearsal', location: 'TBD' }, true)).toEqual(['Missing venue', 'Missing date']);
    expect(eventWarningKeys({ ...gig, location: '' }, false)).toEqual(['Missing venue']);
  });
});
