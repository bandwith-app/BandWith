/**
 * 183 round 4: an accepted quote keeps its client, and the admin is told so
 * where the client is edited (every wizard layout) and in the Academy; the
 * new texts exist in the 5 translations.
 */
import { describe, expect, it } from 'vitest';
import wizard from '@/app/components/quotes/QuoteCreationWizard.tsx?raw';
import academyEn from '../../../../academy/content/business.ts?raw';
import it_ from '@/lib/i18n/locales/it.ts?raw';
import es from '@/lib/i18n/locales/es.ts?raw';
import fr from '@/lib/i18n/locales/fr.ts?raw';
import de from '@/lib/i18n/locales/de.ts?raw';
import pt from '@/lib/i18n/locales/pt.ts?raw';

const KEYS = [
  'The recipient changed: this draft was for the previous client.',
  'Could not copy the text.',
  'From here: {name}',
  'You’re writing to {name}',
  'This quote has been accepted: to send it to someone else, duplicate it.',
  'This quote has payments recorded in {currency}, so its currency can’t be changed.',
  'This quote has been accepted: you can correct the client’s details (a typo in the name, the phone written another way, a typo in the email until you ask for the balance), but to send it to someone else, duplicate it.',
];

describe('accepted quote: the client stays', () => {
  it('the wizard says so above the client fields, in its three layouts', () => {
    expect(wizard).toMatch(/String\(initialData\?\.status \|\| ''\)\.toUpperCase\(\) === 'ACCEPTED'/);
    expect(wizard.match(/\{acceptedNote\}/g)).toHaveLength(3);
  });
  it('the Academy explains it', () => {
    expect(academyEn).toMatch(/An \*\*accepted\*\* quote keeps its client[^']*\*\*Duplicate\*\* it\./);
  });
  it.each([['it', it_], ['es', es], ['fr', fr], ['de', de], ['pt', pt]])('%s has the round 4 texts', (_l, src) => {
    for (const k of KEYS) expect(src).toContain(`${JSON.stringify(k)}:`);
  });
});
