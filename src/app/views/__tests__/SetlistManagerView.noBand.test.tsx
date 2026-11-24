import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

/**
 * Same wait as Band members (owner's report, 11-24): with no band, Repertoire
 * showed its loader forever, because only loading a band's songs ended it.
 */
const band = vi.hoisted(() => ({
  selectedBand: null as { id: string; name: string } | null,
  loading: false,
  error: null as Error | null,
  refreshBands: vi.fn(async () => {}),
}));
const songsApi = vi.hoisted(() => ({
  getSongs: vi.fn(async () => ({ data: [], error: null })),
  getSetlists: vi.fn(async () => ({ data: [], error: null })),
}));

vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({
    selectedBand: band.selectedBand,
    bands: band.selectedBand ? [band.selectedBand] : [],
    loading: band.loading,
    error: band.error,
    refreshBands: band.refreshBands,
    isAdmin: false,
  }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/services/songs', () => ({
  ...songsApi,
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

const loader = () => document.querySelector('.animate-spin');

beforeEach(() => {
  band.selectedBand = null;
  band.loading = false;
  band.error = null;
  band.refreshBands.mockClear();
  songsApi.getSongs.mockClear();
  songsApi.getSetlists.mockClear();
});
afterEach(cleanup);

describe('Repertoire with no band', () => {
  it('ends in "Band required" with Create a band, not in a loader', async () => {
    const onCreateBand = vi.fn();
    render(<SetlistManagerView onClose={() => {}} onCreateBand={onCreateBand} />);
    expect(await screen.findByRole('heading', { name: /band required/i })).toBeTruthy();
    expect(loader()).toBeNull();
    expect(songsApi.getSongs).not.toHaveBeenCalled();
    // No band, so no band library to add to, suggest for or search.
    expect(screen.queryByRole('button', { name: /suggest a song|add song|new setlist/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^setlists/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /create a band/i }));
    expect(onCreateBand).toHaveBeenCalledTimes(1);
  });

  it('keeps its Back, so the screen can always be left', async () => {
    const onClose = vi.fn();
    render(<SetlistManagerView onClose={onClose} />);
    await screen.findByRole('heading', { name: /band required/i });
    fireEvent.click(screen.getByRole('button', { name: /go back/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('bands that could not be loaded: it says so and offers Try again, no loader and no "Band required"', async () => {
    band.error = new Error('Failed to fetch');
    render(<SetlistManagerView onClose={() => {}} onCreateBand={() => {}} />);
    expect(await screen.findByRole('heading', { name: /can’t load your bands/i })).toBeTruthy();
    expect(loader()).toBeNull();
    expect(screen.queryByRole('heading', { name: /band required/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(band.refreshBands).toHaveBeenCalledTimes(1);
  });

  it('while the band list is still loading it waits: a band may come', () => {
    band.loading = true;
    render(<SetlistManagerView onClose={() => {}} />);
    expect(loader()).not.toBeNull();
    expect(screen.queryByRole('heading', { name: /band required/i })).toBeNull();
  });

  it('with a band it loads that band’s songs as before', async () => {
    band.selectedBand = { id: 'band-1', name: 'Velvet Static' };
    render(<SetlistManagerView onClose={() => {}} />);
    await screen.findByRole('button', { name: /^setlists/i });
    expect(songsApi.getSongs).toHaveBeenCalledWith('band-1');
    expect(screen.queryByRole('heading', { name: /band required/i })).toBeNull();
  });
});
