import { describe, expect, it } from 'vitest';
import * as holds from '@/lib/dateHolds';
import * as rules from '@/lib/dateHoldRules';
import cardSrc from '@/app/components/dashboard/DateHoldCard.tsx?raw';
import useDataSrc from '@/app/hooks/useData.ts?raw';
import wizardSrc from '@/app/components/quotes/QuoteCreationWizard.tsx?raw';
import quotesSrc from '@/app/components/dashboard/expanded/QuotesExpanded.tsx?raw';

/** Round 3 of #294 (Codex B3, B5 and the useData minor). */
describe('date on hold, round 3', () => {
  it('answers carry the day and time the card showed (B5)', () => {
    const answerArgs = (holds as Record<string, any>).answerArgs;
    expect(typeof answerArgs).toBe('function');
    expect(answerArgs('e1', 'free', { date: '2026-12-05', startTime: '20:00:00' })).toEqual({
      p_event_id: 'e1', p_answer: 'free', p_date: '2026-12-05', p_start_time: '20:00', p_end_time: null,
    });
    expect(answerArgs('e1', 'busy', { date: '2026-12-05', startTime: null })).toMatchObject({ p_start_time: null });
    // Older shape when nothing was shown.
    expect(answerArgs('e1', 'busy')).toEqual({ p_event_id: 'e1', p_answer: 'busy' });
  });

  it('a moved date is refused as "changed", a released one as "gone" (B5)', () => {
    const answerRefusal = (holds as Record<string, any>).answerRefusal;
    expect(typeof answerRefusal).toBe('function');
    expect(answerRefusal('BWD01')).toBe('changed');
    expect(answerRefusal('P0002')).toBe('gone');
    expect(answerRefusal('42501')).toBeNull();
    expect(cardSrc).toMatch(/answerDateHold\(hold\.eventId, next, hold\)/);
    expect(cardSrc).toMatch(/The date changed\. Check it and answer again\./);
  });

  it('a gig confirmed (or cancelled, updated) reloads the holds (useData minor)', () => {
    const refreshes = (rules as Record<string, any>).refreshesDateHolds;
    expect(typeof refreshes).toBe('function');
    for (const type of ['date_hold', 'date_hold_released', 'event_confirmed', 'event_cancelled', 'event_update']) expect(refreshes(type)).toBe(true);
    expect(refreshes('chat_message')).toBe(false);
    expect(useDataSrc).toMatch(/refreshesDateHolds\(notification\.type\)/);
  });

  it('Quotes → New quote (no event) does not promise a hold (B3)', () => {
    // The promise shows only when the wizard holds a date (an event exists or will be created).
    expect(wizardSrc).toMatch(/!isEditing && holdsDate && \(/);
    // #293 (option 1, after #294): the hold is promised only where the app's save path holds the date.
    expect(quotesSrc).toMatch(/holdsDate=\{!!onCreateNew\}/);
  });
});
