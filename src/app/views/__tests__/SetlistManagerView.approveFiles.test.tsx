import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

// Audit 09 #5: "Approve · learning" / "Mark as ready" changed only the status,
// so the accepted song's recording stayed in the member's own folder, where
// they could still replace or delete it. Both now adopt the files, like review.
vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: { id: 'band-1', name: 'Velvet Static' }, isAdmin: true }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin-1' } }) }));
vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

const ORIG = 'sb://song-files/band-1/suggestions/member-1/audio/abc-take.mp3';
const ADOPTED = 'sb://song-files/band-1/audio/abc-take.mp3';
const svc = vi.hoisted(() => ({ getSongs: vi.fn(), updateSong: vi.fn(), adopt: vi.fn(), sweep: vi.fn(async () => ({ error: null })), fit: vi.fn(async () => true) }));
vi.mock('@/lib/services/songs', () => ({
  getSongs: svc.getSongs,
  getSetlists: vi.fn(async () => ({ data: [], error: null })),
  getSetlist: vi.fn(),
  createSong: vi.fn(), deleteSong: vi.fn(), updateSong: svc.updateSong,
  createSetlist: vi.fn(), updateSetlist: vi.fn(), deleteSetlist: vi.fn(),
  replaceSetlistSongs: vi.fn(), seedRepertoireSongs: vi.fn(), bulkCreateSongs: vi.fn(),
  getSongUsage: vi.fn(), getUpcomingGigsForSetlists: vi.fn(async () => ({ data: [], error: null })),
}));
vi.mock('@/lib/services/songFiles', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/songFiles')>()),
  adoptSuggestionFiles: svc.adopt,
  sweepAdoptedFiles: svc.sweep,
  songFilesFit: svc.fit,
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { SetlistManagerView } from '../SetlistManagerView';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  svc.fit.mockResolvedValue(true);
});

const suggested = { id: 'song-1', band_id: 'band-1', title: 'Empire State of Mind', artist: 'Alicia Keys', duration_seconds: 276, status: 'suggested', genre: null, audio_url: ORIG, chart_url: null };

const approve = async (label: RegExp, status: string) => {
  svc.getSongs.mockResolvedValue({ data: [suggested], error: null });
  svc.updateSong.mockResolvedValue({ data: { ...suggested, status }, error: null });
  svc.adopt.mockResolvedValue({ refs: { audio_url: ADOPTED }, error: null });
  render(<SetlistManagerView onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /actions for empire state of mind/i }));
  fireEvent.click(await screen.findByRole('menuitem', { name: label }));
  await waitFor(() => expect(svc.updateSong).toHaveBeenCalledWith('song-1', { status }));
  await waitFor(() => expect(svc.adopt).toHaveBeenCalledWith(expect.objectContaining({ id: 'song-1', audio_url: ORIG })));
};

describe('Approving a suggested song from its menu', () => {
  it('Approve · learning moves its files into the band’s folders', async () => {
    await approve(/approve · learning/i, 'learning');
  });

  it('Mark as ready does the same', async () => {
    await approve(/mark as ready/i, 'ready');
  });

  it('retries files left behind by an earlier approval when the repertoire opens', async () => {
    svc.getSongs.mockResolvedValue({ data: [{ ...suggested, status: 'learning' }], error: null });
    svc.adopt.mockResolvedValue({ refs: { audio_url: ADOPTED }, error: null });
    render(<SetlistManagerView onClose={() => {}} />);
    await screen.findByText('Empire State of Mind');
    await waitFor(() => expect(svc.adopt).toHaveBeenCalledWith(expect.objectContaining({ id: 'song-1', audio_url: ORIG })));
  });

  it('tidies originals a failed delete left behind, once per visit', async () => {
    svc.getSongs.mockResolvedValue({ data: [{ ...suggested, status: 'ready', audio_url: ADOPTED }], error: null });
    render(<SetlistManagerView onClose={() => {}} />);
    await screen.findByText('Empire State of Mind');
    await waitFor(() => expect(svc.sweep).toHaveBeenCalledWith('band-1'));
    expect(svc.sweep).toHaveBeenCalledTimes(1);
    expect(svc.adopt).not.toHaveBeenCalled();
  });

  it('a band whose storage is full: approving keeps the song suggested and says why (Codex review of 28cb3199)', async () => {
    svc.getSongs.mockResolvedValue({ data: [suggested], error: null });
    svc.fit.mockResolvedValue(false);
    render(<SetlistManagerView onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /actions for empire state of mind/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /approve · learning/i }));
    expect(await screen.findByText('Band storage is full: free up space to add this file.')).toBeTruthy();
    expect(svc.updateSong).not.toHaveBeenCalled();
    expect(svc.adopt).not.toHaveBeenCalled();
  });

  it('a move refused for storage on a later visit is shown, not dropped (Codex review of 28cb3199)', async () => {
    svc.getSongs.mockResolvedValue({ data: [{ ...suggested, status: 'learning' }], error: null });
    const { UserError } = await import('@/lib/userError');
    svc.adopt.mockResolvedValue({ refs: {}, error: new UserError('Band storage is full: free up space to add this file.') });
    render(<SetlistManagerView onClose={() => {}} />);
    expect(await screen.findByText('Band storage is full: free up space to add this file.')).toBeTruthy();
  });

  it('tidies also when the band has no songs left (Codex review of ed7ec29f)', async () => {
    // The last song deleted: its file's lapsed claim (or an unused copy) still waits on the server.
    svc.getSongs.mockResolvedValue({ data: [], error: null });
    render(<SetlistManagerView onClose={() => {}} />);
    await waitFor(() => expect(svc.getSongs).toHaveBeenCalled());
    await waitFor(() => expect(svc.sweep).toHaveBeenCalledWith('band-1'));
    expect(svc.sweep).toHaveBeenCalledTimes(1);
  });
});
