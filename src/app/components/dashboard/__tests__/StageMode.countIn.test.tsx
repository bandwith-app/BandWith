import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));
vi.mock('@/lib/services/countInStyle', () => ({
  getCountInStyle: vi.fn(async () => 'down'),
  setCountInStyle: vi.fn(async () => ({ error: null })),
}));

import { StageMode, type StageLiveControls, type StageSong } from '../StageMode';
import { __resetCountInStyles } from '../StageCountIn';
import { COUNTIN_LEAD_MS, countInPlan, startCountIn, type CountInState } from '@/lib/countIn';
import { meterOf } from '@/lib/meter';
import type { StageRegia } from '@/app/components/event/useStageRegia';
import { setCountInStyle } from '@/lib/services/countInStyle';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  __resetCountInStyles();
});

const songs: StageSong[] = [
  { id: 'r1', songId: 's1', title: 'Harbor Lights', bpm: 120, lyrics: 'Down by the Hudson\nLights on the water', timeSignature: '6/8', countInBars: 2, pickupBeats: 1 },
  { id: 'r2', songId: 's2', title: 'Crazy in Love', bpm: 99, backingTrack: true, lyrics: 'Uh oh' },
  { id: 'r3', songId: 's3', title: 'No Tempo', lyrics: 'La la' },
];

function live(over: Partial<StageLiveControls> = {}, state: CountInState | null = null) {
  const countIn = { state, mine: !!state && state.from === 'me', offset: 0, set: vi.fn() };
  const playhead = { state: null, set: vi.fn(), clientId: 'me' };
  const controls: StageLiveControls = {
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
    click: { state: null, mine: false, offset: 0, setOn: vi.fn() },
    countIn,
    playhead,
    ...over,
  };
  return { controls, countIn, playhead };
}

const stage = (l: StageLiveControls, extra: Partial<React.ComponentProps<typeof StageMode>> = {}) =>
  render(<StageMode title="Gig" dateLabel="Fri" steps={[]} songs={songs} bandId="band-1" live={l} onClose={() => {}} {...extra} />);

describe('Stage mode count-in (plan §6)', () => {
  it('the leader counts the band in: 6/8, two bars, a pickup; Follow the tempo starts at bar 1', () => {
    const { controls, countIn, playhead } = live();
    stage(controls);
    const before = performance.timeOrigin + performance.now();
    fireEvent.click(screen.getByRole('button', { name: 'Count in the band' }));
    const sent = countIn.set.mock.calls[0][0] as CountInState;
    expect(sent).toMatchObject({ on: true, songId: 'r1', bpm: 120, time: '6/8', bars: 2, pickup: 1, style: 'down' });
    expect(sent.startAt - before).toBeGreaterThanOrEqual(COUNTIN_LEAD_MS - 5);
    expect(sent.startAt - before).toBeLessThan(COUNTIN_LEAD_MS + 200);
    const head = playhead.set.mock.calls[0][0];
    expect(head).toMatchObject({ on: true, songId: 'r1', bpm: 120 });
    expect(head.startAt).toBe(sent.startAt + countInPlan(sent).endAt);
  });

  it('no Count in on a backing-track song or while the stage manager plays; the sheet forces one', () => {
    const { controls, countIn } = live({ index: 1 });
    stage(controls);
    expect(screen.queryByRole('button', { name: 'Count in the band' })).toBeNull();
    const regiaPlaying = { on: false, status: 'idle', nowPlaying: { state: { playing: true, songId: 'r1' } } } as unknown as StageRegia;
    cleanup();
    const other = live({ index: 0 });
    stage(other.controls, { regia: regiaPlaying });
    expect(screen.queryByRole('button', { name: 'Count in the band' })).toBeNull();
    cleanup();
    // Forced from the song's count-in sheet.
    stage(controls, { songOpen: true });
    fireEvent.click(screen.getByRole('button', { name: 'Count-in options' }));
    expect(screen.getByText('This song is played with a backing track: the track starts the band.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Count in anyway' }));
    expect(countIn.set).toHaveBeenCalledWith(expect.objectContaining({ on: true, songId: 'r2', bpm: 99 }));
  });

  it('no Count in without a BPM, nor for a member', () => {
    stage(live({ index: 2 }).controls);
    expect(screen.queryByRole('button', { name: 'Count in the band' })).toBeNull();
    cleanup();
    stage(live({ isLeader: false }).controls);
    expect(screen.queryByRole('button', { name: 'Count in the band' })).toBeNull();
  });

  it('the leader sets the band’s direction in the sheet', () => {
    stage(live().controls, { songOpen: true });
    fireEvent.click(screen.getByRole('button', { name: 'Count-in options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Count up: 1 2 3 4' }));
    expect(setCountInStyle).toHaveBeenCalledWith('band-1', 'up');
    expect(screen.getByRole('button', { name: 'Count up: 1 2 3 4' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('every phone shows the countdown full screen on the shared clock; a member can hide it, the leader stops it', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] });
    const now = performance.timeOrigin + performance.now();
    const state = startCountIn({ from: 'leader', songId: 'r1', bpm: 120, meter: meterOf('4/4'), now });
    const member = live({ isLeader: false }, state);
    stage(member.controls);
    const dialog = screen.getByRole('dialog', { name: 'Count-in · Harbor Lights' });
    act(() => void vi.advanceTimersByTime(COUNTIN_LEAD_MS + 20));
    expect(screen.getByTestId('countin-number').textContent).toBe('4');
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('countin-number').textContent).toBe('2');
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('countin-number').textContent).toBe('GO');
    expect(dialog.getAttribute('data-stage')).toBe('go');
    act(() => void vi.advanceTimersByTime(800));
    expect(screen.queryByRole('dialog', { name: /Count-in/ })).toBeNull();
    cleanup();
    // Hide on this phone (member) / Stop for everyone (leader).
    const again = startCountIn({ from: 'leader', songId: 'r1', bpm: 120, meter: meterOf('4/4'), now: performance.timeOrigin + performance.now() });
    stage(live({ isLeader: false }, again).controls);
    fireEvent.click(screen.getByRole('button', { name: 'Hide on this phone' }));
    expect(screen.queryByRole('dialog', { name: /Count-in/ })).toBeNull();
    cleanup();
    const mine = { ...again, from: 'me' };
    const leader = live({}, mine);
    stage(leader.controls);
    // On the countdown and in place of Count in, by the click.
    expect(screen.getAllByRole('button', { name: 'Stop the count-in' })).toHaveLength(2);
    fireEvent.click(within(screen.getByRole('dialog', { name: /Count-in/ })).getByRole('button', { name: 'Stop the count-in' }));
    expect(leader.countIn.set).toHaveBeenCalledWith(expect.objectContaining({ on: false, seq: mine.seq + 1 }));
  });
});
