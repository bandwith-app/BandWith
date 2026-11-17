import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

import { StageMode, type StageLiveControls, type StageSong } from '../StageMode';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);

const songs: StageSong[] = [
  { id: 'r1', songId: 's1', title: 'Paper Boats', key: 'C', bpm: 96, lyrics: '[C]Paper boats on the [G]river' },
  { id: 'r2', songId: 's2', title: 'Superstition', key: 'Ebm', bpm: 100 },
];

/** The admin's live controls (leader, can reorder and strike). */
const leader = (): StageLiveControls => ({
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
  canStrike: true,
  toggleSkip: vi.fn(),
});

const STEPS = [
  { label: 'Load in', time: '17:00', display: 'TBD' },
  { label: 'Soundcheck', time: '18:30', display: 'TBD' },
  { label: 'Show', time: '21:00', display: 'TBD' },
  { label: 'End', time: '23:30', display: 'TBD' },
];

describe('Stage mode on a rehearsal (live mode)', () => {
  it('is called Live mode, has no run of show and nothing to strike off for tonight', () => {
    render(
      <StageMode kind="rehearsal" title="Weekly rehearsal" dateLabel="Tue 17 Nov" date="2026-11-17" steps={[]} songs={songs} live={leader()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('dialog', { name: 'Live mode: Weekly rehearsal' })).toBeInTheDocument();
    expect(screen.getByText('Live mode · Tue 17 Nov')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Run of show' })).toBeNull();
    expect(screen.queryByText('Load in')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Strike Paper Boats off tonight' })).toBeNull();
    // The live core stays: the songs, Prev / Next, the leader's status.
    expect(screen.getByText('Paper Boats')).toBeInTheDocument();
    expect(screen.getByText('Superstition')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next song' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Exit live mode' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Exit stage mode' })).toBeNull();
  });

  it('says when no focus songs were picked', () => {
    render(<StageMode kind="rehearsal" title="New songs rehearsal" dateLabel="Tue 24 Nov" steps={[]} songs={[]} onClose={vi.fn()} />);
    expect(screen.getByText('No songs picked for this rehearsal yet.')).toBeInTheDocument();
    expect(screen.queryByText('No setlist attached to this gig.')).toBeNull();
  });
});

describe('Stage mode on a gig (unchanged)', () => {
  it('keeps its name, the run of show and striking songs off for tonight', () => {
    render(
      <StageMode title="Rooftop Session" dateLabel="Mon 16 Nov" date="2026-11-16" steps={STEPS} songs={songs} live={leader()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole('dialog', { name: 'Stage mode: Rooftop Session' })).toBeInTheDocument();
    expect(screen.getByText('Stage mode · Mon 16 Nov')).toBeInTheDocument();
    const run = screen.getByRole('list', { name: 'Run of show' });
    for (const label of ['Load in', 'Soundcheck', 'End']) expect(run).toHaveTextContent(label);
    expect(screen.getByRole('button', { name: 'Strike Paper Boats off tonight' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Exit stage mode' }).length).toBeGreaterThan(0);
  });

  it('with no setlist says so for the gig', () => {
    render(<StageMode title="Rooftop Session" dateLabel="Mon 16 Nov" steps={STEPS} songs={[]} onClose={vi.fn()} />);
    expect(screen.getByText('No setlist attached to this gig.')).toBeInTheDocument();
  });
});
