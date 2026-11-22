/**
 * #293 round 6 (Claude review r8, QuotesExpanded.tsx:243-266): the quote
 * was written before the lineup's base was checked. A has Sam $200 + Jo
 * $150 open, B removes Sam, A raises Jo to $180: A's update wrote base fee
 * $380 (Sam still counted in the total), then the lineup was refused, and
 * every retry was refused again. Now the quote and the lineup go in one
 * call; a refusal saves neither, and the wizard opens again on the quote as
 * stored, with the notice.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

vi.setConfig({ testTimeout: 45_000 });

const BAND = '11111111-1111-4111-8111-111111111111';
const QUOTE = '22222222-2222-4222-8222-222222222222';
const SAM = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const mocks = vi.hoisted(() => ({
  updateQuote: vi.fn(),
  saveQuoteLineup: vi.fn(),
  saveQuoteWithLineup: vi.fn(),
  getQuote: vi.fn(),
  toast: vi.fn(),
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
  updateQuote: mocks.updateQuote,
  saveQuoteLineup: mocks.saveQuoteLineup,
  saveQuoteWithLineup: mocks.saveQuoteWithLineup,
  getQuote: mocks.getQuote,
}));
vi.mock('@/lib/services/quoteLinks', () => ({ republishClientQuote: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: { id: BAND, name: 'The Night Shift' }, bands: [] }),
  useOptionalBand: () => null,
}));
vi.mock('@/app/components/quotes/QuoteCreationWizard', () => ({
  QuoteCreationWizard: (p: { onCreate: (q: any, o?: any) => void; initialData?: any }) => (
    <div>
      <span data-testid="wizard-lineup">
        {(p.initialData?.musicians || []).map((m: any) => `${m.name} ${m.fee}`).join(', ')}
      </span>
      <button type="button" onClick={() => p.onCreate({ ...(p.initialData || {}), ...mocks.wizardPayload })}>
        wizard save
      </button>
    </div>
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

const sam = { id: 'm-sam', quote_id: QUOTE, user_id: SAM, name: 'Sam Ortiz', instrument: 'Drums', fee: 200, is_external: false, is_available: true };
const jo = { id: 'm-jo', quote_id: QUOTE, user_id: null, name: 'Jo Kim', instrument: 'Guitar', fee: 150, is_external: true, is_available: true };
const row = {
  id: QUOTE, band_id: BAND, quote_number: 'Q-2027-0011', status: 'draft', client_name: 'Emma Carter',
  client_email: 'emma.carter@example.com', event_name: 'Hoboken rooftop', event_date: '2027-06-12',
  venue_name: 'Pier 13', venue_city: 'Hoboken', currency: 'USD', base_fee: 350, total: 350,
  updated_at: '2026-11-22T10:00:00.000Z', musicians: [sam, jo],
} as unknown as DbQuote;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.wizardPayload = null;
});

describe('QuotesExpanded round 6: the quote and its lineup are saved together', () => {
  it('B removed Sam meanwhile and A raises Jo: nothing is saved, the wizard opens again on the lineup as stored', async () => {
    const stale = Object.assign(new Error('Someone else changed this quote’s lineup while it was open.'), { code: '40001', hint: 'BW_LINEUP_CHANGED' });
    mocks.saveQuoteWithLineup.mockResolvedValue({ data: null, lineup: null, error: stale });
    mocks.saveQuoteLineup.mockResolvedValue({ data: null, error: stale });
    mocks.updateQuote.mockResolvedValue({ data: { ...row, base_fee: 380, total: 380 }, error: null });
    mocks.getQuote.mockResolvedValue({ data: { ...row, base_fee: 150, total: 150, musicians: [jo] }, error: null });
    render(
      <QuotesExpanded bandId={BAND} onClose={vi.fn()} onShowToast={mocks.toast} focusQuoteId={QUOTE} onFocusConsumed={vi.fn()} realQuotes={[row]} />,
    );
    await act(async () => {
      fireEvent.click(await screen.findByText('detail edit'));
      await new Promise((r) => setTimeout(r, 50));
    });
    await screen.findByText('wizard save', undefined, { timeout: 20_000 });
    expect(screen.getByTestId('wizard-lineup').textContent).toBe('Sam Ortiz 200, Jo Kim 150');

    // A raises Jo to $180 on the screen still showing Sam.
    mocks.wizardPayload = {
      baseFee: 380,
      musicians: [
        { id: 'm-sam', userId: SAM, name: 'Sam Ortiz', instrument: 'Drums', fee: 200 },
        { id: 'm-jo', name: 'Jo Kim', instrument: 'Guitar', fee: 180, isExternal: true },
      ],
    };
    await act(async () => { fireEvent.click(screen.getByText('wizard save')); });

    await waitFor(() => expect(mocks.saveQuoteWithLineup).toHaveBeenCalledTimes(1));
    const [id, updates, lineup] = mocks.saveQuoteWithLineup.mock.calls[0];
    expect(id).toBe(QUOTE);
    expect(updates).toMatchObject({ base_fee: 380 });
    expect(lineup.base.map((m: any) => `${m.name} ${m.fee}`)).toEqual(['Sam Ortiz 200', 'Jo Kim 150']);
    expect(lineup.musicians.map((m: any) => `${m.name} ${m.fee}`)).toEqual(['Sam Ortiz 200', 'Jo Kim 180']);
    // The quote is never written on its own before the lineup is checked.
    expect(mocks.updateQuote).not.toHaveBeenCalled();
    expect(mocks.saveQuoteLineup).not.toHaveBeenCalled();
    // Reloaded: the wizard shows the lineup as stored now, with the notice.
    await waitFor(() => expect(mocks.getQuote).toHaveBeenCalledWith(QUOTE));
    await waitFor(() => expect(screen.getByTestId('wizard-lineup').textContent).toBe('Jo Kim 150'));
    expect(mocks.toast).toHaveBeenCalledWith(
      'Someone else changed this quote’s lineup meanwhile, so nothing was saved. The quote now shows the lineup as it is: make your change again.',
      'error',
    );

    // Saved again from the reloaded quote: the base is the stored lineup, so it goes through.
    mocks.saveQuoteWithLineup.mockResolvedValue({
      data: { ...row, base_fee: 180, total: 180 },
      lineup: { musicians: [{ ...jo, fee: 180 }], eventId: null, synced: false, confirmed: false },
      error: null,
    });
    mocks.wizardPayload = { baseFee: 180, musicians: [{ id: 'm-jo', name: 'Jo Kim', instrument: 'Guitar', fee: 180, isExternal: true }] };
    await act(async () => { fireEvent.click(screen.getByText('wizard save')); });
    await waitFor(() => expect(mocks.saveQuoteWithLineup).toHaveBeenCalledTimes(2));
    expect(mocks.saveQuoteWithLineup.mock.calls[1][2].base.map((m: any) => `${m.name} ${m.fee}`)).toEqual(['Jo Kim 150']);
    expect(mocks.updateQuote).not.toHaveBeenCalled();
  });

  // Claude r9 NIT: the reload failed: no claim that the lineup is shown as it is; the wizard closes.
  it('refused and the quote could not be reloaded: says so and closes the wizard', async () => {
    const stale = Object.assign(new Error('Someone else changed this quote’s lineup while it was open.'), { code: '40001', hint: 'BW_LINEUP_CHANGED' });
    mocks.saveQuoteWithLineup.mockResolvedValue({ data: null, lineup: null, error: stale });
    mocks.getQuote.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
    render(
      <QuotesExpanded bandId={BAND} onClose={vi.fn()} onShowToast={mocks.toast} focusQuoteId={QUOTE} onFocusConsumed={vi.fn()} realQuotes={[row]} />,
    );
    await act(async () => {
      fireEvent.click(await screen.findByText('detail edit'));
      await new Promise((r) => setTimeout(r, 50));
    });
    await screen.findByText('wizard save', undefined, { timeout: 20_000 });
    mocks.wizardPayload = { baseFee: 380, musicians: [{ id: 'm-jo', name: 'Jo Kim', instrument: 'Guitar', fee: 180, isExternal: true }] };
    await act(async () => { fireEvent.click(screen.getByText('wizard save')); });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(
      'Someone else changed this quote’s lineup meanwhile, so nothing was saved, and the quote could not be reloaded. Close it and open it again.',
      'error',
    ));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.stringMatching(/shows the lineup as it is/), 'error');
    await waitFor(() => expect(screen.queryByText('wizard save')).toBeNull());
    expect(mocks.updateQuote).not.toHaveBeenCalled();
  });

  it('a save of the venue alone (lineup unchanged) is the quote update alone, as before', async () => {
    mocks.updateQuote.mockResolvedValue({ data: { ...row, venue_name: 'Brooklyn Bowl' }, error: null });
    render(
      <QuotesExpanded bandId={BAND} onClose={vi.fn()} onShowToast={mocks.toast} focusQuoteId={QUOTE} onFocusConsumed={vi.fn()} realQuotes={[row]} />,
    );
    await act(async () => {
      fireEvent.click(await screen.findByText('detail edit'));
      await new Promise((r) => setTimeout(r, 50));
    });
    await screen.findByText('wizard save', undefined, { timeout: 20_000 });
    mocks.wizardPayload = { venueName: 'Brooklyn Bowl' };
    await act(async () => { fireEvent.click(screen.getByText('wizard save')); });
    await waitFor(() => expect(mocks.updateQuote).toHaveBeenCalledTimes(1));
    expect(mocks.saveQuoteWithLineup).not.toHaveBeenCalled();
  });
});
