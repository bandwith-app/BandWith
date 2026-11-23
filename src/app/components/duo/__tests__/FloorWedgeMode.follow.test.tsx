import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

import { computePosture, updatePosture, LAPTOP_POSE_PREF, SETTLE_MS } from '@/lib/posture';
import { setStageSongOnly } from '@/lib/stageChrome';
import { nowMs } from '@/lib/stageClick';
import { startPlayhead, type PlayheadState } from '@/lib/playhead';
import { FloorWedgeMode } from '../modes/FloorWedgeMode';
import { FOLLOW_TEMPO_KEY } from '@/app/components/dashboard/StageFollow';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const tabletop = () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  act(() => {
    updatePosture(computePosture({ viewport: { w: 669, h: 900 }, division: { x: 0, y: 440, w: 669, h: 20 }, hinge: 'half-open' }));
  });
  act(() => {
    vi.advanceTimersByTime(SETTLE_MS);
  });
  vi.useRealTimers();
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('bw-song-view', 'chords');
});
afterEach(() => {
  cleanup();
  act(() => setStageSongOnly(false));
  act(() => {
    updatePosture(computePosture({ viewport: { w: 393, h: 852 } }));
  });
  localStorage.removeItem(LAPTOP_POSE_PREF);
});

// 4/4 at 120: 2 s a bar. Verse 4 bars, Chorus 2.
const chart = {
  v: 1 as const,
  source: 'ireal' as const,
  title: 'Canal Street',
  time: '4/4',
  sections: [
    { label: 'Verse', bars: [{ chords: ['C'] }, { chords: ['F'] }, { chords: ['G'] }, { chords: ['C'] }] },
    { label: 'Chorus', bars: [{ chords: ['F'] }, { chords: ['G'] }] },
  ],
};
const songs = [
  { id: 'r1', title: 'Canal Street', key: 'C', bpm: 120, chart, lyrics: '# Verse\n[C]Walking down to Canal Street\n# Chorus\n[F]Hold on' },
  { id: 'r2', title: 'Harbor Lights', key: 'G', lyrics: '[G]Harbor lights are [D]calling' },
];
const playing = (ms: number): PlayheadState => startPlayhead({ from: 'leader', songId: 'r1', bpm: 120, startAt: nowMs() - ms });
const follow = (isLeader: boolean) => ({ isLeader, following: true, leaderSeen: true, connected: true, onToggle: vi.fn() });

describe('Laptop pose: Follow the tempo on the floor wedge', () => {
  it('shows a big “Chorus in 3” instead of the lyrics', () => {
    localStorage.setItem(FOLLOW_TEMPO_KEY, '1');
    tabletop();
    render(
      <FloorWedgeMode
        songs={songs}
        lyricsOn
        follow={follow(false)}
        playhead={{ state: playing(2_500), mine: false, offset: 0, set: vi.fn(), clientId: 'me' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Chorus in 3')).toBeInTheDocument();
    expect(screen.getByText('Now: Verse')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Walking down to');
    // A member: no buttons to move it.
    expect(screen.queryByRole('button', { name: 'Hold' })).toBeNull();
  });

  it('in Song only too', () => {
    localStorage.setItem(FOLLOW_TEMPO_KEY, '1');
    tabletop();
    act(() => setStageSongOnly(true));
    render(
      <FloorWedgeMode songs={songs} lyricsOn follow={follow(false)} playhead={{ state: playing(2_500), mine: false, offset: 0, set: vi.fn(), clientId: 'me' }} onClose={vi.fn()} />,
    );
    expect(screen.getByText('Chorus in 3')).toBeInTheDocument();
  });

  it('switched off: the lyrics as today', () => {
    tabletop();
    render(
      <FloorWedgeMode songs={songs} lyricsOn follow={follow(false)} playhead={{ state: playing(2_500), mine: false, offset: 0, set: vi.fn(), clientId: 'me' }} onClose={vi.fn()} />,
    );
    expect(screen.queryByText('Chorus in 3')).toBeNull();
    expect(document.body.textContent).toContain('Walking down to');
    // The switch is on the Deck, off.
    fireEvent.click(screen.getByRole('switch', { name: 'Follow the tempo' }));
    expect(screen.getByText('Chorus in 3')).toBeInTheDocument();
  });

  it('the leader gets Hold and Stop on the Deck', () => {
    localStorage.setItem(FOLLOW_TEMPO_KEY, '1');
    tabletop();
    const set = vi.fn();
    render(<FloorWedgeMode songs={songs} lyricsOn follow={follow(true)} playhead={{ state: playing(2_500), mine: true, offset: 0, set, clientId: 'me' }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hold' }));
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ hold: [0, 3] }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(set).toHaveBeenLastCalledWith(expect.objectContaining({ on: false }));
  });
});
