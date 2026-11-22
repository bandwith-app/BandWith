import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';
import { setWordChordAt } from '@/lib/songFormat';

// PR #295 review: chords from the chart can share a word ("[C][D]Hello").
// The chord editor showed and announced only C, and changing C replaced the
// word's chords, so D was silently deleted. Every chord shows; an edit
// changes only the chord picked.
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
const row = { id: 's1', band_id: 'b1', title: 'Hudson Line', key: 'C', lyrics: '# Verse\n[C][D]Hello [E]again', chord_chart: null };
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: row, error: null }), maybeSingle: async () => ({ data: row, error: null }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  },
}));
vi.mock('@/lib/services/setlistNotify', () => ({ notifySongUpdated: vi.fn() }));

import { ChordEditor, openChordEditor, closeChordEditor } from '../ChordEditor';

afterEach(() => {
  act(() => closeChordEditor());
  cleanup();
});

describe('setWordChordAt', () => {
  it('changes or removes one chord of a word, keeping the others', () => {
    expect(setWordChordAt('[C][D]Hello', 0, 1, 'E')).toBe('[C][E]Hello');
    expect(setWordChordAt('[C][D]Hello', 0, 0, 'G')).toBe('[G][D]Hello');
    expect(setWordChordAt('[C][D]Hello', 0, 0, null)).toBe('[D]Hello');
    expect(setWordChordAt('Hello', 0, 0, 'C')).toBe('[C]Hello');
    expect(setWordChordAt('[C]Hel[D]lo', 0, 1, 'F')).toBe('[C]Hel[F]lo');
  });
});

describe('a word with two chords in the chord editor', () => {
  const hello = () => screen.getByRole('button', { name: /^Hello/ });

  it('shows and announces both', async () => {
    render(<ChordEditor />);
    act(() => openChordEditor('s1'));
    await screen.findByRole('button', { name: /^again/ });
    expect(hello()).toHaveAccessibleName('Hello, chords C, D');
    expect(within(hello()).getByText('C')).toBeTruthy();
    expect(within(hello()).getByText('D')).toBeTruthy();
  });

  it('changes only the chord picked: D → E keeps C', async () => {
    render(<ChordEditor />);
    act(() => openChordEditor('s1'));
    await screen.findByRole('button', { name: /^again/ });
    fireEvent.click(hello());
    fireEvent.click(within(screen.getByRole('group', { name: 'Chords on “Hello”' })).getByRole('button', { name: 'D' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Chords of the song' })).getByRole('button', { name: 'E' }));
    expect(hello()).toHaveAccessibleName('Hello, chords C, E');
  });

  it('picking a word by keyboard starts from its first chord (Codex review of #295)', async () => {
    render(<ChordEditor />);
    act(() => openChordEditor('s1'));
    const again = await screen.findByRole('button', { name: /^again/ });
    fireEvent.click(hello());
    fireEvent.click(within(screen.getByRole('group', { name: 'Chords on “Hello”' })).getByRole('button', { name: 'D' }));
    fireEvent.keyDown(again, { key: 'Enter' });
    fireEvent.click(within(screen.getByRole('group', { name: 'Chords of the song' })).getByRole('button', { name: 'C' }));
    expect(screen.getByRole('button', { name: /^again/ })).toHaveAccessibleName('again, chord C');
    expect(hello()).toHaveAccessibleName('Hello, chords C, D');
  });

  it('removing C keeps D', async () => {
    render(<ChordEditor />);
    act(() => openChordEditor('s1'));
    await screen.findByRole('button', { name: /^again/ });
    fireEvent.click(hello());
    fireEvent.click(screen.getByRole('button', { name: 'No chord' }));
    expect(hello()).toHaveAccessibleName('Hello, chord D');
  });
});
