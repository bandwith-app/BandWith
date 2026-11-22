/**
 * Audit of 383f15b:
 * - i18n #3: "1.250,00" under Other payments was read as NaN, i.e. 0, and
 *   the client was asked the whole total. It now counts as 1,250, and text
 *   that is no amount stops the request.
 * - money #8: Preview published the trial balance on the client's page.
 *   It now keeps a draft with its own key and publishes nothing.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  preview: vi.fn(),
  markSent: vi.fn(),
  email: vi.fn(),
  open: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/nativeFiles', () => ({ openExternal: mocks.open }));
vi.mock('@/lib/services/pricing', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/pricing')>()),
  getBandPricing: vi.fn(async () => ({ currency: 'EUR', stripe_payment_link: '', bank_account_holder: '', bank_iban: '' })),
}));
const link = {
  quote_id: 'q-1', token: 'a'.repeat(64), lang: 'de', status: 'accepted', version: 1, version_at: null, pdf_url: null, pdf_version: null,
  sent_at: '2027-04-01T10:00:00Z', first_viewed_at: null, responded_at: null, accepted_name: 'Jordan Lee', accepted_version: 1,
  decline_reason: null, revoked_at: null, balance: null, balance_version: 0, balance_at: null, balance_sent_at: null, balance_paid_at: null,
};
vi.mock('@/lib/services/quoteLinks', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/quoteLinks')>()),
  getQuoteLinkState: vi.fn(async () => ({ data: { link, activity: [] }, error: null })),
  getBalanceGig: vi.fn(async () => ({
    data: { id: 'evt-1', status: 'confirmed', currency: 'EUR', event_date: '2099-06-12', fee: 3000, deposit_amount: null, deposit_paid: false, payment_status: 'pending' },
    error: null,
  })),
  publishQuoteBalance: mocks.publish,
  previewQuoteBalance: mocks.preview,
  markQuoteBalanceSent: mocks.markSent,
  sendQuoteBalanceEmail: mocks.email,
}));

// Rendering the whole sheet is slow on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

import { setLocalePref } from '@/lib/i18n';
import { BalanceRequestSheet } from '../BalanceRequestSheet';

const quote = {
  id: 'q-1', quoteNumber: 'Q-2027-0007', status: 'ACCEPTED', clientName: 'Jordan Lee', clientEmail: 'jordan@brooklynevents.example',
  currency: 'EUR', total: 3000, subtotal: 3000, baseFee: 3000, depositRequired: false, eventDate: '2099-06-12', eventName: 'Rooftop wedding',
  musicians: [], customItems: [],
} as any;

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.publish.mockResolvedValue({ data: { token: link.token, balance_version: 1, changed: true }, error: null });
  mocks.preview.mockResolvedValue({ data: 'b'.repeat(64), error: null });
  mocks.markSent.mockResolvedValue({ data: 'balance_requested', error: null });
  mocks.email.mockResolvedValue({ ok: true });
});
afterEach(async () => {
  cleanup();
  await act(() => setLocalePref('en'));
});

const otherField = async () => {
  const fields = await screen.findAllByRole('textbox');
  return fields[0];
};

describe('BalanceRequestSheet: other payments and preview', () => {
  it('counts 1.250,00 typed in German as 1,250 already paid', async () => {
    await act(() => setLocalePref('de'));
    render(<BalanceRequestSheet open onClose={() => {}} quote={quote} bandId="band-1" bandName="The Night Shift" />);
    fireEvent.change(await otherField(), { target: { value: '1.250,00' } });
    const send = await waitFor(() => {
      const b = screen.getAllByRole('button').find((x) => x.closest('[data-bw-sheet-footer], footer') || /e-mail|email/i.test(x.textContent || ''));
      expect(b).toBeTruthy();
      return b!;
    });
    fireEvent.click(send);
    await waitFor(() => expect(mocks.publish).toHaveBeenCalled());
    const sent = mocks.publish.mock.calls[0][1];
    // The agreed total (VAT included) less the 1,250 already paid.
    expect(sent.other).toBe(1250);
    expect(sent.amount).toBe(sent.total - 1250);
    expect(sent.amount).toBeLessThan(sent.total);
  });

  it('does not ask for the balance while Other payments is not an amount', async () => {
    render(<BalanceRequestSheet open onClose={() => {}} quote={quote} bandId="band-1" bandName="The Night Shift" />);
    fireEvent.change(await otherField(), { target: { value: '1,2,5' } });
    expect(await screen.findByText(/Enter an amount/)).toBeTruthy();
    const send = screen.getAllByRole('button').find((x) => /send by email/i.test(x.textContent || ''));
    expect(send?.hasAttribute('disabled')).toBe(true);
  });

  it('Preview publishes nothing to the client: a draft with its key', async () => {
    render(<BalanceRequestSheet open onClose={() => {}} quote={quote} bandId="band-1" bandName="The Night Shift" />);
    fireEvent.change(await otherField(), { target: { value: '100' } });
    const preview = await waitFor(() => {
      const b = screen.getAllByRole('button').find((x) => /^preview/i.test((x.textContent || '').trim()) || /preview/i.test(x.getAttribute('aria-label') || ''));
      expect(b).toBeTruthy();
      return b!;
    });
    fireEvent.click(preview);
    await waitFor(() => expect(mocks.open).toHaveBeenCalled());
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(String(mocks.open.mock.calls[0][0])).toContain(`&k=${'b'.repeat(64)}`);
  });

  // Review of #293: the email has the new amount; the page shows only what the send record puts there.
  it('Send by email: a send that could not be recorded says the page still shows the earlier balance', async () => {
    mocks.markSent.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
    render(<BalanceRequestSheet open onClose={() => {}} quote={quote} bandId="band-1" bandName="The Night Shift" />);
    fireEvent.change(await otherField(), { target: { value: '100' } });
    const send = await waitFor(() => {
      const b = screen.getAllByRole('button').find((x) => /send by email/i.test(x.textContent || ''));
      expect(b && !b.hasAttribute('disabled')).toBe(true);
      return b!;
    });
    fireEvent.click(send);
    await waitFor(() => expect(mocks.email).toHaveBeenCalled());
    expect(await screen.findByText(/still shows the earlier balance/)).toBeTruthy();
    expect(screen.queryByText(/Balance request sent to/)).toBeNull();
  });

  // Codex round 3 (185:314): the send records the balance it published, not whatever is on the link by then.
  it('Send by email: records the balance version it published; one replaced meanwhile says so and is not retried', async () => {
    mocks.publish.mockResolvedValue({ data: { token: link.token, balance_version: 3, changed: true }, error: null });
    mocks.markSent.mockResolvedValue({ data: null, error: new Error('BW_BALANCE_CHANGED: the balance was changed after this one was sent') });
    render(<BalanceRequestSheet open onClose={() => {}} quote={quote} bandId="band-1" bandName="The Night Shift" />);
    fireEvent.change(await otherField(), { target: { value: '100' } });
    const send = await waitFor(() => {
      const b = screen.getAllByRole('button').find((x) => /send by email/i.test(x.textContent || ''));
      expect(b && !b.hasAttribute('disabled')).toBe(true);
      return b!;
    });
    fireEvent.click(send);
    await waitFor(() => expect(mocks.email).toHaveBeenCalled());
    expect(
      await screen.findByText('The email went out, but someone changed the balance meanwhile, so the client’s page still shows the earlier one. Check the balance and send it again.'),
    ).toBeTruthy();
    expect(mocks.markSent).toHaveBeenCalledTimes(1);
    expect(mocks.markSent.mock.calls[0]).toEqual(['q-1', 'sent', 'email', 3]);
  });
});
