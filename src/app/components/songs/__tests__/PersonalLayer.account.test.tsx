import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

// Audit 09 #1: a private note left open, then another account signs in on
// the same browser (sign-out and sign-in in another tab): the app comes back
// without a reload and must not show the first account's note.
// Made-up song and notes (New York).

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
const auth = vi.hoisted(() => ({ userId: 'user-a' as string | null }));
vi.mock('@/lib/AuthContext', () => ({
  useOptionalAuth: () => (auth.userId ? { user: { id: auth.userId } } : { user: null }),
}));
vi.mock('@/lib/services/personalLayer', () => ({
  addPersonalFile: vi.fn(),
  deletePersonalFile: vi.fn(),
  deletePersonalNote: vi.fn(),
  markMyNotesInfoSeen: vi.fn(),
  myNotesInfoSeen: () => true,
  savePersonalNote: vi.fn(),
  usePersonalLayer: () => ({ notes: [], files: [] }),
  useShowMyNotes: () => [true, vi.fn()] as const,
}));
vi.mock('@/lib/services/songFiles', () => ({ openSongResource: vi.fn(), SONG_FILE_ACCEPT: '*/*' }));
vi.mock('@/lib/services/songSuggestions', () => ({ openSuggestChange: vi.fn() }));

import { openNoteFor, PersonalLayerSheets } from '../PersonalLayer';

const song = { id: 's1', band_id: 'b1', title: 'Hudson Line', lyrics: '# Verse 1\nUptown lights' };
const note = {
  id: 'n1',
  song_id: 's1',
  anchor: { type: 'song' as const },
  body: 'My cue: watch the drummer before the bridge',
  created_at: '2026-11-20T10:00:00Z',
  updated_at: '2026-11-20T10:00:00Z',
};

afterEach(() => {
  cleanup();
  auth.userId = 'user-a';
});

describe('My notes: an open note belongs to the account that opened it', () => {
  it('the next account to sign in does not see it', () => {
    auth.userId = 'user-a';
    const first = render(<PersonalLayerSheets />);
    act(() => openNoteFor(song, null, note as never));
    expect(screen.getByDisplayValue(note.body)).toBeTruthy();

    // Signed out in another tab: the signed-in app goes away…
    first.unmount();
    auth.userId = null;
    // …and comes back for another account, without a reload.
    auth.userId = 'user-b';
    render(<PersonalLayerSheets />);
    expect(screen.queryByDisplayValue(note.body)).toBeNull();
    expect(screen.queryByText(/hudson line/i)).toBeNull();
  });

  it('the same account still finds its note after the app comes back', () => {
    const first = render(<PersonalLayerSheets />);
    act(() => openNoteFor(song, null, note as never));
    first.unmount();
    render(<PersonalLayerSheets />);
    expect(screen.getByDisplayValue(note.body)).toBeTruthy();
  });
});
