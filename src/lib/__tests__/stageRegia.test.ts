import { describe, expect, it } from 'vitest';
import {
  formatClock,
  insertAfter,
  parseRegiaState,
  playPosition,
  regiaReadiness,
  rowsWithInserted,
  takesOver,
  type RegiaState,
} from '../stageRegia';

const state: RegiaState = {
  seq: 10,
  from: 'regia-a',
  on: true,
  name: 'Anna',
  songId: 'row-2',
  title: 'Volare',
  playing: true,
  positionMs: 30_000,
  durationMs: 200_000,
};

describe('stage regia', () => {
  it('checks messages', () => {
    expect(parseRegiaState(state)).toEqual(state);
    expect(parseRegiaState({ ...state, name: undefined, title: undefined })).toEqual({ ...state, name: null, title: null });
    expect(parseRegiaState({ ...state, durationMs: null })).toMatchObject({ durationMs: null });
    expect(parseRegiaState({ ...state, positionMs: -1 })).toBeNull();
    expect(parseRegiaState({ ...state, on: 'yes' })).toBeNull();
    expect(parseRegiaState({ ...state, from: '' })).toBeNull();
    expect(parseRegiaState({ ...state, songId: 4 })).toBeNull();
    expect(parseRegiaState({ ...state, name: 'x'.repeat(200) })).toMatchObject({ name: 'x'.repeat(60) });
    expect(parseRegiaState(null)).toBeNull();
  });

  it('runs the time on from when the message arrived, and stops at the end', () => {
    expect(playPosition(state, 1_000, 6_000)).toBe(35_000);
    expect(playPosition({ ...state, playing: false }, 1_000, 6_000)).toBe(30_000);
    expect(playPosition(state, 1_000, 1_000_000)).toBe(200_000);
    expect(playPosition({ ...state, durationMs: null }, 0, 10_000)).toBe(40_000);
    // A clock that went backwards never shows an earlier time.
    expect(playPosition(state, 5_000, 1_000)).toBe(30_000);
  });

  it('formats times as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(72_400)).toBe('1:12');
    expect(formatClock(3_599_000)).toBe('59:59');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(NaN)).toBe('0:00');
  });

  it('hands the Regia to the newest device that turns it on', () => {
    const mine: RegiaState = { ...state, from: 'regia-b', seq: 9 };
    expect(takesOver(state, mine)).toBe(true);
    expect(takesOver({ ...state, seq: 8 }, mine)).toBe(false);
    // Its own message, or a device turning it off, takes nothing.
    expect(takesOver({ ...mine, seq: 20 }, mine)).toBe(false);
    expect(takesOver({ ...state, on: false, seq: 20 }, mine)).toBe(false);
    // Not Regia here: nothing to take.
    expect(takesOver(state, null)).toBe(false);
    expect(takesOver(state, { ...mine, on: false })).toBe(false);
  });

  it('puts a song played off the setlist right after the current one', () => {
    expect(insertAfter(['a', 'b', 'c'], 'a', 'x')).toEqual(['a', 'x', 'b', 'c']);
    expect(insertAfter(['a', 'b', 'c'], 'c', 'x')).toEqual(['a', 'b', 'c', 'x']);
    expect(insertAfter(['a', 'b'], null, 'x')).toEqual(['x', 'a', 'b']);
    expect(insertAfter(['a', 'b'], 'zz', 'x')).toEqual(['a', 'b', 'x']);
    expect(insertAfter(['a', 'x', 'b'], 'b', 'x')).toEqual(['a', 'b', 'x']);
  });

  it('saves the new row in the current song’s set, the sets keeping their songs', () => {
    const saved = [
      { id: 'a', songId: 'sa', setNumber: 1 },
      { id: 'b', songId: 'sb', setNumber: 1 },
      { id: 'c', songId: 'sc', setNumber: 2 },
    ];
    const rows = rowsWithInserted('list', saved, ['a', 'b', 'c'], 'b', { id: 'x', songId: 'sx' });
    expect(rows).toEqual([
      { id: 'a', setlist_id: 'list', song_id: 'sa', position: 1, set_number: 1 },
      { id: 'b', setlist_id: 'list', song_id: 'sb', position: 2, set_number: 1 },
      { id: 'x', setlist_id: 'list', song_id: 'sx', position: 3, set_number: 1 },
      { id: 'c', setlist_id: 'list', song_id: 'sc', position: 4, set_number: 2 },
    ]);
    // Live order differs from the saved one (the leader moved c up): it stands.
    const live = rowsWithInserted('list', saved, ['c', 'a', 'b'], 'c', { id: 'x', songId: 'sx' });
    expect(live?.map((r) => r.id)).toEqual(['c', 'x', 'a', 'b']);
    expect(live?.map((r) => r.position)).toEqual([1, 2, 3, 4]);
    // A row we don't know: nothing to save.
    expect(rowsWithInserted('list', saved, ['a', 'q'], 'a', { id: 'x', songId: 'sx' })).toBeNull();
  });

  it('counts what is ready to play on this device', () => {
    const songs = [{ audio: 'sb://song-files/b/audio/1.mp3' }, { audio: undefined }, { audio: 'https://x/2.mp3' }, { audio: '' }];
    expect(regiaReadiness(songs, new Set(['sb://song-files/b/audio/1.mp3']))).toEqual({ withAudio: 2, ready: 1, missing: 1, noAudio: 2 });
    expect(regiaReadiness([], new Set())).toEqual({ withAudio: 0, ready: 0, missing: 0, noAudio: 0 });
  });
});
