/**
 * Audit of 383f15b, i18n #2: a German-formatted deposit of €1,250 was
 * recorded as €1.25. The sheet now reads the amount as the user writes it.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/services/quoteLinks', () => ({
  getBalanceGig: vi.fn(async () => ({
    data: { id: 'evt-1', status: 'tentative', currency: 'EUR', event_date: '2027-06-12', fee: 3000, deposit_amount: null, deposit_paid: false, payment_status: 'pending' },
    error: null,
  })),
}));
vi.mock('@/lib/services/quotes', () => ({ recordQuoteDeposit: mocks.record }));

// Rendering the whole sheet is slow on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

import { setLocalePref } from '@/lib/i18n';
import { DepositReceivedSheet } from '../DepositReceivedSheet';

const quote = {
  id: 'q-1', quoteNumber: 'Q-2027-0007', status: 'ACCEPTED', clientName: 'Jordan Lee', currency: 'EUR',
  total: 3000, depositRequired: true, depositPercentage: 30, eventDate: '2027-06-12',
} as any;

afterEach(async () => {
  cleanup();
  await act(() => setLocalePref('en'));
});

describe('DepositReceivedSheet: the amount as typed', () => {
  it('records 1.250 typed in German as 1250, not 1.25', async () => {
    await act(() => setLocalePref('de'));
    mocks.record.mockResolvedValue({ data: { eventId: 'evt-1', received: true, confirmed: true, created: false }, error: null });
    render(<DepositReceivedSheet open onClose={() => {}} quote={quote} />);
    const field = await screen.findByRole('textbox');
    fireEvent.change(field, { target: { value: '1.250' } });
    const button = screen.getAllByRole('button').find((b) => /anzahlung|deposit/i.test(b.textContent || '') && !b.hasAttribute('disabled'));
    expect(button).toBeTruthy();
    fireEvent.click(button!);
    await waitFor(() => expect(mocks.record).toHaveBeenCalled());
    expect(mocks.record.mock.calls[0][1].amount).toBe(1250);
  });

  it('does not record text that is not an amount', async () => {
    mocks.record.mockClear();
    render(<DepositReceivedSheet open onClose={() => {}} quote={quote} />);
    const field = await screen.findByRole('textbox');
    fireEvent.change(field, { target: { value: '1,2,5' } });
    expect(await screen.findByText(/Enter an amount/)).toBeTruthy();
    const button = screen.getAllByRole('button').find((b) => /deposit received/i.test(b.textContent || ''));
    expect(button?.hasAttribute('disabled')).toBe(true);
  });
});
