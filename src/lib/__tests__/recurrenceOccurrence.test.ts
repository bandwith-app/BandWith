import { describe, it, expect } from 'vitest';
import { occurrenceOn } from '../recurrenceSkips';

/**
 * Codex #297 B1: a repeating rehearsal opened from Home, search or a push
 * must open on the date the user picked (or the next one still on), so
 * "Delete this date" takes out that date and not the first of the series.
 */
const series = {
  eventId: 'ev',
  date: '2099-12-01',
  is_recurring: true,
  recurrence_rule: { frequency: 'weekly', interval: 1, skip_dates: ['2099-12-15'] },
};

describe('occurrenceOn', () => {
  it('opens the picked date of the series', () => {
    expect(occurrenceOn(series, '2099-12-08')?.date).toBe('2099-12-08');
    expect(occurrenceOn(series, '2099-12-08T00:00:00')?.date).toBe('2099-12-08');
  });

  it('keeps the row itself for its own date and for an event that does not repeat', () => {
    expect(occurrenceOn(series, '2099-12-01')).toBe(series);
    const once = { eventId: 'g', date: '2099-12-01', is_recurring: false, recurrence_rule: null };
    expect(occurrenceOn(once, '2099-12-08')).toBe(once);
    expect(occurrenceOn(once, null, '2099-12-05')).toBe(once);
  });

  it('with no date, opens the next date still on from the given day', () => {
    expect(occurrenceOn(series, null, '2099-12-09')?.date).toBe('2099-12-22'); // 15th was deleted
    expect(occurrenceOn(series, null, '2099-11-01')).toBe(series);
  });

  it('a deleted first date moves to the next one; nothing left gives null', () => {
    const firstGone = { ...series, recurrence_rule: { frequency: 'weekly', interval: 2, skip_dates: ['2099-12-01'] } };
    expect(occurrenceOn(firstGone, null)?.date).toBe('2099-12-15');
    const ended = { ...series, recurrence_rule: { frequency: 'weekly', until: '2099-12-08', skip_dates: ['2099-12-01', '2099-12-08'] } };
    expect(occurrenceOn(ended, null)).toBeNull();
  });

  it('follows monthly and biweekly series and the count limit', () => {
    const monthly = { ...series, recurrence_rule: { freq: 'monthly' } };
    expect(occurrenceOn(monthly, null, '2099-12-02')?.date).toBe('2100-01-01');
    const biweekly = { ...series, recurrence_rule: { frequency: 'biweekly' } };
    expect(occurrenceOn(biweekly, null, '2099-12-02')?.date).toBe('2099-12-15');
    const two = { ...series, recurrence_rule: { frequency: 'weekly', count: 1 } };
    expect(occurrenceOn(two, null, '2099-12-02')?.date).toBe('2099-12-08');
    expect(occurrenceOn(two, null, '2099-12-09')).toBeNull();
  });
});

import { eventCardPatch, eventCardValues, changedPatch, eventDataPatch } from '../eventOverviewEdit';

/**
 * Opened on a later date, the series still starts on its first date: an
 * edit of the title or time must not move the series to the date on screen
 * (that would drop every earlier date).
 */
describe('editing one date of a series', () => {
  it('the opened date remembers where the series starts', () => {
    expect(occurrenceOn(series, '2099-12-08')).toMatchObject({ date: '2099-12-08', seriesDate: '2099-12-01' });
    expect(occurrenceOn(series, null, '2099-12-09')).toMatchObject({ date: '2099-12-22', seriesDate: '2099-12-01' });
  });

  it('the overview Event card keeps the series start unless the date was changed', () => {
    const ev = { title: 'Weekly', eventType: 'rehearsal', time: '19:00', ...occurrenceOn(series, '2099-12-08')! } as any;
    const renamed = changedPatch(ev, eventCardPatch('rehearsal', { ...eventCardValues(ev), title: 'Weekly jam' }, ev));
    expect(renamed).not.toHaveProperty("event_date");
    expect(eventDataPatch(renamed!, ev).date).toBeUndefined(); // the date on screen stays
    const moved = changedPatch(ev, eventCardPatch('rehearsal', { ...eventCardValues(ev), date: '2099-12-09' }, ev, 'series'));
    expect(moved?.event_date).toBe('2099-12-02');
    expect(changedPatch(ev, eventCardPatch('rehearsal', eventCardValues(ev), ev))).toBeNull();
  });
});

import appSrc from '@/app/AuthenticatedApp.tsx?raw';

describe('the app', () => {
  it('a Calendar date of a series opens knowing the series start; the wizard keeps it', () => {
    expect(appSrc).toMatch(/seriesDate: series\.date/);
    expect(appSrc).toMatch(/occurrenceStart\(editingEventData, date, !!eventData\.is_recurring, 'series'\)/);
  });
});

/** Codex #297 round 3 B3 and Claude's occurrence-edit minors. */
describe('the Event card on one date of a series', () => {
  const at = { title: 'Weekly', eventType: 'rehearsal', time: '19:00', ...occurrenceOn(series, '2099-12-08')! } as any;

  it('a rename never writes the series start', () => {
    const patch = changedPatch(at, eventCardPatch('rehearsal', { ...eventCardValues(at), title: 'Weekly jam' }, at));
    expect(patch).not.toHaveProperty('event_date');
    expect(patch?.title).toBe('Weekly jam');
  });

  it('switched to "once", it keeps the date it shows', () => {
    const patch = changedPatch(at, eventCardPatch('rehearsal', { ...eventCardValues(at), recurrence: 'once' }, at));
    expect(patch).toMatchObject({ event_date: '2099-12-08', is_recurring: false, recurrence_rule: null });
  });

  it('a new date for the whole series moves its start by the same days', () => {
    const v = { ...eventCardValues(at), date: '2099-12-10' };
    expect(eventCardPatch('rehearsal', v, at, 'series').event_date).toBe('2099-12-03');
  });

  it('a new date for this date only leaves the series start alone', () => {
    const v = { ...eventCardValues(at), date: '2099-12-10' };
    expect(eventCardPatch('rehearsal', v, at, 'date')).not.toHaveProperty('event_date');
  });
});

describe('a deleted date opened from its "Rehearsal cancelled" push (Claude #297 r5 minor 6)', () => {
  it('comes back marked as cancelled, on that date', () => {
    expect(occurrenceOn(series, '2099-12-15')).toMatchObject({ date: '2099-12-15', seriesDate: '2099-12-01', skippedOccurrence: true });
  });
  it('the first date deleted: the series row, marked', () => {
    const first = { ...series, recurrence_rule: { ...series.recurrence_rule, skip_dates: ['2099-12-01'] } };
    expect(occurrenceOn(first, '2099-12-01')).toMatchObject({ date: '2099-12-01', skippedOccurrence: true });
  });
  it('a date still on is not marked', () => {
    expect(occurrenceOn(series, '2099-12-08')).not.toHaveProperty('skippedOccurrence');
  });
});
