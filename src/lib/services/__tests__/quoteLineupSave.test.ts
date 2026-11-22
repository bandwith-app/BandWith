/**
 * Codex round 4 on #293 (AuthenticatedApp.tsx:2882): a musician replaced in
 * the calendar's quote editor stayed on the tentative gig, so confirming
 * the quote confirmed the old lineup. saveQuoteLineup saves the quote's
 * lineup and the gig's in one transaction (bw_quote_save_lineup, 185).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (n: string, a: unknown) => rpc(n, a), from: vi.fn() }, getSafeUser: vi.fn() }));

import { saveQuoteLineup, changedQuoteLineup, quoteLineupKey } from '../quotes';
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
    expect(linked.slice(0, 3000)).toMatch(/changedQuoteLineup\(q\.musicians, editing\.quote\.musicians\)/);
    expect(linked.slice(0, 3000)).toMatch(/await saveQuoteLineup\(editing\.quote\.id, lineupEdit\.musicians, lineupEdit\.base\)/);
    expect(QuotesExpandedSrc).toMatch(/changedQuoteLineup\(quoteData\.musicians, baseline\.musicians\)/);
    expect(QuotesExpandedSrc).toMatch(/await saveQuoteLineup\(existing\.id, lineupEdit\.musicians, lineupEdit\.base\)/);
  });
});

// Codex round 5 on #293 (QuotesExpanded.tsx:253): a venue-only save sent the
// lineup the wizard opened with, bringing back a musician another admin had
// removed meanwhile, with the old fees.
describe('round 5: the lineup is saved only when it changed, checked against the one opened', () => {
  const opened = [
    { id: 'a', userId: MAYA, name: 'Maya Brooks', instrument: 'Bass', fee: 300 },
    { id: 'b', name: 'Leo Park', instrument: 'Drums', fee: 275, isExternal: true },
  ] as any[];
  it('unchanged (any order, fee to the cent): nothing to save', () => {
    const edited = [{ ...opened[1], fee: 275.001 }, { ...opened[0], instrument: ' bass ' }] as any[];
    expect(quoteLineupKey(edited)).toBe(quoteLineupKey(opened));
    expect(changedQuoteLineup(edited, opened)).toBeNull();
    expect(changedQuoteLineup(undefined, opened)).toBeNull();
  });
  it('changed: the new lineup and the one opened, for the server to check', () => {
    const r = changedQuoteLineup([opened[0]], opened);
    expect(r?.musicians).toEqual([expect.objectContaining({ name: 'Maya Brooks', fee: 300 })]);
    expect(r?.base).toHaveLength(2);
  });
  it('the lineup opened is not known: saved without a check, as before', () => {
    expect(changedQuoteLineup([opened[0]], undefined)?.base).toBeNull();
  });
  it('the RPC gets the lineup opened as p_base; without one, no p_base', async () => {
    rpc.mockResolvedValue({ data: { musicians: [], event_id: null, synced: false, confirmed: false }, error: null });
    await saveQuoteLineup(QUOTE, [lineup[0]] as any, lineup as any);
    expect(rpc.mock.calls[0][1].p_base).toHaveLength(2);
    expect(rpc.mock.calls[0][1].p_base[1].fee).toBe(275.01);
    await saveQuoteLineup(QUOTE, [lineup[0]] as any);
    expect('p_base' in rpc.mock.calls[1][1]).toBe(false);
  });
  it('a lineup changed meanwhile: the server’s refusal is the error', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'Someone else changed this quote’s lineup while it was open. Close it and open it again: the lineup was not saved.' } });
    const r = await saveQuoteLineup(QUOTE, [lineup[0]] as any, lineup as any);
    expect(r.data).toBeNull();
    expect(r.error?.message).toMatch(/lineup while it was open/);
  });
});
