import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

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
vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
const cal = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock('@/lib/nativeFiles', async (orig) => ({ ...(await orig<typeof import('@/lib/nativeFiles')>()), openExternal: cal.openExternal }));
vi.mock('@/lib/memberCalendar', async (orig) => ({
  ...(await orig<typeof import('@/lib/memberCalendar')>()),
  useCalendarToken: () => ({ token: 'c'.repeat(64), loading: false }),
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

// The venue field: a pick from the suggestions is one button here.
vi.mock('@/app/components/ui/VenueAutocomplete', () => ({
  VenueAutocomplete: ({ inputId, value, onChange, onSelect }: any) => (
    <>
      <input id={inputId} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" onClick={() => onSelect({ name: 'Blue Note', address: 'Via Borsieri 37', city: '' })}>
        Pick Blue Note
      </button>
    </>
  ),
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { EventDetail } from '../EventDetail';
import type { EventData } from '../EventCard';

const EVT = '11111111-2222-4333-8444-555555555555';
const gig: EventData = {
  id: 1,
  eventId: EVT,
  band_id: 'band-1',
  band_name: 'Velvet Static',
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const show = (event: EventData, extra: Record<string, unknown> = {}) =>
  render(<EventDetail event={event} onClose={vi.fn()} onEventUpdated={vi.fn()} onToast={vi.fn()} currentUserId="u-2" {...extra} />);

describe('Event detail: add to calendar', () => {
  it('a member on the gig adds it to Apple Calendar (.ics) or Google Calendar', async () => {
    show(gig, { userResponse: 'accepted' });
    fireEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));
    expect(cal.openExternal).toHaveBeenLastCalledWith(expect.stringMatching(new RegExp(`member-calendar\\?t=c{64}&l=en&e=${EVT}$`)));
    fireEvent.click(screen.getByRole('button', { name: 'Google Calendar' }));
    const calls = cal.openExternal.mock.calls;
    const google = calls[calls.length - 1]?.[0] as string;
    expect(google).toContain('calendar.google.com/calendar/render');
    expect(google).toContain('dates=20991212T193000');
    expect(google).toContain('Wedding+Rossi+%C2%B7+Velvet+Static');
    // Never the fee.
    expect(google).not.toContain('1000');
  });

  it('not for quotes, declined gigs, past gigs or unsaved events', async () => {
    const cases: [EventData, Record<string, unknown>][] = [
      [{ ...gig, status: 'QUOTE' }, { isAdmin: true }],
      [gig, { userResponse: 'declined', isAdmin: true }],
      [{ ...gig, date: '2001-01-01' }, { userResponse: 'accepted' }],
      [{ ...gig, eventId: 'draft-1' }, { userResponse: 'accepted' }],
    ];
    for (const [event, extra] of cases) {
      show(event, extra);
      await screen.findAllByText('Wedding Rossi');
      expect(screen.queryByTestId('add-to-calendar')).toBeNull();
      cleanup();
    }
  });
});
