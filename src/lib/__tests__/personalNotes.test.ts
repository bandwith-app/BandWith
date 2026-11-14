import { describe, expect, it } from 'vitest';
import { anchorLabel, lineChords, lineKey, lineWords, placeNotes, songLineRefs, type PersonalNote } from '../personalNotes';

// Made-up lyrics only.
const SONG = ['# Verse 1', '[C]Paper boats on the [G]river', '[Am]Lanterns in the [F]rain', '', '# Chorus', '[F]Hold the [G]line', '[F]Hold the [G]line'].join('\n');
const note = (id: string, anchor: PersonalNote['anchor']): PersonalNote => ({ id, song_id: 's', anchor, body: id });

describe('personal notes', () => {
  it('finds a line by its words, chords removed', () => {
    expect(lineKey('[C]Paper  boats on the [G]River')).toBe('paper boats on the river');
    const refs = songLineRefs(SONG);
    expect(refs.map((r) => `${r.section}:${r.index}:${r.occ}`)).toEqual(['0:0:0', '0:1:0', '1:0:0', '1:1:1']);
  });

  it('puts notes under their line, the repeated line by occurrence', () => {
    const notes = [
      note('a', { type: 'line', line: 'lanterns in the rain', occ: 0 }),
      note('b', { type: 'chord', line: 'hold the line', occ: 1, chord: 'G' }),
      note('c', { type: 'song' }),
    ];
    const placed = placeNotes(SONG, notes);
    expect(placed.byLine.get('0:1')?.map((n) => n.id)).toEqual(['a']);
    expect(placed.byLine.get('1:1')?.map((n) => n.id)).toEqual(['b']);
    expect(placed.song.map((n) => n.id)).toEqual(['c']);
  });

  it('keeps a note when the admin changes chords or moves sections', () => {
    const edited = ['# Chorus', '[D]Hold the [E]line', '', '# Verse 1', '[D]Lanterns in the [A]rain'].join('\n');
    const placed = placeNotes(edited, [note('a', { type: 'line', line: 'lanterns in the rain', occ: 0 })]);
    expect(placed.byLine.get('1:0')?.map((n) => n.id)).toEqual(['a']);
  });

  it('shows a note whose line is gone on the whole song', () => {
    const placed = placeNotes(SONG, [note('x', { type: 'word', line: 'a line that was cut', occ: 0, word: 1 })]);
    expect(placed.song.map((n) => n.id)).toEqual(['x']);
  });

  it('lists words and chords of a line for the anchor', () => {
    expect(lineWords('[C]Paper boats on the [G]river')).toEqual(['Paper', 'boats', 'on', 'the', 'river']);
    expect(lineChords('[F]Hold the [G]line [F]')).toEqual(['F', 'G']);
    expect(anchorLabel({ type: 'word', line: 'x', occ: 0, word: 1 }, '[C]Paper boats')).toBe('boats');
    expect(anchorLabel({ type: 'chord', line: 'x', occ: 0, chord: 'Am' })).toBe('Am');
    expect(anchorLabel({ type: 'song' })).toBeNull();
  });
});
