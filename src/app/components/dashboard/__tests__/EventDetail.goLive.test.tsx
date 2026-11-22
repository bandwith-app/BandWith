import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, cleanup, screen, waitFor } from '@testing-library/react';

// "Go live" on Home while the same gig is already open in the side pane
// (iPad, Duo book): the detail does not remount, so Stage mode has to start
// when startInStage turns on, not only on the first render.
const rows = vi.hoisted(() => ({
  'sl-a': [{ song: { title: 'Empire State of Mind', artist: 'Jay-Z', duration_seconds: 276, key: 'F#m' } }],
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
  return { supabase: new Proxy({}, { get: () => () => builder() }), isDemoMode: false };
});
vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/BandContext', () => ({ useBand: () => ({ selectedBand: null, bands: [] }), useOptionalBand: () => null }));
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


const gig = (eventId: string, setlistId: string): EventData => ({
  id: 1,
  eventId,
  eventType: 'gig',
  band_id: 'band-1',
  title: 'Rooftop Session',
  status: 'CONFIRMED',
  date: '2099-12-12',
  time: '19:30',
  location: 'The Loft, Brooklyn',
  price: '2400',
  members: [],
  color: '#000',
  setlistId,
});

afterEach(cleanup);

const stage = () => screen.queryByRole('dialog', { name: 'Stage mode: Rooftop Session' });

describe('EventDetail Go live', () => {
  it('opens Stage mode when Go live comes for the gig already on screen', async () => {
    const props = { onClose: vi.fn(), isAdmin: false, currentUserId: 'u-1' };
    const { rerender } = render(<EventDetail {...props} event={gig('evt-a', 'sl-a')} />);
    await waitFor(() => expect(screen.queryAllByText('Empire State of Mind').length).toBeGreaterThan(0));
    expect(stage()).toBeNull();
    rerender(<EventDetail {...props} event={gig('evt-a', 'sl-a')} startInStage />);
    await waitFor(() => expect(stage()).not.toBeNull());
  });

  it('still opens Stage mode on the first render', async () => {
    render(<EventDetail onClose={vi.fn()} isAdmin={false} currentUserId="u-1" event={gig('evt-a', 'sl-a')} startInStage />);
    await waitFor(() => expect(stage()).not.toBeNull());
  });
});
