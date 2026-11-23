/**
 * 183 round 5 (Codex review of 8f5922d7, QuotesExpanded.tsx:203): an edit
 * is compared with the quote as the wizard opened it, never with the list as
 * it reloaded since. Its read time goes out as edit_base_at, so the server's
 * stale-edit check catches a change of client made meanwhile.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

vi.setConfig({ testTimeout: 45_000 });

const BAND = '11111111-1111-4111-8111-111111111111';
const QUOTE = '22222222-2222-4222-8222-222222222222';
const OPENED_AT = '2026-11-20T15:04:05.000Z';
const RELOADED_AT = '2026-11-20T15:09:00.000Z';

const mocks = vi.hoisted(() => ({ updateQuote: vi.fn(), wizardPayload: null as any }));
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
}));
vi.mock('@/lib/services/quoteLinks', () => ({ republishClientQuote: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: { id: BAND, name: 'The Night Shift' }, bands: [] }),
  useOptionalBand: () => null,
}));
vi.mock('@/app/components/quotes/QuoteCreationWizard', () => ({
  QuoteCreationWizard: (p: { onCreate: (q: any, o?: any) => void; initialData?: any }) => (
    <button type="button" onClick={() => p.onCreate({ ...(p.initialData || {}), ...mocks.wizardPayload })}>
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
  id: QUOTE, band_id: BAND, quote_number: 'Q-2027-0007', status: 'sent', client_name: 'Emma Carter',
  client_email: 'emma.carter@example.com', event_name: 'Rooftop wedding', event_date: '2027-06-12',
  venue_name: '230 Fifth', venue_city: 'New York', currency: 'USD', total: 2400, updated_at: OPENED_AT, musicians: [],
} as unknown as DbQuote;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.wizardPayload = null;
});

describe('QuotesExpanded: the edit\'s baseline', () => {
  it('the list reloads while the wizard is open (another admin gave the quote to Jordan): the edit keeps the time it opened with', async () => {
    mocks.updateQuote.mockResolvedValue({ data: { ...row }, error: null });
    const props = { bandId: BAND, onClose: vi.fn(), onShowToast: vi.fn(), focusQuoteId: QUOTE, onFocusConsumed: vi.fn() };
    const view = render(<QuotesExpanded {...props} realQuotes={[row]} />);
    await act(async () => {
      fireEvent.click(await screen.findByText('detail edit'));
      await new Promise((r) => setTimeout(r, 50));
    });
    // Round 6 (r9): 20 s, as the wizard's lazy load is slow on a loaded runner.
    await screen.findByText('wizard save', undefined, { timeout: 20_000 });
    // Reloaded meanwhile: the quote now goes to Jordan, saved later.
    const reloaded = { ...row, client_name: 'Jordan Lee', client_email: 'jordan@brooklynevents.example', updated_at: RELOADED_AT } as DbQuote;
    await act(async () => { view.rerender(<QuotesExpanded {...props} realQuotes={[reloaded]} />); });
    // The admin fixes the email on the screen opened for Emma.
    mocks.wizardPayload = { clientEmail: 'emma@carter.example' };
    await act(async () => { fireEvent.click(screen.getByText('wizard save')); });
    await waitFor(() => expect(mocks.updateQuote).toHaveBeenCalledTimes(1));
    const updates = mocks.updateQuote.mock.calls[0][1];
    expect(updates.edit_base_at).toBe(OPENED_AT);
    expect(updates).toMatchObject({ client_email: 'emma@carter.example' });
  });
});
