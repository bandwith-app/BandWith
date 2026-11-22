import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

// Kill switch `voice_parts` (docs/flags.md): off → a note pinned to a line
// doesn't name the line's part ("Backing · line 2"), and the line picker
// shows plain lines, without the part's label or colour. Made-up song.

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

import { NoteEditorSheet, noteHeadline } from '../RehearsalNotes';
import type { RehearsalNote } from '@/lib/rehearsalNotes';
import { __resetAppFlagsForTest, __setAppFlagsForTest } from '@/lib/appFlags';

const LYRICS = '# Verse 1\nPaper boats\n# Chorus\n[F]Hold the line\n{bv}(ooh, [G]yeah){/bv}\nMorning comes';
const note: RehearsalNote = {
  id: 'n1', bandId: 'b', eventId: 'e', date: '2026-11-20', sessionId: null,
  songId: 's1', songTitle: 'Hudson Line', preset: 'tempo', section: 'Chorus', line: '(ooh, yeah)', body: null,
  scope: 'band', status: 'open', markedAtS: null, createdBy: 'u', okBy: null, okAt: null,
  createdAt: '2026-11-20T20:00:00Z', assignees: [],
};
const t = (s: string, v?: Record<string, unknown>) => (v ? s.replace(/\{(\w+)\}/g, (_, k) => String(v[k])) : s);
const controls = { userId: 'u', isAdmin: true, save: vi.fn(), remove: vi.fn(), practised: vi.fn(), ok: vi.fn() } as never;
const editor = () => (
  <NoteEditorSheet open note={note} controls={controls} songs={[{ songId: 's1', title: 'Hudson Line', lyrics: LYRICS }]} members={[]} onClose={() => {}} />
);

beforeEach(() => __resetAppFlagsForTest(null));
afterEach(cleanup);

describe('voice_parts in rehearsal notes', () => {
  it('on (the default): the note says the line is a backing part', () => {
    expect(noteHeadline(note, t as never, LYRICS)).toContain('Backing');
    render(editor());
    expect(screen.getAllByText('Backing').length).toBeGreaterThan(0);
  });

  it('off: no part in the headline, the line picker shows plain lines', () => {
    __setAppFlagsForTest({ voice_parts: false });
    expect(noteHeadline(note, t as never, LYRICS)).toBe('Tempo · Chorus · “(ooh, yeah)”');
    render(editor());
    expect(screen.getByRole('button', { name: '(ooh, yeah)' })).toBeInTheDocument();
    expect(screen.queryByText('Backing')).toBeNull();
  });

  it('turned off while the editor is open: the labels go', () => {
    render(editor());
    expect(screen.getAllByText('Backing').length).toBeGreaterThan(0);
    act(() => __setAppFlagsForTest({ voice_parts: false }));
    expect(screen.queryByText('Backing')).toBeNull();
  });
});
