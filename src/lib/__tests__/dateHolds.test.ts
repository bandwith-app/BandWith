import { describe, expect, it } from 'vitest';
import { clock24, groupAnswers, holdPlace, holdTime, isDateHoldType, isQuoteStageEvent, sortHolds, toAnswerRow, toDateHold, type DateHold } from '@/lib/dateHolds';
import { notificationTarget, notificationTargetLabel } from '@/lib/notificationRouting';

const hold = (over: Partial<DateHold> = {}): DateHold => ({
  eventId: 'e1', bandId: 'b1', bandName: 'Velvet Static', date: '2026-12-05', startTime: '20:00:00', endTime: '23:00:00',
  venueName: 'Blue Note', venueCity: 'New York', myAnswer: null, answeredAt: null, ...over,
});

describe('date on hold (178)', () => {
  it('reads the RPC row and keeps only day, time and place', () => {
    const h = toDateHold({
      event_id: 'e1', band_id: 'b1', band_name: 'Velvet Static', event_date: '2026-12-05', start_time: '20:00:00',
      end_time: '23:00:00', venue_name: 'TBD', venue_city: 'New York', my_answer: 'maybe', answered_at: null,
      // Never in the RPC, and never kept if it were.
      title: 'Smith wedding', client_name: 'Jane Smith', fee: 4200,
    } as Record<string, unknown>)!;
    expect(h).toEqual(hold({ venueName: null, myAnswer: null }));
    expect(Object.keys(h)).not.toContain('title');
    expect(toDateHold({ event_id: 'e1' })).toBeNull();
  });

  it('writes the time and the place in plain words', () => {
    expect(holdTime(hold())).toBe('20:00–23:00');
    expect(holdTime(hold({ endTime: null }))).toBe('20:00');
    expect(holdTime(hold({ startTime: '8 PM', endTime: '11:30 PM' }))).toBe('20:00–23:30');
    expect(holdTime(hold({ startTime: null, endTime: null }))).toBe('');
    expect(clock24('TBD')).toBe('');
    expect(holdPlace(hold())).toBe('Blue Note, New York');
    expect(holdPlace(hold({ venueName: null }))).toBe('New York');
    expect(holdPlace(hold({ venueName: 'Blue Note New York' }))).toBe('Blue Note New York');
    expect(holdPlace(hold({ venueName: 'TBD', venueCity: '' }))).toBe('');
  });

  it('lists the soonest first', () => {
    const later = hold({ eventId: 'e2', date: '2026-12-06' });
    const evening = hold({ eventId: 'e3', startTime: '21:00' });
    expect(sortHolds([later, evening, hold()]).map((h) => h.eventId)).toEqual(['e1', 'e3', 'e2']);
  });

  it('groups the answers for the admin', () => {
    const rows = [
      { user_id: 'u1', name: 'Sam', answer: 'busy', on_lineup: true },
      { user_id: 'u2', name: 'Ana', answer: 'free' },
      { user_id: 'u3', name: 'Lee', answer: null },
      { name: 'no id' },
    ].map((r) => toAnswerRow(r as Record<string, unknown>)).filter((r) => !!r);
    const g = groupAnswers(rows as NonNullable<ReturnType<typeof toAnswerRow>>[]);
    expect(g.free.map((r) => r.name)).toEqual(['Ana']);
    expect(g.busy.map((r) => [r.name, r.onLineup])).toEqual([['Sam', true]]);
    expect(g.none.map((r) => r.name)).toEqual(['Lee']);
  });

  it('knows a quote-stage event like the database does', () => {
    expect(isQuoteStageEvent({ status: 'tentative', event_type: 'gig' })).toBe(true);
    expect(isQuoteStageEvent({ status: 'pending', quoteId: 'q1' })).toBe(true);
    expect(isQuoteStageEvent({ status: 'confirmed', quote_id: 'q1' })).toBe(false);
    expect(isQuoteStageEvent({ status: 'tentative', eventType: 'rehearsal' })).toBe(false);
    expect(isQuoteStageEvent({ status: 'confirmed', event_type: 'gig' })).toBe(false);
  });

  it('routes the hold notices: answer on Home, nothing to open once free', () => {
    expect(isDateHoldType('date_hold_changed')).toBe(true);
    expect(isDateHoldType('event_invite')).toBe(false);
    const t = notificationTarget('date_hold', { event_id: 'e1' });
    expect(t).toEqual({ screen: 'home', holdEventId: 'e1' });
    expect(notificationTargetLabel(t!)).toBe('Answer on Home');
    expect(notificationTarget('date_hold_changed', {})).toEqual({ screen: 'home' });
    expect(notificationTarget('date_hold_released', { event_id: 'e1' })).toBeNull();
  });

  it('routes the hold push (type event_date_hold, no event_id for old builds) to that hold', () => {
    // 178's push payload: old builds see an event_* type without an event id
    // and open the calendar; new builds open the hold itself.
    const push = { type: 'event_date_hold', hold_type: 'date_hold_changed', hold_event_id: 'e2', notification_id: 'n1' };
    expect(notificationTarget(push.type, push)).toEqual({ screen: 'home', holdEventId: 'e2' });
    expect(notificationTarget('event_date_hold', { hold_type: 'date_hold', hold_event_id: 'e3' })).toEqual({ screen: 'home', holdEventId: 'e3' });
    expect(notificationTarget('event_date_hold', { hold_type: 'date_hold_released', hold_event_id: 'e2' })).toBeNull();
  });
});
