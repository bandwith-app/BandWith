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
  undo: vi.fn(),
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
  undoQuoteBalanceSend: mocks.undo,
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
  mocks.markSent.mockResolvedValue({ data: 'balance_requested', error: null, pending: true });
  mocks.email.mockResolvedValue({ ok: true });
  mocks.undo.mockResolvedValue({ data: true, error: null });
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

  // Codex round 6 (BalanceRequestSheet:340): an app closed right after the
  // email never recorded the send, so the page kept the earlier balance.
  // The send is recorded first (pending), then the email, then confirmed.
  it('Send by email: the send is recorded before the email goes out, and confirmed after', async () => {
    mocks.publish.mockResolvedValue({ data: { token: link.token, balance_version: 5, changed: true }, error: null });
    render(<BalanceRequestSheet open onClose={() => {}} quote={quote} bandId="band-1" bandName="The Night Shift" />);
    fireEvent.change(await otherField(), { target: { value: '100' } });
    const send = await waitFor(() => {
      const b = screen.getAllByRole('button').find((x) => /send by email/i.test(x.textContent || ''));
      expect(b && !b.hasAttribute('disabled')).toBe(true);
      return b!;
    });
    fireEvent.click(send);
    await waitFor(() => expect(mocks.markSent).toHaveBeenCalledTimes(2));
    expect(mocks.markSent.mock.calls[0]).toEqual(['q-1', 'sent', 'email', 5, true]);
    expect(mocks.markSent.mock.calls[1]).toEqual(['q-1', 'sent', 'email', 5, false]);
    expect(mocks.markSent.mock.invocationCallOrder[0]).toBeLessThan(mocks.email.mock.invocationCallOrder[0]);
    expect(mocks.email.mock.invocationCallOrder[0]).toBeLessThan(mocks.markSent.mock.invocationCallOrder[1]);
    expect(await screen.findByText(/Balance request sent to/)).toBeTruthy();
    expect(mocks.undo).not.toHaveBeenCalled();
  });

  it('Send by email: a send that could not be recorded sends no email', async () => {
    mocks.markSent.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
    render(<BalanceRequestSheet open onClose={() => {}} quote={quote} bandId="band-1" bandName="The Night Shift" />);
    fireEvent.change(await otherField(), { target: { value: '100' } });
    const send = await waitFor(() => {
      const b = screen.getAllByRole('button').find((x) => /send by email/i.test(x.textContent || ''));
      expect(b && !b.hasAttribute('disabled')).toBe(true);
      return b!;
    });
    fireEvent.click(send);
    expect(await screen.findByText('The client page could not be updated. Try again.')).toBeTruthy();
    expect(mocks.email).not.toHaveBeenCalled();
    expect(screen.queryByText(/Balance request sent to/)).toBeNull();
  });

  // Codex round 3 (185:314): the send records the balance it published, not whatever is on the link by then.
  it('Send by email: records the balance version it published; one replaced meanwhile sends nothing', async () => {
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
    expect(await screen.findByText('Someone changed the balance meanwhile, so nothing was sent. Check the balance and send it again.')).toBeTruthy();
    expect(mocks.markSent).toHaveBeenCalledTimes(1);
    expect(mocks.markSent.mock.calls[0]).toEqual(['q-1', 'sent', 'email', 3, true]);
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it('Send by email: an email that did not go out puts the page back; one that may have gone out keeps the record', async () => {
    mocks.publish.mockResolvedValue({ data: { token: link.token, balance_version: 6, changed: true }, error: null });
    mocks.email.mockResolvedValue({ ok: false, code: 'too_soon' });
    render(<BalanceRequestSheet open onClose={() => {}} quote={quote} bandId="band-1" bandName="The Night Shift" />);
    fireEvent.change(await otherField(), { target: { value: '100' } });
    const send = await waitFor(() => {
      const b = screen.getAllByRole('button').find((x) => /send by email/i.test(x.textContent || ''));
      expect(b && !b.hasAttribute('disabled')).toBe(true);
      return b!;
    });
    fireEvent.click(send);
    expect(await screen.findByText('An email was just sent. Wait a minute and try again.')).toBeTruthy();
    expect(mocks.undo).toHaveBeenCalledWith('q-1', 6);
    cleanup();
    mocks.undo.mockClear();
    mocks.email.mockResolvedValue({ ok: false, code: undefined, error: new Error('Failed to fetch') });
    {
      render(<BalanceRequestSheet open onClose={() => {}} quote={quote} bandId="band-1" bandName="The Night Shift" />);
      fireEvent.change(await otherField(), { target: { value: '100' } });
      const send = await waitFor(() => {
        const b = screen.getAllByRole('button').find((x) => /send by email/i.test(x.textContent || ''));
        expect(b && !b.hasAttribute('disabled')).toBe(true);
        return b!;
      });
      fireEvent.click(send);
      expect(await screen.findByText('The email could not be sent. Share the link instead.')).toBeTruthy();
    }
    expect(mocks.undo).not.toHaveBeenCalled();
  });

  // Claude r9 (send-email:669): Resend refused it, nothing went out: the page is put back too.
  it('Send by email: an email Resend refused (email_refused) puts the page back', async () => {
    mocks.publish.mockResolvedValue({ data: { token: link.token, balance_version: 7, changed: true }, error: null });
    mocks.email.mockResolvedValue({ ok: false, code: 'email_refused', error: new Error('Edge Function returned a non-2xx status code') });
    render(<BalanceRequestSheet open onClose={() => {}} quote={quote} bandId="band-1" bandName="The Night Shift" />);
    fireEvent.change(await otherField(), { target: { value: '100' } });
    const send = await waitFor(() => {
      const b = screen.getAllByRole('button').find((x) => /send by email/i.test(x.textContent || ''));
      expect(b && !b.hasAttribute('disabled')).toBe(true);
      return b!;
    });
    fireEvent.click(send);
    expect(await screen.findByText('The email could not be sent. Share the link instead.')).toBeTruthy();
    expect(mocks.undo).toHaveBeenCalledWith('q-1', 7);
    expect(mocks.markSent.mock.calls).toEqual([['q-1', 'sent', 'email', 7, true]]);
  });

  // Claude round 4 (#286 send-email): the email names the balance version it is for.
  it('Send by email: the email is for the balance just published; another one meanwhile sends nothing', async () => {
    mocks.publish.mockResolvedValue({ data: { token: link.token, balance_version: 4, changed: true }, error: null });
    mocks.email.mockResolvedValue({ ok: false, code: 'balance_changed' });
    render(<BalanceRequestSheet open onClose={() => {}} quote={quote} bandId="band-1" bandName="The Night Shift" />);
    fireEvent.change(await otherField(), { target: { value: '100' } });
    const send = await waitFor(() => {
      const b = screen.getAllByRole('button').find((x) => /send by email/i.test(x.textContent || ''));
      expect(b && !b.hasAttribute('disabled')).toBe(true);
      return b!;
    });
    fireEvent.click(send);
    await waitFor(() => expect(mocks.email).toHaveBeenCalled());
    expect(mocks.email.mock.calls[0]).toEqual(['q-1', 'sent', 4]);
    expect(await screen.findByText('Someone changed the balance meanwhile, so nothing was sent. Check the balance and send it again.')).toBeTruthy();
    // Round 6: recorded first, then put back as the email did not go out.
    expect(mocks.markSent.mock.calls).toEqual([['q-1', 'sent', 'email', 4, true]]);
    expect(mocks.undo).toHaveBeenCalledWith('q-1', 4);
  });
});
