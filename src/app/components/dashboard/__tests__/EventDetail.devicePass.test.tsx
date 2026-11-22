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

const sheet = async (title: string) => {
  await screen.findByText(title);
  const found = screen.getAllByRole('dialog').find((d) => within(d).queryByText(title));
  if (!found) throw new Error(`No sheet "${title}"`);
  return found;
};

/** Opens the title sheet and types a new title (Save becomes available). */
const editTitle = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Edit title, date & times' }));
  const dialog = await sheet('Title, date & times');
  fireEvent.change(within(dialog).getByLabelText('Event title'), { target: { value: 'Wedding Rossi & Bianchi' } });
  return dialog;
};

const renderAdminGig = () =>
  render(<EventDetail event={gig} onClose={vi.fn()} onEventUpdated={vi.fn()} onToast={vi.fn()} isAdmin currentUserId="u-1" />);

describe('Overview edit sheets keep unsaved changes until the admin decides', () => {
  // The first test here renders the whole gig detail cold: under a full-suite
  // run it can pass 5 s (seen at 5.4 s), so it gets 10 s (a known flake).
  it('edit sheet asks before discarding changes (Cancel)', async () => {
    renderAdminGig();
    const dialog = await editTitle();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Save your changes?')).toBeTruthy();
    // Keep editing: the typed title is still there.
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByText('Save your changes?')).toBeNull());
    expect((within(dialog).getByLabelText('Event title') as HTMLInputElement).value).toBe('Wedding Rossi & Bianchi');
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  }, 10_000);

  it('edit sheet asks before discarding changes (Escape / system Back)', async () => {
    renderAdminGig();
    await editTitle();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByText('Save your changes?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByText('Title, date & times')).toBeNull());
    expect(mocks.updateEvent).not.toHaveBeenCalled();
  });

  it('edit sheet asks before discarding changes (Save changes from the prompt saves)', async () => {
    mocks.updateEvent.mockResolvedValue({ data: {}, error: null });
    renderAdminGig();
    const dialog = await editTitle();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('Save your changes?')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    });
    expect(mocks.updateEvent).toHaveBeenCalledTimes(1);
  });

  it('edit sheet without changes closes at once', async () => {
    renderAdminGig();
    fireEvent.click(screen.getByRole('button', { name: 'Edit title, date & times' }));
    const dialog = await sheet('Title, date & times');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Title, date & times')).toBeNull());
    expect(screen.queryByText('Save your changes?')).toBeNull();
  });

  it("opening another card's editor asks before discarding changes", async () => {
    renderAdminGig();
    await editTitle();
    // Another pencil (on the iPhone Duo it sits in the rail, above the sheet).
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit venue' })[0]);
    expect(await screen.findByText('Save your changes?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(await sheet('Venue & location')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Title, date & times')).toBeNull());
  });
});

describe('Member privacy and RSVP on a gig', () => {
  it("a member never sees the gig's client, even from cached admin data", async () => {
    const cached: EventData = { ...gig, clientName: 'Aurora Events', clientPhone: '+39 02 555', clientEmail: 'hi@aurora.test', dressCode: 'All black' };
    render(<EventDetail event={cached} onClose={vi.fn()} isAdmin={false} userResponse="accepted" currentUserId="u-2" />);
    await waitFor(() => expect(screen.getAllByText('Bo Bass').length).toBeGreaterThan(0));
    expect(screen.queryByText('Aurora Events')).toBeNull();
    expect(screen.queryByText('+39 02 555')).toBeNull();
    expect(screen.queryByText('hi@aurora.test')).toBeNull();
    expect(screen.queryByText('CLIENT & NOTES')).toBeNull();
    // Logistics stay visible.
    expect(screen.getAllByText('All black').length).toBeGreaterThan(0);
  });

  it('the admin still sees the client', async () => {
    const withClient: EventData = { ...gig, clientName: 'Aurora Events' };
    render(<EventDetail event={withClient} onClose={vi.fn()} isAdmin currentUserId="u-1" />);
    await waitFor(() => expect(screen.getAllByText('Aurora Events').length).toBeGreaterThan(0));
  });

  it("a member whose gig answer was Maybe is asked to choose GOING or CAN'T", async () => {
    const onRespond = vi.fn().mockResolvedValue(undefined);
    render(
      <EventDetail event={gig} onClose={vi.fn()} isAdmin={false} userResponse="maybe" onRespond={onRespond} canRespond currentUserId="u-2" />,
    );
    expect(await screen.findByText("Your answer was Maybe. Choose GOING or CAN'T.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'GOING' }));
    });
    expect(onRespond).toHaveBeenCalledWith('confirmed');
  });

  it('a member who already answered GOING sees no Maybe prompt on a gig', async () => {
    render(<EventDetail event={gig} onClose={vi.fn()} isAdmin={false} userResponse="accepted" onRespond={vi.fn()} canRespond currentUserId="u-2" />);
    await waitFor(() => expect(screen.getAllByText('Bo Bass').length).toBeGreaterThan(0));
    expect(screen.queryByText("Your answer was Maybe. Choose GOING or CAN'T.")).toBeNull();
  });
});

describe('Rehearsal focus songs', () => {
  it('the focus songs sheet of a rehearsal is titled Focus songs, not Setlist', async () => {
    render(<EventDetail event={rehearsal} onClose={vi.fn()} isAdmin currentUserId="u-1" />);
    await waitFor(() => expect(screen.getAllByText('Bo Bass').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'EDIT: FOCUS SONGS' }));
    expect(await screen.findByText('Focus songs · 0')).toBeTruthy();
    expect(screen.queryByText('Setlist · 0')).toBeNull();
  });
});

describe('Venue sheet', () => {
  it("picking another venue does not keep the old venue's city", async () => {
    render(
      <EventDetail
        event={{ ...gig, venueAddress: 'Via Mozart 14, Milano', venueCity: 'Milano' }}
        onClose={vi.fn()}
        onEventUpdated={vi.fn()}
        onToast={vi.fn()}
        isAdmin
        currentUserId="u-1"
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit venue' })[0]);
    const dialog = await sheet('Venue & location');
    expect((within(dialog).getByLabelText('City') as HTMLInputElement).value).toBe('Milano');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pick Blue Note' }));
    expect((within(dialog).getByLabelText('City') as HTMLInputElement).value).toBe('');
  });

  it('a gig with no setting saved shows Indoor, as the calendar does, and saves nothing until tapped', async () => {
    renderAdminGig();
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit venue' })[0]);
    const dialog = await sheet('Venue & location');
    expect(within(dialog).getByRole('button', { name: 'Indoor' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(dialog).getByRole('button', { name: 'Outdoor' }).getAttribute('aria-pressed')).toBe('false');
    // Untouched: closing does not ask (nothing to save).
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Venue & location')).toBeNull());
    expect(screen.queryByText('Save your changes?')).toBeNull();
  });
});
