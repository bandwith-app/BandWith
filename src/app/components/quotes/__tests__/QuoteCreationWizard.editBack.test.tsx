import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';

// Audit 10 #5: editing a saved quote, Android Back went past the editor to
// the dashboard and dropped the changes. Now Back asks first when something
// changed, and just closes when nothing did. Made-up client (New York).

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: { id: 'b1', name: 'Hudson Line', members: [] }, refreshMembers: vi.fn() }),
  useOptionalBand: () => ({ selectedBand: { id: 'b1', name: 'Hudson Line', members: [] } }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/services/pricing', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, getBandPricing: vi.fn(async () => real.DEFAULT_BAND_PRICING) };
});
vi.mock('@/lib/services/location', () => ({ calculateTravelDistance: vi.fn(async () => null), venueFields: () => ({}) }));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { QuoteCreationWizard } from '../QuoteCreationWizard';
import { handleBackFromStack } from '@/lib/backStack';

afterEach(cleanup);

const quote = {
  id: 'q1',
  quoteNumber: 'Q-2026-0012',
  status: 'DRAFT' as const,
  clientName: 'Maya Chen',
  clientEmail: 'maya@example.com',
  eventName: 'Chen wedding',
  eventType: 'wedding' as const,
  eventDate: '2027-06-12',
  eventTimeStart: '19:00',
  venueName: 'The Loft, Brooklyn',
  venueCity: 'Brooklyn',
  guestCount: 120,
};

const renderEdit = async () => {
  const onClose = vi.fn();
  const onCreate = vi.fn();
  render(<QuoteCreationWizard initialData={quote as never} onClose={onClose} onCreate={onCreate} />);
  await screen.findByText('Editing');
  return { onClose, onCreate };
};

describe('editing a quote: Android Back', () => {
  it('with a change: Back asks to save or discard, and nothing is lost', async () => {
    const { onClose, onCreate } = await renderEdit();
    fireEvent.change(await screen.findByDisplayValue('Maya Chen'), { target: { value: 'Maya Chen-Park' } });

    let handled = false;
    act(() => {
      handled = handleBackFromStack();
    });
    expect(handled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    const sheet = (await screen.findByText('Save your changes?')).closest('[role="dialog"]') as HTMLElement;
    expect(sheet).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect((onCreate.mock.calls[0][0] as { clientName: string }).clientName).toBe('Maya Chen-Park');
  });

  it('with no change: Back closes the editor only', async () => {
    const { onClose } = await renderEdit();
    let handled = false;
    act(() => {
      handled = handleBackFromStack();
    });
    expect(handled).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
