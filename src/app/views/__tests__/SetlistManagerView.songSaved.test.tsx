import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: { id: 'band-1', name: 'Velvet Static' }, isAdmin: true }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

const song = { id: 'song-1', band_id: 'band-1', title: 'O sole mio', artist: 'Traditional', duration_seconds: 200, status: 'ready', genre: null, lyrics: 'old' };
const svc = vi.hoisted(() => ({ getSongs: vi.fn(), getSetlists: vi.fn() }));
vi.mock('@/lib/services/songs', () => ({
  getSongs: svc.getSongs,
  getSetlists: svc.getSetlists,
  getSetlist: vi.fn(),
  createSong: vi.fn(), deleteSong: vi.fn(), updateSong: vi.fn(),
  createSetlist: vi.fn(), updateSetlist: vi.fn(), deleteSetlist: vi.fn(),
  replaceSetlistSongs: vi.fn(), seedRepertoireSongs: vi.fn(), bulkCreateSongs: vi.fn(),
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { SetlistManagerView } from '../SetlistManagerView';
import { SONG_SAVED } from '@/app/components/songs/ChordEditor';
import { SUGGESTIONS_CHANGED } from '@/lib/services/songSuggestions';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mount = async () => {
  svc.getSongs.mockResolvedValue({ data: [song], error: null });
  svc.getSetlists.mockResolvedValue({ data: [], error: null });
  render(<SetlistManagerView onClose={() => {}} />);
  await screen.findByText('O sole mio');
  await waitFor(() => expect(svc.getSongs).toHaveBeenCalledTimes(1));
};

describe('Repertoire after a chord edit', () => {
  it('updates the saved song in place instead of downloading the whole repertoire again', async () => {
    await mount();
    await act(async () => {
      window.dispatchEvent(new CustomEvent(SONG_SAVED, { detail: { id: 'song-1', lyrics: '[C]new' } }));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(svc.getSongs).toHaveBeenCalledTimes(1);
    expect(svc.getSetlists).toHaveBeenCalledTimes(1);
  });

  it('still reloads when suggestions change (a song can move in or out)', async () => {
    await mount();
    await act(async () => {
      window.dispatchEvent(new CustomEvent(SUGGESTIONS_CHANGED));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(svc.getSongs).toHaveBeenCalledTimes(2);
  });
});
