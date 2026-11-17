import { describe, expect, it } from 'vitest';
import { initialQuote, viewQuote, sendMessage, acceptQuote, declineQuote, createGig, steps, statusLabel } from '../src/ui/demos/quotes-contracts';
import { markup } from '../src/content/demos/quotes-contracts';

describe('quotes demo: Client confirmation', () => {
  it('moves Sent → Viewed → Discussing → Accepted, lighting each step', () => {
    let s = initialQuote();
    expect(statusLabel(s)).toBe('Sent');
    s = viewQuote(s);
    expect(statusLabel(s)).toBe('Viewed');
    s = sendMessage(s, 'One more set?');
    expect(statusLabel(s)).toBe('Discussing');
    s = acceptQuote(s, 'Anna Rossi');
    expect(statusLabel(s)).toBe('Accepted');
    expect(steps(s).map((x) => x.done)).toEqual([true, true, true, true]);
    expect(s.history[0].text).toBe('Accepted by Anna Rossi');
  });

  it('leaves Discussing dark when the client accepts without writing', () => {
    const s = acceptQuote(initialQuote(), 'Anna Rossi');
    expect(steps(s).map((x) => x.done)).toEqual([true, true, false, true]);
  });

  it('lets a declined quote still be accepted, but not the other way round', () => {
    let s = declineQuote(viewQuote(initialQuote()), 'Another date');
    expect(statusLabel(s)).toBe('Declined');
    expect(steps(s)[3].label).toBe('Declined');
    s = acceptQuote(s, 'Anna Rossi');
    expect(statusLabel(s)).toBe('Accepted');
    expect(declineQuote(s, '')).toBe(s);
  });

  it('keeps messages after an answer from changing the status', () => {
    const s = sendMessage(acceptQuote(initialQuote(), 'A'), 'Thanks');
    expect(s.status).toBe('accepted');
  });

  it('only turns an accepted quote into a gig', () => {
    expect(createGig(viewQuote(initialQuote())).gig).toBe(false);
    expect(createGig(acceptQuote(initialQuote(), 'A')).gig).toBe(true);
  });

  it('never offers online payment and keeps the calm voice', () => {
    const html = markup();
    expect(html).not.toMatch(/stripe|paypal|card payment|pay now/i);
    expect(html).not.toMatch(/!/);
  });
});
