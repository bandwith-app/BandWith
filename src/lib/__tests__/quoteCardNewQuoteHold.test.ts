/**
 * #294 x #293 (option 1: #294 first, then #293 on top). A new quote from the
 * Quotes card goes through saveNewQuote, which holds the date: a tentative
 * event with the quote's lineup. Since 178 the members get the hold card
 * from the server (day, time, place), so the save sends no availability
 * request of its own (that one named the client and the fees).
 * (saveNewQuote is not exported: its body is read from the source.)
 */
import { describe, expect, it } from 'vitest';
import app from '@/app/AuthenticatedApp.tsx?raw';

const body = (() => {
  const start = app.indexOf('const saveNewQuote = async');
  const end = app.indexOf('\n  };\n', start);
  return start >= 0 && end > start ? app.slice(start, end) : '';
})();

describe('saveNewQuote (the Quotes card and the calendar)', () => {
  it('creates the tentative event holding the date, with the lineup', () => {
    expect(body).toMatch(/status: 'tentative'/);
    expect(body).toMatch(/await saveEventLineup\(ev\.id, memberRows/);
    expect(body).toMatch(/converted_to_event_id: createdEventId/);
  });
  it('sends no availability request of its own: the server’s hold card does it (178)', () => {
    expect(body).not.toMatch(/notifyEventMembersCreated\(/);
    expect(body).not.toMatch(/askAvailability/);
    expect(body).toContain('// Members get the hold card from the server (178): day, time');
  });
});
