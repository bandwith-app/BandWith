import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

import { StageMode, type StageLiveControls, type StageSong } from '../StageMode';
import { songViewLabel } from '@/app/components/ui/SongViews';
import { STAGE_FULL_ATTR } from '@/lib/stageChrome';
import { handleBackFromStack } from '@/lib/backStack';
import { DICTIONARIES } from '@/lib/i18n';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute(STAGE_FULL_ATTR);
});

const songs: StageSong[] = [
  { id: 'r1', songId: 's1', title: 'Paper Boats', key: 'C', bpm: 96, lyrics: '[C]Paper boats on the [G]river' },
  { id: 'r2', songId: 's2', title: 'Harbor Lights', key: 'G', bpm: 88, lyrics: '[G]Harbor lights are [D]calling' },
];

const live = (over: Partial<StageLiveControls> = {}): StageLiveControls => ({
  index: 0,
  select: vi.fn(),
  go: vi.fn(),
  following: true,
  setFollowing: vi.fn(),
  leaderSeen: true,
  connected: true,
  isLeader: true,
  canReorder: true,
  move: vi.fn(),
  saveState: 'idle',
  skipped: new Set(),
  click: { state: null, mine: true, offset: 0, setOn: vi.fn() },
  ...over,
});

function openSong(controls: StageLiveControls, kind: 'gig' | 'rehearsal' = 'rehearsal') {
  const utils = render(
    <StageMode kind={kind} title="Weekly rehearsal" dateLabel="Tue 17 Nov" date="2026-11-17" steps={[]} songs={songs} live={controls} onClose={vi.fn()} />,
  );
  // The song tab (the setlist is the first tab).
  fireEvent.click(within(screen.getByRole('tablist', { name: 'Setlist' })).getAllByRole('tab')[1]);
  return utils;
}

describe('Song only (the clean full-screen song view)', () => {
  it('shows only the song and Show everything, Prev, the click and Next', () => {
    openSong(live());
    fireEvent.click(screen.getByRole('button', { name: 'Song only' }));
    const view = screen.getByRole('dialog', { name: 'Song only: Paper Boats' });
    expect(view).toHaveTextContent('Paper boats on the');
    // Nothing else: no tabs, no title bar, no text size, no notes.
    expect(within(view).queryByRole('tablist')).toBeNull();
    expect(within(view).queryByRole('heading')).toBeNull();
    const names = within(view).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Show everything', 'Previous song', 'Start the click · 96 BPM', 'Next song']);
    // The app's chrome and the system bars go, as in Full screen.
    expect(document.documentElement.hasAttribute(STAGE_FULL_ATTR)).toBe(true);
  });

  it('Prev and Next move through the setlist, the click button runs the synced click', () => {
    const controls = live();
    openSong(controls);
    fireEvent.click(screen.getByRole('button', { name: 'Song only' }));
    const view = screen.getByRole('dialog', { name: 'Song only: Paper Boats' });
    fireEvent.click(within(view).getByRole('button', { name: 'Next song' }));
    expect(controls.go).toHaveBeenCalledWith(1);
    fireEvent.click(within(view).getByRole('button', { name: /^Start the click/ }));
    expect(controls.click!.setOn).toHaveBeenCalledWith(true, expect.objectContaining({ bpm: 96 }));
  });

  it('follows the current song and Prev is off on the first one', () => {
    const { rerender } = openSong(live());
    fireEvent.click(screen.getByRole('button', { name: 'Song only' }));
    expect(within(screen.getByRole('dialog', { name: 'Song only: Paper Boats' })).getByRole('button', { name: 'Previous song' })).toBeDisabled();
    rerender(
      <StageMode kind="rehearsal" title="Weekly rehearsal" dateLabel="Tue 17 Nov" date="2026-11-17" steps={[]} songs={songs} live={live({ index: 1 })} onClose={vi.fn()} />,
    );
    const view = screen.getByRole('dialog', { name: 'Song only: Harbor Lights' });
    expect(view).toHaveTextContent('Harbor lights are');
    expect(within(view).getByRole('button', { name: 'Next song' })).toBeDisabled();
  });

  it('Show everything and system Back return to the full live screen (Stage mode stays open)', () => {
    const onClose = vi.fn();
    render(
      <StageMode title="Rooftop Session" dateLabel="Mon 16 Nov" date="2026-11-16" steps={[]} songs={songs} live={live()} onClose={onClose} />,
    );
    fireEvent.click(within(screen.getByRole('tablist', { name: 'Setlist' })).getAllByRole('tab')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Song only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show everything' }));
    expect(screen.queryByRole('dialog', { name: /^Song only/ })).toBeNull();
    expect(document.documentElement.hasAttribute(STAGE_FULL_ATTR)).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Stage mode: Rooftop Session' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Song only' }));
    act(() => {
      handleBackFromStack();
    });
    expect(screen.queryByRole('dialog', { name: /^Song only/ })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Song only' })).toBeInTheDocument();
  });

  it('page-turner pedals (arrows, Page Up / Down) step through the songs', () => {
    const controls = live();
    openSong(controls);
    fireEvent.click(screen.getByRole('button', { name: 'Song only' }));
    fireEvent.keyDown(window, { key: 'PageDown' });
    expect(controls.go).toHaveBeenLastCalledWith(1);
    // The first song: back has nowhere to go.
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(controls.go).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(controls.go).toHaveBeenCalledTimes(2);
  });
});

describe('Song view names', () => {
  const en = (k: string) => k;
  it('Lyrics · Lyrics & chords · Chord chart: "chords" alone never names the lyrics', () => {
    expect(songViewLabel('lyrics', en)).toBe('Lyrics');
    expect(songViewLabel('chords', en)).toBe('Lyrics & chords');
    expect(songViewLabel('structure', en)).toBe('Chord chart');
  });

  it('is translated in every language', () => {
    for (const [locale, dict] of Object.entries(DICTIONARIES)) {
      for (const k of ['Lyrics & chords', 'Chord chart', 'Song only', 'Song only: {title}', 'Show everything']) {
        expect(dict[k], `${locale}: ${k}`).toBeTruthy();
      }
    }
  });

  it('the live screen shows the new names on its tabs', () => {
    localStorage.setItem('bw-song-view', 'chords');
    openSong(live());
    expect(screen.getAllByRole('tab', { name: 'Lyrics & chords' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: 'Chord chart' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Chords' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Structure' })).toBeNull();
  });
});
