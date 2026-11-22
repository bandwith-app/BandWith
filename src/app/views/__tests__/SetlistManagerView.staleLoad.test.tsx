import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, act } from '@testing-library/react';

// Audit 09 #4: on iPad / Duo the setlists stay listed next to the editor.
// Tap setlist A, then B at once: when A's load finishes last, the editor
// must keep B (name, songs, save target), never show A's songs under B.
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
const setlist = (id: string, name: string, songId: string) => ({
  id, band_id: 'band-1', name, song_count: 1,
  songs: [{ id: `row-${id}`, setlist_id: id, song_id: songId, position: 1, set_number: 1 }],
});
type Load = { data: ReturnType<typeof setlist>; error: null };
// Every load still waiting for its answer, per setlist, oldest first.
const pending = new Map<string, ((v: Load) => void)[]>();
const answer = (id: string, n: number, v: Load) => pending.get(id)![n](v);
const svc = vi.hoisted(() => ({ replaceSetlistSongs: vi.fn(async () => ({ error: null, previous: [] })) }));
vi.mock('@/lib/services/songs', () => ({
  getSongs: vi.fn(async () => ({ data: songs, error: null })),
  getSetlists: vi.fn(async () => ({
    data: [
      { id: 'sl-a', band_id: 'band-1', name: 'Rooftop Session', song_count: 1 },
      { id: 'sl-b', band_id: 'band-1', name: 'Brooklyn Wedding', song_count: 1 },
    ],
    error: null,
  })),
  getSetlist: vi.fn((id: string) => new Promise<Load>((resolve) => pending.set(id, [...(pending.get(id) ?? []), resolve]))),
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

afterEach(() => {
  cleanup();
  pending.clear();
});

describe('SetlistManagerView: a slow load never lands on another setlist', () => {
  it('A answered after B: the editor shows B and Save writes B', async () => {
    render(<SetlistManagerView onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /^setlists/i }));
    fireEvent.click(await screen.findByText('Rooftop Session'));
    fireEvent.click(await screen.findByText('Brooklyn Wedding'));
    await waitFor(() => expect(pending.size).toBe(2));

    await act(async () => answer('sl-b', 0, { data: setlist('sl-b', 'Brooklyn Wedding', 'song-b'), error: null }));
    await act(async () => answer('sl-a', 0, { data: setlist('sl-a', 'Rooftop Session', 'song-a'), error: null }));

    const name = (await screen.findByDisplayValue(/Brooklyn Wedding|Rooftop Session/)) as HTMLInputElement;
    expect(name.value).toBe('Brooklyn Wedding');
    expect(screen.queryByRole('button', { name: /remove empire state of mind/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /save setlist/i }));
    await waitFor(() => expect(svc.replaceSetlistSongs).toHaveBeenCalled());
    expect(svc.replaceSetlistSongs).toHaveBeenCalledWith('sl-b', [{ id: 'row-sl-b', song_id: 'song-b', set_number: 1 }], expect.objectContaining({ name: 'Brooklyn Wedding' }));
  });

  // Round 2 (Codex B5): A, then B, then A again. The first A answer arrives
  // last, after the second one and after the user started editing.
  it('A, B, A again: the first A answer, arriving last, never replaces the edits', async () => {
    svc.replaceSetlistSongs.mockClear();
    render(<SetlistManagerView onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /^setlists/i }));
    fireEvent.click(await screen.findByText('Rooftop Session'));
    fireEvent.click(await screen.findByText('Brooklyn Wedding'));
    fireEvent.click((await screen.findAllByText('Rooftop Session'))[0]);
    await waitFor(() => expect(pending.get('sl-a')?.length).toBe(2));

    await act(async () => answer('sl-a', 1, { data: setlist('sl-a', 'Rooftop Session', 'song-a'), error: null }));
    const name = (await screen.findByDisplayValue('Rooftop Session')) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Rooftop Session · Saturday' } });
    await act(async () => answer('sl-b', 0, { data: setlist('sl-b', 'Brooklyn Wedding', 'song-b'), error: null }));
    // The old answer: the setlist before the user's edit.
    await act(async () => answer('sl-a', 0, { data: setlist('sl-a', 'Rooftop Session', 'song-b'), error: null }));

    expect((screen.getByDisplayValue(/Rooftop Session/) as HTMLInputElement).value).toBe('Rooftop Session · Saturday');
    fireEvent.click(screen.getByRole('button', { name: /save setlist/i }));
    await waitFor(() => expect(svc.replaceSetlistSongs).toHaveBeenCalled());
    expect(svc.replaceSetlistSongs).toHaveBeenCalledWith('sl-a', [{ id: 'row-sl-a', song_id: 'song-a', set_number: 1 }], {
      name: 'Rooftop Session · Saturday',
      // Saved only over what the second load showed.
      expected: { name: 'Rooftop Session', songs: [{ id: 'row-sl-a', song_id: 'song-a', set_number: 1, vocal_parts: null }] },
    });
  });
});
