/**
 * Codex round 4 on #293 (AuthenticatedApp.tsx:2882): a musician replaced in
 * the calendar's quote editor stayed on the tentative gig, so confirming
 * the quote confirmed the old lineup. saveQuoteLineup saves the quote's
 * lineup and the gig's in one transaction (bw_quote_save_lineup, 185).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (n: string, a: unknown) => rpc(n, a), from: vi.fn() }, getSafeUser: vi.fn() }));

import { saveQuoteLineup, changedQuoteLineup, quoteLineupKey, saveQuoteWithLineup, isLineupChangedError } from '../quotes';
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
  // Round 6 (Claude review r8): with the quote, in one call (saveQuoteWithLineup).
  it('the calendar’s quote editor (AuthenticatedApp) and Quotes save the quote and a changed lineup together', () => {
    const linked = AuthenticatedAppSrc.slice(AuthenticatedAppSrc.indexOf('const handleLinkedQuoteSave'));
    const body = linked.slice(0, 4000);
    expect(body).toMatch(/changedQuoteLineup\(q\.musicians, editing\.quote\.musicians\)/);
    expect(body).toMatch(/\? await saveQuoteWithLineup\(editing\.quote\.id, updates, lineupEdit\)/);
    expect(body).not.toMatch(/saveQuoteLineup\(/);
    // The lineup edit is known before anything is written.
    expect(body.indexOf('changedQuoteLineup(')).toBeLessThan(body.indexOf('updateQuoteDB('));
    // Refused: reloaded, the wizard opened again on it.
    expect(body).toMatch(/isLineupChangedError\(error\)[\s\S]{0,400}getQuoteDB\(editing\.quote\.id\)[\s\S]{0,700}setLinkedQuoteWizardKey/);
    // r9: not reloaded: the wizard closes and the notice says the quote could not be reloaded.
    expect(body).toMatch(/if \(!fresh\.data\) \{[\s\S]{0,200}setEditingLinkedQuote\(null\);[\s\S]{0,240}could not be reloaded/);
    expect(AuthenticatedAppSrc).toMatch(/key=\{`linked-quote-wizard-\$\{linkedQuoteWizardKey\}`\}/);
    expect(QuotesExpandedSrc).toMatch(/changedQuoteLineup\(quoteData\.musicians, baseline\.musicians\)/);
    expect(QuotesExpandedSrc).toMatch(/\? await saveQuoteWithLineup\(existing\.id, updates, lineupEdit\)/);
    expect(QuotesExpandedSrc).not.toMatch(/saveQuoteLineup\(/);
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

// Claude review r8 of #293: the quote was written before the lineup's base
// was checked, so a stale editor's fee for a removed musician stayed in the
// total. One RPC now takes both and refuses both.
describe('round 6: saveQuoteWithLineup', () => {
  const opened = [
    { user_id: MAYA, name: 'Sam Ortiz', instrument: 'Drums', fee: 200, is_external: false, is_available: true },
    { user_id: null, name: 'Jo Kim', instrument: 'Guitar', fee: 150, is_external: true, is_available: true },
  ];
  const edit = { musicians: [opened[0], { ...opened[1], fee: 180 }], base: opened };
  it('one call: the quote’s columns, the lineup and the lineup it opened with', async () => {
    rpc.mockResolvedValue({ data: { quote: { id: QUOTE, base_fee: 380 }, lineup: { musicians: [], event_id: EVENT, synced: true, confirmed: false } }, error: null });
    const r = await saveQuoteWithLineup(QUOTE, { base_fee: 380 } as any, edit as any);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('bw_quote_save_with_lineup');
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_quote_id: QUOTE, p_updates: { base_fee: 380 } });
    expect(rpc.mock.calls[0][1].p_musicians[1].fee).toBe(180);
    expect(rpc.mock.calls[0][1].p_base[1].fee).toBe(150);
    expect(r).toMatchObject({ data: { base_fee: 380 }, lineup: { eventId: EVENT, synced: true }, error: null });
  });
  it('the lineup changed meanwhile: an error that keeps the code and hint, nothing saved', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '40001', hint: 'BW_LINEUP_CHANGED', message: 'Someone else changed this quote’s lineup while it was open.' } });
    const r = await saveQuoteWithLineup(QUOTE, { base_fee: 380 } as any, edit as any);
    expect(r.data).toBeNull();
    expect(isLineupChangedError(r.error)).toBe(true);
    expect((r.error as any).code).toBe('40001');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('a database without it: the two calls of round 5', async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.bw_quote_save_with_lineup' } })
      .mockResolvedValueOnce({ data: { musicians: [], event_id: null, synced: false, confirmed: false }, error: null });
    const update = vi.fn(() => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: QUOTE }, error: null }) }) }) }));
    const { supabase } = await import('@/lib/supabase');
    (supabase.from as any).mockReturnValue({ update });
    const r = await saveQuoteWithLineup(QUOTE, { base_fee: 380 } as any, edit as any);
    expect(update).toHaveBeenCalledWith({ base_fee: 380 });
    expect(rpc.mock.calls[1][0]).toBe('bw_quote_save_lineup');
    expect(r.error).toBeNull();
    expect(r.lineup).toMatchObject({ synced: false });
  });
});

// Codex round 6 (quotes.ts:1178): the lineup's key names who, by profile.
describe('round 6: the lineup key includes the profile', () => {
  const SAM2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  it('two Sam Ortiz on drums at $250 are two lineups when they are two people', () => {
    const a = [{ id: 'x', userId: MAYA, name: 'Sam Ortiz', instrument: 'Drums', fee: 250 }] as any[];
    const b = [{ id: 'x', userId: SAM2, name: 'Sam Ortiz', instrument: 'Drums', fee: 250 }] as any[];
    expect(quoteLineupKey(a)).not.toBe(quoteLineupKey(b));
    expect(changedQuoteLineup(b, a)).not.toBeNull();
    // An outside musician has no profile: the same as before.
    const c = [{ id: 'x', name: 'Sam Ortiz', instrument: 'Drums', fee: 250, userId: 'not-a-uuid' }] as any[];
    expect(quoteLineupKey(c)).toBe(quoteLineupKey([{ ...c[0], userId: undefined }] as any[]));
  });
});
