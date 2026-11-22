import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';

// Audit 09 #6 and #8, in the chord editor. Made-up song (New York).
//  #6 Admin A opens Edit chords, admin B adds a verse and saves, A changes one
//     chord and saves: B's verse must stay, and A's draft too.
//  #8 JSON lyrics: a chord goes on a word of the song, not on the JSON text.

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

// The server: one song row. A plain update overwrites it; the 189 function
// writes only over the lyrics the editor loaded.
const server = vi.hoisted(() => ({ lyrics: '' as string | null }));
vi.mock('@/lib/supabase', () => ({
  getSafeUser: async () => ({ data: { user: { id: 'u1' } } }),
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { id: 's1', band_id: 'b1', title: 'Hudson Line', key: 'C', lyrics: server.lyrics, chord_chart: null }, error: null }),
        }),
      }),
      update: (v: { lyrics: string }) => ({
        eq: async () => {
          server.lyrics = v.lyrics;
          return { error: null };
        },
      }),
    }),
    rpc: async (fn: string, args: { p_lyrics: string; p_expected: string | null }) => {
      if (fn !== 'bw_save_song_lyrics') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
      if (server.lyrics !== args.p_expected) return { data: { saved: false, lyrics: server.lyrics }, error: null };
      server.lyrics = args.p_lyrics;
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

beforeEach(() => {
  server.lyrics = '# Verse 1\n[C]Hello again';
});
afterEach(() => {
  act(() => closeChordEditor());
  cleanup();
});

describe('chord editor: no lost lyrics', () => {
  it("another admin's new verse survives a stale chord save, and the draft is kept", async () => {
    render(<ChordEditor />);
    act(() => openChordEditor('s1'));
    await screen.findByRole('button', { name: 'Hello, chord C' });
    // Admin B saves a new verse meanwhile.
    server.lyrics = '# Verse 1\n[C]Hello again\n\n# Verse 2\nUptown lights';

    await putChordOn('again', 'G');
    fireEvent.click(screen.getByRole('button', { name: 'Save chords' }));

    await waitFor(() => expect(screen.getByText(/someone else changed these lyrics/i)).toBeTruthy());
    expect(server.lyrics).toContain('Uptown lights');
    // A's chord is still on screen, not saved and not lost.
    expect(screen.getByRole('button', { name: 'again, chord G' })).toBeTruthy();

    // A takes the latest version: B's verse appears, A puts the chord again and saves.
    fireEvent.click(screen.getByRole('button', { name: /load the latest version/i }));
    await screen.findByRole('button', { name: 'Uptown' });
    await putChordOn('again', 'G');
    fireEvent.click(screen.getByRole('button', { name: 'Save chords' }));
    await waitFor(() => expect(server.lyrics).toBe('# Verse 1\n[C]Hello [G]again\n\n# Verse 2\nUptown lights'));
  });

  it('A can also keep their own version on purpose', async () => {
    render(<ChordEditor />);
    act(() => openChordEditor('s1'));
    await screen.findByRole('button', { name: 'Hello, chord C' });
    server.lyrics = '# Verse 1\nHello again (B)';
    await putChordOn('again', 'G');
    fireEvent.click(screen.getByRole('button', { name: 'Save chords' }));
    fireEvent.click(await screen.findByRole('button', { name: /save mine instead/i }));
    await waitFor(() => expect(server.lyrics).toBe('# Verse 1\n[C]Hello [G]again'));
  });

  it('JSON lyrics: the chord lands on the word and the song stays readable', async () => {
    server.lyrics = '{"lines":["Hello again"]}';
    render(<ChordEditor />);
    act(() => openChordEditor('s1'));
    await putChordOn('Hello', 'C');
    fireEvent.click(screen.getByRole('button', { name: 'Save chords' }));
    await waitFor(() => expect(server.lyrics).toBe('[C]Hello again'));
  });

  it('JSON lyrics with sections keep their sections', async () => {
    server.lyrics = JSON.stringify({ sections: [{ name: 'Verse 1', lines: ['Hello again'] }, { name: 'Chorus', lines: ['Uptown lights'] }] });
    render(<ChordEditor />);
    act(() => openChordEditor('s1'));
    await putChordOn('Uptown', 'F');
    fireEvent.click(screen.getByRole('button', { name: 'Save chords' }));
    await waitFor(() => expect(server.lyrics).toBe('# Verse 1\nHello again\n\n# Chorus\n[F]Uptown lights'));
  });
});
