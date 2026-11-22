// Codex review #285 round 3: Home's Upcoming list opens a later date of a
// repeating rehearsal; the detail (and its "Add to calendar") must be that
// date, not the series' first one.
import { describe, expect, it } from 'vitest';
import * as occ from '../eventOccurrence';
import home from '../../app/views/HomeView.tsx?raw';
import app from '../../app/AuthenticatedApp.tsx?raw';

const series = { id: 'ev-1', eventId: 'ev-1', date: '2026-11-24', isRecurring: true, title: 'Weekly' };

describe('opening one date of a series', () => {
  it('is that date, as the calendar opens it', () => {
    const at = (occ as { atOccurrence?: typeof occ.atOccurrence }).atOccurrence;
    expect(typeof at).toBe('function');
    expect(at!(series, '2026-12-08')).toEqual({ ...series, date: '2026-12-08', id: 'ev-1-occ-2026-12-08' });
    // The first date, no date or a malformed one: the event as it is.
    expect(at!(series, '2026-11-24')).toBe(series);
    expect(at!(series, undefined)).toBe(series);
    expect(at!(series, 'soon')).toBe(series);
  });

  it('Home passes the date it shows; the app opens the event at it', () => {
    expect(home).toMatch(/onSelectEvent\(eventId, occurrenceOf\(event\)\)/);
    expect(app).toMatch(/const navigateToEvent = useCallback\(async \(eventDbId: string, occurrence\?: string\) =>/);
    expect(app).toMatch(/handleEventCardClickRef\.current\(atOccurrence\(ev, occurrence\)\)/);
  });
});
