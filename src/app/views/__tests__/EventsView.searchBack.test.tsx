/**
 * Calendar search (full screen): Android Back, the browser's Back and Escape
 * close it, like its own Back. An event picked from the results opens on top
 * and closes first, back to the results.
 */
import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor, within } from '@testing-library/react';
import { EventsView } from '../EventsView';
import { handleBackFromStack } from '@/lib/backStack';
import type { EventData } from '@/app/components/dashboard/EventCard';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const gig: EventData = {
  id: 1,
  eventId: 'e1',
  band_id: 'b1',
  title: 'Spring Gala',
  status: 'confirmed',
  date: '2026-11-20',
  time: '20:00',
  location: 'Blue Note, Milano',
  price: '0',
  members: [],
  color: 'gig',
};

function Calendar({ eventOpen = false, onEventClick = () => {} }: { eventOpen?: boolean; onEventClick?: (e: EventData) => void }) {
  const [search, setSearch] = useState('');
  return (
    <EventsView
      eventFilter="ALL"
      setEventFilter={() => {}}
      eventSearch={search}
      setEventSearch={setSearch}
      eventView="calendar"
      groupedEvents={[]}
      allEvents={[gig]}
      rawEvents={[gig]}
      onEventClick={onEventClick}
      isAdmin
      eventOpen={eventOpen}
    />
  );
}

const openSearch = () => act(() => void window.dispatchEvent(new Event('bw:open-event-search')));
const searchScreen = () => screen.queryByRole('dialog', { name: 'Search events' });

afterEach(() => {
  cleanup();
  // Nothing left registered for the next test.
  while (handleBackFromStack());
});

describe('Calendar search and system Back', () => {
  it('system Back closes the search', async () => {
    render(<Calendar />);
    openSearch();
    expect(searchScreen()).not.toBeNull();
    let handled = false;
    act(() => void (handled = handleBackFromStack()));
    expect(handled).toBe(true);
    await waitFor(() => expect(searchScreen()).toBeNull());
  });

  it('with an event picked from the results open on top, Back is left to the event first', async () => {
    const { rerender } = render(<Calendar />);
    openSearch();
    fireEvent.change(screen.getByPlaceholderText('Search title, venue, city, client…'), { target: { value: 'Blue' } });
    fireEvent.click(within(searchScreen()!).getByRole('button', { name: /Spring Gala/ }));
    rerender(<Calendar eventOpen />);
    let handled = true;
    act(() => void (handled = handleBackFromStack()));
    expect(handled).toBe(false);
    expect(searchScreen()).not.toBeNull();

    // The event closed: the next Back closes the search.
    rerender(<Calendar />);
    act(() => void (handled = handleBackFromStack()));
    expect(handled).toBe(true);
    await waitFor(() => expect(searchScreen()).toBeNull());
  });

  it('an event already open beside the calendar (tablet) does not keep the search open', async () => {
    render(<Calendar eventOpen />);
    openSearch();
    let handled = false;
    act(() => void (handled = handleBackFromStack()));
    expect(handled).toBe(true);
    await waitFor(() => expect(searchScreen()).toBeNull());
  });
});
