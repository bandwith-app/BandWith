import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

import { StageMode, type StageLiveControls, type StageSong } from '../StageMode';
import { STAGE_FULL_ATTR } from '@/lib/stageChrome';
import { nowMs } from '@/lib/stageClick';
import { startPlayhead, type PlayheadState } from '@/lib/playhead';
import { FOLLOW_TEMPO_KEY } from '../StageFollow';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute(STAGE_FULL_ATTR);
  // Lyrics & chords: the lyrics with their chords.
  localStorage.setItem('bw-song-view', 'chords');
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
  { id: 'r2', songId: 's2', title: 'Harbor Lights', key: 'G', lyrics: '[G]Harbor lights are [D]calling' },
];

/** Playing since `ms` ago, on the first song. */
const playing = (ms: number, over: Partial<PlayheadState> = {}): PlayheadState => ({
  ...startPlayhead({ from: 'leader-phone', songId: 'r1', bpm: 120, startAt: nowMs() - ms }),
  ...over,
});

const live = (over: Partial<StageLiveControls> = {}): StageLiveControls => ({
  index: 0,
  select: vi.fn(),
  go: vi.fn(),
  following: true,
  setFollowing: vi.fn(),
  leaderSeen: true,
  connected: true,
  isLeader: false,
  canReorder: false,
  move: vi.fn(),
  saveState: 'idle',
  skipped: new Set(),
  click: { state: null, mine: false, offset: 0, setOn: vi.fn() },
  ...over,
});

const member = (state: PlayheadState | null, set = vi.fn()) =>
  live({ playhead: { state, mine: false, offset: 0, set, clientId: 'member-phone' } });

function Stage({ controls, kind = 'gig', index = 0 }: { controls: StageLiveControls; kind?: 'gig' | 'rehearsal'; index?: number }) {
  return (
    <StageMode kind={kind} title="Friday at the Bowery" dateLabel="Fri 27 Nov" date="2026-11-27" steps={[]} songs={songs} live={{ ...controls, index }} onClose={vi.fn()} />
  );
}

/** The leader's phone: the playhead it sets is the one it shows. */
function LeaderStage({ initial = null, onSet }: { initial?: PlayheadState | null; onSet?: (s: PlayheadState) => void }) {
  const [state, setState] = useState<PlayheadState | null>(initial);
  const controls = live({
    isLeader: true,
    playhead: {
      state,
      mine: true,
      offset: 0,
      clientId: 'leader-phone',
      set: (next) => {
        const s = { ...next, from: 'leader-phone' };
        onSet?.(s);
        setState(s);
      },
    },
  });
  return <Stage controls={controls} />;
}

const openSong = () => fireEvent.click(within(screen.getByRole('tablist', { name: 'Setlist' })).getAllByRole('tab')[1]);
const followSwitch = () => screen.getByRole('switch', { name: 'Follow the tempo' });
const lit = (sel: string) => document.querySelector(sel)?.hasAttribute('data-follow-now') ?? false;

describe('Follow the tempo: the switch', () => {
  it('is off by default, per device, and remembered', () => {
    const { unmount } = render(<Stage controls={member(null)} />);
    openSong();
    expect(followSwitch()).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(followSwitch());
    expect(followSwitch()).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem(FOLLOW_TEMPO_KEY)).toBe('1');
    unmount();
    render(<Stage controls={member(null)} />);
    openSong();
    expect(followSwitch()).toHaveAttribute('aria-checked', 'true');
  });

  it('is disabled on a song with no BPM, saying why', () => {
    render(<Stage controls={member(null)} index={1} />);
    openSong();
    expect(followSwitch()).toBeDisabled();
    expect(screen.getByText('Add a BPM to follow this song')).toBeInTheDocument();
  });

  it('off: nothing changes, even while the leader plays', () => {
    render(<Stage controls={member(playing(2_500))} />);
    openSong();
    expect(screen.queryByText(/Next:/)).toBeNull();
    expect(document.querySelector('[data-follow-now]')).toBeNull();
    expect(document.querySelector('[data-follow-on]')).toBeNull();
  });

  it('is not there without a live Stage (nothing to follow)', () => {
    const { playhead: _none, ...noPlayhead } = member(null);
    render(<Stage controls={noPlayhead} />);
    openSong();
    expect(screen.queryByRole('switch', { name: 'Follow the tempo' })).toBeNull();
  });
});

describe('Follow the tempo: a member', () => {
  beforeEach(() => localStorage.setItem(FOLLOW_TEMPO_KEY, '1'));

  it('waits for the leader, then shows the next section and lights the line being sung', () => {
    const { rerender } = render(<Stage controls={member(null)} />);
    openSong();
    expect(screen.getByText('Starts when the leader starts the song')).toBeInTheDocument();
    // Bar 2 of the verse: the first line, the chorus in 3 bars.
    rerender(<Stage controls={member(playing(2_500))} />);
    expect(screen.getByText('Next: Chorus in 3 bars')).toBeInTheDocument();
    expect(lit('[data-line="0:0"]')).toBe(true);
    expect(lit('[data-line="0:1"]')).toBe(false);
  });

  it('moves on with the song: the next line, then the chorus', () => {
    render(<Stage controls={member(playing(4_500))} />);
    openSong();
    expect(lit('[data-line="0:1"]')).toBe(true);
    expect(screen.getByText('Next: Chorus in 2 bars')).toBeInTheDocument();
  });

  it('can’t move the shared playhead: no buttons, a tap does nothing', () => {
    const set = vi.fn();
    render(<Stage controls={member(playing(2_500), set)} />);
    openSong();
    expect(screen.queryByRole('button', { name: 'Hold' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    fireEvent.click(document.querySelector('[data-line="1:0"]')!);
    expect(set).not.toHaveBeenCalled();
  });

  it('a playhead on another song lights nothing here', () => {
    render(<Stage controls={member(playing(2_500, { songId: 'r2' }))} />);
    openSong();
    expect(document.querySelector('[data-follow-now]')).toBeNull();
  });

  it('chord chart: the bar being played lights up, with its section', () => {
    localStorage.setItem('bw-song-view', 'structure');
    render(<Stage controls={member(playing(2_500))} />);
    openSong();
    expect(lit('[data-cell="0:1"]')).toBe(true);
    expect(lit('[data-cell="0:0"]')).toBe(false);
    expect(lit('[data-chart-section="0"]')).toBe(true);
  });

  it('a fermata: one state, waiting for the leader', () => {
    const held = { ...chart, sections: [chart.sections[0], { label: 'Chorus', bars: [{ chords: ['F'] }, { chords: ['G'], fermata: true }] }] };
    const one: StageSong[] = [{ ...songs[0], chart: held }];
    render(<StageMode title="Friday" dateLabel="Fri" steps={[]} songs={one} live={member(playing(60_000))} onClose={vi.fn()} />);
    openSong();
    expect(screen.getByText('Waiting for the leader')).toBeInTheDocument();
  });

  it('rehearsal Live mode: the same', () => {
    render(<Stage controls={member(playing(2_500))} kind="rehearsal" />);
    openSong();
    expect(screen.getByText('Next: Chorus in 3 bars')).toBeInTheDocument();
    expect(lit('[data-line="0:0"]')).toBe(true);
  });

  it('Song only: the same line above the song, the line lit', () => {
    render(<Stage controls={member(playing(2_500))} />);
    openSong();
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    const view = screen.getByRole('dialog', { name: 'Song only: Canal Street' });
    expect(within(view).getByText('Next: Chorus in 3 bars')).toBeInTheDocument();
    expect(view.querySelector('[data-line="0:0"]')?.hasAttribute('data-follow-now')).toBe(true);
  });
});

describe('Follow the tempo: the leader', () => {
  beforeEach(() => localStorage.setItem(FOLLOW_TEMPO_KEY, '1'));

  it('Start sends the playhead for this song; the band gets a bar to get ready', () => {
    const sent: PlayheadState[] = [];
    render(<LeaderStage onSet={(s) => sent.push(s)} />);
    openSong();
    expect(screen.getByText('The band follows when you start')).toBeInTheDocument();
    const before = nowMs();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(sent[0]).toMatchObject({ on: true, songId: 'r1', bpm: 120, bar: 0, hold: null });
    expect(sent[0].startAt).toBeGreaterThanOrEqual(before + 700 + 2_000);
    expect(screen.getByText('Starting…')).toBeInTheDocument();
    // How to re-align, said while bar 1 is coming.
    expect(screen.getByText('Tap a bar, line or section to move everyone there.')).toBeInTheDocument();
  });

  it('Hold repeats the section until Let go; Stop ends it', () => {
    const sent: PlayheadState[] = [];
    render(<LeaderStage initial={playing(2_500, { from: 'leader-phone' })} onSet={(s) => sent.push(s)} />);
    openSong();
    // In the song, the hint gives the room back.
    expect(screen.queryByText('Tap a bar, line or section to move everyone there.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hold' }));
    expect(sent[sent.length - 1]?.hold).toEqual([0, 3]);
    expect(screen.getByText('Repeating Verse until the leader lets go')).toBeInTheDocument();
    const letGo = screen.getByRole('button', { name: 'Let go' });
    expect(letGo).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(letGo);
    expect(sent[sent.length - 1]?.hold).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(sent[sent.length - 1]?.on).toBe(false);
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(document.querySelector('[data-follow-now]')).toBeNull();
  });

  it('a tap on a line moves everyone there: that line’s bar starts now', () => {
    const sent: PlayheadState[] = [];
    render(<LeaderStage initial={playing(2_500, { from: 'leader-phone' })} onSet={(s) => sent.push(s)} />);
    openSong();
    const now = nowMs();
    // "Hold on tight": the chorus' second line, bar 6 (index 5).
    act(() => {
      fireEvent.click(document.querySelector('[data-line="1:1"]')!);
    });
    expect(sent[sent.length - 1]).toMatchObject({ on: true, bar: 5 });
    expect(Math.abs(sent[sent.length - 1]!.startAt - now)).toBeLessThan(500);
    expect(lit('[data-line="1:1"]')).toBe(true);
    expect(screen.getByText('Last section: Chorus')).toBeInTheDocument();
  });

  it('a tap on a bar or a section heading of the chart, too', () => {
    localStorage.setItem('bw-song-view', 'structure');
    const sent: PlayheadState[] = [];
    render(<LeaderStage initial={playing(500, { from: 'leader-phone' })} onSet={(s) => sent.push(s)} />);
    openSong();
    fireEvent.click(document.querySelector('[data-cell="0:2"]')!);
    expect(sent[sent.length - 1]?.bar).toBe(2);
    fireEvent.click(document.querySelector('[data-chart-section="1"] h3')!);
    expect(sent[sent.length - 1]?.bar).toBe(4);
  });
});
