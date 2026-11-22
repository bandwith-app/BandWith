/**
 * 183 round 6, app side (Codex review of 86dd51f6):
 * - quotes.ts:322: against a database before 183 (no edit_base_at, no
 *   server totals) the retry sends the totals the app worked out, so that
 *   database never keeps the old ones;
 * - AuthenticatedApp.tsx:2710: the gig of a quote edited from its event
 *   gets the fee of the row the database returned, not the wizard's copy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { from: (t: string) => mockFrom(t), rpc: vi.fn(), functions: { invoke: vi.fn() } },
  getSafeUser: vi.fn(),
}));

import { quoteUpdateRecord, updateQuote } from '../quotes';
import appSrc from '@/app/AuthenticatedApp.tsx?raw';
import type { Quote as AppQuote } from '@/app/data/quotes';

const BAND_ID = '11111111-1111-4111-8111-111111111111';
const QUOTE_ID = '22222222-2222-4222-8222-222222222222';
const original = {
  id: QUOTE_ID, status: 'SENT', clientName: 'Jordan Lee', clientEmail: 'jordan@brooklynevents.example',
  eventName: 'Lee wedding', eventDate: '2027-05-15', currency: 'USD', baseFee: 4200, subtotal: 4200, total: 4200,
  depositRequired: true, depositPercentage: 30, depositAmount: 1260, customItems: [], updatedAt: '2026-11-20T15:04:05.123456+00:00',
} as unknown as Partial<AppQuote>;

/** The update calls the quotes table got, in order; the first fails as a database before 183 does. */
const sent: Record<string, unknown>[] = [];
beforeEach(() => {
  sent.length = 0;
  mockFrom.mockReset().mockImplementation(() => ({
    update: (u: Record<string, unknown>) => {
      sent.push(u);
      const failing = sent.length === 1;
      const chain = {
        eq: () => chain,
        select: () => chain,
        single: async () => (failing
          ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'edit_base_at' column of 'quotes' in the schema cache" } }
          : { data: { id: QUOTE_ID, ...u }, error: null }),
      };
      return chain;
    },
  }));
});

describe('round 6: a database before 183', () => {
  it('an edit of the fee: the first try sends no totals, the retry sends the app’s', async () => {
    const edit = { ...original, baseFee: 4800, subtotal: 4800, total: 4800, depositAmount: 1440 };
    const updates = quoteUpdateRecord(edit, BAND_ID, original);
    expect(updates).not.toHaveProperty('total');
    const r = await updateQuote(QUOTE_ID, updates);
    expect(r.error).toBeNull();
    expect(sent).toHaveLength(2);
    expect(sent[0]).not.toHaveProperty('total');
    expect(sent[1]).toMatchObject({ base_fee: 4800, total: 4800, deposit_amount: 1440 });
    expect(sent[1]).not.toHaveProperty('edit_base_at');
  });

  it('an edit that leaves the totals alone sends none on the retry either', async () => {
    const updates = quoteUpdateRecord({ ...original, venueName: 'The Foundry' }, BAND_ID, original);
    await updateQuote(QUOTE_ID, updates);
    expect(sent[1]).not.toHaveProperty('total');
    expect(sent[1]).toMatchObject({ venue_name: 'The Foundry' });
  });
});

describe('round 6: the gig of a quote edited from its event', () => {
  it('takes the fee from the saved row', () => {
    const body = appSrc.slice(appSrc.indexOf('const handleLinkedQuoteSave'), appSrc.indexOf('const handleEventDelete'));
    const event = body.slice(body.indexOf('await updateEvent(editing.eventId'), body.indexOf('} as any);', body.indexOf('await updateEvent(editing.eventId')));
    expect(event).toMatch(/fee: Number\(\(data as any\)\?\.total\) \|\| 0/);
    expect(event).not.toMatch(/fee: q\.total/);
    expect(event).toMatch(/event_date: merged\.eventDate/);
  });
});
