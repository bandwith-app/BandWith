import { describe, it, expect } from 'vitest';
import { inPrefetchWindow, prefetchSetlistIds } from '../audioPrefetch';

const admin = (bandId?: string) => bandId === 'b1';

describe('audio pre-download: which gigs', () => {
  it('upcoming confirmed band gigs within 3 days, with a setlist, where I am admin', () => {
    const ids = prefetchSetlistIds(
      [
        { setlistId: 'today', date: '2026-11-20', status: 'CONFIRMED', band_id: 'b1' },
        { setlistId: 'in3', date: '2026-11-23', status: 'CONFIRMED', band_id: 'b1' },
        { setlistId: 'in4', date: '2026-11-24', status: 'CONFIRMED', band_id: 'b1' },
        { setlistId: 'past', date: '2026-11-19', status: 'CONFIRMED', band_id: 'b1' },
        { setlistId: 'member', date: '2026-11-21', status: 'CONFIRMED', band_id: 'b2' },
        { setlistId: 'quote', date: '2026-11-21', status: 'QUOTE', band_id: 'b1' },
        { setlistId: 'cancelled', date: '2026-11-21', status: 'DRAFT', band_id: 'b1' },
        { setlistId: 'rehearsal', date: '2026-11-21', status: 'REHEARSAL', band_id: 'b1', eventType: 'rehearsal' },
        { date: '2026-11-21', status: 'CONFIRMED', band_id: 'b1' },
        { setlistId: 'personal', date: '2026-11-21', status: 'CONFIRMED' },
        { setlistId: 'today', date: '2026-11-20', status: 'CONFIRMED', band_id: 'b1' },
      ],
      admin,
      '2026-11-20',
    );
    expect(ids).toEqual(['today', 'in3']);
  });

  it('the window: today up to 3 days ahead', () => {
    expect(inPrefetchWindow('2026-11-20', '2026-11-20')).toBe(true);
    expect(inPrefetchWindow('2026-11-23', '2026-11-20')).toBe(true);
    expect(inPrefetchWindow('2026-11-24', '2026-11-20')).toBe(false);
    expect(inPrefetchWindow('2026-11-19', '2026-11-20')).toBe(false);
    // Across a month end.
    expect(inPrefetchWindow('2026-12-02', '2026-11-30')).toBe(true);
  });
});
