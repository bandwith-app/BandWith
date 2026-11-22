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
  price: '0',
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
    expect(body).toMatch(/scope === 'date'[\s\S]*deleteRehearsalDate\(selectedEvent\)[\s\S]*return;/);
    expect(appSource).toMatch(/onDelete=\{\(scope\) => inItemBand\(selectedEvent\.band_id, "delete this event", \(\) => handleEventDelete\(scope\)\)\}/);
  });
});

describe('Claude #297 r5: deleted dates (minors 2, 5, 6)', () => {
  const later = { ...rehearsal, recurrence_rule: { frequency: 'weekly', interval: 1, skip_dates: ['2099-12-19', '2099-12-26', '2000-01-01'] } } as EventData;
  const showWith = (event: EventData, extra: Record<string, unknown> = {}) =>
    render(<EventDetail event={event} onClose={vi.fn()} onEventUpdated={vi.fn()} onToast={vi.fn()} currentUserId="u-1" onDelete={vi.fn()} {...extra} />);

  it('minor 6: a deleted date opened from its push is shown as cancelled, with no RSVP', async () => {
    showWith(later, { isAdmin: false, canRespond: true, onRespond: vi.fn() });
    expect(await screen.findByTestId('ed-date-cancelled')).toBeTruthy();
    expect(screen.getByText('This date was cancelled')).toBeTruthy();
    expect(screen.getByText('CANCELLED')).toBeTruthy();
    expect(screen.queryByText('Are you coming?')).toBeNull();
    // A member has no Restore.
    expect(screen.queryByRole('button', { name: /Restore this date/ })).toBeNull();
  });

  it('minor 5: an admin restores the cancelled date, and "Delete this date" is not offered on it', async () => {
    const onRestoreDate = vi.fn();
    showWith(later, { isAdmin: true, onRestoreDate });
    fireEvent.click(await screen.findByRole('button', { name: /Restore this date/ }));
    expect(onRestoreDate).toHaveBeenCalledWith('2099-12-19');
    fireEvent.click(screen.getByRole('button', { name: 'DELETE THIS REHEARSAL' }));
    expect(screen.queryByRole('button', { name: 'Delete this date' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete the whole series' })).toBeTruthy();
  });

  it('minor 5: the series lists its other deleted dates still to come for admins, each with Restore', async () => {
    const onRestoreDate = vi.fn();
    showWith({ ...later, date: '2099-12-12' } as EventData, { isAdmin: true, onRestoreDate });
    const list = await screen.findByTestId('ed-deleted-dates');
    const rows = list.querySelectorAll('li');
    expect(rows).toHaveLength(2); // 2000-01-01 is past
    fireEvent.click(screen.getAllByRole('button', { name: /^Restore / })[1]);
    expect(onRestoreDate).toHaveBeenCalledWith('2099-12-26');
    expect(screen.queryByTestId('ed-date-cancelled')).toBeNull();
  });

  it('minor 5: members see no deleted-dates list', async () => {
    showWith({ ...later, date: '2099-12-12' } as EventData, { isAdmin: false, onRestoreDate: vi.fn() });
    await screen.findByText('Weekly rehearsal');
    expect(screen.queryByTestId('ed-deleted-dates')).toBeNull();
  });

  it('minor 5: "Delete this date" offers Undo, and the detail restores through the app', () => {
    const start = appSource.indexOf('const handleEventDelete = async');
    const body = appSource.slice(start, appSource.indexOf('if (!selectedEvent.band_id)', start));
    expect(body).toMatch(/action: \{ label: t\('Undo'\), onClick: \(\) => handleRestoreDate\(deletedDay, seriesId\) \}/);
    expect(appSource).toMatch(/onRestoreDate=\{\(day\) => inItemBand\(selectedEvent\.band_id, "restore this date", \(\) => handleRestoreDate\(day\)\)\}/);
    expect(appSource).toMatch(/const handleRestoreDate = async[\s\S]{0,200}restoreRehearsalDate\(id, date\)/);
  });

  it('minor 2: "Only this date" sends the wizard\'s edits with the move and no second full update', () => {
    expect(appSource).toMatch(/moveRehearsalDateOnly\([\s\S]{0,300}fields: eventData \}/);
    expect(appSource).toMatch(/movedHere\s*\? \(setlistId \? await withFastTimeout\(updateEvent\(data\._editingEventId, \{ setlist_id: setlistId \}\)/);
  });
});
