/**
 * #293 round 5 (Codex): the deposit is recorded in the quote's currency
 * (bw_quote_deposit_received, 183/187), so the sheet names that currency,
 * not the one the gig defaulted to. A USD quote on a gig kept in EUR.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/services/quoteLinks', () => ({
  getBalanceGig: vi.fn(async () => ({
    data: { id: 'evt-1', status: 'tentative', currency: 'EUR', event_date: '2027-06-12', fee: 3000, deposit_amount: null, deposit_paid: false, payment_status: 'pending' },
    error: null,
  })),
}));
vi.mock('@/lib/services/quotes', () => ({ recordQuoteDeposit: vi.fn() }));

vi.setConfig({ testTimeout: 30_000 });

import { DepositReceivedSheet } from '../DepositReceivedSheet';

const quote = {
  id: 'q-1', quoteNumber: 'Q-2027-0008', status: 'ACCEPTED', clientName: 'Jordan Lee', currency: 'USD',
  total: 3000, depositRequired: true, depositPercentage: 30, eventDate: '2027-06-12',
} as any;

afterEach(() => cleanup());

describe('DepositReceivedSheet: the currency the deposit is recorded in', () => {
  it('a USD quote on a gig that defaulted to EUR says USD', async () => {
    render(<DepositReceivedSheet open onClose={() => {}} quote={quote} />);
    await screen.findByRole('textbox');
    expect(await screen.findByText('USD')).toBeTruthy();
    expect(screen.queryByText('EUR')).toBeNull();
    // The deposit the quote asks for is written in dollars too.
    expect(document.body.textContent || '').not.toMatch(/€/);
  });
});
