import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor, act } from '@testing-library/react';

// Codex 11-22, C1: an admin opens Edit on a gig that has a setlist while the
// connection is bad. The setlist does not load and the section showed empty.
// Songs added then and saved replaced the whole stored setlist: unchecked
// (`_setlistExpected: null`) when the load failed, and with a matching
// baseline when the load was only slow (25 songs became 3).
// Now the setlist is edited only once it has loaded: while it loads the
// section says so, and a failed load shows why in place of the editor. A
// save with songs and no loaded setlist is still refused.
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
  // Over the Save button (and in the section, when it is open).
  expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain(REFUSED);
};
const settle = async () => {
  await waitFor(() => expect(getSetlist).toHaveBeenCalledWith('sl-25'));
  await act(async () => {});
};

const pickSongs = () => screen.getByRole('button', { name: 'Pick songs' }) as HTMLButtonElement;
const sectionAlert = () => screen.queryAllByRole('alert').map((a) => a.textContent);
/** The section's own "Loading setlist…" line (other status lines of the form don't count). */
const loadingShown = () => screen.queryAllByRole('status').some((el) => el.textContent === 'Loading setlist…');

afterEach(() => {
  cleanup();
  vi.mocked(getSetlist).mockReset();
  vi.mocked(getSetlist).mockImplementation(async () => ({ data: null, error: null }));
});

describe('editing a gig whose setlist is slow to load', () => {
  it('nothing can be added until it loads; then the saved songs are shown and a save sends them plus the additions', async () => {
    // 25 songs stored; the answer takes its time (a venue with a bad signal).
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `row-${i + 1}`,
      song_id: `song-${i + 1}`,
      position: i,
      set_number: 1,
      song: { id: `song-${i + 1}`, title: `Standard ${i + 1}`, artist: 'Hudson Five' },
    }));
    let land: (v: { data: any; error: null }) => void = () => {};
    vi.mocked(getSetlist).mockImplementationOnce(() => new Promise((r) => (land = r)));
    const onCreate = vi.fn(async () => true);
    render(<CreateEventModal onClose={vi.fn()} onCreate={onCreate} editingEvent={gig} currentUserId="me" />);
    await settle();
    openSetlist();

    // Still loading: the section says so, and no song can be added on top of
    // a setlist nobody has seen yet.
    expect(loadingShown()).toBe(true);
    expect(pickSongs().disabled).toBe(true);
    fireEvent.click(pickSongs());
    expect(screen.queryByText('picker: add three songs')).toBeNull();

    await act(async () => {
      land({ data: { id: 'sl-25', name: 'Rooftop Session setlist', songs: rows }, error: null });
    });
    expect(loadingShown()).toBe(false);
    expect(screen.getByText('1 set · 25 songs')).toBeTruthy();
    expect(pickSongs().disabled).toBe(false);

    addThreeSongs();
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const sent = (onCreate.mock.calls[0] as unknown[])[0] as any;
    expect(songIds(sent)).toEqual([...rows.map((r) => r.song_id), 'S1', 'S2', 'S3']);
    expect(sent._setlistExpected).toEqual({ id: 'sl-25', songs: rows.map((r) => ({ id: r.id, song_id: r.song_id, set_number: 1 })) });
    expect(sent._setlistCleared).toBe(false);
  });

  it('saving while it still loads leaves the setlist alone', async () => {
    vi.mocked(getSetlist).mockImplementationOnce(() => new Promise(() => {}));
    const onCreate = vi.fn(async () => true);
    render(<CreateEventModal onClose={vi.fn()} onCreate={onCreate} editingEvent={gig} currentUserId="me" />);
    await settle();
    openSetlist();
    expect(loadingShown()).toBe(true);
    expect(pickSongs().disabled).toBe(true);
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const sent = (onCreate.mock.calls[0] as unknown[])[0] as any;
    expect(songIds(sent)).toEqual([]);
    expect(sent._setlistCleared).toBe(false);
  });
});

describe('editing a gig whose setlist did not load (Codex C1)', () => {
  const failures: [string, () => void][] = [
    ['the load fails', () => vi.mocked(getSetlist).mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') })],
    ['the load throws', () => vi.mocked(getSetlist).mockRejectedValueOnce(new Error('Failed to fetch'))],
  ];
  for (const [how, arrange] of failures) {
    it(`${how}: the section says why in place of the editor, and the gig saves without touching the setlist`, async () => {
      arrange();
      const onCreate = vi.fn(async () => true);
      render(<CreateEventModal onClose={vi.fn()} onCreate={onCreate} editingEvent={gig} currentUserId="me" />);
      await settle();
      openSetlist();
      expect(sectionAlert()).toEqual([REFUSED]);
      // No way to add songs to a setlist that is not here.
      expect(screen.queryByRole('button', { name: 'Pick songs' })).toBeNull();
      expect(loadingShown()).toBe(false);

      // The rest of the gig still saves. No songs and not "emptied": the app
      // leaves the gig's setlist as it is (AuthenticatedApp persistSetlist /
      // offlineExtras, eventExtras saveSetlist).
      fireEvent.click(screen.getByText('Save changes'));
      await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
      const sent = (onCreate.mock.calls[0] as unknown[])[0] as any;
      expect(songIds(sent)).toEqual([]);
      expect(sent._setlistCleared).toBe(false);
    });
  }

  // The save's own check, whatever the screen allowed: songs in the form and
  // no loaded setlist are never sent. Reached here by handing the open form
  // another gig whose setlist does not load.
  it('songs in the form with no loaded setlist: the save is refused and says why', async () => {
    vi.mocked(getSetlist).mockResolvedValueOnce({ data: stored as any, error: null });
    const onCreate = vi.fn(async () => true);
    const view = render(<CreateEventModal onClose={vi.fn()} onCreate={onCreate} editingEvent={gig} currentUserId="me" />);
    await settle();
    vi.mocked(getSetlist).mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') });
    view.rerender(
      <CreateEventModal onClose={vi.fn()} onCreate={onCreate} editingEvent={{ ...gig, eventId: 'evt-8', setlistId: 'sl-other' }} currentUserId="me" />,
    );
    await waitFor(() => expect(getSetlist).toHaveBeenCalledWith('sl-other'));
    await act(async () => {});
    await saveIsRefused(onCreate);
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

  it('a gig with no setlist is editable at once', async () => {
    const onCreate = vi.fn(async () => true);
    render(<CreateEventModal onClose={vi.fn()} onCreate={onCreate} editingEvent={{ ...gig, setlistId: undefined }} currentUserId="me" />);
    await act(async () => {});
    expect(getSetlist).not.toHaveBeenCalled();
    openSetlist();
    expect(loadingShown()).toBe(false);
    expect(pickSongs().disabled).toBe(false);
    addThreeSongs();
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const sent = (onCreate.mock.calls[0] as unknown[])[0] as any;
    expect(songIds(sent)).toEqual(['S1', 'S2', 'S3']);
    expect(sent._setlistExpected).toEqual({ id: null, songs: [] });
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
