import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';

// D: a rehearsal note on a precise point of the song. Where in the song (any
// kind of note, not only "Repeat a section") and, optionally, one line; and
// holding a line in Live mode writes a band note right there.

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
vi.mock('@/lib/services/personalLayer', () => ({
  addPersonalFile: vi.fn(),
  deletePersonalFile: vi.fn(),
  deletePersonalNote: vi.fn(),
  markMyNotesInfoSeen: vi.fn(),
  myNotesInfoSeen: () => true,
  savePersonalNote: vi.fn(),
  usePersonalLayer: () => ({ notes: [], files: [] }),
  useShowMyNotes: () => [false, vi.fn()],
}));

import { StageMode, type StageSong } from '../StageMode';
import { PersonalLayerSheets } from '@/app/components/songs/PersonalLayer';
import type { LiveNotes } from '../RehearsalNotes';
import type { RehearsalNotesControls } from '@/app/components/event/useRehearsalNotes';
import type { RehearsalSessionControls } from '@/app/components/event/useRehearsalSession';
import type { RehearsalNote } from '@/lib/rehearsalNotes';
import { sessionStatus, startSession } from '@/lib/rehearsalSession';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ADMIN = 'u-admin';
const songs: StageSong[] = [
  { id: 'r1', songId: 's1', title: 'Paper Boats', lyrics: '# Verse 1\nPaper boats\n# Chorus\nOn the river\nHold the line' },
];

const draft = (m: Partial<RehearsalNote>): RehearsalNote => ({
  id: '', bandId: 'b', eventId: 'e', date: '2026-11-20', sessionId: null, songId: null, songTitle: null,
  preset: null, section: null, body: null, scope: 'band', status: 'open', markedAtS: null,
  createdBy: ADMIN, okBy: null, okAt: null, createdAt: '2026-11-20T20:00:00.000Z', assignees: [], ...m,
});

const controls = (): RehearsalNotesControls => ({
  enabled: true, notes: [], loaded: true, waiting: 0, userId: ADMIN, isAdmin: true,
  mark: vi.fn(() => null), save: vi.fn(), remove: vi.fn(), practised: vi.fn(), ok: vi.fn(), draft,
});

const session: RehearsalSessionControls = {
  enabled: true, ready: true, state: startSession(Date.now() - 60_000), status: sessionStatus(startSession(Date.now() - 60_000)),
  unsaved: false, justEnded: false, alreadyEnded: false, dismissSummary: vi.fn(), canControl: true,
  start: vi.fn(), pause: vi.fn(), resume: vi.fn(), end: vi.fn(),
};

const renderLive = (c: RehearsalNotesControls, songOpen = false) => {
  const notes: LiveNotes = { controls: c, songs, members: [{ userId: ADMIN, name: 'Gianna' }], elapsed: () => 60 };
  return render(
    <>
      <StageMode kind="rehearsal" title="Weekly rehearsal" dateLabel="Fri 20 Nov" steps={[]} songs={songs} bandId="b"
        live={{ index: 0 } as never} session={session} notes={notes} songOpen={songOpen} onClose={vi.fn()} />
      {/* Mounted once in the app (AuthenticatedApp). */}
      <PersonalLayerSheets />
    </>,
  );
};

const sheet = (name: RegExp) => screen.getByRole('heading', { name }).closest('[role="dialog"]') as HTMLElement;

describe('a rehearsal note on a precise point (D)', () => {
  it('any note can say where in the song, and which line', () => {
    const c = controls();
    renderLive(c);
    fireEvent.click(screen.getByRole('button', { name: 'Notes · 0' }));
    fireEvent.click(screen.getByRole('button', { name: 'New note' }));
    const editor = sheet(/New note/);
    fireEvent.click(within(editor).getByRole('button', { name: 'Tempo' }));
    const where = within(editor).getByRole('group', { name: 'Where in the song' });
    fireEvent.click(within(where).getByRole('button', { name: 'Chorus' }));
    const lines = within(editor).getByRole('group', { name: 'Line (optional)' });
    expect(within(lines).getAllByRole('button').map((b) => b.textContent)).toEqual(['On the river', 'Hold the line']);
    fireEvent.click(within(lines).getByRole('button', { name: 'Hold the line' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Save note' }));
    expect(c.save).toHaveBeenCalledWith(expect.objectContaining({ songId: 's1', preset: 'tempo', section: 'Chorus', line: 'Hold the line' }));
  });

  it('holding a line in Live mode writes a band note there', () => {
    vi.useFakeTimers();
    const c = controls();
    renderLive(c, true);
    const line = screen.getByText('Hold the line');
    fireEvent.pointerDown(line, { pointerId: 1, clientX: 5, clientY: 5 });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    fireEvent.pointerUp(line, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole('button', { name: /Note for the band/ }));
    const editor = sheet(/New note/);
    expect(within(within(editor).getByRole('group', { name: 'Where in the song' })).getByRole('button', { name: 'Chorus' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(editor).getByRole('button', { name: 'Solo' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Save note' }));
    expect(c.save).toHaveBeenCalledWith(expect.objectContaining({ songId: 's1', section: 'Chorus', line: 'Hold the line', preset: 'solo' }));
  });
});
