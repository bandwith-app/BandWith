import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const cachedMock = vi.fn();
const downloadMock = vi.fn();
const playableMock = vi.fn();
vi.mock('@/lib/regiaAudio', async () => ({
  audioFailureFor: (await vi.importActual<typeof import('@/lib/regiaAudio')>('@/lib/regiaAudio')).audioFailureFor,
  cachedAudio: (...a: unknown[]) => cachedMock(...a),
  downloadAudio: (...a: unknown[]) => downloadMock(...a),
  playableUrl: (...a: unknown[]) => playableMock(...a),
  createRegiaPlayer: () => {
    throw new Error('the real player is never used in tests');
  },
}));
const addMock = vi.fn();
const saveOrderMock = vi.fn();
vi.mock('@/lib/services/songs', () => ({
  addSongToSetlist: (...a: unknown[]) => addMock(...a),
  saveSetlistOrder: (...a: unknown[]) => saveOrderMock(...a),
}));
const outputMock = vi.fn();
const playbackMock = vi.fn();
let outputChange: ((o: { kind: string; name: string }) => void) | null = null;
vi.mock('@/lib/audioOutput', async () => {
  const real = await vi.importActual<typeof import('@/lib/audioOutput')>('@/lib/audioOutput');
  return {
    ...real,
    currentAudioOutput: () => outputMock(),
    setPlaybackSession: (on: boolean) => playbackMock(on),
    onAudioOutputChange: (fn: typeof outputChange) => {
      outputChange = fn;
      return () => {
        outputChange = null;
      };
    },
  };
});
const stopPlayerMock = vi.fn();
vi.mock('@/lib/audioPlayer', () => ({ stopPlayer: () => stopPlayerMock() }));

import { useStageRegia, type RegiaSong } from '../useStageRegia';
import type { StageRegiaBridge } from '../useStageLive';
import type { RegiaPlayer, RegiaPlayerSnapshot } from '@/lib/regiaAudio';
import type { RegiaState } from '@/lib/stageRegia';

/** A player that plays at once and remembers what it was asked. */
function fakePlayer() {
  let snap: RegiaPlayerSnapshot = { status: 'idle', positionMs: 0, durationMs: null };
  const subs = new Set<() => void>();
  const set = (p: Partial<RegiaPlayerSnapshot>) => {
    snap = { ...snap, ...p };
    subs.forEach((f) => f());
  };
  const player: RegiaPlayer & { loaded: string[]; disposed: boolean; set: typeof set } = {
    loaded: [],
    disposed: false,
    set,
    load: vi.fn(async (url: string) => {
      player.loaded.push(url);
      set({ status: 'ready', positionMs: 0, durationMs: 180_000 });
      return true;
    }),
    play: vi.fn(async () => {
      set({ status: 'playing' });
      return true;
    }),
    pause: vi.fn(() => set({ status: 'paused' })),
    stop: vi.fn(async () => set({ status: 'ready', positionMs: 0 })),
    snapshot: () => snap,
    subscribe: (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    dispose: vi.fn(() => {
      player.disposed = true;
    }),
  };
  return player;
}

const SONGS: RegiaSong[] = [
  { id: 'r1', songId: 's1', setNumber: 1, title: 'Volare', audio: 'sb://song-files/b/audio/1.mp3' },
  { id: 'r2', songId: 's2', setNumber: 1, title: 'Azzurro', audio: 'sb://song-files/b/audio/2.mp3' },
  { id: 'r3', songId: 's3', setNumber: 2, title: 'Senza audio' },
];

const setup = (over: Partial<Parameters<typeof useStageRegia>[0]> = {}) => {
  const bridge: { current: StageRegiaBridge } = { current: {} };
  const send = vi.fn();
  const select = vi.fn();
  const jumpTo = vi.fn();
  const players: ReturnType<typeof fakePlayer>[] = [];
  const createPlayer = vi.fn(() => {
    const p = fakePlayer();
    players.push(p);
    return p;
  });
  const hook = renderHook((p: Partial<Parameters<typeof useStageRegia>[0]>) =>
    useStageRegia({
      eventId: 'gig-1',
      setlistId: 'list-1',
      open: true,
      isAdmin: true,
      myName: 'Anna',
      clientId: 'me',
      send,
      bridge,
      songs: SONGS,
      currentId: 'r1',
      select,
      jumpTo,
      createPlayer,
      ...over,
      ...p,
    }),
  { initialProps: {} });
  return { ...hook, bridge, send, select, jumpTo, createPlayer, players };
};

const remote = (over: Partial<RegiaState> = {}): RegiaState => ({
  seq: Number.MAX_SAFE_INTEGER - 10,
  from: 'other',
  on: true,
  name: 'Marco',
  songId: 'r2',
  title: 'Azzurro',
  playing: true,
  positionMs: 12_000,
  durationMs: 200_000,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  cachedMock.mockReset().mockResolvedValue(new Set());
  downloadMock.mockReset().mockResolvedValue({ ok: true });
  playableMock.mockReset().mockImplementation(async (ref: string) => ({ url: `local:${ref}`, local: true }));
  addMock.mockReset();
  saveOrderMock.mockReset().mockResolvedValue({ error: null });
  stopPlayerMock.mockReset();
  outputMock.mockReset().mockResolvedValue({ kind: 'usb', name: 'USB-C to 3.5mm' });
  playbackMock.mockReset().mockResolvedValue(undefined);
  outputChange = null;
});

describe('useStageRegia (stage manager mode)', () => {
  it('a member never gets a player or any audio, and sees what the Regia plays', () => {
    const { result, bridge, createPlayer } = setup({ isAdmin: false });
    expect(result.current.available).toBe(false);
    act(() => result.current.turnOn());
    expect(createPlayer).not.toHaveBeenCalled();
    expect(cachedMock).not.toHaveBeenCalled();
    act(() => bridge.current.receive?.(remote()));
    expect(result.current.nowPlaying?.state).toMatchObject({ songId: 'r2', playing: true, positionMs: 12_000 });
    // The Regia left the channel: nothing plays any more.
    act(() => bridge.current.left?.('other'));
    expect(result.current.nowPlaying).toBeNull();
  });

  it('turning it on downloads tonight’s audio and tells the band', async () => {
    const { result, send, createPlayer } = setup();
    act(() => result.current.turnOn());
    expect(createPlayer).toHaveBeenCalledTimes(1);
    expect(stopPlayerMock).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ on: true, from: 'me', name: 'Anna' }));
    await waitFor(() => expect(result.current.readiness).toEqual({ withAudio: 2, ready: 2, missing: 0, noAudio: 1 }));
    expect(downloadMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('bw-regia:gig-1')).toBe('1');
  });

  it('Play on a song: everyone moves to it and its audio plays here only', async () => {
    const { result, send, select, players } = setup();
    act(() => result.current.turnOn());
    await act(async () => {
      await result.current.play(1);
    });
    expect(select).toHaveBeenCalledWith(1);
    expect(players[0].loaded).toEqual(['local:sb://song-files/b/audio/2.mp3']);
    expect(result.current.status).toBe('playing');
    await waitFor(() =>
      expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ on: true, songId: 'r2', title: 'Azzurro', playing: true })),
    );
  });

  it('a late arrival gets where the song is right now', async () => {
    const { result, bridge: br, players } = setup();
    act(() => result.current.turnOn());
    await act(async () => {
      await result.current.play(0);
    });
    act(() => players[0].set({ positionMs: 42_000 }));
    expect(br.current.latest?.()).toMatchObject({ on: true, songId: 'r1', playing: true, positionMs: 42_000 });
  });

  it('a song with no audio still moves the band, nothing plays', async () => {
    const { result, select, players } = setup();
    act(() => result.current.turnOn());
    await act(async () => {
      await result.current.play(2);
    });
    expect(select).toHaveBeenCalledWith(2);
    expect(players[0].loaded).toEqual([]);
    expect(result.current.status).not.toBe('playing');
  });

  it('shows each song’s download: queued, its progress, then ready', async () => {
    let finish!: () => void;
    downloadMock.mockImplementation(async (ref: string, onProgress?: (p: number | null) => void) => {
      if (ref.endsWith('1.mp3')) {
        onProgress?.(0.4);
        await new Promise<void>((r) => (finish = r));
      }
      return { ok: true };
    });
    const { result } = setup();
    act(() => result.current.turnOn());
    await waitFor(() => expect(result.current.audio['sb://song-files/b/audio/1.mp3']).toEqual({ state: 'downloading', progress: 0.4 }));
    expect(result.current.audio['sb://song-files/b/audio/2.mp3']).toEqual({ state: 'queued' });
    expect(result.current.downloading).toEqual({ done: 0, total: 2, progress: 0.2 });
    await act(async () => finish());
    await waitFor(() => expect(result.current.downloading).toBeNull());
    expect(result.current.audio['sb://song-files/b/audio/2.mp3']).toEqual({ state: 'ready' });
    expect(result.current.readiness.ready).toBe(2);
  });

  it('a song that can’t be downloaded says why, and Try again downloads it again', async () => {
    downloadMock.mockImplementation(async (ref: string) => (ref.endsWith('2.mp3') ? { ok: false, reason: 'link' } : { ok: true }));
    const { result } = setup();
    act(() => result.current.turnOn());
    await waitFor(() => expect(result.current.audio['sb://song-files/b/audio/2.mp3']).toEqual({ state: 'failed', reason: 'link' }));
    expect(result.current.failed).toEqual([{ title: 'Azzurro', reason: 'link' }]);
    downloadMock.mockResolvedValue({ ok: true });
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.failed).toEqual([]);
    expect(result.current.readiness.ready).toBe(2);
  });

  it('Play on a song whose link gives no audio: it says which song, why and what to do', async () => {
    downloadMock.mockImplementation(async (ref: string) => (ref.endsWith('2.mp3') ? { ok: false, reason: 'link' } : { ok: true }));
    playableMock.mockImplementation(async (ref: string) => ({ url: `https://x/${ref}`, local: false }));
    const { result, players } = setup();
    act(() => result.current.turnOn());
    await waitFor(() => expect(result.current.failed).toHaveLength(1));
    players[0].load = vi.fn(async () => false);
    await act(async () => {
      await result.current.play(1);
    });
    expect(result.current.error).toEqual({ kind: 'load', title: 'Azzurro', reason: 'link' });
    // The card shows the song that failed, not the one before it.
    expect(result.current.loadedId).toBe('r2');
  });

  it('Play on a song still downloading (no copy yet, streaming refused): says to wait, not that the link is wrong', async () => {
    let finish!: () => void;
    downloadMock.mockImplementation(async () => {
      await new Promise<void>((r) => (finish = r));
      return { ok: true };
    });
    playableMock.mockImplementation(async (ref: string) => ({ url: `https://x/${ref}`, local: false }));
    const { result, players } = setup();
    act(() => result.current.turnOn());
    await waitFor(() => expect(result.current.audio['sb://song-files/b/audio/1.mp3']?.state).toBe('downloading'));
    players[0].load = vi.fn(async () => false);
    await act(async () => {
      await result.current.play(0);
    });
    expect(result.current.error).toEqual({ kind: 'load', title: 'Volare', reason: 'pending' });
    await act(async () => finish());
  });

  it('before the first check of the device, the audio counts as being checked', () => {
    cachedMock.mockImplementation(() => new Promise(() => {}));
    const { result } = setup();
    act(() => result.current.turnOn());
    expect(result.current.checking).toBe(true);
  });

  it('Play on a song with no audio says so (not a silent tap), and offers the next song with audio', async () => {
    const songs: RegiaSong[] = [{ id: 'r0', songId: 's0', title: '50’s Medley' }, ...SONGS];
    const { result } = setup({ songs, currentId: 'r0' });
    act(() => result.current.turnOn());
    expect(result.current.nextPlayable).toBe(1);
    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.error).toEqual({ kind: 'no-audio', title: '50’s Medley' });
    expect(result.current.nextPlayable).toBe(1);
  });

  it('another admin turning it on takes it over: the audio here stops', async () => {
    const { result, bridge: br, players } = setup();
    act(() => result.current.turnOn());
    await act(async () => {
      await result.current.play(0);
    });
    act(() => br.current.receive?.(remote()));
    expect(result.current.on).toBe(false);
    expect(players[0].disposed).toBe(true);
    expect(result.current.lostTo).toBe('Marco');
    expect(localStorage.getItem('bw-regia:gig-1')).toBeNull();
    // From now on this admin sees the other Regia like a member.
    expect(result.current.nowPlaying?.state.from).toBe('other');
  });

  it('knows when another admin already holds it (asked before taking over)', () => {
    const { result, bridge: br } = setup();
    act(() => br.current.receive?.(remote()));
    expect(result.current.heldBy).toBe('Marco');
    expect(br.current.latest?.()).toBeNull();
  });

  it('a song off the setlist is added right after the current one, then plays', async () => {
    addMock.mockResolvedValue({ data: { id: 'r9' }, error: null });
    const { result, jumpTo, players } = setup();
    act(() => result.current.turnOn());
    await act(async () => {
      await result.current.playExtra({ id: 's9', title: 'Nuova', audio: 'sb://song-files/b/audio/9.mp3' });
    });
    expect(addMock).toHaveBeenCalledWith('list-1', 's9', 4, 1);
    expect(jumpTo).toHaveBeenCalledWith('r9', ['r1', 'r9', 'r2', 'r3']);
    expect(saveOrderMock.mock.calls[0][0].map((r: { id: string; set_number: number }) => [r.id, r.set_number])).toEqual([
      ['r1', 1],
      ['r9', 1],
      ['r2', 1],
      ['r3', 2],
    ]);
    expect(players[0].loaded).toEqual(['local:sb://song-files/b/audio/9.mp3']);
  });

  it('closing Stage mode stops the audio and tells the band', async () => {
    const { result, rerender, send, players } = setup();
    act(() => result.current.turnOn());
    await act(async () => {
      await result.current.play(0);
    });
    rerender({ open: false });
    expect(players[0].disposed).toBe(true);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ on: false, playing: false }));
  });

  it('comes back as Regia after a restart, not playing', () => {
    localStorage.setItem('bw-regia:gig-1', '1');
    const { result, players } = setup();
    expect(result.current.on).toBe(true);
    expect(players[0].play).not.toHaveBeenCalled();
  });

  it('shows where the sound goes, and warns when the cable to the mixer comes out', async () => {
    const { result, rerender } = setup();
    act(() => result.current.turnOn());
    await waitFor(() => expect(result.current.output).toEqual({ kind: 'usb', name: 'USB-C to 3.5mm' }));
    expect(playbackMock).toHaveBeenCalledWith(true);
    expect(result.current.outputWarning).toBeNull();
    act(() => outputChange?.({ kind: 'speaker', name: 'Speaker' }));
    expect(result.current.outputWarning).toBe('speaker');
    act(() => outputChange?.({ kind: 'bluetooth', name: 'AirPods' }));
    expect(result.current.outputWarning).toBe('bluetooth');
    rerender({ open: false });
    expect(playbackMock).toHaveBeenLastCalledWith(false);
  });
});
