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
  saveQuoteMusicians: vi.fn(),
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
  saveQuoteMusicians: mocks.saveQuoteMusicians,
  syncQuoteHoldEvent: mocks.syncQuoteHoldEvent,
}));
vi.mock('@/lib/services/quoteLinks', () => ({ republishClientQuote: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: { id: BAND, name: 'The Night Shift' }, bands: [] }),
  useOptionalBand: () => null,
}));
// The wizard: one button that saves what the test sets.
vi.mock('@/app/components/quotes/QuoteCreationWizard', () => ({
  QuoteCreationWizard: (p: { onCreate: (q: any, o?: any) => void; initialData?: any }) => (
    <button type="button" onClick={() => p.onCreate({ ...(p.initialData || {}), ...mocks.wizardPayload }, { askAvailability: true })}>
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
    mocks.saveQuoteMusicians.mockResolvedValue({
      data: [{ id: 'm-2', quote_id: QUOTE, name: 'Sam Ortiz', instrument: 'Bass', fee: 350, is_external: true, is_available: true }],
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
    await waitFor(() => expect(mocks.saveQuoteMusicians).toHaveBeenCalledTimes(1));
    expect(mocks.saveQuoteMusicians.mock.calls[0][0]).toBe(QUOTE);
    expect(mocks.saveQuoteMusicians.mock.calls[0][1]).toEqual([expect.objectContaining({ name: 'Sam Ortiz', fee: 350 })]);
  });

  it('a lineup that did not save says so and keeps the wizard open', async () => {
    mocks.updateQuote.mockResolvedValue({ data: { ...row }, error: null });
    mocks.saveQuoteMusicians.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
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
    mocks.saveQuoteMusicians.mockResolvedValue({ data: saved, error: null });
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
    mocks.saveQuoteMusicians.mockResolvedValue({ data: [], error: null });
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
});
