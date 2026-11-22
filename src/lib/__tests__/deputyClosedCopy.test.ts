// Claude r7 (5): a request whose deputy was removed from the band (182: the
// page is closed, without fee or keys) showed "This gig is over." for a gig
// still to come.
import { describe, it, expect } from 'vitest';
import { DEPUTY_STRINGS, closedCopy } from '../../deputy/strings';

const S = DEPUTY_STRINGS.en;
const base = { closed: true, event_cancelled: false, status: 'available', fee: 250, calendar_token: 'a'.repeat(64), gig_calendar_token: 'b'.repeat(64) };

describe('the closed reply page says why', () => {
  it("removed from the band (fee and keys gone): You're no longer on this gig.", () => {
    expect(closedCopy({ ...base, fee: null, calendar_token: null, gig_calendar_token: null }, S)).toEqual([S.removedTitle, S.removedBody]);
    expect(S.removedTitle).toBe("You're no longer on this gig.");
  });

  it('cancelled by the band, withdrawn, or over: as before', () => {
    expect(closedCopy({ ...base, event_cancelled: true, fee: null, calendar_token: null, gig_calendar_token: null }, S)).toEqual([S.cancelledTitle, S.cancelledBody]);
    expect(closedCopy({ ...base, status: 'cancelled' }, S)).toEqual([S.closedTitle, S.closedBody]);
    expect(closedCopy(base, S)).toEqual([S.pastTitle, S.pastBody]);
    // A past gig offered without a fee still has its keys: over, not removed.
    expect(closedCopy({ ...base, fee: null }, S)).toEqual([S.pastTitle, S.pastBody]);
  });

  it('every language has the new copy', () => {
    for (const [lang, s] of Object.entries(DEPUTY_STRINGS)) {
      expect(s.removedTitle, lang).toBeTruthy();
      expect(s.removedBody, lang).toContain('{band}');
      if (lang !== 'en') expect(s.removedTitle, lang).not.toBe(S.removedTitle);
    }
  });
});
