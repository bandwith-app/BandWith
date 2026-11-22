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
    expect(renamed?.event_date).toBe('2099-12-01');
    expect(eventDataPatch(renamed!, ev).date).toBe('2099-12-08');
    const moved = changedPatch(ev, eventCardPatch('rehearsal', { ...eventCardValues(ev), date: '2099-12-09' }, ev));
    expect(moved?.event_date).toBe('2099-12-09');
    expect(changedPatch(ev, eventCardPatch('rehearsal', eventCardValues(ev), ev))).toBeNull();
  });
});

import appSrc from '@/app/AuthenticatedApp.tsx?raw';

describe('the app', () => {
  it('a Calendar date of a series opens knowing the series start; the wizard keeps it', () => {
    expect(appSrc).toMatch(/seriesDate: series\.date/);
    expect(appSrc).toMatch(/event_date: editingEventData\?\.seriesDate && date === editingEventData\.date \? editingEventData\.seriesDate : date/);
  });
});
