/**
 * 183: a save refused because another admin changed the quote's client or
 * prices meanwhile (40001) shows the server's message, already in the
 * admin's language and telling them to open the quote again. Anything else
 * stays the translated generic text (no raw server errors on screen).
 */
import { describe, it, expect } from 'vitest';
import { quoteErrorText } from '../quoteSaveError';
import QuotesExpandedSource from '@/app/components/dashboard/expanded/QuotesExpanded.tsx?raw';

const t = (k: string) => k;
const stale = Object.assign(new Error('Un altro amministratore ha cambiato il cliente o i prezzi di questo preventivo. Chiudilo e riaprilo.'), { code: '40001' });

describe('quoteErrorText', () => {
  it('another admin changed the quote: the server’s translated message', () => {
    expect(quoteErrorText(stale, 'Failed to update quote', t)).toBe(stale.message);
  });
  it('any other error: the generic translated text, never the raw message', () => {
    const raw = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    expect(quoteErrorText(raw, 'Failed to update quote', t)).toBe('Failed to update quote. Check your connection and try again.');
    expect(quoteErrorText(null, 'Failed to update quote', t)).toBe('Failed to update quote. Check your connection and try again.');
  });
  it('the Quotes screen uses it for every failed action', () => {
    expect(QuotesExpandedSource).toMatch(/return quoteErrorText\(err, fallback, t\)/);
  });
});

// Round 4: an accepted quote keeps its client, a paid quote its currency.
// The app's own words (its 5 languages), whatever the database language.
describe('quoteErrorText: accepted quote, currency of recorded payments', () => {
  const tp = (k: string, p?: Record<string, string>) => (p ? k.replace(/\{(\w+)\}/g, (_, n) => p[n] ?? '') : k);
  it('a new client on an accepted quote: duplicate it', () => {
    const e = { code: 'P0001', message: 'Questo preventivo è stato accettato…', hint: 'BW_QUOTE_ACCEPTED' };
    expect(quoteErrorText(e, 'Failed to update quote', tp)).toBe('This quote has been accepted: to send it to someone else, duplicate it.');
  });
  it('another currency on a quote with payments: names the currency', () => {
    const e = { code: 'P0001', message: 'This quote has payments recorded in USD…', hint: 'BW_QUOTE_CURRENCY_LOCKED', details: 'USD' };
    expect(quoteErrorText(e, 'Failed to update quote', tp)).toBe('This quote has payments recorded in USD, so its currency can’t be changed.');
  });
});
