import { describe, expect, it } from 'vitest';
import {
  changedLineCount,
  correctionKind,
  diffHunks,
  diffLines,
  notesWithNote,
  songChangedSince,
  stripChords,
} from '../songSuggestions';

// Made-up test lyrics only.
const SONG = ['# Verse 1', '[C]Paper boats on the [G]river', '[Am]Lanterns in the [F]rain', '', '[Chorus]', '[F]Hold the [G]line'].join('\n');

describe('stripChords', () => {
  it('drops inline chords and chord-only marks, keeps section names', () => {
    expect(stripChords('[Am]Hello [G7]there\n♪ [C] [G]\n[Chorus]')).toBe('Hello there\n[Chorus]');
  });
});

describe('correctionKind', () => {
  it('is null when nothing changed', () => {
    expect(correctionKind(SONG, `${SONG}\n`)).toBeNull();
  });
  it('is chords when only chords moved or changed', () => {
    expect(correctionKind(SONG, SONG.replace('[G]river', '[Em]river'))).toBe('chords');
    expect(correctionKind(SONG, SONG.replace('[C]Paper boats', 'Paper [C]boats'))).toBe('chords');
  });
  it('is lyrics when a word changed', () => {
    expect(correctionKind(SONG, SONG.replace('Lanterns', 'Lantern'))).toBe('lyrics');
  });
});

describe('diffLines', () => {
  it('marks changed lines only', () => {
    const d = diffLines(SONG, SONG.replace('[Am]Lanterns in the [F]rain', '[Am]Lanterns in the [F]snow'));
    expect(d.filter((x) => x.op === 'del').map((x) => x.text)).toEqual(['[Am]Lanterns in the [F]rain']);
    expect(d.filter((x) => x.op === 'add').map((x) => x.text)).toEqual(['[Am]Lanterns in the [F]snow']);
    expect(changedLineCount(d)).toBe(2);
    expect(d.length).toBe(7);
  });
  it('handles empty before (a first text) and inserted lines', () => {
    expect(diffLines('', 'a\nb')).toEqual([{ op: 'add', text: 'a' }, { op: 'add', text: 'b' }]);
    const d = diffLines('a\nc', 'a\nb\nc');
    expect(d).toEqual([{ op: 'same', text: 'a' }, { op: 'add', text: 'b' }, { op: 'same', text: 'c' }]);
  });
});

describe('diffHunks', () => {
  it('keeps context around changes and collapses the rest', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i}`);
    const after = [...lines];
    after[6] = 'changed';
    const h = diffHunks(diffLines(lines.join('\n'), after.join('\n')), 1);
    expect(h[0]).toBeNull();
    expect(h.filter(Boolean).map((x) => x!.text)).toEqual(['line 5', 'line 6', 'changed', 'line 7']);
    expect(h[h.length - 1]).toBeNull();
  });
});

describe('notesWithNote', () => {
  it('appends the note after the song notes', () => {
    expect(notesWithNote('', ' Count in four ')).toBe('Count in four');
    expect(notesWithNote('Capo 2\n', 'Count in four')).toBe('Capo 2\n\nCount in four');
  });
});

describe('songChangedSince', () => {
  it('compares the field the suggestion changes', () => {
    const s = { kind: 'lyrics' as const, original: { lyrics: SONG } };
    expect(songChangedSince(s, { lyrics: `${SONG}\n` })).toBe(false);
    expect(songChangedSince(s, { lyrics: `${SONG}\nmore` })).toBe(true);
    expect(songChangedSince({ kind: 'note', original: { notes: null } }, { notes: '' })).toBe(false);
    expect(songChangedSince({ kind: 'new_song', original: {} }, { lyrics: 'x' })).toBe(false);
  });
});
