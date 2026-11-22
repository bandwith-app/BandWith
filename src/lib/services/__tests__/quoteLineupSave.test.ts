/**
 * Codex round 4 on #293 (AuthenticatedApp.tsx:2882): a musician replaced in
 * the calendar's quote editor stayed on the tentative gig, so confirming
 * the quote confirmed the old lineup. saveQuoteLineup saves the quote's
 * lineup and the gig's in one transaction (bw_quote_save_lineup, 185).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (n: string, a: unknown) => rpc(n, a), from: vi.fn() }, getSafeUser: vi.fn() }));

import { saveQuoteLineup } from '../quotes';
import AuthenticatedAppSrc from '@/app/AuthenticatedApp.tsx?raw';
import QuotesExpandedSrc from '@/app/components/dashboard/expanded/QuotesExpanded.tsx?raw';

const QUOTE = '22222222-2222-4222-8222-222222222222';
const EVENT = '33333333-3333-4333-8333-333333333333';
const MAYA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const lineup = [
  { user_id: MAYA, name: 'Maya Brooks', instrument: 'Bass', fee: 350, is_external: false, is_available: true },
  { user_id: null, name: 'Leo Park', instrument: 'Drums', fee: 275.005, is_external: true, is_available: true },
];

beforeEach(() => rpc.mockReset());

describe('saveQuoteLineup', () => {
  it('one call saves the quote’s lineup and the gig on hold', async () => {
    rpc.mockResolvedValue({ data: { musicians: [{ id: 'm1', ...lineup[0] }], event_id: EVENT, synced: true, confirmed: false }, error: null });
    const r = await saveQuoteLineup(QUOTE, lineup as any);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('bw_quote_save_lineup');
    expect(rpc.mock.calls[0][1].p_musicians[1].fee).toBe(275.01);
    expect(r).toEqual({ data: { musicians: [{ id: 'm1', ...lineup[0] }], eventId: EVENT, synced: true, confirmed: false }, error: null });
  });
  it('the gig was confirmed meanwhile: says so, the quote’s lineup is saved', async () => {
    rpc.mockResolvedValue({ data: { musicians: [], event_id: EVENT, synced: false, confirmed: true }, error: null });
    expect((await saveQuoteLineup(QUOTE, [])).data).toMatchObject({ synced: false, confirmed: true });
  });
  it('a database before round 4: the quote’s lineup alone (the caller syncs the gig as before)', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.bw_quote_save_lineup' } })
      .mockResolvedValueOnce({ data: [{ id: 'm1', ...lineup[0] }], error: null });
    const r = await saveQuoteLineup(QUOTE, [lineup[0]] as any);
    expect(rpc.mock.calls[1][0]).toBe('bw_quote_save_musicians');
    expect(r.data).toMatchObject({ synced: false, confirmed: false, eventId: null });
    expect(r.data?.musicians).toHaveLength(1);
  });
  it('a refused lineup: an error, nothing to show as saved', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'Every musician needs a name and a valid fee' } });
    const r = await saveQuoteLineup(QUOTE, lineup as any);
    expect(r.data).toBeNull();
    expect(r.error?.message).toMatch(/valid fee/);
  });
});

describe('both quote editors save the lineup with the gig on hold', () => {
  it('the calendar’s quote editor (AuthenticatedApp) and Quotes use saveQuoteLineup', () => {
    const linked = AuthenticatedAppSrc.slice(AuthenticatedAppSrc.indexOf('const handleLinkedQuoteSave'));
    expect(linked.slice(0, 3000)).toMatch(/await saveQuoteLineup\(editing\.quote\.id, appMusiciansToDb\(q\.musicians\)\)/);
    expect(QuotesExpandedSrc).toMatch(/await saveQuoteLineup\(existing\.id, appMusiciansToDb\(quoteData\.musicians\)\)/);
  });
});
