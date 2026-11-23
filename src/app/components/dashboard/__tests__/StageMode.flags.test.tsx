import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
vi.mock('@/lib/services/countInStyle', () => ({
  getCountInStyle: vi.fn(async () => 'down'),
  setCountInStyle: vi.fn(async () => ({ error: null })),
}));

import { StageMode, type StageLiveControls, type StageSong } from '../StageMode';
import { __resetCountInStyles } from '../StageCountIn';
import { FOLLOW_TEMPO_KEY } from '../StageFollow';
import { __resetAppFlagsForTest, __setAppFlagsForTest } from '@/lib/appFlags';
import { startCountIn, type CountInState } from '@/lib/countIn';
import { startPlayhead, type PlayheadState } from '@/lib/playhead';
import { nowMs } from '@/lib/stageClick';
import { meterOf } from '@/lib/meter';

/**
 * The count_in and follow_tempo kill switches (app_flags, docs/flags.md) on
 * the Stage screen: off, the feature's controls and its display are not
 * there, for the leader and for a member; flipped while Stage is open, they
 * go (and come back) without closing Stage.
 */

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

beforeEach(() => {
  localStorage.clear();
  __resetAppFlagsForTest(null);
  // Lyrics & chords: the lyrics with their chords (as StageMode.follow.test.tsx).
  localStorage.setItem('bw-song-view', 'chords');
});
afterEach(() => {
  cleanup();
  __resetCountInStyles();
  __resetAppFlagsForTest(null);
});

// 4/4 at 120: a bar is 2 s. Verse (4 bars, two lines) · Chorus (2 bars, two lines).
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
const lyrics = '# Verse\n[C]Walking down to [F]Canal Street\n[G]The train is running [C]late\n# Chorus\n[F]Hold on\n[G]Hold on tight';
const songs: StageSong[] = [
  { id: 'r1', songId: 's1', title: 'Canal Street', key: 'C', bpm: 120, lyrics, chart },
  { id: 'r2', songId: 's2', title: 'Crazy in Love', bpm: 99, backingTrack: true, lyrics: 'Uh oh' },
];

const controls = (over: Partial<StageLiveControls> = {}, state: { count?: CountInState | null; head?: PlayheadState | null } = {}): StageLiveControls => ({
  index: 0,
  select: vi.fn(),
  go: vi.fn(),
  following: true,
  setFollowing: vi.fn(),
  leaderSeen: true,
  connected: true,
  isLeader: true,
  canReorder: false,
  move: vi.fn(),
  saveState: 'idle',
  skipped: new Set(),
  click: { state: null, mine: false, offset: 0, setOn: vi.fn() },
  countIn: { state: state.count ?? null, mine: !!state.count && state.count.from === 'me', offset: 0, set: vi.fn() },
  playhead: { state: state.head ?? null, mine: !!state.head && state.head.from === 'me', offset: 0, set: vi.fn(), clientId: 'me' },
  ...over,
});
const Stage: React.FC<{ live: StageLiveControls }> = ({ live }) => (
  <StageMode title="Friday at the Bowery" dateLabel="Fri 27 Nov" date="2026-11-27" steps={[]} songs={songs} bandId="band-1" live={live} onClose={vi.fn()} />
);
const openSong = () => fireEvent.click(within(screen.getByRole('tablist', { name: 'Setlist' })).getAllByRole('tab')[1]);
const counting = (from: string) => startCountIn({ from, songId: 'r1', bpm: 120, meter: meterOf('4/4'), now: nowMs() });
const playing = (from: string, ms = 2_500) => startPlayhead({ from, songId: 'r1', bpm: 120, startAt: nowMs() - ms });

describe('count_in switched off: Stage', () => {
  it('on (the default, also with nothing read from the server): the leader has Count in and its options', () => {
    render(<Stage live={controls()} />);
    expect(screen.getByRole('button', { name: 'Count in the band' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Count-in options' })).toBeTruthy();
  });

  it('off: no Count in, no Count-in options (so no "Count in anyway" either), for the leader and for a member', () => {
    act(() => __setAppFlagsForTest({ count_in: false }));
    const leader = controls();
    render(<Stage live={leader} />);
    expect(screen.queryByRole('button', { name: 'Count in the band' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Count-in options' })).toBeNull();
    cleanup();
    // The backing-track song, where the sheet's "Count in anyway" would be.
    render(<Stage live={controls({ index: 1 })} />);
    expect(screen.queryByRole('button', { name: 'Count-in options' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Count in anyway' })).toBeNull();
    cleanup();
    render(<Stage live={controls({ isLeader: false })} />);
    expect(screen.queryByRole('button', { name: 'Count-in options' })).toBeNull();
  });

  it('off: no countdown is drawn, whatever state reaches the screen (a member’s, or the leader’s own)', () => {
    act(() => __setAppFlagsForTest({ count_in: false }));
    render(<Stage live={controls({ isLeader: false }, { count: counting('leader') })} />);
    expect(screen.queryByRole('dialog', { name: /Count-in/ })).toBeNull();
    cleanup();
    render(<Stage live={controls({}, { count: counting('me') })} />);
    expect(screen.queryByRole('dialog', { name: /Count-in/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop the count-in' })).toBeNull();
  });

  it('switched off while the countdown is on screen, and while its options are open: both go; back on, the controls return', () => {
    const member = controls({ isLeader: false }, { count: counting('leader') });
    const { rerender } = render(<Stage live={member} />);
    expect(screen.getByRole('dialog', { name: /Count-in/ })).toBeTruthy();
    act(() => __setAppFlagsForTest({ count_in: false }));
    expect(screen.queryByRole('dialog', { name: /Count-in/ })).toBeNull();
    // The options sheet, open on the leader's phone when the switch flips.
    const leader = controls();
    rerender(<Stage live={leader} />);
    act(() => __setAppFlagsForTest({ count_in: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Count-in options' }));
    expect(screen.getByRole('dialog', { name: 'Count-in' })).toBeTruthy();
    act(() => __setAppFlagsForTest({ count_in: false }));
    expect(screen.queryByRole('dialog', { name: 'Count-in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Count in the band' })).toBeNull();
    act(() => __setAppFlagsForTest({ count_in: true }));
    expect(screen.getByRole('button', { name: 'Count in the band' })).toBeTruthy();
    // Stage itself never closed.
    expect(screen.getByRole('dialog', { name: 'Stage mode: Friday at the Bowery' })).toBeTruthy();
  });

  it('leaves Follow the tempo where it is', () => {
    act(() => __setAppFlagsForTest({ count_in: false }));
    render(<Stage live={controls()} />);
    openSong();
    expect(screen.getByRole('switch', { name: 'Follow the tempo' })).toBeTruthy();
  });
});

describe('follow_tempo switched off: Stage', () => {
  beforeEach(() => localStorage.setItem(FOLLOW_TEMPO_KEY, '1'));

  it('on (the default): the switch, the strip and the leader’s Start are there', () => {
    render(<Stage live={controls()} />);
    openSong();
    expect(screen.getByRole('switch', { name: 'Follow the tempo' })).toBeTruthy();
    expect(document.querySelector('[data-follow-strip]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
  });

  it('off: no switch, no strip, no Start / Hold / Stop, nothing lit, for the leader and for a member, even while a playhead runs', () => {
    act(() => __setAppFlagsForTest({ follow_tempo: false }));
    render(<Stage live={controls({}, { head: playing('me') })} />);
    openSong();
    expect(screen.queryByRole('switch', { name: 'Follow the tempo' })).toBeNull();
    expect(document.querySelector('[data-follow-strip]')).toBeNull();
    for (const name of ['Start', 'Hold', 'Let go', 'Go on', 'Stop']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(document.querySelector('[data-follow-now]')).toBeNull();
    expect(document.querySelector('[data-follow-on]')).toBeNull();
    cleanup();
    render(<Stage live={controls({ isLeader: false }, { head: playing('leader') })} />);
    openSong();
    expect(screen.queryByRole('switch', { name: 'Follow the tempo' })).toBeNull();
    expect(document.querySelector('[data-follow-strip]')).toBeNull();
    expect(document.querySelector('[data-follow-now]')).toBeNull();
  });

  it('off: a tap on the song moves nobody (the leader’s re-align is part of it)', () => {
    act(() => __setAppFlagsForTest({ follow_tempo: false }));
    const leader = controls({}, { head: playing('me') });
    render(<Stage live={leader} />);
    openSong();
    fireEvent.click(document.querySelector('[data-line="1:0"]')!);
    expect(leader.playhead!.set).not.toHaveBeenCalled();
  });

  it('switched off mid-song: the lit line and the strip go, the song stays on screen; back on, they return and the device’s own choice is kept', () => {
    render(<Stage live={controls({ isLeader: false }, { head: playing('leader') })} />);
    openSong();
    expect(screen.getByText('Next: Chorus in 3 bars')).toBeTruthy();
    expect(document.querySelector('[data-line="0:0"]')?.hasAttribute('data-follow-now')).toBe(true);
    act(() => __setAppFlagsForTest({ follow_tempo: false }));
    expect(screen.queryByText('Next: Chorus in 3 bars')).toBeNull();
    expect(document.querySelector('[data-follow-now]')).toBeNull();
    expect(document.querySelector('[data-follow-strip]')).toBeNull();
    // The song is still there to read.
    expect(document.querySelector('[data-line="0:0"]')).not.toBeNull();
    // Nothing saved was touched: back on, this phone still follows.
    expect(localStorage.getItem(FOLLOW_TEMPO_KEY)).toBe('1');
    act(() => __setAppFlagsForTest({ follow_tempo: true }));
    expect(screen.getByRole('switch', { name: 'Follow the tempo' }).getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[data-follow-strip]')).not.toBeNull();
  });

  it('leaves the count-in where it is', () => {
    act(() => __setAppFlagsForTest({ follow_tempo: false }));
    render(<Stage live={controls()} />);
    expect(screen.getByRole('button', { name: 'Count in the band' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Count-in options' })).toBeTruthy();
  });
});
