import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: { id: 'band-1', name: 'Velvet Static' }, isAdmin: true }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
const songs = vi.hoisted(() => ({
  getSongs: vi.fn(async (..._args: unknown[]) => ({
    data: [{ id: 'song-1', band_id: 'band-1', title: 'O sole mio', artist: 'Traditional', status: 'ready', priority: 'medium' }],
    error: null,
  })),
}));
vi.mock('@/lib/services/songs', () => ({ getSongs: songs.getSongs, createSong: vi.fn() }));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { SongPicker } from '../SongPicker';

afterEach(cleanup);

describe('SongPicker egress', () => {
  it('loads the library without lyrics, chord charts or notes', async () => {
    render(<SongPicker isOpen onClose={() => {}} onSelect={() => {}} />);
    await screen.findByText('O sole mio');
    await waitFor(() => expect(songs.getSongs).toHaveBeenCalled());
    for (const call of songs.getSongs.mock.calls) {
      expect(call[1]).toMatchObject({ columns: 'list' });
    }
  });
});
