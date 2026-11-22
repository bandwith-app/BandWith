/**
 * Review of #293: a quote made from Quotes or the calendar holds its date
 * with a tentative gig that copies the quote's fee. Without the quote's
 * currency the gig defaulted to EUR, and its deposit receipt labelled
 * dollars as euros. (AuthenticatedApp's saveNewQuote is not exported, so
 * the event row it builds is read from the source.)
 */
import { describe, expect, it } from 'vitest';
import app from '@/app/AuthenticatedApp.tsx?raw';

describe('the tentative gig of a new quote', () => {
  it('takes the quote currency with the quote fee', () => {
    const start = app.indexOf('const saveNewQuote = async');
    const row = app.slice(app.indexOf('const evD: Record<string, any> = {', start), app.indexOf('};', app.indexOf('const evD', start)));
    expect(row).toContain('fee: q.total || 0');
    expect(row).toMatch(/currency: String\(q\.currency\)\.toUpperCase\(\)/);
  });
});
