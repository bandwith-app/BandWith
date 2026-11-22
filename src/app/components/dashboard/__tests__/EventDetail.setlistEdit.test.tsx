import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react';

// Two songs on the gig's setlist; every other query resolves empty.
const rows = vi.hoisted(() => ({
  'sl-a': [
    { id: 'r1', song_id: 's1', set_number: 1, position: 1, song: { title: 'O sole mio', artist: 'Traditional', duration_seconds: 200 } },
    { id: 'r2', song_id: 's2', set_number: 1, position: 2, song: { title: 'Volare', artist: 'Modugno', duration_seconds: 180 } },
  ],
}));
const mocks = vi.hoisted(() => ({
  replaceSetlistSongs: vi.fn(),
  notifySetlistSaved: vi.fn(),
}));
vi.mock('@/lib/supabase', () => {
  const builder = () => {
    let setlistId: string | undefined;
    const b: any = new Proxy(function () {}, {
      get: (_t, prop) => {
        if (prop === 'eq') return (col: string, val: string) => ((col === 'setlist_id' && (setlistId = val)), b);
        if (prop === 'then') {
          const data = setlistId ? (rows as Record<string, unknown[]>)[setlistId] ?? [] : null;
          const p = Promise.resolve({ data, error: null });
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
vi.mock('@/lib/services/songs', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/songs')>()),
  replaceSetlistSongs: mocks.replaceSetlistSongs,
}));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: mocks.notifySetlistSaved }));
vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), pickUp: vi.fn(), dragTick: vi.fn(), drop: vi.fn() },
}));
vi.mock('@/lib/BandContext', () => ({ useBand: () => ({ selectedBand: null, bands: [] }) }));
vi.mock('@/app/components/ui/WeatherWidget', () => ({ WeatherWidget: () => null }));
vi.mock('@/app/components/event/useEventMembers', () => ({
  useEventMembers: () => ({ members: [], loading: false, error: null, paidSupported: false, markAllPaid: vi.fn(), markingPaid: false, markError: null }),
}));
vi.mock('@/lib/services/eventTasks', () => ({
  useEventTasks: () => ({ tasks: [], toggle: vi.fn(), error: null }),
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
  date: '2099-12-12',
  time: '19:30',
  location: 'Villa Clara',
  price: '2400',
  members: [],
  color: '#000',
  setlistId: 'sl-a',
};

beforeEach(() => {
  mocks.replaceSetlistSongs.mockResolvedValue({
    error: null,
    previous: [
      { song_id: 's1', set_number: 1, position: 1 },
      { song_id: 's2', set_number: 1, position: 2 },
    ],
  });
  mocks.notifySetlistSaved.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const order = () => screen.getAllByRole('button', { name: /^Reorder / }).map((b) => b.getAttribute('aria-label'));

describe('EventDetail setlist editing in the overview', () => {
  it('members see the list without reorder controls or Add songs', async () => {
    render(<EventDetail event={gig} onClose={vi.fn()} isAdmin={false} currentUserId="u-2" />);
    await waitFor(() => expect(screen.queryAllByText('O sole mio').length).toBeGreaterThan(0));
    expect(screen.queryAllByRole('button', { name: /^Reorder / })).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Add songs/i })).toBeNull();
  });

  it('admin reorders, sees Unsaved changes, and Save writes once and notifies once', async () => {
    const onClose = vi.fn();
    render(<EventDetail event={gig} onClose={onClose} isAdmin currentUserId="u-1" />);
    await waitFor(() => expect(order()).toEqual(['Reorder O sole mio', 'Reorder Volare']));
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder Volare' }), { key: 'ArrowUp' });
    expect(order()).toEqual(['Reorder Volare', 'Reorder O sole mio']);
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toBeTruthy();
    expect(mocks.replaceSetlistSongs).not.toHaveBeenCalled();

    // Leaving asks first and doesn't close.
    fireEvent.click(screen.getAllByRole('button', { name: /back/i })[0]);
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText('Save the setlist changes?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Keep editing/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    });
    expect(mocks.replaceSetlistSongs).toHaveBeenCalledTimes(1);
    // Only over the rows as loaded (188 checks row ids, Codex r6 B6).
    expect(mocks.replaceSetlistSongs).toHaveBeenCalledWith(
      'sl-a',
      [
        { song_id: 's2', set_number: 1 },
        { song_id: 's1', set_number: 1 },
      ],
      { expected: { songs: [{ id: 'r1', song_id: 's1', set_number: 1 }, { id: 'r2', song_id: 's2', set_number: 1 }] } },
    );
    expect(mocks.notifySetlistSaved).toHaveBeenCalledTimes(1);
    expect(mocks.notifySetlistSaved).toHaveBeenCalledWith({
      setlistId: 'sl-a',
      eventId: 'evt-a',
      change: { moved: 1, added: 0, removed: 0 },
    });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull());
  });

  it('Cancel puts the saved order back without writing', async () => {
    render(<EventDetail event={gig} onClose={vi.fn()} isAdmin currentUserId="u-1" />);
    await waitFor(() => expect(order()).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove song' })[0]);
    expect(order()).toEqual(['Reorder Volare']);
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(order()).toEqual(['Reorder O sole mio', 'Reorder Volare']);
    expect(mocks.replaceSetlistSongs).not.toHaveBeenCalled();
    expect(mocks.notifySetlistSaved).not.toHaveBeenCalled();
  });
});
