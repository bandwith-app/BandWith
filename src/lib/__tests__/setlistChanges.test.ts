import { describe, it, expect } from 'vitest';
import { diffSetlist, entriesFromRows, hasSetlistChange, songFieldsChanged } from '../setlistChanges';

const list = (ids: string, set = 1) => ids.split('').map((songId) => ({ songId, setNumber: set }));

describe('diffSetlist', () => {
  it('no change', () => {
    expect(diffSetlist(list('abcd'), list('abcd'))).toEqual({ moved: 0, added: 0, removed: 0 });
    expect(hasSetlistChange(diffSetlist(list('abcd'), list('abcd')))).toBe(false);
  });

  it('one song dragged to the top counts as one move', () => {
    expect(diffSetlist(list('abcde'), list('eabcd'))).toEqual({ moved: 1, added: 0, removed: 0 });
  });

  it('two songs swapped: one moved (the shortest way to get there)', () => {
    expect(diffSetlist(list('abcd'), list('bacd')).moved).toBe(1);
  });

  it('two separate moves', () => {
    expect(diffSetlist(list('abcdef'), list('bacdfe')).moved).toBe(2);
  });

  it('added and removed', () => {
    expect(diffSetlist(list('abc'), list('abxy'))).toEqual({ moved: 0, added: 2, removed: 1 });
  });

  it('a song moved to another set is a move even in the same play position', () => {
    const before = [...list('ab', 1), ...list('cd', 2)];
    const after = [...list('a', 1), ...list('bcd', 2)];
    expect(diffSetlist(before, after)).toEqual({ moved: 1, added: 0, removed: 0 });
  });

  it('the summary "2 moved, 1 added"', () => {
    expect(diffSetlist(list('abcde'), list('dabecx'))).toEqual({ moved: 2, added: 1, removed: 0 });
  });

  it('duplicates pair up occurrence by occurrence', () => {
    expect(diffSetlist(list('aba'), list('ab'))).toEqual({ moved: 0, added: 0, removed: 1 });
    expect(diffSetlist(list('ab'), list('aab'))).toEqual({ moved: 0, added: 1, removed: 0 });
  });

  it('a missing set number is set 1', () => {
    expect(diffSetlist([{ songId: 'a' }, { songId: 'b', setNumber: null }], list('ab'))).toEqual({ moved: 0, added: 0, removed: 0 });
  });

  it('empty to full and full to empty', () => {
    expect(diffSetlist([], list('ab'))).toEqual({ moved: 0, added: 2, removed: 0 });
    expect(diffSetlist(list('ab'), [])).toEqual({ moved: 0, added: 0, removed: 2 });
  });
});

describe('entriesFromRows', () => {
  it('sorts by set then position and drops rows without a song', () => {
    const rows = [
      { song_id: 'c', set_number: 2, position: 1 },
      { song_id: 'b', set_number: 1, position: 2 },
      { song_id: null, set_number: 1, position: 3 },
      { song_id: 'a', set_number: null, position: 1 },
    ];
    expect(entriesFromRows(rows).map((e) => e.songId)).toEqual(['a', 'b', 'c']);
  });
});

describe('songFieldsChanged', () => {
  it('maps columns to notification fields in a stable order', () => {
    expect(songFieldsChanged({ lyrics: 'x', bpm: 120, key: 'C', audio_url: 'a', youtube_url: 'y', unknown: 1 })).toEqual([
      'key',
      'tempo',
      'lyrics',
      'media',
    ]);
    expect(songFieldsChanged({})).toEqual([]);
  });
});
