import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// Audit 09 #7: a long medley pasted in Lyrics was cut at 20,000 characters
// on save, with "saved" shown. Now nothing is cut: too long is said before
// saving and the whole text stays in the field. Made-up song (New York).

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/BandContext', () => ({ useBand: () => ({ isAdmin: true }) }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, profile: null }) }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/services/notifications', () => ({ notifySongAdded: vi.fn() }));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySongUpdated: vi.fn() }));
const svc = vi.hoisted(() => ({ updateSong: vi.fn(async (..._a: unknown[]) => ({ data: {}, error: null })) }));
vi.mock('@/lib/services/songs', () => ({ createSong: vi.fn(), updateSong: svc.updateSong }));
vi.mock('@/lib/services/songFiles', () => ({
  uploadSongFile: vi.fn(), removeSongFiles: vi.fn(async () => {}), isStoredSongFile: () => false,
  classifySongFile: () => 'audio', validateSongFile: () => null, normalizeSongFile: async (f: File) => f,
  SONG_FILE_ACCEPT: '*/*', songFileName: () => '', openSongResource: vi.fn(),
}));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { AddSongModal } from '../AddSongModal';

beforeEach(() => svc.updateSong.mockClear());
afterEach(cleanup);

const song = { id: 's1', band_id: 'b1', title: 'Hudson Medley', artist: 'Hudson Line', lyrics: 'Short', status: 'ready' } as never;

describe('song form: long lyrics are never cut', () => {
  it('too long: says so, saves nothing, keeps every character in the field', { timeout: 60000 }, async () => {
    render(<AddSongModal isOpen onClose={() => {}} bandId="b1" song={song} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    const field = (await screen.findByDisplayValue('Short')) as HTMLTextAreaElement;
    const medley = `# Verse 1\n${'Uptown lights over the river\n'.repeat(800)}# Outro\nThe very last line`;
    expect(medley.length).toBeGreaterThan(20000);
    fireEvent.change(field, { target: { value: medley } });
    fireEvent.click(screen.getByRole('button', { name: /save song/i }));

    await waitFor(() => expect(screen.getAllByText(/lyrics are too long/i).length).toBeGreaterThan(0));
    expect(svc.updateSong).not.toHaveBeenCalled();
    expect((screen.getByDisplayValue(/The very last line/) as HTMLTextAreaElement).value).toBe(medley);
  });

  it('within the limit: saved whole', { timeout: 60000 }, async () => {
    render(<AddSongModal isOpen onClose={() => {}} bandId="b1" song={song} />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    const field = (await screen.findByDisplayValue('Short')) as HTMLTextAreaElement;
    const text = `Uptown lights\n${'la '.repeat(3000)}end`;
    fireEvent.change(field, { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: /save song/i }));
    await waitFor(() => expect(svc.updateSong).toHaveBeenCalled());
    const changes = svc.updateSong.mock.calls[0][1] as { lyrics: string };
    expect(changes.lyrics.endsWith('end')).toBe(true);
  });
});
