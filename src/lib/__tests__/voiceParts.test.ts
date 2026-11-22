import { describe, expect, it } from 'vitest';
import {
  hasVoiceMarkers,
  instrumentVoicePart,
  isMyPart,
  lineVoice,
  normalizeVoiceLines,
  songVoiceParts,
  stripVoiceMarkers,
  voiceRuns,
} from '../voiceParts';
import { normalizeLyrics, parseLine, serializeLine, setWordChord, copySectionChords, textSections } from '../songFormat';
import { lineKey, lineWords, lyricsLineText, placeNotes, songLineRefs, type PersonalNote } from '../personalNotes';
import { sectionLines } from '../rehearsalNotes';

describe('voice markers', () => {
  it('strips every known marker and keeps chords and unknown braces', () => {
    expect(stripVoiceMarkers('{bv}[Am](ooh, [G]yeah){/bv}')).toBe('[Am](ooh, [G]yeah)');
    expect(stripVoiceMarkers('Lead {v2}and second{/v2} {ALL}all{/ALL} {sp}spoken{/sp}')).toBe('Lead and second all spoken');
    expect(stripVoiceMarkers('{title: Hudson Line}')).toBe('{title: Hudson Line}');
    expect(hasVoiceMarkers('{bv}ooh{/bv}')).toBe(true);
    expect(hasVoiceMarkers('[Am]plain')).toBe(false);
  });

  it('splits a line into runs by part, chords staying in the text', () => {
    expect(voiceRuns('[C]Paper boats {bv}(on the [G]river){/bv}')).toEqual([
      { voice: 'lead', text: '[C]Paper boats ' },
      { voice: 'bv', text: '(on the [G]river)' },
    ]);
    expect(voiceRuns('plain line')).toEqual([{ voice: 'lead', text: 'plain line' }]);
    // An unclosed marker ends with the line; a stray close is dropped.
    expect(voiceRuns('{v2}to the end')).toEqual([{ voice: 'v2', text: 'to the end' }]);
    expect(voiceRuns('stray{/bv} close')).toEqual([{ voice: 'lead', text: 'stray close' }]);
    // A new part closes the one before (no nesting).
    expect(voiceRuns('{bv}ooh {all}hey{/all}')).toEqual([
      { voice: 'bv', text: 'ooh ' },
      { voice: 'all', text: 'hey' },
    ]);
  });

  it('tells the part of a whole line, or mixed', () => {
    expect(lineVoice('{bv}(ooh, yeah){/bv}')).toBe('bv');
    expect(lineVoice('  {bv}(ooh){/bv}  ')).toBe('bv');
    expect(lineVoice('Plain')).toBe('lead');
    expect(lineVoice('Lead {bv}ooh{/bv}')).toBe('mixed');
  });

  it('lists the parts a song uses (none when it has only lead)', () => {
    expect(songVoiceParts('# Verse\nPlain\nwords')).toEqual([]);
    expect(songVoiceParts('Lead\n{bv}(ooh){/bv}\n{v2}high{/v2}')).toEqual(['lead', 'v2', 'bv']);
    expect(songVoiceParts('{all}Everyone{/all}')).toEqual(['all']);
  });
});

describe('chords inside and around markers (parseLine / serializeLine)', () => {
  it('reads clean words and writes markers back where they were', () => {
    const line = '{bv}[Am](ooh, [G]yeah){/bv} and [C]home';
    const m = parseLine(line);
    expect(m.words.map((w) => w.text)).toEqual(['(ooh,', 'yeah)', 'and', 'home']);
    expect(m.words[0].chords).toEqual([{ at: 0, chord: 'Am' }]);
    expect(serializeLine(m)).toBe(line);
  });

  it('keeps markers when a chord is set or cleared on a word', () => {
    const line = '{bv}(ooh, yeah){/bv} and home';
    expect(setWordChord(line, 0, 'Am')).toBe('{bv}[Am](ooh, yeah){/bv} and home');
    expect(setWordChord(setWordChord(line, 1, 'G'), 1, null)).toBe(line);
    expect(setWordChord('Lead {v2}high{/v2}', 1, 'D')).toBe('Lead {v2}[D]high{/v2}');
  });

  it('copies chords between sections without touching the target parts', () => {
    const lyrics = '# Verse 1\n[C]Paper [G]boats\n# Verse 2\n{bv}Paper boats{/bv}';
    const [v1, v2] = textSections(lyrics);
    expect(copySectionChords(lyrics, v1, v2).split('\n')[3]).toBe('{bv}[C]Paper [G]boats{/bv}');
  });
});

describe('normalizeLyrics with voice parts', () => {
  it('puts the opening marker before the chord of its first word', () => {
    expect(normalizeLyrics('[Am]{bv}(ooh){/bv}')).toBe('{bv}[Am](ooh){/bv}');
    expect(normalizeLyrics('[Am] {bv}(ooh){/bv}')).toBe('{bv}[Am](ooh){/bv}');
  });

  it('splits a part that spans lines into one span per line', () => {
    expect(normalizeLyrics('# Chorus\n{bv}ooh\nyeah{/bv}\nlead')).toBe('# Chorus\n{bv}ooh{/bv}\n{bv}yeah{/bv}\nlead');
    // A heading ends any open part.
    expect(normalizeLyrics('{v2}high\n# Bridge\nlow')).toBe('{v2}high{/v2}\n# Bridge\nlow');
  });

  it('lower-cases markers and leaves unknown braces alone', () => {
    expect(normalizeVoiceLines(['{BV}ooh{/BV}', '{foo} bar'])).toEqual(['{bv}ooh{/bv}', '{foo} bar']);
  });
});

describe('notes keep their line after parts are added (regression)', () => {
  const before = '# Chorus\n[C]Paper boats on the [G]river\n(ooh, yeah)\nPaper boats on the river';
  const after = '# Chorus\n{v2}[C]Paper boats on the [G]river{/v2}\n{bv}(ooh, yeah){/bv}\n{all}Paper boats on the river{/all}';

  it('matches the same line keys and words', () => {
    expect(songLineRefs(after).map((r) => [r.key, r.occ])).toEqual(songLineRefs(before).map((r) => [r.key, r.occ]));
    expect(lyricsLineText('{bv}(ooh, [G]yeah){/bv}')).toBe('(ooh, yeah)');
    expect(lineKey('{all}Paper Boats{/all}')).toBe('paper boats');
    expect(lineWords('{v2}[C]Paper boats{/v2}')).toEqual(['Paper', 'boats']);
  });

  it('places personal notes on the same drawn lines', () => {
    const notes: PersonalNote[] = [
      { id: 'a', song_id: 's', anchor: { type: 'line', line: 'paper boats on the river', occ: 1 }, body: 'softer' },
      { id: 'b', song_id: 's', anchor: { type: 'word', line: '(ooh, yeah)', occ: 0, word: 1 }, body: 'high' },
      { id: 'c', song_id: 's', anchor: { type: 'chord', line: 'paper boats on the river', occ: 0, chord: 'G' }, body: 'late' },
    ];
    const a = placeNotes(before, notes);
    const b = placeNotes(after, notes);
    expect(b.song).toEqual([]);
    expect([...b.byLine.entries()].map(([k, v]) => [k, v.map((n) => n.id)])).toEqual(
      [...a.byLine.entries()].map(([k, v]) => [k, v.map((n) => n.id)]),
    );
  });

  it('offers rehearsal note lines without markers', () => {
    expect(sectionLines(after, 'Chorus')).toEqual(sectionLines(before, 'Chorus'));
  });
});

describe('my part', () => {
  it('comes from the instrument', () => {
    expect(instrumentVoicePart('Lead vocals')).toBe('lead');
    expect(instrumentVoicePart('Guitar / Backing vocals')).toBe('bv');
    expect(instrumentVoicePart('Cori')).toBe('bv');
    expect(instrumentVoicePart('Second voice')).toBe('v2');
    expect(instrumentVoicePart('Singer')).toBe('lead');
    expect(instrumentVoicePart('Drums')).toBe(null);
    expect(instrumentVoicePart(null)).toBe(null);
  });

  it('counts "all" as everyone’s part', () => {
    expect(isMyPart('all', 'bv')).toBe(true);
    expect(isMyPart('bv', 'bv')).toBe(true);
    expect(isMyPart('lead', 'bv')).toBe(false);
    expect(isMyPart('sp', 'lead')).toBe(false);
  });
});
