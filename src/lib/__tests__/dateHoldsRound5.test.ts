import { describe, expect, it } from 'vitest';
import cardSrc from '@/app/components/dashboard/DateHoldCard.tsx?raw';
import answersSrc from '@/app/components/dashboard/DateHoldAnswers.tsx?raw';
import de from '@/lib/i18n/locales/de';
import es from '@/lib/i18n/locales/es';
import fr from '@/lib/i18n/locales/fr';
import it_ from '@/lib/i18n/locales/it';
import pt from '@/lib/i18n/locales/pt';

/** Round 5 of #294 (Claude r4 #5, a11y). */
describe('date on hold, round 5', () => {
  it('saving an answer keeps focus: aria-busy, no disabled button, repeat taps ignored', () => {
    // PillButton's `loading` disables the button (focus is lost).
    expect(cardSrc).not.toMatch(/loading=\{saving/);
    expect(cardSrc).toContain("aria-busy={saving === 'free'}");
    expect(cardSrc).toContain("aria-busy={saving === 'busy'}");
    expect(cardSrc).toMatch(/if \(saving \|\| next === answer\) return;/);
  });

  it('an empty group says "Nobody yet" in every language, not a lone dash', () => {
    expect(answersSrc).not.toMatch(/>\s*—\s*</);
    expect(answersSrc).toContain("t('Nobody yet')");
    for (const dict of [de, es, fr, it_, pt] as Record<string, string>[]) expect(dict['Nobody yet'], 'Nobody yet').toBeTruthy();
  });
});
