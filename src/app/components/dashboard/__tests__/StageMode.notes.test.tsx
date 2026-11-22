import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { rejectedKey } from '@/lib/rehearsalNotesOutbox';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

import { StageMode, type StageSong } from '../StageMode';
import type { LiveNotes } from '../RehearsalNotes';
import type { RehearsalNotesControls } from '@/app/components/event/useRehearsalNotes';
import type { RehearsalSessionControls } from '@/app/components/event/useRehearsalSession';
import type { RehearsalNote } from '@/lib/rehearsalNotes';
import { endSession, pauseSession, sessionStatus, startSession, type SessionState } from '@/lib/rehearsalSession';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);

const ADMIN = 'u-admin';
const MEMBER = 'u-member';
const songs: StageSong[] = [
  { id: 'r1', songId: 's1', title: 'Paper Boats', lyrics: '# Verse 1\nPaper boats\n# Chorus\nOn the river' },
  { id: 'r2', songId: 's2', title: 'Superstition' },
];

const note = (over: Partial<RehearsalNote> = {}): RehearsalNote => ({
  id: 'n1',
  bandId: 'b',
  eventId: 'e',
  date: '2026-11-19',
  sessionId: null,
  songId: 's1',
  songTitle: 'Paper Boats',
  preset: null,
  section: null,
  body: null,
  scope: 'band',
  status: 'marked',
  markedAtS: 754,
  createdBy: ADMIN,
  okBy: null,
  okAt: null,
  createdAt: '2026-11-19T20:00:00.000Z',
  assignees: [],
  ...over,
});

const controls = (notes: RehearsalNote[], over: Partial<RehearsalNotesControls> = {}): RehearsalNotesControls => {
  const userId = over.userId ?? ADMIN;
  return {
    enabled: true,
    notes,
    loaded: true,
    waiting: 0,
    userId,
    isAdmin: true,
    mark: vi.fn(() => null),
    save: vi.fn(),
    remove: vi.fn(),
    practised: vi.fn(),
    ok: vi.fn(),
    draft: (m) => ({ ...note({ id: '', status: 'open', markedAtS: null, createdBy: userId }), songId: null, songTitle: null, ...m }),
    ...over,
  };
};

const session = (state: SessionState | null, over: Partial<RehearsalSessionControls> = {}): RehearsalSessionControls => ({
  enabled: true,
  ready: true,
  state,
  status: sessionStatus(state),
  unsaved: false,
  justEnded: false,
  alreadyEnded: false,
  dismissSummary: vi.fn(),
  canControl: true,
  start: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  end: vi.fn(),
  ...over,
});

const members = [
  { userId: ADMIN, name: 'Gianna' },
  { userId: MEMBER, name: 'Marco' },
];

const renderLive = (c: RehearsalNotesControls, s: RehearsalSessionControls, elapsed = 754) => {
  const notes: LiveNotes = { controls: c, songs, members, elapsed: () => elapsed };
  return render(
    <StageMode
      kind="rehearsal"
      title="Weekly rehearsal"
      dateLabel="Thu 19 Nov"
      steps={[]}
      songs={songs}
      live={{ index: 0 } as never}
      session={s}
      notes={notes}
      onClose={vi.fn()}
    />,
  );
};

const T0 = Date.now() - 20 * 60_000;

/** A sheet by its title (BwSheet's dialog is named by its heading). */
const sheet = (name: RegExp) => screen.getByRole('heading', { name }).closest('[role="dialog"]') as HTMLElement;

describe('Live mode on a rehearsal: notes (A2)', () => {
  it('Mark: one tap keeps the song playing and the minute', () => {
    const c = controls([]);
    renderLive(c, session(startSession(T0)));
    fireEvent.click(screen.getByRole('button', { name: 'Mark' }));
    expect(c.mark).toHaveBeenCalledWith({ songId: 's1', songTitle: 'Paper Boats', markedAtS: 754 });
    expect(screen.getByText('Marked')).toBeInTheDocument();
  });

  it('at the pause the marks wait to be written: a preset, and it is a note', () => {
    const c = controls([note()]);
    renderLive(c, session(pauseSession(startSession(T0), T0 + 60_000)));
    fireEvent.click(screen.getByRole('button', { name: 'To write: 1' }));
    const list = sheet(/Notes · 1/);
    expect(within(list).getByText('Marked at 12:34')).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'Write' }));
    const editor = sheet(/Edit note/);
    fireEvent.click(within(editor).getByRole('button', { name: 'Tempo' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Save note' }));
    expect(c.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1', preset: 'tempo', status: 'open', scope: 'band' }));
  });

  it('"Repeat a section" only when the song has structure, then its sections', () => {
    const c = controls([note({ songId: 's2', songTitle: 'Superstition' })]);
    renderLive(c, session(pauseSession(startSession(T0), T0 + 60_000)));
    fireEvent.click(screen.getByRole('button', { name: 'To write: 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Write' }));
    let editor = sheet(/Edit note/);
    expect(within(editor).queryByRole('button', { name: 'Repeat a section' })).toBeNull();
    fireEvent.click(within(editor).getByRole('button', { name: 'Paper Boats' }));
    editor = sheet(/Edit note/);
    fireEvent.click(within(editor).getByRole('button', { name: 'Repeat a section' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Save note' }));
    expect(screen.getByText('Pick the section to repeat.')).toBeInTheDocument();
    expect(c.save).not.toHaveBeenCalled();
    fireEvent.click(within(editor).getByRole('button', { name: 'Chorus' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Save note' }));
    expect(c.save).toHaveBeenCalledWith(expect.objectContaining({ songId: 's1', preset: 'repeat_section', section: 'Chorus' }));
  });

  it('a member writes for the band or for themselves only (Q-A1)', () => {
    const c = controls([], { userId: MEMBER, isAdmin: false });
    renderLive(c, session(startSession(T0), { canControl: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Notes · 0' }));
    fireEvent.click(screen.getByRole('button', { name: 'New note' }));
    const editor = sheet(/New note/);
    const who = within(editor).getByRole('group', { name: 'Who it’s for' });
    expect(within(who).getAllByRole('button').map((b) => b.textContent)).toEqual(['Whole band', 'Me']);
    fireEvent.click(within(who).getByRole('button', { name: 'Me' }));
    fireEvent.change(within(editor).getByRole('textbox'), { target: { value: 'Learn the bridge' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save note' }));
    expect(c.save).toHaveBeenCalledWith(
      expect.objectContaining({ songId: 's1', body: 'Learn the bridge', scope: 'members', assignees: [{ userId: MEMBER, practisedAt: null }] }),
    );
  });

  it('Practised for the assignee; OK for an admin (Q-A4)', () => {
    const forMarco = note({ status: 'open', preset: 'tempo', scope: 'members', assignees: [{ userId: MEMBER, practisedAt: null }] });
    const member = controls([forMarco], { userId: MEMBER, isAdmin: false });
    renderLive(member, session(startSession(T0), { canControl: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Notes · 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Practised' }));
    expect(member.practised).toHaveBeenCalledWith('n1', true);
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    cleanup();

    const admin = controls([forMarco]);
    renderLive(admin, session(startSession(T0)));
    fireEvent.click(screen.getByRole('button', { name: 'Notes · 1' }));
    expect(screen.queryByRole('button', { name: 'Practised' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(admin.ok).toHaveBeenCalledWith('n1', true);
  });

  it('the summary offers to write the marks', () => {
    const c = controls([note()]);
    renderLive(c, session(endSession(startSession(T0), T0 + 60 * 60_000), { justEnded: true }));
    const summary = screen.getByRole('dialog', { name: 'Rehearsal summary' });
    fireEvent.click(within(summary).getByRole('button', { name: 'Marks to write: 1' }));
    expect(sheet(/Notes · 1/)).toBeInTheDocument();
  });

  it('audit 06 #5: a note the server refused says so, its words stay to copy, then it can be removed', () => {
    const refused = note({ id: 'n9', status: 'open', preset: 'tempo', body: 'Count the outro in four', markedAtS: null });
    const dismissRejected = vi.fn();
    const c = controls([], { rejected: [refused], dismissRejected });
    renderLive(c, session(startSession(T0)));
    expect(screen.getByText("A note wasn't saved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Notes · 0' }));
    const list = sheet(/Notes · 0/);
    expect(within(list).getByText("These notes weren't saved. Copy what you need, then remove them.")).toBeInTheDocument();
    expect(within(list).getByText('Paper Boats · Tempo · Count the outro in four')).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'Remove note: Paper Boats · Tempo · Count the outro in four' }));
    // One entry per refused version: removed by its key (#296 round 6).
    expect(dismissRejected).toHaveBeenCalledWith(rejectedKey(refused));
  });

  it('#296 round 8 (Codex r8 M2): a refused note pinned to a lyric line shows and copies the line; two versions that differ only by line are two entries', () => {
    const a = note({ id: 'n9', status: 'open', preset: 'tempo', section: null, line: 'Paper boats on the river', body: 'Rushes here', markedAtS: null });
    const b = { ...a, line: 'Sinking slow' };
    expect(rejectedKey(a)).not.toBe(rejectedKey(b));
    renderLive(controls([], { rejected: [a, b], dismissRejected: vi.fn() }), session(startSession(T0)));
    fireEvent.click(screen.getByRole('button', { name: 'Notes · 0' }));
    const list = sheet(/Notes · 0/);
    expect(within(list).getByText('Paper Boats · Tempo · “Paper boats on the river” · Rushes here')).toBeInTheDocument();
    expect(within(list).getByText('Paper Boats · Tempo · “Sinking slow” · Rushes here')).toBeInTheDocument();
  });

  it('#296 round 3: the refused notes read as a status (not an alert), each button names its note', () => {
    const refused = note({ id: 'n9', status: 'open', preset: 'tempo', body: 'Count the outro in four', markedAtS: null });
    renderLive(controls([], { rejected: [refused], dismissRejected: vi.fn() }), session(startSession(T0)));
    fireEvent.click(screen.getByRole('button', { name: 'Notes · 0' }));
    const list = sheet(/Notes · 0/);
    expect(within(list).queryByRole('alert')).toBeNull();
    expect(within(list).getByRole('status')).toHaveTextContent("These notes weren't saved. Copy what you need, then remove them.");
    expect(within(list).getByRole('button', { name: 'Copy note: Paper Boats · Tempo · Count the outro in four' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Remove note: Paper Boats · Tempo · Count the outro in four' })).toBeInTheDocument();
  });

  it('#296 round 3: no clipboard (or it refuses): the screen says so, the text stays to select', async () => {
    const refused = note({ id: 'n9', status: 'open', preset: 'tempo', body: 'Count the outro in four', markedAtS: null });
    const had = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    for (const clipboard of [undefined, { writeText: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))) }]) {
      Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
      const view = renderLive(controls([], { rejected: [refused], dismissRejected: vi.fn() }), session(startSession(T0)));
      fireEvent.click(screen.getByRole('button', { name: 'Notes · 0' }));
      const list = sheet(/Notes · 0/);
      fireEvent.click(within(list).getByRole('button', { name: /^Copy note:/ }));
      expect(await within(list).findByText('Couldn’t copy. Select the text and copy it yourself.')).toBeInTheDocument();
      view.unmount();
    }
    if (had) Object.defineProperty(navigator, 'clipboard', had);
    else delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it('#296 round 4 / Claude r8 N3: after a copy the live region says “Copied”, once: the button keeps its name', async () => {
    const refused = note({ id: 'n9', status: 'open', preset: 'tempo', body: 'Count the outro in four', markedAtS: null });
    const had = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true });
    try {
      renderLive(controls([], { rejected: [refused], dismissRejected: vi.fn() }), session(startSession(T0)));
      fireEvent.click(screen.getByRole('button', { name: 'Notes · 0' }));
      const list = sheet(/Notes · 0/);
      fireEvent.click(within(list).getByRole('button', { name: /^Copy note:/ }));
      const live = list.querySelector('[aria-live="polite"]');
      await waitFor(() => expect(live).toHaveTextContent('Copied'));
      // Seen on the button, announced only by the live region (not twice).
      expect(within(list).queryByRole('button', { name: 'Copied' })).toBeNull();
      expect(within(list).getByRole('button', { name: /^Copy note:/ })).toHaveTextContent('Copied');
    } finally {
      if (had) Object.defineProperty(navigator, 'clipboard', had);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('#296 round 4: a refused note the device had no room for says to copy it now', () => {
    const refused = { ...note({ id: 'n9', status: 'open', preset: 'tempo', body: 'Count the outro in four', markedAtS: null }), spaceFull: true };
    renderLive(controls([], { rejected: [refused], dismissRejected: vi.fn() }), session(startSession(T0)));
    fireEvent.click(screen.getByRole('button', { name: 'Notes · 0' }));
    expect(within(sheet(/Notes · 0/)).getByText('Space full: copy your note now')).toBeInTheDocument();
  });

  it('gigs have no notes', () => {
    const c = controls([]);
    const notes: LiveNotes = { controls: c, songs, members, elapsed: () => 0 };
    render(<StageMode kind="gig" title="Gig" dateLabel="Thu" steps={[]} songs={songs} notes={notes} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Mark' })).toBeNull();
  });
});

describe('Live mode: notes from last time (A3)', () => {
  const earlierNote = note({ id: 'old', date: '2026-11-12', status: 'open', preset: 'ending', markedAtS: null });
  const renderWithEarlier = (ok = vi.fn(), isAdmin = true) => {
    const c = controls([]);
    const notes: LiveNotes = {
      controls: c,
      songs,
      members,
      elapsed: () => 0,
      earlier: { notes: [earlierNote], userId: ADMIN, isAdmin, practised: vi.fn(), ok },
    };
    render(
      <StageMode kind="rehearsal" title="Weekly rehearsal" dateLabel="Thu 19 Nov" steps={[]} songs={songs} live={{ index: 0 } as never} session={session(null)} notes={notes} onClose={vi.fn()} />,
    );
    return ok;
  };

  it('a badge on the songs with open notes; it opens them and an admin confirms OK', () => {
    const ok = renderWithEarlier();
    expect(screen.queryByRole('button', { name: /From last time · Superstition/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'From last time · Paper Boats: 1' }));
    const list = sheet(/Paper Boats/);
    expect(within(list).getByText('Ending')).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: /OK/ }));
    expect(ok).toHaveBeenCalledWith('old', true);
  });

  it('a member sees the notes but cannot confirm a band note', () => {
    renderWithEarlier(vi.fn(), false);
    fireEvent.click(screen.getByRole('button', { name: 'From last time · Paper Boats: 1' }));
    expect(within(sheet(/Paper Boats/)).queryByRole('button', { name: /OK/ })).toBeNull();
  });
});
