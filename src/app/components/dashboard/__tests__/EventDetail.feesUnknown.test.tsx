/**
 * Audit of 383f15b, events #5: with the fees not loaded (feeUnknown), the
 * Edit fee and Lineup sheets can't be saved: saving wrote 0 over every
 * musician's real fee.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, cleanup, screen, waitFor, fireEvent, within } from '@testing-library/react';

// Every query resolves empty; the event row update and the lineup are mocked.
vi.mock('@/lib/supabase', () => {
  const builder = () => {
    const b: any = new Proxy(function () {}, {
      get: (_t, prop) => {
        if (prop === 'then') {
          const p = Promise.resolve({ data: null, error: null });
          return p.then.bind(p);
        }
        return b;
      },
      apply: () => b,
    });
    return b;
  };
  return { supabase: new Proxy({}, { get: () => () => builder() }) };
});
const mocks = vi.hoisted(() => ({
  updateEvent: vi.fn(),
  reloadMembers: vi.fn(),
  saveEventLineup: vi.fn(),
  members: [
    // getEventMemberMoney failed: the fees shown are not the real ones.
    { userId: 'u-1', name: 'Maya Brooks', initials: 'MB', role: 'Guitar', fee: 0, status: 'confirmed', feeUnknown: true },
    { userId: 'u-2', name: 'Sam Ortiz', initials: 'SO', role: 'Bass', fee: 0, status: 'confirmed', feeUnknown: true },
  ],
}));
vi.mock('@/lib/services/events', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/events')>()),
  updateEvent: mocks.updateEvent,
}));
vi.mock('@/lib/services/eventMemberMoney', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/eventMemberMoney')>()),
  saveEventLineup: mocks.saveEventLineup,
}));
vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), pickUp: vi.fn(), dragTick: vi.fn(), drop: vi.fn() },
}));
vi.mock('@/lib/BandContext', () => ({ useBand: () => ({ selectedBand: null, bands: [] }) }));
vi.mock('@/app/components/ui/WeatherWidget', () => ({ WeatherWidget: () => null }));
vi.mock('@/app/components/event/useEventMembers', () => ({
  useEventMembers: () => ({
    members: mocks.members,
    loading: false,
    error: null,
    paidSupported: false,
    markAllPaid: vi.fn(),
    markingPaid: false,
    markError: null,
    reload: mocks.reloadMembers,
  }),
}));
vi.mock('@/lib/services/eventTasks', () => ({
  useEventTasks: () => ({ tasks: [], toggle: vi.fn(), error: null, reload: vi.fn() }),
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { EventDetail } from '../EventDetail';
import type { EventData } from '../EventCard';

const gig: EventData = {
  id: 1,
  eventId: 'evt-a',
  band_id: 'band-1',
  title: 'Rooftop wedding',
  status: 'CONFIRMED',
  eventType: 'wedding',
  date: '2099-12-12',
  time: '19:30',
  location: '230 Fifth Ave, New York',
  venueName: '230 Fifth',
  price: '1000',
  members: [],
  color: '#000',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const sheet = async (title: string) => {
  await screen.findByText(title);
  const found = screen.getAllByRole('dialog').find((d) => within(d).queryByText(title));
  if (!found) throw new Error(`No sheet "${title}"`);
  return found;
};

describe('EventDetail: fees not loaded', () => {
  it('Edit fee says why and does not save', async () => {
    render(<EventDetail event={gig} onClose={vi.fn()} isAdmin currentUserId="u-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit fee' }));
    const dialog = await sheet('Edit fee');
    expect(within(dialog).getByText(/The fees could not be loaded/)).toBeTruthy();
    const save = within(dialog).getByRole('button', { name: /^Save$/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await act(async () => {
      fireEvent.click(save);
    });
    expect(mocks.saveEventLineup).not.toHaveBeenCalled();
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });

  it('Lineup says why and does not save', async () => {
    render(<EventDetail event={gig} onClose={vi.fn()} isAdmin currentUserId="u-1" />);
    await waitFor(() => expect(screen.getAllByText('Sam Ortiz').length).toBeGreaterThan(0));
    const edit = screen.getAllByRole('button', { name: /^EDIT: / }).find((b) => /LINEUP/.test(b.getAttribute('aria-label') || ''));
    fireEvent.click(edit!);
    const dialog = await sheet('Lineup');
    expect(within(dialog).getByText(/The fees could not be loaded/)).toBeTruthy();
    const save = within(dialog).getByRole('button', { name: /^Save$/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await act(async () => {
      fireEvent.click(save);
    });
    expect(mocks.saveEventLineup).not.toHaveBeenCalled();
  });

  // Round 2 (#293): the fees load while the sheet is open (back online).
  const unknown = mocks.members;
  const known = [
    { userId: 'u-1', name: 'Maya Brooks', initials: 'MB', role: 'Guitar', fee: 300, status: 'confirmed' },
    { userId: 'u-2', name: 'Sam Ortiz', initials: 'SO', role: 'Bass', fee: 250, status: 'confirmed' },
  ];
  afterEach(() => {
    mocks.members = unknown;
  });

  it('Edit fee: fees that load while it is open replace the zeros it showed', async () => {
    const view = render(<EventDetail event={gig} onClose={vi.fn()} isAdmin currentUserId="u-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit fee' }));
    await sheet('Edit fee');
    mocks.members = known as typeof unknown;
    view.rerender(<EventDetail event={gig} onClose={vi.fn()} isAdmin currentUserId="u-1" />);
    const dialog = await sheet('Edit fee');
    await waitFor(() => expect(within(dialog).getByDisplayValue('300')).toBeTruthy());
    expect(within(dialog).getByDisplayValue('250')).toBeTruthy();
    expect(within(dialog).queryByDisplayValue('0')).toBeNull();
  });

  it('Lineup: fees that load while it is open replace the zeros it showed', async () => {
    const view = render(<EventDetail event={gig} onClose={vi.fn()} isAdmin currentUserId="u-1" />);
    await waitFor(() => expect(screen.getAllByText('Sam Ortiz').length).toBeGreaterThan(0));
    const edit = screen.getAllByRole('button', { name: /^EDIT: / }).find((b) => /LINEUP/.test(b.getAttribute('aria-label') || ''));
    fireEvent.click(edit!);
    await sheet('Lineup');
    mocks.members = known as typeof unknown;
    view.rerender(<EventDetail event={gig} onClose={vi.fn()} isAdmin currentUserId="u-1" />);
    const dialog = await sheet('Lineup');
    await waitFor(() => expect(within(dialog).getByDisplayValue('300')).toBeTruthy());
    expect(within(dialog).getByDisplayValue('250')).toBeTruthy();
  });
});
