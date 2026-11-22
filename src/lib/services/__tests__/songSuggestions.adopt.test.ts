import { describe, it, expect, vi, beforeEach } from 'vitest';

// Audit 09 #5 / #9: an accepted suggested song's files move into the band's
// folders. The move happened first and the song-row update's error was
// ignored: a failed update left the song pointing at a file that was gone.
// Now: copy, point the song at the copy (checked), then delete the original.
const sb = vi.hoisted(() => {
  const log: string[] = [];
  const state = { updateError: null as unknown, updateRows: 1, copyError: null as unknown };
  const storage = {
    copy: vi.fn(async (from: string, to: string) => {
      log.push(`copy ${from} -> ${to}`);
      return { data: state.copyError ? null : { path: to }, error: state.copyError };
    }),
    move: vi.fn(async (from: string, to: string) => {
      log.push(`move ${from} -> ${to}`);
      return { data: {}, error: null };
    }),
    remove: vi.fn(async (paths: string[]) => {
      log.push(`remove ${paths.join(',')}`);
      return { data: [], error: null };
    }),
  };
  const update = vi.fn((patch: Record<string, unknown>) => {
    const conds: Array<[string, unknown]> = [];
    const chain = {
      eq: (k: string, v: unknown) => {
        conds.push([k, v]);
        return chain;
      },
      select: () => chain,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        log.push(`update ${JSON.stringify(patch)} where ${conds.map(([k, v]) => `${k}=${v}`).join(' and ')}`);
        return Promise.resolve(
          state.updateError
            ? { data: null, error: state.updateError }
            : { data: Array.from({ length: state.updateRows }, () => ({ id: 'song-1' })), error: null },
        ).then(res, rej);
      },
    };
    return chain;
  });
  const supabase = {
    rpc: vi.fn(async () => ({ data: { status: 'accepted', song_id: 'song-1', files: [] }, error: null })),
    from: vi.fn(() => ({ update })),
    storage: { from: vi.fn(() => storage) },
  };
  return { supabase, storage, update, log, state };
});
vi.mock('../../supabase', () => ({ supabase: sb.supabase }));
vi.mock('@/lib/supabase', () => ({ supabase: sb.supabase }));

import { reviewSongSuggestion } from '../songSuggestions';
import { adoptSuggestionFiles } from '../songFiles';

const ORIG = 'band-1/suggestions/member-1/audio/abc-take.mp3';
const DEST = 'band-1/audio/abc-take.mp3';
const song = { audio_url: `sb://song-files/${ORIG}`, chart_url: 'https://example.com/chart.pdf' };

beforeEach(() => {
  sb.log.length = 0;
  sb.state.updateError = null;
  sb.state.updateRows = 1;
  sb.state.copyError = null;
  vi.clearAllMocks();
});

describe('accepting a suggested song with an uploaded file', () => {
  it('copies, points the song at the copy, then deletes the original', async () => {
    const res = await reviewSongSuggestion({ id: 'sg-1', kind: 'new_song' }, 'accept', { song });
    expect(res.error).toBeNull();
    expect(sb.storage.move).not.toHaveBeenCalled();
    expect(sb.log).toEqual([
      `copy ${ORIG} -> ${DEST}`,
      `update {"audio_url":"sb://song-files/${DEST}"} where id=song-1 and audio_url=sb://song-files/${ORIG}`,
      `remove ${ORIG}`,
    ]);
  });

  it('a failed song update keeps the original file the song still links to', async () => {
    sb.state.updateError = new Error('network down');
    const res = await reviewSongSuggestion({ id: 'sg-1', kind: 'new_song' }, 'accept', { song });
    expect(res.status).toBe('accepted');
    expect(sb.storage.move).not.toHaveBeenCalled();
    // Only the unused copy goes; the original stays.
    expect(sb.storage.remove).toHaveBeenCalledTimes(1);
    expect(sb.storage.remove).toHaveBeenCalledWith([DEST]);
  });

  it('a song changed meanwhile (no row updated) keeps the original too', async () => {
    sb.state.updateRows = 0;
    const out = await adoptSuggestionFiles({ id: 'song-1', ...song });
    expect(out.error).toBeTruthy();
    expect(out.refs).toEqual({});
    expect(sb.storage.remove).toHaveBeenCalledWith([DEST]);
    expect(sb.storage.remove).not.toHaveBeenCalledWith([ORIG]);
  });

  it('a copy left by an earlier try is reused (retry after a failure)', async () => {
    sb.state.copyError = Object.assign(new Error('The resource already exists'), { statusCode: '409' });
    const out = await adoptSuggestionFiles({ id: 'song-1', ...song });
    expect(out.error).toBeNull();
    expect(out.refs).toEqual({ audio_url: `sb://song-files/${DEST}` });
    expect(sb.log[sb.log.length - 1]).toBe(`remove ${ORIG}`);
  });

  it('a song with no suggestion files is left alone', async () => {
    const out = await adoptSuggestionFiles({ id: 'song-1', audio_url: 'sb://song-files/band-1/audio/x.mp3', chart_url: null });
    expect(out).toEqual({ refs: {}, error: null });
    expect(sb.log).toEqual([]);
  });
});
