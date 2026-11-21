import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// The score itself is ScoreView's (its own test): here, only that the song views reach it.
vi.mock('../ScoreView', () => ({
  ScoreView: ({ scoreRef, title, size }: { scoreRef: string; title: string; size: number }) => (
    <div data-testid="score" data-ref={scoreRef} data-title={title} data-size={size} />
  ),
}));

import { SongBody, SongViewTabs, songViewLabel } from '../SongViews';

const SONG = { title: 'Harbor Lights', lyrics: '# Verse\n[G]Harbor lights', score: 'demo://scores/harbor-lights.musicxml' };

describe('the Score view in the song views', () => {
  afterEach(cleanup);

  it('is a tab next to Lyrics, Lyrics & chords and Chord chart', () => {
    const pick = vi.fn();
    render(<SongViewTabs song={SONG} view="lyrics" onChange={pick} />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Lyrics', 'Lyrics & chords', 'Chord chart', 'Score']);
    fireEvent.click(screen.getByRole('tab', { name: 'Score' }));
    expect(pick).toHaveBeenCalledWith('score');
    expect(songViewLabel('score', (k) => k)).toBe('Score');
  });

  it('shows the score of the song, at the reader size', () => {
    render(<SongBody song={SONG} view="score" size={30} />);
    const score = screen.getByTestId('score');
    expect(score).toHaveAttribute('data-ref', SONG.score);
    expect(score).toHaveAttribute('data-title', 'Harbor Lights');
    expect(score).toHaveAttribute('data-size', '30');
  });

  it('shows the chart for a song without a score, even when the reader last picked Score', () => {
    render(<SongBody song={{ lyrics: SONG.lyrics }} view="score" size={30} />);
    expect(screen.queryByTestId('score')).toBeNull();
  });
});
