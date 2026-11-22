import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';

// Codex 11-22: "Load the latest version" on song A reads the song again. If
// song B was opened before that answer came back, the answer still replaced
// the editor's text, undo steps and conflict: B showed A's lyrics, and a
// save would have written them into B. Made-up songs (New York).

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
vi.mock('@/lib/BandContext', () => ({ useOptionalBand: () => ({ isAdmin: true, selectedBand: { id: 'b1', members: [] } }) }));
vi.mock('@/lib/AuthContext', () => ({ useOptionalAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/lib/services/vocalParts', () => ({
  fetchSongVocalParts: vi.fn(async () => ({})),
  fetchSetlistVocalParts: vi.fn(async () => ({})),
  saveSongVocalParts: vi.fn(async () => ({ error: null })),
  saveSetlistVocalParts: vi.fn(async () => ({ error: null })),
}));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySongUpdated: vi.fn() }));

// The server: two songs. A read of a song in `held` waits until released.
const server = vi.hoisted(() => ({
  songs: {} as Record<string, { title: string; lyrics: string | null }>,
  held: {} as Record<string, Promise<void> | undefined>,
}));
vi.mock('@/lib/supabase', () => ({
  getSafeUser: async () => ({ data: { user: { id: 'u1' } } }),
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          single: async () => {
            // Held: the answer waits here until the test releases it.
            const gate = server.held[id];
            if (gate !== undefined) await gate;
            const s = server.songs[id];
            return { data: { id, band_id: 'b1', title: s.title, key: 'C', lyrics: s.lyrics, chord_chart: null }, error: null };
          },
        }),
      }),
    }),
    rpc: async (fn: string, args: { p_song_id: string; p_lyrics: string; p_expected: string | null }) => {
      if (fn !== 'bw_save_song_lyrics') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
      const s = server.songs[args.p_song_id];
      if (s.lyrics !== args.p_expected) return { data: { saved: false, lyrics: s.lyrics }, error: null };
      s.lyrics = args.p_lyrics;
      return { data: { saved: true, lyrics: args.p_lyrics }, error: null };
    },
  },
}));

import { ChordEditor, openChordEditor, closeChordEditor } from '../ChordEditor';

const putChordOn = async (word: string, chord: string) => {
  fireEvent.click(await screen.findByRole('button', { name: word }));
  fireEvent.change(screen.getByLabelText('New chord'), { target: { value: chord } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
};
const conflictShown = () => screen.queryByText(/someone else changed these lyrics/i);

afterEach(() => {
  act(() => closeChordEditor());
  cleanup();
  server.held = {};
});

describe('chord editor: a late "Load the latest version" of another song', () => {
  it("does not replace the open song's text, undo steps or conflict", async () => {
    server.songs = {
      a: { title: 'Hudson Line', lyrics: '# Verse 1\n[C]Hello again' },
      b: { title: 'Harlem Morning', lyrics: '# Verse 1\n[D]Harlem morning' },
    };
    render(<ChordEditor />);

    // Song A: a bandmate saves meanwhile, so A's save is a conflict.
    act(() => openChordEditor('a'));
    await screen.findByRole('button', { name: 'Hello, chord C' });
    server.songs.a.lyrics = '# Verse 1\n[C]Hello again\n\n# Verse 2\nUptown lights';
    await putChordOn('again', 'G');
    fireEvent.click(screen.getByRole('button', { name: 'Save chords' }));
    await waitFor(() => expect(conflictShown()).toBeTruthy());

    // "Load the latest version" of A: the read is slow.
    let release: () => void = () => {};
    server.held.a = new Promise<void>((r) => (release = r));
    fireEvent.click(screen.getByRole('button', { name: /load the latest version/i }));

    // Song B is opened before A's answer. The admin puts a chord, and a
    // bandmate's save makes B's own save a conflict too.
    act(() => openChordEditor('b'));
    await screen.findByRole('button', { name: 'Harlem, chord D' });
    await putChordOn('morning', 'A');
    server.songs.b.lyrics = '# Verse 1\n[D]Harlem morning\n\n# Verse 2\nBridge at dawn';
    fireEvent.click(screen.getByRole('button', { name: 'Save chords' }));
    await waitFor(() => expect(conflictShown()).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false);

    // A's answer arrives now.
    await act(async () => {
      release();
      await server.held.a;
      await Promise.resolve();
    });
    await act(async () => {});

    // B's text, with the chord just put, is still here; none of A's words.
    expect(screen.getByRole('button', { name: 'morning, chord A' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Uptown' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hello, chord C' })).toBeNull();
    // B's conflict is still shown and its undo step is still there.
    expect(conflictShown()).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false);
    // Nothing of A was written into B.
    expect(server.songs.b.lyrics).toBe('# Verse 1\n[D]Harlem morning\n\n# Verse 2\nBridge at dawn');
  });

  it('with the same song still open, the latest version loads as before', async () => {
    server.songs = { a: { title: 'Hudson Line', lyrics: '# Verse 1\n[C]Hello again' } };
    render(<ChordEditor />);
    act(() => openChordEditor('a'));
    await screen.findByRole('button', { name: 'Hello, chord C' });
    server.songs.a.lyrics = '# Verse 1\n[C]Hello again\n\n# Verse 2\nUptown lights';
    await putChordOn('again', 'G');
    fireEvent.click(screen.getByRole('button', { name: 'Save chords' }));
    await waitFor(() => expect(conflictShown()).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /load the latest version/i }));
    await screen.findByRole('button', { name: 'Uptown' });
    expect(conflictShown()).toBeNull();
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
