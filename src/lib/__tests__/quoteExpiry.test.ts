import { describe, it, expect } from 'vitest';
import { isQuoteExpired, shownQuoteStatus } from '../quoteExpiry';

describe('quote expiry (as on the client page: valid_until + 1 day)', () => {
  it('expires open quotes once the day after valid_until has passed', () => {
    expect(isQuoteExpired('sent', '2026-11-10', '2026-11-11')).toBe(false);
    expect(isQuoteExpired('sent', '2026-11-10', '2026-11-12')).toBe(true);
    expect(isQuoteExpired('VIEWED', '2026-11-10', '2026-12-01')).toBe(true);
    expect(isQuoteExpired('negotiating', '2026-10-31', '2026-11-02')).toBe(true);
  });

  it('never expires drafts, settled quotes or quotes with no date', () => {
    expect(isQuoteExpired('draft', '2026-01-01', '2026-11-14')).toBe(false);
    expect(isQuoteExpired('accepted', '2026-01-01', '2026-11-14')).toBe(false);
    expect(isQuoteExpired('declined', '2026-01-01', '2026-11-14')).toBe(false);
    expect(isQuoteExpired('sent', '', '2026-11-14')).toBe(false);
    expect(isQuoteExpired('expired', null, '2026-11-14')).toBe(true);
  });

  it('shows EXPIRED instead of the stored status', () => {
    expect(shownQuoteStatus('SENT', '2026-11-01', '2026-11-14')).toBe('EXPIRED');
    expect(shownQuoteStatus('SENT', '2026-11-30', '2026-11-14')).toBe('SENT');
    expect(shownQuoteStatus('ACCEPTED', '2026-11-01', '2026-11-14')).toBe('ACCEPTED');
  });
});
