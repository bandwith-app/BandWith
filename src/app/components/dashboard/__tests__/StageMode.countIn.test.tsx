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
  const playhead = { state: null, mine: false, offset: 0, set: vi.fn(), clientId: 'me' };
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
    const after = performance.timeOrigin + performance.now();
    const sent = countIn.set.mock.calls[0][0] as CountInState;
    expect(sent).toMatchObject({ on: true, songId: 'r1', bpm: 120, time: '6/8', bars: 2, pickup: 1, style: 'down' });
    // 1.5 s after the tap.
    expect(sent.startAt).toBeGreaterThanOrEqual(before + COUNTIN_LEAD_MS - 1);
    expect(sent.startAt).toBeLessThanOrEqual(after + COUNTIN_LEAD_MS + 1);
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
    stage(controls);
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
    stage(live().controls);
    // Found by its name, not a second stopwatch next to Count in.
    expect(screen.getByRole('button', { name: 'Count-in options' })).toHaveTextContent('Count-in');
    fireEvent.click(screen.getByRole('button', { name: 'Count-in options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Count up: 1 2 3 4' }));
    expect(setCountInStyle).toHaveBeenCalledWith('band-1', 'up');
    expect(screen.getByRole('button', { name: 'Count up: 1 2 3 4' }).getAttribute('aria-pressed')).toBe('true');
    // This phone: vibration on; the speaker only once a sound is chosen.
    const vibrate = screen.getByRole('switch', { name: /Vibrate on every beat/ });
    fireEvent.click(vibrate);
    expect(vibrate.getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('switch', { name: /phone’s speaker/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Click' }));
    expect((screen.getByRole('switch', { name: /phone’s speaker/ }) as HTMLButtonElement).disabled).toBe(false);
    // In a browser (no output route known) the hint says what to do there, in plain words.
    expect(screen.getByText('In a browser, turn this on to hear the count, also in headphones.')).toBeInTheDocument();
    localStorage.clear();
  });

  it('each number carries the moment of its beat on this phone (the leader’s clock, through the offset)', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] });
    const now = performance.timeOrigin + performance.now();
    const state = startCountIn({ from: 'leader', songId: 'r1', bpm: 120, meter: meterOf('4/4'), now });
    const member = live({ isLeader: false }, state);
    // The leader's clock runs 40 ms ahead of this phone's.
    member.controls.countIn!.offset = 40;
    stage(member.controls);
    const beat = (i: number) => String(Math.round(state.startAt + countInPlan(state).events[i].at - 40));
    act(() => void vi.advanceTimersByTime(COUNTIN_LEAD_MS + 20));
    const num = screen.getByTestId('countin-number');
    expect(num.textContent).toBe('4');
    expect(num.dataset.at).toBe(beat(0));
    act(() => void vi.advanceTimersByTime(500));
    expect(num.textContent).toBe('3');
    expect(num.dataset.at).toBe(beat(1));
    act(() => void vi.advanceTimersByTime(1500));
    expect(num.textContent).toBe('GO');
    expect(num.dataset.at).toBe(beat(4));
  });

  it('every phone shows the countdown full screen on the shared clock; a member can hide it, the leader stops it', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] });
    const now = performance.timeOrigin + performance.now();
    const state = startCountIn({ from: 'leader', songId: 'r1', bpm: 120, meter: meterOf('4/4'), now });
    const member = live({ isLeader: false }, state);
    stage(member.controls);
    const dialog = screen.getByRole('dialog', { name: 'Count-in · Harbor Lights' });
    // Over the app's pop-ups (urgent alerts 182–183, poll and RSVP sheets 184–185), under the Duo rail (190).
    expect(dialog.className).toContain('z-[186]');
    // Sized to the pane it sits on (a Duo pane), never to the whole screen.
    const ring = dialog.querySelector('svg')!.parentElement as HTMLElement;
    expect(ring.style.getPropertyValue('--bw-countin-ring')).toMatch(/^min\(\d+cqmin, \d+px\)$/);
    act(() => void vi.advanceTimersByTime(COUNTIN_LEAD_MS + 20));
    expect(screen.getByTestId('countin-number').textContent).toBe('4');
    // Each beat pulses the whole screen (readable from the back of the stage), then fades.
    const flash = () => Number(screen.getByTestId('countin-flash').style.opacity);
    expect(flash()).toBeGreaterThan(0.12);
    act(() => void vi.advanceTimersByTime(400));
    expect(flash()).toBeLessThan(0.03);
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('countin-number').textContent).toBe('2');
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByTestId('countin-number').textContent).toBe('GO');
    expect(dialog.getAttribute('data-stage')).toBe('go');
    // The band is playing: the stage is visible and usable under GO.
    expect(dialog.className).toContain('pointer-events-none');
    expect(dialog.className).not.toContain('bg-black');
    expect(screen.queryByRole('button', { name: 'Hide on this phone' })).toBeNull();
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
    const stopped = leader.countIn.set.mock.calls[0][0] as CountInState;
    expect(stopped).toMatchObject({ on: false, songId: 'r1' });
    expect(stopped.seq).toBeGreaterThan(mine.seq);
  });
});
