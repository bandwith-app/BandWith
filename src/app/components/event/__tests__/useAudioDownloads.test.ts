import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * #296 round 3 (Codex B3): signing out during a setlist's download stopped
 * the song coming down, but the batch went on to the next song, whose
 * download started after the sign-out and filled the shared device again.
 */
const state = { signedOut: false, user: 'admin-1' as string | null };
let release: (() => void) | null = null;
const downloadMock = vi.fn(async (_ref: string) => {
  await new Promise<void>((r) => (release = r));
  return state.signedOut ? { ok: false as const, reason: 'failed' as const } : { ok: true as const };
});
let cachedOverride = new Set<string>();
vi.mock('@/lib/regiaAudio', () => ({
  cachedAudio: async (refs: string[]) => new Set(refs.filter((r) => cachedOverride.has(r))),
  downloadAudio: (ref: string) => downloadMock(ref),
  audioSession: () => {
    const at = state.signedOut;
    return () => state.signedOut === at;
  },
}));
vi.mock('@/lib/sessionUser', () => ({ sessionUserId: async () => state.user }));

import { useAudioDownloads } from '../useAudioDownloads';

beforeEach(() => {
  state.signedOut = false;
  state.user = 'admin-1';
  release = null;
  downloadMock.mockClear();
});

/** Lets whatever is still waiting finish (so a failing run doesn't hang the next test). */
const drain = async (run: Promise<void>) => {
  for (let i = 0; i < 5 && release; i++) {
    const r = release;
    release = null;
    await act(async () => r());
    await flush();
  }
  await act(async () => run);
};

const flush = () => act(async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
});

describe('useAudioDownloads: a sign-out stops the whole batch', () => {
  it('signed out while song 1 comes down: songs 2 and 3 are never started', async () => {
    const refs = ['https://a/1.mp3', 'https://a/2.mp3', 'https://a/3.mp3'];
    const { result } = renderHook(() => useAudioDownloads(refs));
    let run!: Promise<void>;
    act(() => {
      run = result.current.prepare();
    });
    await flush();
    expect(downloadMock).toHaveBeenCalledTimes(1);
    // Sign-out: the session ends, the current download keeps nothing.
    state.signedOut = true;
    state.user = null;
    await act(async () => release?.());
    await flush();
    expect(downloadMock).toHaveBeenCalledTimes(1);
    await drain(run);
  });

  it('another account signed in meanwhile (another tab): the batch stops too', async () => {
    const refs = ['https://a/1.mp3', 'https://a/2.mp3'];
    const { result } = renderHook(() => useAudioDownloads(refs));
    let run!: Promise<void>;
    act(() => {
      run = result.current.prepare();
    });
    await flush();
    state.user = 'someone-else';
    await act(async () => release?.());
    await flush();
    expect(downloadMock).toHaveBeenCalledTimes(1);
    await drain(run);
  });

  it('nobody signs out: every song comes down, one after the other', async () => {
    const refs = ['https://a/1.mp3', 'https://a/2.mp3'];
    const { result } = renderHook(() => useAudioDownloads(refs));
    let run!: Promise<void>;
    act(() => {
      run = result.current.prepare();
    });
    for (let i = 0; i < 2; i++) {
      await flush();
      await act(async () => release?.());
    }
    await act(async () => run);
    expect(downloadMock).toHaveBeenCalledTimes(2);
  });
});

describe('#296 round 4: a pass asked for during a download belongs to that account', () => {
  it('asked again while song 1 comes down, then signed out and another account in: that pass downloads nothing', async () => {
    const refs = ['https://a/1.mp3', 'https://a/2.mp3'];
    const { result } = renderHook(() => useAudioDownloads(refs));
    let run!: Promise<void>;
    act(() => {
      run = result.current.prepare();
    });
    await flush();
    // Back online, the card's retry: queued behind the pass on its way.
    act(() => {
      void result.current.prepare();
    });
    await flush();
    // Sign-out, then another person signs in on this device.
    state.signedOut = true;
    state.user = 'someone-else';
    await drain(run);
    await flush();
    expect(downloadMock).toHaveBeenCalledTimes(1);
  });
});

describe('#296 round 5: session expired offline', () => {
  it('the songs already on the device still show as ready; nothing is downloaded', async () => {
    state.user = null;
    const refs = ['https://a/1.mp3', 'https://a/2.mp3'];
    cachedOverride = new Set(['https://a/1.mp3']);
    const { result } = renderHook(() => useAudioDownloads(refs));
    await act(async () => {
      await result.current.prepare();
    });
    expect(result.current.audio['https://a/1.mp3']).toEqual({ state: 'ready' });
    expect(downloadMock).not.toHaveBeenCalled();
    cachedOverride = new Set();
  });
});
