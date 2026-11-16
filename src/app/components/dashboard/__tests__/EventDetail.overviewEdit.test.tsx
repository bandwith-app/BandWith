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
  members: [
    { userId: 'u-1', name: 'Ada Admin', initials: 'AA', role: 'Guitar', fee: 400, status: 'confirmed' },
    { userId: 'u-2', name: 'Bo Bass', initials: 'BB', role: 'Bass', fee: 400, status: 'pending' },
  ],
}));
vi.mock('@/lib/services/events', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/events')>()),
  updateEvent: mocks.updateEvent,
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
  title: 'Wedding Rossi',
  status: 'CONFIRMED',
  eventType: 'wedding',
  date: '2099-12-12',
  time: '19:30',
  location: 'Villa Clara',
  venueName: 'Villa Clara',
  price: '1000',
  members: [],
  color: '#000',
};

const rehearsal: EventData = {
  ...gig,
  id: 2,
  eventId: 'evt-r',
  title: 'Band rehearsal',
  status: 'REHEARSAL',
  eventType: 'rehearsal',
  time: '19:00',
  endTime: '22:00',
  location: 'Studio 5',
  venueName: 'Studio 5',
  price: '0',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const editActions = () => screen.queryAllByRole('button', { name: /^EDIT: / });
/** The open editor sheet with this title (sheets are unnamed dialogs on <body>). */
const sheet = async (title: string) => {
  await screen.findByText(title);
  const found = screen.getAllByRole('dialog').find((d) => within(d).queryByText(title));
  if (!found) throw new Error(`No sheet "${title}"`);
  return found;
};

describe('EventDetail: one overview to edit the event', () => {
  it('admin: every card has its EDIT, none opens the Edit page, and there is no Edit button at the bottom', async () => {
    const onEdit = vi.fn();
    render(<EventDetail event={gig} onClose={vi.fn()} onEdit={onEdit} onChat={vi.fn()} isAdmin currentUserId="u-1" />);
    await waitFor(() => expect(screen.getAllByText('Bo Bass').length).toBeGreaterThan(0));

    const labels = editActions().map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(expect.arrayContaining([expect.stringMatching(/LINEUP/), 'EDIT: TASKS', 'EDIT: NOTES']));
    expect(screen.getByRole('button', { name: 'Edit title, date & times' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Edit venue' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Edit fee' })).toBeTruthy();
    // The bottom row is the chat only: no plain "EDIT" pill.
    expect(screen.queryByRole('button', { name: /^EDIT$/ })).toBeNull();
    expect(screen.getByRole('button', { name: /EVENT CHAT/ })).toBeTruthy();

    for (const b of editActions()) {
      fireEvent.click(b);
      fireEvent.keyDown(document, { key: 'Escape' });
    }
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('admin edits the title and times from the hero; Save writes the card once', async () => {
    mocks.updateEvent.mockResolvedValue({ data: {}, error: null });
    const onEventUpdated = vi.fn();
    const onToast = vi.fn();
    render(
      <EventDetail event={gig} onClose={vi.fn()} onEventUpdated={onEventUpdated} onToast={onToast} isAdmin currentUserId="u-1" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit title, date & times' }));
    const dialog = await sheet('Title, date & times');
    const save = within(dialog).getByRole('button', { name: /^Save$/ });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText('Event title'), { target: { value: 'Wedding Rossi & Bianchi' } });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(save);
    });
    expect(mocks.updateEvent).toHaveBeenCalledTimes(1);
    expect(mocks.updateEvent).toHaveBeenCalledWith('evt-a', {
      title: 'Wedding Rossi & Bianchi',
      event_date: '2099-12-12',
      start_time: '19:30',
      end_time: null,
      event_type: 'wedding',
      load_in_time: null,
      soundcheck_time: null,
    });
    expect(onEventUpdated).toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith('Event updated!', 'success');
    // Shown at once, before the events list reloads.
    await waitFor(() => expect(screen.getAllByText('Wedding Rossi & Bianchi').length).toBeGreaterThan(0));
  });

  it('rehearsal admin: studio cost, focus songs, notes and to-dos are edited on their cards', async () => {
    const onEdit = vi.fn();
    render(<EventDetail event={rehearsal} onClose={vi.fn()} onEdit={onEdit} onChat={vi.fn()} isAdmin currentUserId="u-1" />);
    await waitFor(() => expect(screen.getAllByText('Bo Bass').length).toBeGreaterThan(0));
    const labels = editActions().map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(expect.arrayContaining(['EDIT: STUDIO COST', 'EDIT: NOTES', 'EDIT: TASKS', 'EDIT: FOCUS SONGS']));
    expect(screen.queryByRole('button', { name: /^EDIT$/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'EDIT: STUDIO COST' }));
    expect(await sheet('Studio cost')).toBeTruthy();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('members keep the read-only overview', async () => {
    render(<EventDetail event={gig} onClose={vi.fn()} onEdit={vi.fn()} isAdmin={false} userResponse="accepted" currentUserId="u-2" />);
    await waitFor(() => expect(screen.getAllByText('Bo Bass').length).toBeGreaterThan(0));
    expect(editActions()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Edit title, date & times' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit venue' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit fee' })).toBeNull();
  });
});
