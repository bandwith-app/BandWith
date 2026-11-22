import { describe, expect, it } from 'vitest';
import * as holds from '@/lib/dateHolds';
import cardSrc from '@/app/components/dashboard/DateHoldCard.tsx?raw';
import wizardSrc from '@/app/components/quotes/QuoteCreationWizard.tsx?raw';
import demoSrc from '@/lib/demo/demoClient.ts?raw';
import de from '@/lib/i18n/locales/de';
import es from '@/lib/i18n/locales/es';
import fr from '@/lib/i18n/locales/fr';
import it_ from '@/lib/i18n/locales/it';
import pt from '@/lib/i18n/locales/pt';

/** Round 4 of #294 (Codex M1, M3 on f1da693a). */
describe('date on hold, round 4', () => {
  it('"I\'m free" sends the whole window the card showed (M1)', () => {
    expect(holds.answerArgs('e1', 'free', { date: '2026-12-05', startTime: '20:00:00', endTime: '23:30:00' })).toEqual({
      p_event_id: 'e1', p_answer: 'free', p_date: '2026-12-05', p_start_time: '20:00', p_end_time: '23:30',
    });
    expect(holds.answerArgs('e1', 'free', { date: '2026-12-05', startTime: '20:00', endTime: null })).toMatchObject({ p_end_time: null });
    expect(holds.answerArgs('e1', 'busy')).toEqual({ p_event_id: 'e1', p_answer: 'busy' });
  });

  it('a new time is refused as "time changed", with its own message in every language (M1)', () => {
    expect(holds.answerRefusal('BWD02')).toBe('timeChanged');
    expect(holds.answerRefusal('BWD01')).toBe('changed');
    const key = 'The time changed. Check it and answer again.';
    expect(cardSrc).toContain(`t('${key}')`);
    for (const dict of [de, es, fr, it_, pt] as Record<string, string>[]) expect(dict[key], key).toBeTruthy();
    expect(demoSrc).toMatch(/BWD02/);
  });

  it('the iPad composer promises a hold only when the wizard holds a date (M3)', () => {
    const promise = "t('Members are asked to keep the date free. They see only the day, time and place, not the client or the fee.')";
    const uses = wizardSrc.split(promise).length - 1;
    expect(uses).toBe(2);
    expect(wizardSrc.match(/!isEditing && holdsDate && \(/g)?.length).toBe(2);
  });
});
