import { describe, it, expect } from 'vitest';
import { focusSuggestions, suggestedFocusSongs, fromLastTime, openCountBySong, songChangeFromNote, songNotes, toPractise } from '../toPractise';
import type { RehearsalNote } from '../rehearsalNotes';

const ME = 'me';
const OTHER = 'other';
let seq = 0;
const note = (over: Partial<RehearsalNote> = {}): RehearsalNote => ({
  id: `n${++seq}`,
  bandId: 'b',
  eventId: 'e',
  date: '2026-11-12',
  sessionId: null,
  songId: 's1',
  songTitle: 'Paper Boats',
  preset: 'review',
  section: null,
  body: null,
  scope: 'band',
  status: 'open',
  markedAtS: null,
  createdBy: OTHER,
  okBy: null,
  okAt: null,
  createdAt: '2026-11-12T20:00:00.000Z',
  assignees: [],
  ...over,
});

describe('To practise (A3)', () => {
  it('open notes for me or the band, by song, newest rehearsal first; not marks, not OK, not practised by me, not for others', () => {
    const groups = toPractise(
      [
        note({ id: 'a', songId: 's1', date: '2026-11-05' }),
        note({ id: 'b', songId: 's2', songTitle: 'Harbor Lights', date: '2026-11-12', scope: 'members', assignees: [{ userId: ME, practisedAt: null }] }),
        note({ id: 'c', songId: 's1', date: '2026-11-12' }),
        note({ id: 'd', songId: 's3', status: 'marked' }),
        note({ id: 'e', songId: 's3', status: 'ok' }),
        note({ id: 'f', songId: 's3', scope: 'members', assignees: [{ userId: ME, practisedAt: '2026-11-13T10:00:00Z' }] }),
        note({ id: 'g', songId: 's3', scope: 'members', assignees: [{ userId: OTHER, practisedAt: null }] }),
        note({ id: 'h', songId: null, songTitle: null, body: 'Tune before' }),
      ],
      ME,
    );
    expect(groups.map((g) => [g.songId, g.notes.map((n) => n.id), g.lastDate])).toEqual([
      ['s1', ['c', 'a'], '2026-11-12'],
      ['s2', ['b'], '2026-11-12'],
    ]);
  });

  it('a note I just ticked Practised here stays (to take it back) until I leave', () => {
    const done = note({ id: 'p', scope: 'members', assignees: [{ userId: ME, practisedAt: '2026-11-13T10:00:00Z' }] });
    expect(toPractise([done], ME)).toEqual([]);
    expect(toPractise([done], ME, new Set(['p'])).map((g) => g.notes.map((n) => n.id))).toEqual([['p']]);
  });

  it('the song page: that song’s open notes for everyone, mine first', () => {
    const list = songNotes(
      [
        note({ id: 'x', songId: 's1', scope: 'members', assignees: [{ userId: OTHER, practisedAt: null }] }),
        note({ id: 'y', songId: 's1' }),
        note({ id: 'z', songId: 's2' }),
        note({ id: 'w', songId: 's1', status: 'ok' }),
      ],
      's1',
      ME,
    );
    expect(list.map((n) => n.id)).toEqual(['y', 'x']);
  });
});

describe('next rehearsal (A3)', () => {
  const notes = [
    note({ id: 'old1', songId: 's2', date: '2026-11-05' }),
    note({ id: 'old2', songId: 's1', date: '2026-11-12' }),
    note({ id: 'off', songId: 's9', date: '2026-11-12' }),
    note({ id: 'same', songId: 's1', date: '2026-11-19' }),
    note({ id: 'mark', songId: 's1', date: '2026-11-12', status: 'marked' }),
  ];

  it('"From last time": open notes from earlier rehearsals on songs in its setlist, setlist order', () => {
    expect(fromLastTime(notes, ['s1', 's2', 's3'], '2026-11-19').map((g) => [g.songId, g.notes.map((n) => n.id)])).toEqual([
      ['s1', ['old2']],
      ['s2', ['old1']],
    ]);
  });

  it('a note just confirmed OK stays in "From last time" (to take it back)', () => {
    expect(fromLastTime([note({ id: 'k', songId: 's1', status: 'ok' })], ['s1'], '2026-11-19').map((g) => g.notes.map((n) => n.id))).toEqual([['k']]);
  });

  it('Live mode badges: open notes per song (any rehearsal)', () => {
    expect(openCountBySong(notes)).toEqual({ s1: 2, s2: 1, s9: 1 });
  });

  it('focus songs suggested by open notes: most notes first, then most recent', () => {
    expect(focusSuggestions(notes)).toEqual(['s1', 's9', 's2']);
    expect(focusSuggestions([note({ songId: 'a', date: '2026-11-01' }), note({ songId: 'b', date: '2026-11-10' })])).toEqual(['b', 'a']);
  });
});

describe('focus songs to pre-select (097)', () => {
  it('ids with titles, at most the limit', () => {
    const notes = [note({ songId: 'a', songTitle: 'A' }), note({ songId: 'a', songTitle: 'A' }), note({ songId: 'b', songTitle: 'B' }), note({ songId: 'c', songTitle: null })];
    expect(suggestedFocusSongs(notes)).toEqual([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
    expect(suggestedFocusSongs(notes, 1)).toEqual([{ id: 'a', title: 'A' }]);
  });
});

describe('tempo / key notes become song suggestions (A3, 108)', () => {
  it('reads the tempo or the key from the note', () => {
    expect(songChangeFromNote(note({ preset: 'tempo', body: 'Tempo: 96' }))).toEqual({ kind: 'tempo', bpm: 96 });
    expect(songChangeFromNote(note({ preset: 'tempo', body: 'slower, 88 bpm' }))).toEqual({ kind: 'tempo', bpm: 88 });
    expect(songChangeFromNote(note({ preset: 'key', body: 'Key: F#m' }))).toEqual({ kind: 'key', key: 'F#m' });
    expect(songChangeFromNote(note({ preset: 'key', body: 'down to Bb' }))).toEqual({ kind: 'key', key: 'Bb' });
  });

  it('nothing to suggest: other presets, no number, out of range, no song', () => {
    expect(songChangeFromNote(note({ preset: 'tempo', body: 'too fast' }))).toBeNull();
    expect(songChangeFromNote(note({ preset: 'tempo', body: '900' }))).toBeNull();
    expect(songChangeFromNote(note({ preset: 'ending', body: '96' }))).toBeNull();
    expect(songChangeFromNote(note({ preset: 'key', body: 'higher' }))).toBeNull();
    expect(songChangeFromNote(note({ preset: 'tempo', body: '96', songId: null }))).toBeNull();
  });
});
