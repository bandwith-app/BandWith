import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor, act } from '@testing-library/react';

// Codex 11-22, C1: an admin opens Edit on a gig that has a setlist while the
// connection is bad. The setlist does not load and the section shows empty.
// Songs added then and saved replaced the whole stored setlist, unchecked
// (`_setlistExpected: null`). Now that save is refused and says why.
// Made-up data (New York).
vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: { id: 'band-1', name: 'Hudson Five' }, bands: [], isAdmin: true }),
}));
vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/supabase', () => {
  const result = Promise.resolve({ data: null, error: null });
  const chain: any = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? result.then.bind(result) : chain),
    apply: () => chain,
  });
  return { supabase: chain };
});
vi.mock('@/lib/services/songs', async (orig) => ({
  setlistOrder: (await orig<typeof import('@/lib/services/songs')>()).setlistOrder,
  getSongs: vi.fn(async () => ({ data: [], error: null })),
  getSetlists: vi.fn(async () => ({ data: [], error: null })),
  getSetlist: vi.fn(async () => ({ data: null, error: null })),
}));
vi.mock('@/lib/services/eventTasks', () => ({ listEventTasks: vi.fn(async () => ({ data: [], error: null })) }));
vi.mock('@/lib/services/pricing', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/pricing')>()),
  getBandPricing: vi.fn(() => new Promise(() => {})),
}));
vi.mock('@/lib/wizardDrafts', async (orig) => ({
  ...(await orig<typeof import('@/lib/wizardDrafts')>()),
  saveEventDraft: vi.fn(),
  deleteEventDraft: vi.fn(),
}));

// The song picker, cut down to what the admin does in it.
const picked = [
  { id: 'S1', title: 'Blue Bossa', artist: 'Kenny Dorham' },
  { id: 'S2', title: 'Take the A Train', artist: 'Duke Ellington' },
  { id: 'S3', title: 'Autumn in New York', artist: 'Vernon Duke' },
];
vi.mock('@/app/components/ui/SongPicker', () => ({
  SongPicker: (p: any) =>
    p.isOpen ? (
      <div>
        <button type="button" onClick={() => p.onSelectMultiple(picked)}>
          picker: add three songs
        </button>
        <button
          type="button"
          onClick={() => {
            p.onRemoveSelected(picked.map((s) => s.id));
            p.onClose();
          }}
        >
          picker: untick them
        </button>
      </div>
    ) : null,
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { CreateEventModal } from '../CreateEventModal';
import { getSetlist } from '@/lib/services/songs';

const REFUSED = 'The setlist could not be loaded. Close and reopen the gig.';

const gig = {
  id: 7,
  eventId: 'evt-7',
  title: 'Rooftop Session',
  status: 'CONFIRMED',
  eventType: 'club',
  date: '2099-11-13',
  time: '21:00',
  location: 'Pier 17',
  price: '1200',
  venueAddress: '89 South St, New York',
  venueCity: 'New York',
  indoorOutdoor: 'outdoor',
  setlistId: 'sl-25',
};

const stored = {
  id: 'sl-25',
  name: 'Rooftop Session setlist',
  songs: [
    { id: 'r1', song_id: 'A', position: 0, set_number: 1, song: { id: 'A', title: 'Autumn Leaves', artist: 'Joseph Kosma' } },
    { id: 'r2', song_id: 'B', position: 1, set_number: 1, song: { id: 'B', title: 'Harlem Nocturne', artist: 'Earle Hagen' } },
  ],
};

const openSetlist = () => fireEvent.click(screen.getByText('Setlist, tasks & notes'));
const addThreeSongs = () => {
  fireEvent.click(screen.getByText('Pick songs'));
  fireEvent.click(screen.getByText('picker: add three songs'));
};
const songIds = (sent: any): string[] => (sent.setlist || []).flatMap((s: any) => (s.songs || []).map((sg: any) => sg.songId));
/** Save changes: nothing is sent (no save call carries a setlist), and the form says why. */
const saveIsRefused = async (onCreate: ReturnType<typeof vi.fn>) => {
  fireEvent.click(screen.getByText('Save changes'));
  await act(async () => {});
  expect(onCreate.mock.calls.map((c) => ({ songs: songIds(c[0]), expected: (c[0] as any)._setlistExpected }))).toEqual([]);
  expect(screen.getByRole('alert').textContent).toBe(REFUSED);
};
const settle = async () => {
  await waitFor(() => expect(getSetlist).toHaveBeenCalledWith('sl-25'));
  await act(async () => {});
};

afterEach(() => {
  cleanup();
  vi.mocked(getSetlist).mockReset();
  vi.mocked(getSetlist).mockImplementation(async () => ({ data: null, error: null }));
});

describe('editing a gig whose setlist did not load (Codex C1)', () => {
  it('the load fails, the admin adds songs: the save is refused and says why', async () => {
    vi.mocked(getSetlist).mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    const onCreate = vi.fn(async () => true);
    render(<CreateEventModal onClose={vi.fn()} onCreate={onCreate} editingEvent={gig} currentUserId="me" />);
    await settle();
    openSetlist();
    addThreeSongs();
    await saveIsRefused(onCreate);
  });

  it('a load that throws is the same', async () => {
    vi.mocked(getSetlist).mockRejectedValueOnce(new Error('Failed to fetch'));
    const onCreate = vi.fn(async () => true);
    render(<CreateEventModal onClose={vi.fn()} onCreate={onCreate} editingEvent={gig} currentUserId="me" />);
    await settle();
    openSetlist();
    addThreeSongs();
    await saveIsRefused(onCreate);
  });

  it('the load has not come back yet: songs are not saved over a setlist nobody saw', async () => {
    vi.mocked(getSetlist).mockImplementationOnce(() => new Promise(() => {}));
    const onCreate = vi.fn(async () => true);
    render(<CreateEventModal onClose={vi.fn()} onCreate={onCreate} editingEvent={gig} currentUserId="me" />);
    await settle();
    openSetlist();
    addThreeSongs();
    await saveIsRefused(onCreate);
  });

  it('refused, then the added songs are taken off: the rest saves and the stored setlist is left alone', async () => {
    vi.mocked(getSetlist).mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    const onCreate = vi.fn(async () => true);
    render(<CreateEventModal onClose={vi.fn()} onCreate={onCreate} editingEvent={gig} currentUserId="me" />);
    await settle();
    openSetlist();
    addThreeSongs();
    await saveIsRefused(onCreate);

    fireEvent.click(screen.getByText('Pick songs'));
    fireEvent.click(screen.getByText('picker: untick them'));
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
    const sent = (onCreate.mock.calls[0] as unknown[])[0] as any;
    // No songs and not "emptied": the app leaves the gig's setlist as it is
    // (AuthenticatedApp persistSetlist / offlineExtras, eventExtras saveSetlist).
    expect(songIds(sent)).toEqual([]);
    expect(sent._setlistCleared).toBe(false);
  });

  it('the load fails and no song is added: the gig saves without touching the setlist', async () => {
    vi.mocked(getSetlist).mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    const onCreate = vi.fn(async () => true);
    render(<CreateEventModal onClose={vi.fn()} onCreate={onCreate} editingEvent={gig} currentUserId="me" />);
    await settle();
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
    const sent = (onCreate.mock.calls[0] as unknown[])[0] as any;
    expect(songIds(sent)).toEqual([]);
    expect(sent._setlistCleared).toBe(false);
  });

  it('the load succeeds: added songs save with the setlist as it loaded', async () => {
    vi.mocked(getSetlist).mockResolvedValueOnce({ data: stored as any, error: null });
    const onCreate = vi.fn(async () => true);
    render(<CreateEventModal onClose={vi.fn()} onCreate={onCreate} editingEvent={gig} currentUserId="me" />);
    await settle();
    openSetlist();
    addThreeSongs();
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
    const sent = (onCreate.mock.calls[0] as unknown[])[0] as any;
    expect(songIds(sent)).toEqual(['A', 'B', 'S1', 'S2', 'S3']);
    expect(sent._setlistExpected).toEqual({
      id: 'sl-25',
      songs: [{ id: 'r1', song_id: 'A', set_number: 1 }, { id: 'r2', song_id: 'B', set_number: 1 }],
    });
    expect(sent._setlistCleared).toBe(false);
  });
});

// A draft is restored only for a new gig (`ds` is null while editing), so a
// draft's songs never stand in for a gig's saved setlist. Kept as a check:
// if drafts ever restore into Edit, the baseline rule above still holds.
describe('a draft given together with a gig being edited', () => {
  const draft = {
    id: 'draft-1',
    userId: 'me',
    bandId: 'band-1',
    title: 'Club night',
    savedAt: '2099-01-01T00:00:00.000Z',
    state: {
      step: 2,
      eventType: 'club',
      details: { title: 'Club night', date: '2099-12-01', startTime: '21:00', endTime: '23:30', venue: 'Blue Note' },
      selectedMembers: [],
      memberFees: {},
      setlist: [{ uid: 'set-d', title: 'Set 1', songs: [{ uid: 'song-d', title: 'Draft Song', artist: 'Nobody', songId: 'D1' }] }],
    },
  };

  it('the saved setlist is still loaded and sent as the baseline; the draft songs are not', async () => {
    vi.mocked(getSetlist).mockResolvedValueOnce({ data: stored as any, error: null });
    const onCreate = vi.fn(async () => true);
    render(<CreateEventModal onClose={vi.fn()} onCreate={onCreate} editingEvent={gig} draft={draft as any} currentUserId="me" />);
    await settle();
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const sent = (onCreate.mock.calls[0] as unknown[])[0] as any;
    expect(songIds(sent)).toEqual(['A', 'B']);
    expect(sent._setlistExpected).toEqual({
      id: 'sl-25',
      songs: [{ id: 'r1', song_id: 'A', set_number: 1 }, { id: 'r2', song_id: 'B', set_number: 1 }],
    });
  });

  it('the load fails: the draft songs are not saved over the setlist', async () => {
    vi.mocked(getSetlist).mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    const onCreate = vi.fn(async () => true);
    render(<CreateEventModal onClose={vi.fn()} onCreate={onCreate} editingEvent={gig} draft={draft as any} currentUserId="me" />);
    await settle();
    fireEvent.click(screen.getByText('Save changes'));
    await act(async () => {});
    // Either refused, or saved with no songs: never the draft's songs with no baseline.
    for (const call of onCreate.mock.calls) {
      const sent = (call as unknown[])[0] as any;
      expect(songIds(sent)).toEqual([]);
      expect(sent._setlistCleared).toBe(false);
    }
  });
});
