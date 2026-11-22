/**
 * Codex #297 MINOR: Calendar search on a repeating rehearsal whose first date
 * was deleted shows (and opens) the next date still on, not the deleted one.
 */
import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import { EventsView } from '../EventsView';
import { handleBackFromStack } from '@/lib/backStack';
import type { EventData } from '@/app/components/dashboard/EventCard';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const series = {
  id: 7,
  eventId: 'r1',
  band_id: 'b1',
  title: 'Weekly Groove Session',
  status: 'REHEARSAL',
  date: '2099-12-01',
  time: '19:00',
  location: 'Studio A',
  price: '0',
  members: [],
  color: 'rehearsal',
  is_recurring: true,
  recurrence_rule: { frequency: 'weekly', interval: 1, skip_dates: ['2099-12-01'] },
} as unknown as EventData;

function Calendar({ events, onEventClick }: { events: EventData[]; onEventClick: (e: EventData) => void }) {
  const [search, setSearch] = useState('');
  return (
    <EventsView
      eventFilter="ALL"
      setEventFilter={() => {}}
      eventSearch={search}
      setEventSearch={setSearch}
      eventView="calendar"
      groupedEvents={[]}
      allEvents={events}
      rawEvents={events}
      onEventClick={onEventClick}
      isAdmin
    />
  );
}

const results = () => screen.getByRole('dialog', { name: 'Search events' });
const search = (q: string) => {
  act(() => void window.dispatchEvent(new Event('bw:open-event-search')));
  fireEvent.change(screen.getByPlaceholderText('Search title, venue, city, client…'), { target: { value: q } });
};

afterEach(() => {
  cleanup();
  while (handleBackFromStack());
});

describe('Calendar search and deleted rehearsal dates', () => {
  it('opens the next date still on, not the deleted first date', () => {
    const onEventClick = vi.fn();
    render(<Calendar events={[series]} onEventClick={onEventClick} />);
    search('Groove');
    fireEvent.click(within(results()).getByRole('button', { name: /Weekly Groove Session/ }));
    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick.mock.calls[0][0].date).toBe('2099-12-08');
  });

  it('a series with every date deleted is not a result', () => {
    const gone = { ...series, recurrence_rule: { frequency: 'weekly', until: '2099-12-01', skip_dates: ['2099-12-01'] } } as unknown as EventData;
    render(<Calendar events={[gone]} onEventClick={() => {}} />);
    search('Groove');
    expect(within(results()).queryByRole('button', { name: /Weekly Groove Session/ })).toBeNull();
  });
});
