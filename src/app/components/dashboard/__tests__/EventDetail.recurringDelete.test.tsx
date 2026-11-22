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

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { EventDetail } from '../EventDetail';
import type { EventData } from '../EventCard';
import appSource from '@/app/AuthenticatedApp.tsx?raw';

/** Audit 05 #4: deleting one date of a weekly rehearsal must not delete the series. */
const rehearsal: EventData = {
  id: 1,
  eventId: '11111111-2222-4333-8444-555555555555',
  band_id: 'band-1',
  band_name: 'Velvet Static',
  title: 'Weekly rehearsal',
  status: 'REHEARSAL',
  eventType: 'rehearsal',
  date: '2099-12-19',
  time: '20:00',
  location: 'Studio 4',
  members: [],
  color: '#000',
  is_recurring: true,
  recurrence_rule: { frequency: 'weekly', interval: 1 },
} as EventData;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const show = (event: EventData, onDelete = vi.fn()) => {
  render(<EventDetail event={event} onClose={vi.fn()} onEventUpdated={vi.fn()} onToast={vi.fn()} currentUserId="u-1" isAdmin onDelete={onDelete} />);
  return onDelete;
};

describe('Event detail: deleting a repeating rehearsal (audit 05 #4)', () => {
  it('offers this date or the whole series, and this date is the first choice', async () => {
    const onDelete = show(rehearsal);
    fireEvent.click(await screen.findByRole('button', { name: 'DELETE THIS REHEARSAL' }));
    expect(screen.queryByRole('button', { name: 'Confirm delete' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete this date' }));
    expect(onDelete).toHaveBeenCalledWith('date');
  });

  it('the whole series is still there as its own choice', async () => {
    const onDelete = show(rehearsal);
    fireEvent.click(await screen.findByRole('button', { name: 'DELETE THIS REHEARSAL' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete the whole series' }));
    expect(onDelete).toHaveBeenCalledWith('series');
  });

  it('a one-off rehearsal keeps the single confirm', async () => {
    const onDelete = show({ ...rehearsal, is_recurring: false, recurrence_rule: undefined } as EventData);
    fireEvent.click(await screen.findByRole('button', { name: 'DELETE THIS REHEARSAL' }));
    expect(screen.queryByRole('button', { name: 'Delete this date' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('the app takes only that date out of the series, before any delete of the event row', () => {
    const start = appSource.indexOf('const handleEventDelete = async');
    const body = appSource.slice(start, appSource.indexOf("from('events')\n          .delete()", start));
    expect(body).toMatch(/scope === 'date'[\s\S]*skipRehearsalDate\(selectedEvent\.eventId, selectedEvent\.date\)[\s\S]*return;/);
    expect(appSource).toMatch(/onDelete=\{\(scope\) => inItemBand\(selectedEvent\.band_id, "delete this event", \(\) => handleEventDelete\(scope\)\)\}/);
  });
});
