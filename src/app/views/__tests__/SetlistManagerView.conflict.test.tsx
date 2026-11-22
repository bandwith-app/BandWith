import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, act, within } from '@testing-library/react';

// Round 3 (Claude M5): two admins on the same setlist. Admin B added a song
// while A was editing: A's save must not silently drop it. A sees it and
// chooses: load the latest version, or save theirs over it.
// Made-up band and setlists (New York).

vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: { id: 'band-1', name: 'Hudson Line' }, isAdmin: true }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySetlistSaved: vi.fn(), notifySongUpdated: vi.fn() }));

const songs = [
  { id: 'song-a', band_id: 'band-1', title: 'Empire State of Mind', artist: 'Jay-Z', duration_seconds: 200, status: 'ready', genre: null },
  { id: 'song-b', band_id: 'band-1', title: 'Brooklyn Bridge', artist: 'Trad.', duration_seconds: 180, status: 'ready', genre: null },
];
const current = { name: 'Rooftop Session', songs: [{ song_id: 'song-a', set_number: 1 }, { song_id: 'song-b', set_number: 1 }] };
const svc = vi.hoisted(() => ({
  replaceSetlistSongs: vi.fn(),
  getSetlist: vi.fn(async (id: string) => ({
    data: { id, band_id: 'band-1', name: 'Rooftop Session', song_count: 1, songs: [{ id: 'row-1', setlist_id: id, song_id: 'song-a', position: 1, set_number: 1 }] },
    error: null,
  })),
}));
vi.mock('@/lib/services/songs', () => ({
  getSongs: vi.fn(async () => ({ data: songs, error: null })),
  getSetlists: vi.fn(async () => ({ data: [{ id: 'sl-a', band_id: 'band-1', name: 'Rooftop Session', song_count: 1 }], error: null })),
  getSetlist: svc.getSetlist,
  createSong: vi.fn(), deleteSong: vi.fn(), updateSong: vi.fn(),
  createSetlist: vi.fn(), updateSetlist: vi.fn(), deleteSetlist: vi.fn(),
  replaceSetlistSongs: svc.replaceSetlistSongs, seedRepertoireSongs: vi.fn(), bulkCreateSongs: vi.fn(),
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { SetlistManagerView } from '../SetlistManagerView';
import { handleBackFromStack } from '@/lib/backStack';

afterEach(() => {
  cleanup();
  svc.replaceSetlistSongs.mockReset();
  svc.getSetlist.mockClear();
});

const openAndSave = async () => {
  render(<SetlistManagerView onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /^setlists/i }));
  fireEvent.click(await screen.findByText('Rooftop Session'));
  const name = (await screen.findByDisplayValue('Rooftop Session')) as HTMLInputElement;
  fireEvent.change(name, { target: { value: 'Rooftop Session · Saturday' } });
  fireEvent.click(screen.getByRole('button', { name: /save setlist/i }));
};

describe('SetlistManagerView: saved only over the setlist as loaded', () => {
  it('sends what it loaded; changed meanwhile → says so and keeps the edits', async () => {
    svc.replaceSetlistSongs.mockResolvedValueOnce({ error: null, conflict: current });
    await openAndSave();
    await waitFor(() => expect(svc.replaceSetlistSongs).toHaveBeenCalledTimes(1));
    expect(svc.replaceSetlistSongs.mock.calls[0][2]).toEqual({
      name: 'Rooftop Session · Saturday',
      // Row by row, with who sings it (Codex r6 M1, 188 checks them).
      expected: { name: 'Rooftop Session', songs: [{ id: 'row-1', song_id: 'song-a', set_number: 1, vocal_parts: null }] },
    });
    expect(await screen.findByText(/someone else changed this setlist/i)).toBeTruthy();
    expect(screen.getByDisplayValue('Rooftop Session · Saturday')).toBeTruthy();
  });

  it('"Save mine instead" saves over what is stored now', async () => {
    svc.replaceSetlistSongs.mockResolvedValueOnce({ error: null, conflict: current }).mockResolvedValueOnce({ error: null, previous: [] });
    await openAndSave();
    fireEvent.click(await screen.findByRole('button', { name: /save mine instead/i }));
    await waitFor(() => expect(svc.replaceSetlistSongs).toHaveBeenCalledTimes(2));
    expect(svc.replaceSetlistSongs.mock.calls[1][2]).toEqual({ name: 'Rooftop Session · Saturday', expected: current });
  });

  it('"Load the latest version" reloads the setlist', async () => {
    svc.replaceSetlistSongs.mockResolvedValueOnce({ error: null, conflict: current });
    await openAndSave();
    fireEvent.click(await screen.findByRole('button', { name: /load the latest version/i }));
    await waitFor(() => expect(svc.getSetlist).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/someone else changed this setlist/i)).toBeNull();
  });

  // Round 4 (Codex MINOR): Save from the "Save the setlist changes?" sheet
  // hits a conflict: the sheet closes and the choice shows; never a retry
  // with the old version.
  it('Save in the leave sheet, changed meanwhile: the sheet closes and the choice shows', async () => {
    svc.replaceSetlistSongs.mockResolvedValue({ error: null, conflict: current });
    render(<SetlistManagerView onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /^setlists/i }));
    fireEvent.click(await screen.findByText('Rooftop Session'));
    fireEvent.change(await screen.findByDisplayValue('Rooftop Session'), { target: { value: 'Rooftop Session · Saturday' } });
    act(() => {
      handleBackFromStack();
    });
    const sheet = (await screen.findByText('Save the setlist changes?')).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(sheet).getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(svc.replaceSetlistSongs).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Save the setlist changes?')).toBeNull());
    expect(await screen.findByRole('button', { name: /load the latest version/i })).toBeTruthy();
    expect(screen.getByDisplayValue('Rooftop Session · Saturday')).toBeTruthy();
    expect(svc.replaceSetlistSongs).toHaveBeenCalledTimes(1);
  });

  // Round 5 (Claude MINOR 2): "Load the latest version" fetches first; the
  // draft is replaced only when the latest version arrived.
  it('"Load the latest version" that fails keeps the draft and says so', async () => {
    svc.replaceSetlistSongs.mockResolvedValueOnce({ error: null, conflict: current });
    await openAndSave();
    svc.getSetlist.mockResolvedValueOnce({ data: null, error: new Error('Failed to fetch') } as any);
    fireEvent.click(await screen.findByRole('button', { name: /load the latest version/i }));
    await waitFor(() => expect(svc.getSetlist).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.getByDisplayValue('Rooftop Session · Saturday')).toBeTruthy();
    expect(screen.getByRole('button', { name: /load the latest version/i })).toBeTruthy();
    expect(screen.getByText(/could not load this setlist/i)).toBeTruthy();
  });

  // Round 5 (Claude MINOR 9): a song played twice (a reprise) is kept.
  it('a reprise loads and saves as two entries', async () => {
    svc.getSetlist.mockResolvedValueOnce({
      data: { id: 'sl-a', band_id: 'band-1', name: 'Rooftop Session', song_count: 3, songs: [
        { id: 'row-1', setlist_id: 'sl-a', song_id: 'song-a', position: 1, set_number: 1 },
        { id: 'row-2', setlist_id: 'sl-a', song_id: 'song-b', position: 2, set_number: 1 },
        { id: 'row-3', setlist_id: 'sl-a', song_id: 'song-a', position: 3, set_number: 2 },
      ] },
      error: null,
    } as any);
    svc.replaceSetlistSongs.mockResolvedValueOnce({ error: null, previous: [] });
    await openAndSave();
    await waitFor(() => expect(svc.replaceSetlistSongs).toHaveBeenCalledTimes(1));
    expect(svc.replaceSetlistSongs.mock.calls[0][1]).toEqual([
      expect.objectContaining({ song_id: 'song-a', set_number: 1 }),
      expect.objectContaining({ song_id: 'song-b', set_number: 1 }),
      expect.objectContaining({ song_id: 'song-a', set_number: 2 }),
    ]);
  });

  // Round 6 (Codex B5): each performance is its own row. The same song twice,
  // the first one removed: the reprise keeps its row (its notes and singers, 188).
  it('a reprise: removing the first keeps the reprise\'s own row', async () => {
    svc.getSetlist.mockResolvedValueOnce({
      data: { id: 'sl-a', band_id: 'band-1', name: 'Rooftop Session', song_count: 3, songs: [
        { id: 'row-1', setlist_id: 'sl-a', song_id: 'song-a', position: 1, set_number: 1, notes: 'Open soft' },
        { id: 'row-2', setlist_id: 'sl-a', song_id: 'song-b', position: 2, set_number: 1 },
        { id: 'row-3', setlist_id: 'sl-a', song_id: 'song-a', position: 3, set_number: 1, notes: 'Reprise: everyone sings' },
      ] },
      error: null,
    } as any);
    svc.replaceSetlistSongs.mockResolvedValueOnce({ error: null, previous: [] });
    render(<SetlistManagerView onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /^setlists/i }));
    fireEvent.click(await screen.findByText('Rooftop Session'));
    await screen.findByDisplayValue('Rooftop Session');
    const removes = await screen.findAllByRole('button', { name: 'Remove Empire State of Mind' });
    expect(removes).toHaveLength(2);
    fireEvent.click(removes[0]);
    fireEvent.click(screen.getByRole('button', { name: /save setlist/i }));
    await waitFor(() => expect(svc.replaceSetlistSongs).toHaveBeenCalledTimes(1));
    expect(svc.replaceSetlistSongs.mock.calls[0][1]).toEqual([
      { id: 'row-2', song_id: 'song-b', set_number: 1 },
      { id: 'row-3', song_id: 'song-a', set_number: 1 },
    ]);
  });
});

