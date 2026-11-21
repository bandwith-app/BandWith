import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn() },
}));

import { StageMode, type StageLiveControls, type StageSong } from '../StageMode';
import type { StageRegia } from '@/app/components/event/useStageRegia';

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);

const songs: StageSong[] = [
  { id: 'r1', songId: 's1', title: 'Volare', audio: 'sb://song-files/b/audio/1.mp3' },
  { id: 'r2', songId: 's2', title: 'Azzurro', audio: 'sb://song-files/b/audio/2.mp3' },
  { id: 'r3', songId: 's3', title: 'Senza audio' },
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
  canStrike: true,
  toggleSkip: vi.fn(),
  ...over,
});

const regia = (over: Partial<StageRegia> = {}): StageRegia =>
  ({
    available: true,
    on: false,
    turnOn: vi.fn(),
    turnOff: vi.fn(),
    heldBy: null,
    lostTo: null,
    dismissLost: vi.fn(),
    readiness: { withAudio: 2, ready: 2, missing: 0, noAudio: 1 },
    downloading: null,
    cached: new Set(),
    audio: {
      'sb://song-files/b/audio/1.mp3': { state: 'ready' },
      'sb://song-files/b/audio/2.mp3': { state: 'ready' },
    },
    failed: [],
    retry: vi.fn(),
    nextPlayable: 1,
    error: null,
    dismissError: vi.fn(),
    output: null,
    outputWarning: null,
    status: 'ready',
    positionMs: 0,
    durationMs: null,
    loadedId: null,
    nextIndex: 1,
    play: vi.fn(),
    toggle: vi.fn(),
    stop: vi.fn(),
    playExtra: vi.fn(),
    nowPlaying: null,
    ...over,
  }) as StageRegia;

const renderStage = (r: StageRegia, l: StageLiveControls = live()) =>
  render(<StageMode title="Festa" dateLabel="Sat 21 Nov" steps={[]} songs={songs} bandId="b1" live={l} regia={r} onClose={vi.fn()} />);

describe('Stage mode: the Regia (stage manager mode)', () => {
  it('an admin turns it on from Stage mode', () => {
    const r = regia();
    renderStage(r);
    fireEvent.click(screen.getByRole('button', { name: 'Stage manager: play audio here' }));
    expect(r.turnOn).toHaveBeenCalledOnce();
  });

  it('asks before taking it over from another admin', () => {
    const r = regia({ heldBy: 'Marco' });
    renderStage(r);
    fireEvent.click(screen.getByRole('button', { name: 'Stage manager: play audio here' }));
    expect(r.turnOn).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Marco’s device is the stage manager');
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));
    expect(r.turnOn).toHaveBeenCalledOnce();
  });

  it('on: ▶ on every song with audio, the player, readiness', () => {
    const r = regia({ on: true });
    renderStage(r);
    expect(screen.getByRole('region', { name: 'Stage manager' })).toHaveTextContent('Audio ready 2/2');
    fireEvent.click(screen.getByRole('button', { name: 'Play Azzurro' }));
    expect(r.play).toHaveBeenCalledWith(1);
    // No ▶ for a song without audio.
    expect(screen.queryByRole('button', { name: 'Play Senza audio' })).toBeNull();
    // The player's own button plays the current song.
    fireEvent.click(screen.getByRole('button', { name: /^Play$/ }));
    expect(r.toggle).toHaveBeenCalled();
  });

  it('warns when the sound comes from the device’s speaker', () => {
    renderStage(regia({ on: true, output: { kind: 'speaker', name: 'Speaker' }, outputWarning: 'speaker' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Plug in the cable to the mixer');
  });

  it('shows the output when it is fine', () => {
    renderStage(regia({ on: true, output: { kind: 'usb', name: 'USB-C to 3.5mm Adapter' } }));
    expect(screen.getByText(/Output: USB-C to 3.5mm Adapter/)).toBeTruthy();
  });

  it('a song off the setlist: the repertoire sheet opens', () => {
    renderStage(regia({ on: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Play a song not in the setlist' }));
    expect(screen.getByRole('dialog', { name: 'Play a song not in the setlist' })).toBeTruthy();
  });

  it('while the audio downloads: how far, overall and on each song', () => {
    renderStage(
      regia({
        on: true,
        readiness: { withAudio: 2, ready: 0, missing: 2, noAudio: 1 },
        downloading: { done: 0, total: 2, progress: 0.2 },
        audio: {
          'sb://song-files/b/audio/1.mp3': { state: 'downloading', progress: 0.4 },
          'sb://song-files/b/audio/2.mp3': { state: 'queued' },
        },
      }),
    );
    const card = screen.getByRole('region', { name: 'Stage manager' });
    expect(card).toHaveTextContent('Downloading audio 1/2 · 20%');
    expect(screen.getByRole('progressbar', { name: 'Downloading audio' })).toHaveAttribute('aria-valuenow', '20');
    expect(screen.getByRole('button', { name: 'Play Volare · downloading 40%' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play Azzurro · waiting to download' })).toBeTruthy();
  });

  it('songs that can’t be downloaded: which, why, what to do, and Try again', () => {
    const r = regia({
      on: true,
      readiness: { withAudio: 2, ready: 1, missing: 1, noAudio: 1 },
      audio: { 'sb://song-files/b/audio/1.mp3': { state: 'ready' }, 'sb://song-files/b/audio/2.mp3': { state: 'failed', reason: 'link' } },
      failed: [{ title: 'Azzurro', reason: 'link' }],
    });
    renderStage(r);
    const card = screen.getByRole('region', { name: 'Stage manager' });
    expect(card).toHaveTextContent('Audio ready 1/2');
    fireEvent.click(screen.getByRole('button', { name: '1 song can’t be downloaded' }));
    expect(card).toHaveTextContent('Azzurro');
    expect(card).toHaveTextContent('The link doesn’t give an audio file');
    expect(card).toHaveTextContent('Anyone with the link');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(r.retry).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Play Azzurro · can’t be downloaded' })).toBeTruthy();
  });

  it('the current song has no audio: says so, and Play offers the next song with audio', () => {
    const r = regia({ on: true, nextPlayable: 0 });
    renderStage(r, live({ index: 2 }));
    const card = screen.getByRole('region', { name: 'Stage manager' });
    expect(card).toHaveTextContent('“Senza audio” has no audio: the band plays it live.');
    fireEvent.click(screen.getByRole('button', { name: 'Play next: Volare' }));
    expect(r.play).toHaveBeenCalledWith(0);
    expect(r.toggle).not.toHaveBeenCalled();
  });

  it('Play failed: names the song, the reason and the fix', () => {
    renderStage(regia({ on: true, loadedId: 'r2', status: 'error', nextPlayable: null, error: { kind: 'load', title: 'Azzurro', reason: 'offline' } }));
    expect(screen.getByRole('region', { name: 'Stage manager' })).toHaveTextContent(
      '“Azzurro” can’t be played. No internet, and it isn’t on this device yet. It downloads once you’re back online.',
    );
  });

  it('a member sees no Regia controls, only what is playing', () => {
    const r = regia({
      available: false,
      nowPlaying: {
        state: { seq: 1, from: 'x', on: true, name: 'Anna', songId: 'r2', title: 'Azzurro', playing: true, positionMs: 72_000, durationMs: 238_000 },
        receivedAt: Date.now(),
      },
    });
    renderStage(r, live({ isLeader: false, canReorder: false, canStrike: false, following: false, index: 0 }));
    expect(screen.queryByRole('button', { name: 'Stage manager: play audio here' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Play / })).toBeNull();
    const strip = screen.getByText(/Now playing · Azzurro/).closest('[role="status"]')!;
    expect(strip).toHaveTextContent('1:12 / 3:58');
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
  });
});
