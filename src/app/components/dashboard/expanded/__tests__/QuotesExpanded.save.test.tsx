/**
 * Audit of 383f15b, money & documents:
 * - #3: editing a quote saved only the quotes row; the lineup changes were
 *   lost (old names and fees came back and went into the gig).
 * - #10: a new quote made from the Quotes card skipped the app's save path
 *   (the tentative event holding the date, the availability request).
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

vi.setConfig({ testTimeout: 30_000 });

const BAND = '11111111-1111-4111-8111-111111111111';
const QUOTE = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  createQuote: vi.fn(),
  updateQuote: vi.fn(),
  saveQuoteLineup: vi.fn(),
  syncQuoteHoldEvent: vi.fn().mockResolvedValue({ data: null, error: null }),
  wizardPayload: null as any,
}));
vi.mock('@/lib/supabase', () => {
  const chain: any = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => void) => res({ data: null, error: null }) : chain),
    apply: () => chain,
  });
  return { supabase: new Proxy({}, { get: () => () => chain }), getSafeUser: vi.fn() };
});
vi.mock('@/lib/services/quotes', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/quotes')>()),
  createQuote: mocks.createQuote,
  updateQuote: mocks.updateQuote,
  saveQuoteLineup: mocks.saveQuoteLineup,
  // Round 6: one call for the quote and a changed lineup; here as a
  // database without it (the two calls), so these checks keep their shape.
  // The atomic path: QuotesExpanded.lineupStale.test.tsx.
  saveQuoteWithLineup: async (id: string, updates: unknown, lineup: { musicians: unknown; base: unknown }) => {
    const q = await mocks.updateQuote(id, updates);
    if (q.error || !q.data) return { data: null, lineup: null, error: q.error };
    const l = await mocks.saveQuoteLineup(id, lineup.musicians, lineup.base);
    return { data: q.data, lineup: l.data, error: null, lineupError: l.error };
  },
  syncQuoteHoldEvent: mocks.syncQuoteHoldEvent,
}));
vi.mock('@/lib/services/quoteLinks', () => ({ republishClientQuote: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: { id: BAND, name: 'The Night Shift' }, bands: [] }),
  useOptionalBand: () => null,
}));
// The wizard: one button that saves what the test sets.
vi.mock('@/app/components/quotes/QuoteCreationWizard', () => ({
  QuoteCreationWizard: (p: { onCreate: (q: any, o?: any) => void; initialData?: any; holdsDate?: boolean }) => (
    <button type="button" data-holds-date={String(p.holdsDate)} onClick={() => p.onCreate({ ...(p.initialData || {}), ...mocks.wizardPayload }, { askAvailability: true })}>
      wizard save
    </button>
  ),
}));
vi.mock('@/app/components/quotes/QuoteDetailModal', () => ({
  QuoteDetailModal: (p: { quote: any; onEdit: (q: any) => void }) => (
    <button type="button" onClick={() => p.onEdit(p.quote)}>
      detail edit
    </button>
  ),
}));
vi.mock('@/app/components/quotes/QuoteShareModal', () => ({ QuoteShareModal: () => null }));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { QuotesExpanded } from '../QuotesExpanded';
import type { Quote as DbQuote } from '@/lib/services/quotes';

const row = {
  id: QUOTE,
  band_id: BAND,
  quote_number: 'Q-2027-0007',
  status: 'draft',
  client_name: 'Jordan Lee',
  event_name: 'Rooftop wedding',
  event_date: '2027-06-12',
  venue_name: '230 Fifth',
  venue_city: 'New York',
  currency: 'USD',
  total: 2400,
  musicians: [{ id: 'm-1', quote_id: QUOTE, name: 'Maya Brooks', instrument: 'Vocals', fee: 400, is_external: false, is_available: true }],
} as unknown as DbQuote;

/** Clicks, then lets the lazy wizard module load. */
const clickAndSettle = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
    await new Promise((r) => setTimeout(r, 50));
  });
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.syncQuoteHoldEvent.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.wizardPayload = null;
});

describe('QuotesExpanded: saving', () => {
  it('a new quote goes through the app save path (onCreateNew), not a bare createQuote', async () => {
    const onCreateNew = vi.fn().mockResolvedValue(undefined);
    mocks.wizardPayload = { clientName: 'Jordan Lee', eventDate: '2027-06-12', musicians: [] };
    render(<QuotesExpanded bandId={BAND} onClose={vi.fn()} realQuotes={[]} onShowToast={vi.fn()} onCreateNew={onCreateNew} />);
    await clickAndSettle(screen.getByRole('button', { name: 'New quote' }));
    await act(async () => {
      fireEvent.click(await screen.findByText('wizard save', undefined, { timeout: 10_000 }));
    });
    expect(onCreateNew).toHaveBeenCalledTimes(1);
    expect(onCreateNew.mock.calls[0][0]).toMatchObject({ clientName: 'Jordan Lee' });
    expect(onCreateNew.mock.calls[0][1]).toEqual({ askAvailability: true });
    expect(mocks.createQuote).not.toHaveBeenCalled();
  });

  it('editing a quote saves its lineup too', async () => {
    mocks.updateQuote.mockResolvedValue({ data: { ...row }, error: null });
    mocks.saveQuoteLineup.mockResolvedValue({
      data: { musicians: [{ id: 'm-2', quote_id: QUOTE, name: 'Sam Ortiz', instrument: 'Bass', fee: 350, is_external: true, is_available: true }], eventId: null, synced: false, confirmed: false },
      error: null,
    });
    mocks.wizardPayload = { musicians: [{ id: 'x', name: 'Sam Ortiz', instrument: 'Bass', fee: 350, isExternal: true }] };
    const onShowToast = vi.fn();
    render(
      <QuotesExpanded bandId={BAND} onClose={vi.fn()} realQuotes={[row]} onShowToast={onShowToast} focusQuoteId={QUOTE} onFocusConsumed={vi.fn()} />,
    );
    await clickAndSettle(await screen.findByText('detail edit'));
    await act(async () => {
      fireEvent.click(await screen.findByText('wizard save', undefined, { timeout: 10_000 }));
    });
    await waitFor(() => expect(mocks.saveQuoteLineup).toHaveBeenCalledTimes(1));
    expect(mocks.saveQuoteLineup.mock.calls[0][0]).toBe(QUOTE);
    expect(mocks.saveQuoteLineup.mock.calls[0][1]).toEqual([expect.objectContaining({ name: 'Sam Ortiz', fee: 350 })]);
  });

  it('a lineup that did not save says so and keeps the wizard open', async () => {
    mocks.updateQuote.mockResolvedValue({ data: { ...row }, error: null });
    mocks.saveQuoteLineup.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
    mocks.wizardPayload = { musicians: [{ id: 'x', name: 'Sam Ortiz', instrument: 'Bass', fee: 350, isExternal: true }] };
    const onShowToast = vi.fn();
    render(
      <QuotesExpanded bandId={BAND} onClose={vi.fn()} realQuotes={[row]} onShowToast={onShowToast} focusQuoteId={QUOTE} onFocusConsumed={vi.fn()} />,
    );
    await clickAndSettle(await screen.findByText('detail edit'));
    await act(async () => {
      fireEvent.click(await screen.findByText('wizard save', undefined, { timeout: 10_000 }));
    });
    await waitFor(() => expect(onShowToast).toHaveBeenCalledWith(expect.stringContaining('Quote saved, but the lineup was not'), 'error'));
    expect(screen.getByText('wizard save')).toBeTruthy();
  });

  // Codex round 3 (QuotesExpanded.tsx:247): the edit updated only the quote,
  // so accepting it confirmed the tentative event as first saved.
  it('editing a quote keeps its date on hold in step: date, fee and the saved lineup', async () => {
    const saved = [{ id: 'm-2', quote_id: QUOTE, user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Sam Ortiz', instrument: 'Bass', fee: 375, is_external: false, is_available: true }];
    mocks.updateQuote.mockResolvedValue({ data: { ...row, event_date: '2027-06-19', total: 3100 }, error: null });
    mocks.saveQuoteLineup.mockResolvedValue({ data: { musicians: saved, eventId: null, synced: false, confirmed: false }, error: null });
    mocks.syncQuoteHoldEvent.mockResolvedValue({ data: 'ev-1', error: null });
    mocks.wizardPayload = { eventDate: '2027-06-19', total: 3100, musicians: [{ id: 'x', userId: saved[0].user_id, name: 'Sam Ortiz', instrument: 'Bass', fee: 375 }] };
    const onShowToast = vi.fn();
    render(
      <QuotesExpanded bandId={BAND} onClose={vi.fn()} realQuotes={[row]} onShowToast={onShowToast} focusQuoteId={QUOTE} onFocusConsumed={vi.fn()} />,
    );
    await clickAndSettle(await screen.findByText('detail edit'));
    await act(async () => {
      fireEvent.click(await screen.findByText('wizard save', undefined, { timeout: 10_000 }));
    });
    await waitFor(() => expect(mocks.syncQuoteHoldEvent).toHaveBeenCalledTimes(1));
    const [id, quote, lineup] = mocks.syncQuoteHoldEvent.mock.calls[0];
    expect(id).toBe(QUOTE);
    expect(quote).toMatchObject({ eventDate: '2027-06-19', total: 3100 });
    expect(lineup).toEqual(saved);
    await waitFor(() => expect(onShowToast).toHaveBeenCalledWith('Quote updated', 'success'));
  });

  it('a date on hold that did not update says so; the quote stays saved', async () => {
    mocks.updateQuote.mockResolvedValue({ data: { ...row }, error: null });
    mocks.saveQuoteLineup.mockResolvedValue({ data: { musicians: [], eventId: null, synced: false, confirmed: false }, error: null });
    mocks.syncQuoteHoldEvent.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
    mocks.wizardPayload = { eventDate: '2027-06-19', musicians: [] };
    const onShowToast = vi.fn();
    render(
      <QuotesExpanded bandId={BAND} onClose={vi.fn()} realQuotes={[row]} onShowToast={onShowToast} focusQuoteId={QUOTE} onFocusConsumed={vi.fn()} />,
    );
    await clickAndSettle(await screen.findByText('detail edit'));
    await act(async () => {
      fireEvent.click(await screen.findByText('wizard save', undefined, { timeout: 10_000 }));
    });
    await waitFor(() =>
      expect(onShowToast).toHaveBeenCalledWith('Quote updated, but its calendar event was not. Save the quote again to update it.', 'error'),
    );
    expect(mocks.updateQuote).toHaveBeenCalledTimes(1);
  });

  // Codex round 4: the gig on hold got the lineup with the quote (one
  // transaction): it is not written again; confirmed meanwhile: said so.
  it('the lineup saved with the gig on hold is not written again on it', async () => {
    const saved = [{ id: 'm-2', quote_id: QUOTE, user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Sam Ortiz', instrument: 'Bass', fee: 375, is_external: false, is_available: true }];
    mocks.updateQuote.mockResolvedValue({ data: { ...row, event_date: '2027-06-19' }, error: null });
    mocks.saveQuoteLineup.mockResolvedValue({ data: { musicians: saved, eventId: 'ev-1', synced: true, confirmed: false }, error: null });
    mocks.syncQuoteHoldEvent.mockResolvedValue({ data: 'ev-1', error: null });
    mocks.wizardPayload = { eventDate: '2027-06-19', musicians: [{ id: 'x', userId: saved[0].user_id, name: 'Sam Ortiz', instrument: 'Bass', fee: 375 }] };
    const onShowToast = vi.fn();
    render(
      <QuotesExpanded bandId={BAND} onClose={vi.fn()} realQuotes={[row]} onShowToast={onShowToast} focusQuoteId={QUOTE} onFocusConsumed={vi.fn()} />,
    );
    await clickAndSettle(await screen.findByText('detail edit'));
    await act(async () => {
      fireEvent.click(await screen.findByText('wizard save', undefined, { timeout: 10_000 }));
    });
    await waitFor(() => expect(mocks.syncQuoteHoldEvent).toHaveBeenCalledTimes(1));
    expect(mocks.syncQuoteHoldEvent.mock.calls[0][2]).toBeNull();
  });

  it('the gig was confirmed meanwhile: the quote is saved, the gig left as it is, and it says so', async () => {
    mocks.updateQuote.mockResolvedValue({ data: { ...row }, error: null });
    mocks.saveQuoteLineup.mockResolvedValue({ data: { musicians: [], eventId: 'ev-1', synced: false, confirmed: true }, error: null });
    mocks.wizardPayload = { eventDate: '2027-06-19', musicians: [] };
    const onShowToast = vi.fn();
    render(
      <QuotesExpanded bandId={BAND} onClose={vi.fn()} realQuotes={[row]} onShowToast={onShowToast} focusQuoteId={QUOTE} onFocusConsumed={vi.fn()} />,
    );
    await clickAndSettle(await screen.findByText('detail edit'));
    await act(async () => {
      fireEvent.click(await screen.findByText('wizard save', undefined, { timeout: 10_000 }));
    });
    await waitFor(() =>
      expect(onShowToast).toHaveBeenCalledWith('The gig was confirmed meanwhile: the quote is saved, the gig’s lineup was not changed.', 'success'),
    );
    expect(mocks.syncQuoteHoldEvent).not.toHaveBeenCalled();
  });

  // Codex round 5 (QuotesExpanded.tsx:253): a save of the venue alone sent the
  // lineup as the wizard opened it, so a musician removed meanwhile came back.
  it('a venue-only save does not send the lineup', async () => {
    mocks.updateQuote.mockResolvedValue({ data: { ...row, venue_name: 'The Foundry' }, error: null });
    mocks.wizardPayload = { venueName: 'The Foundry' };
    const onShowToast = vi.fn();
    render(
      <QuotesExpanded bandId={BAND} onClose={vi.fn()} realQuotes={[row]} onShowToast={onShowToast} focusQuoteId={QUOTE} onFocusConsumed={vi.fn()} />,
    );
    await clickAndSettle(await screen.findByText('detail edit'));
    await act(async () => {
      fireEvent.click(await screen.findByText('wizard save', undefined, { timeout: 10_000 }));
    });
    await waitFor(() => expect(onShowToast).toHaveBeenCalledWith('Quote updated', 'success'));
    expect(mocks.saveQuoteLineup).not.toHaveBeenCalled();
    // The gig on hold keeps its lineup too.
    expect(mocks.syncQuoteHoldEvent.mock.calls[0][2]).toBeNull();
  });

  it('a changed lineup is sent with the lineup the wizard opened with', async () => {
    mocks.updateQuote.mockResolvedValue({ data: { ...row }, error: null });
    mocks.saveQuoteLineup.mockResolvedValue({ data: { musicians: [], eventId: null, synced: false, confirmed: false }, error: null });
    mocks.wizardPayload = { musicians: [{ id: 'x', name: 'Sam Ortiz', instrument: 'Bass', fee: 350, isExternal: true }] };
    render(
      <QuotesExpanded bandId={BAND} onClose={vi.fn()} realQuotes={[row]} onShowToast={vi.fn()} focusQuoteId={QUOTE} onFocusConsumed={vi.fn()} />,
    );
    await clickAndSettle(await screen.findByText('detail edit'));
    await act(async () => {
      fireEvent.click(await screen.findByText('wizard save', undefined, { timeout: 10_000 }));
    });
    await waitFor(() => expect(mocks.saveQuoteLineup).toHaveBeenCalledTimes(1));
    expect(mocks.saveQuoteLineup.mock.calls[0][2]).toEqual([expect.objectContaining({ name: 'Maya Brooks', fee: 400 })]);
  });

  // #294 x #293 (option 1): a new quote from the Quotes card goes through the
  // app's save path, which holds the date (tentative event + lineup), so the
  // wizard shows the "Lineup availability" note there; without that path
  // (no onCreateNew) nothing holds the date and the note stays hidden.
  it('New quote from the Quotes card: the wizard holds the date (the lineup note shows)', async () => {
    render(<QuotesExpanded bandId={BAND} onClose={vi.fn()} realQuotes={[]} onShowToast={vi.fn()} onCreateNew={vi.fn()} />);
    await clickAndSettle(screen.getByRole('button', { name: 'New quote' }));
    const wizard = await screen.findByText('wizard save', undefined, { timeout: 10_000 });
    expect(wizard.getAttribute('data-holds-date')).toBe('true');
  });

  it('without the app save path the wizard promises no hold', async () => {
    render(<QuotesExpanded bandId={BAND} onClose={vi.fn()} realQuotes={[]} onShowToast={vi.fn()} />);
    await clickAndSettle(screen.getByRole('button', { name: 'New quote' }));
    const wizard = await screen.findByText('wizard save', undefined, { timeout: 10_000 });
    expect(wizard.getAttribute('data-holds-date')).toBe('false');
  });
});

