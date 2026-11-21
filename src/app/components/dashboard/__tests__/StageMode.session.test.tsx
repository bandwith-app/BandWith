import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

import { StageMode, type StageSong } from '../StageMode';
import type { RehearsalSessionControls } from '@/app/components/event/useRehearsalSession';
import { endSession, markPlayed, pauseSession, sessionStatus, startSession, type SessionState } from '@/lib/rehearsalSession';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// The clock is fixed for each test: the timer reads Date.now() when it renders,
// so a busy machine (the whole suite at once) could otherwise turn 47:23 into
// 47:24. Only Date is faked; timeouts stay real for waitFor and the fades.
const NOW = new Date('2026-11-19T20:00:00Z').getTime();
let T0 = NOW - 47 * 60_000 - 23_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  T0 = Date.now() - 47 * 60_000 - 23_000;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const songs: StageSong[] = [
  { id: 'r1', songId: 's1', title: 'Paper Boats' },
  { id: 'r2', songId: 's2', title: 'Superstition' },
  { id: 'r3', songId: 's3', title: 'Harbor Lights' },
];

const session = (state: SessionState | null, over: Partial<RehearsalSessionControls> = {}): RehearsalSessionControls => ({
  enabled: true,
  ready: true,
  state,
  status: sessionStatus(state),
  unsaved: false,
  justEnded: false,
  dismissSummary: vi.fn(),
  canControl: true,
  start: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  end: vi.fn(),
  ...over,
});

const renderLive = (s: RehearsalSessionControls, kind: 'rehearsal' | 'gig' = 'rehearsal') =>
  render(<StageMode kind={kind} title="Weekly rehearsal" dateLabel="Thu 19 Nov" steps={[]} songs={songs} session={s} onClose={vi.fn()} />);


describe('Live mode on a rehearsal: the session timer (A1b)', () => {
  it('the admin starts the rehearsal', () => {
    const s = session(null);
    renderLive(s);
    fireEvent.click(screen.getByRole('button', { name: 'Start rehearsal' }));
    expect(s.start).toHaveBeenCalledOnce();
    expect(screen.queryByRole('timer')).toBeNull();
  });

  it('a member sees nothing before it starts', () => {
    renderLive(session(null, { canControl: false }));
    expect(screen.queryByRole('region', { name: 'Rehearsal timer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start rehearsal' })).toBeNull();
  });

  it('running: the clock without pauses, Pause and End (asked first)', () => {
    const s = session(startSession(T0));
    renderLive(s);
    expect(screen.getByRole('timer')).toHaveTextContent('47:23');
    expect(screen.getByText('Rehearsing')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(s.pause).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    expect(screen.getByText('End rehearsal?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep going' }));
    expect(s.end).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    fireEvent.click(screen.getByRole('button', { name: 'End now' }));
    expect(s.end).toHaveBeenCalledOnce();
  });

  it('paused: the clock stands, Resume', () => {
    const s = session(pauseSession(startSession(T0), T0 + 10 * 60_000));
    renderLive(s);
    expect(screen.getByRole('timer')).toHaveTextContent('10:00');
    expect(screen.getByText('Paused')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(s.resume).toHaveBeenCalledOnce();
  });

  it('a member sees the clock but no controls', () => {
    renderLive(session(startSession(T0), { canControl: false }));
    expect(screen.getByRole('timer')).toHaveTextContent('47:23');
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
  });

  it('offline: the admin is told it is saved later', () => {
    renderLive(session(startSession(T0), { unsaved: true }));
    expect(screen.getByText(/Saved when back online/)).toBeInTheDocument();
  });

  it('ended: the summary with the time rehearsed and the songs played', () => {
    let st = startSession(T0);
    st = markPlayed(st, { id: 's1', title: 'Paper Boats' });
    st = markPlayed(st, { id: 's3', title: 'Harbor Lights' });
    st = endSession(st, T0 + (60 + 52) * 60_000);
    const s = session(st, { justEnded: true });
    renderLive(s);
    const dialog = screen.getByRole('dialog', { name: 'Rehearsal summary' });
    expect(dialog).toHaveTextContent('1 h 52 min');
    expect(dialog).toHaveTextContent('2 of 3 songs played');
    const list = screen.getByRole('list', { name: 'Songs played' });
    expect(list).toHaveTextContent('Paper Boats');
    expect(list).toHaveTextContent('Harbor Lights');
    expect(list).not.toHaveTextContent('Superstition');
    fireEvent.click(screen.getByRole('button', { name: 'Resume rehearsal' }));
    expect(s.resume).toHaveBeenCalledOnce();
  });

  it('ended earlier: Summary opens it again; a member gets Done only', async () => {
    const st = endSession(startSession(T0), T0 + 30 * 60_000);
    renderLive(session(st, { canControl: false }));
    expect(screen.queryByRole('dialog', { name: 'Rehearsal summary' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Summary' }));
    expect(screen.getByRole('dialog', { name: 'Rehearsal summary' })).toHaveTextContent('30 min');
    expect(screen.queryByRole('button', { name: 'Resume rehearsal' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    // Fades out, then is gone.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rehearsal summary' })).toBeNull());
  });

  it('switched off (flag) or on a gig: no timer', () => {
    renderLive(session(startSession(T0), { enabled: false }));
    expect(screen.queryByRole('region', { name: 'Rehearsal timer' })).toBeNull();
    cleanup();
    renderLive(session(startSession(T0)), 'gig');
    expect(screen.queryByRole('region', { name: 'Rehearsal timer' })).toBeNull();
  });
});
