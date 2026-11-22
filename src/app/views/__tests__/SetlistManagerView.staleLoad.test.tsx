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
const pending = new Map<string, (v: Load) => void>();
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
  getSetlist: vi.fn((id: string) => new Promise<Load>((resolve) => pending.set(id, resolve))),
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

    await act(async () => pending.get('sl-b')!({ data: setlist('sl-b', 'Brooklyn Wedding', 'song-b'), error: null }));
    await act(async () => pending.get('sl-a')!({ data: setlist('sl-a', 'Rooftop Session', 'song-a'), error: null }));

    const name = (await screen.findByDisplayValue(/Brooklyn Wedding|Rooftop Session/)) as HTMLInputElement;
    expect(name.value).toBe('Brooklyn Wedding');
    expect(screen.queryByRole('button', { name: /remove empire state of mind/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /save setlist/i }));
    await waitFor(() => expect(svc.replaceSetlistSongs).toHaveBeenCalled());
    expect(svc.replaceSetlistSongs).toHaveBeenCalledWith('sl-b', [{ song_id: 'song-b', set_number: 1 }], { name: 'Brooklyn Wedding' });
  });
});
