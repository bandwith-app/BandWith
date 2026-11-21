import { describe, it, expect, vi, beforeEach } from 'vitest';
import HARBOR from '../demo/scores/harbor-lights.musicxml?raw';

const resolveSongFileUrl = vi.hoisted(() => vi.fn());
vi.mock('../services/songFiles', () => ({ resolveSongFileUrl }));

import { loadScore, prefetchScores, scoreCacheKey, setScoreStore, type ScoreStore } from '../scoreCache';

const REF = 'sb://song-files/band-1/score/abc-tune.musicxml';

const memoryStore = (): ScoreStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v) };
};

let store: ReturnType<typeof memoryStore>;
const fetchMock = vi.fn();

beforeEach(() => {
  store = memoryStore();
  setScoreStore(store);
  resolveSongFileUrl.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const ok = (text: string) => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(text).buffer });

describe('loadScore', () => {
  it('downloads a stored score once and keeps it on the device', async () => {
    resolveSongFileUrl.mockResolvedValue('https://signed.example/tune');
    fetchMock.mockResolvedValue(ok(HARBOR));
    expect(await loadScore(REF)).toContain('Harbor Lights');
    expect(store.data.get(await scoreCacheKey(REF))).toContain('Harbor Lights');
    // A second read (or a second reader) never goes to the network again.
    expect(await loadScore(REF)).toContain('Harbor Lights');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads the copy on the device with no network (Stage mode at a venue with no signal)', async () => {
    store.data.set(await scoreCacheKey(REF), HARBOR);
    resolveSongFileUrl.mockRejectedValue(new Error('offline'));
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await loadScore(REF)).toContain('Harbor Lights');
  });

  it('fails clearly when there is neither a copy nor a network', async () => {
    resolveSongFileUrl.mockResolvedValue('https://signed.example/tune');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(loadScore('sb://song-files/band-1/score/never-seen.mxl')).rejects.toThrow('offline');
  });

  it('refuses a stored file that is not MusicXML (and keeps nothing)', async () => {
    resolveSongFileUrl.mockResolvedValue('https://signed.example/tune');
    fetchMock.mockResolvedValue(ok('<html>not a score</html>'));
    const ref = 'sb://song-files/band-1/score/bad.musicxml';
    await expect(loadScore(ref)).rejects.toThrow('not-musicxml');
    expect(store.data.size).toBe(0);
  });

  it('reads the demo scores bundled with the demo build, without the network', async () => {
    expect(await loadScore('demo://scores/night-ferry.musicxml')).toContain('Night Ferry');
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(loadScore('demo://scores/nope.musicxml')).rejects.toThrow('not-found');
  });
});

describe('prefetchScores', () => {
  it('keeps every score of a setlist on the device before the gig, skipping the ones already there', async () => {
    const other = 'sb://song-files/band-1/score/other.musicxml';
    store.data.set(await scoreCacheKey(other), HARBOR);
    resolveSongFileUrl.mockResolvedValue('https://signed.example/tune');
    fetchMock.mockResolvedValue(ok(HARBOR));
    const n = await prefetchScores([REF, other, undefined, null, REF, 'demo://scores/harbor-lights.musicxml']);
    expect(n).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.data.has(await scoreCacheKey(REF))).toBe(true);
  });
});
