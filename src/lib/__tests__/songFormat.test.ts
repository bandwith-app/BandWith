import { describe, expect, it } from 'vitest';
import {
  applyKeyFix,
  attachChords,
  availableViews,
  canonicalSectionName,
  checkKey,
  chordsMissingFromChart,
  copySectionChords,
  defaultSongView,
  guessKey,
  isBareChordLine,
  matchChartSection,
  mergeChordLine,
  normalizeLyrics,
  parseLine,
  parseSectionName,
  proposeChordsFromChart,
  resolveView,
  sectionLabel,
  sectionProgressions,
  serializeLine,
  setWordChord,
  songChords,
  textSections,
} from '../songFormat';
import type { SongChart } from '../ireal';

// Made-up lyrics only.
const t = (k: string, v?: Record<string, string | number>) => (v ? k.replace(/\{(\w+)\}/g, (_, n) => String(v[n])) : k);

const CHART: SongChart = {
  v: 1,
  source: 'ireal',
  title: 'Paper Boats',
  key: 'C',
  sections: [
    { label: 'A', bars: [{ chords: ['C'] }, { chords: ['G'] }, { chords: ['A-'] }, { chords: ['F'] }] },
    { label: 'B', bars: [{ chords: ['F'] }, { chords: ['G7'] }, { chords: ['C'] }, { chords: ['%'] }] },
  ],
};

describe('section names', () => {
  it('normalizes names in every language to one canonical name', () => {
    expect(canonicalSectionName('Rit.')).toBe('Chorus');
    expect(canonicalSectionName('RITORNELLO')).toBe('Chorus');
    expect(canonicalSectionName('Strofa 2')).toBe('Verse 2');
    expect(canonicalSectionName('2nd verse')).toBe('Verse 2');
    expect(canonicalSectionName('Pre-Chorus')).toBe('Pre-chorus');
    expect(canonicalSectionName('Estribillo x2')).toBe('Chorus x2');
    expect(canonicalSectionName('Ponte')).toBe('Bridge');
    expect(canonicalSectionName('Whistle part')).toBe('Whistle part');
  });
  it('reads iReal letters only when asked', () => {
    expect(parseSectionName('A').kind).toBeNull();
    expect(parseSectionName('A', { letters: true }).kind).toBe('verse');
  });
  it('shows names in the viewer’s language', () => {
    expect(sectionLabel('Verse 2', t)).toBe('Verse 2');
    expect(sectionLabel('Rit. x2', t)).toBe('Chorus x2');
  });
});

describe('chords attached to words', () => {
  it('attaches a chord before a space to the next word', () => {
    expect(attachChords('[C] Paper boats on the [G] river')).toBe('[C]Paper boats on the [G]river');
    expect(attachChords('[C] [G] [Am]')).toBe('[C] [G] [Am]');
  });
  it('merges a chord line over a lyric line', () => {
    expect(isBareChordLine('C        G')).toBe(true);
    expect(isBareChordLine('A lantern')).toBe(false);
    expect(mergeChordLine('C                   G', 'Paper boats on the river')).toBe('[C]Paper boats on the [G]river');
  });
  it('normalizes a whole text', () => {
    const raw = ['[Strofa]', 'C          Am', 'Lanterns in the rain', '', 'Rit.:', '[F] Hold the [G] line', '', '[Strofa]', 'Every light'].join('\n');
    expect(normalizeLyrics(raw)).toBe(
      ['# Verse 1', '[C]Lanterns in [Am]the rain', '', '# Chorus', '[F]Hold the [G]line', '', '# Verse 2', 'Every light'].join('\n'),
    );
  });
  it('keeps JSON lyrics as they are', () => {
    expect(normalizeLyrics('["one", "two"]')).toBe('["one", "two"]');
  });
});

describe('word model', () => {
  it('round-trips a line', () => {
    const line = '  [C]Paper bo[G]ats on the [Am]river [F]';
    const m = parseLine(line);
    expect(m.words.map((w) => w.text)).toEqual(['Paper', 'boats', 'on', 'the', 'river']);
    expect(m.words[1].chords).toEqual([{ at: 2, chord: 'G' }]);
    expect(m.tail).toEqual(['F']);
    expect(serializeLine(m)).toBe(line);
  });
  it('sets and removes a chord on a word', () => {
    expect(setWordChord('Paper boats', 1, 'Em')).toBe('Paper [Em]boats');
    expect(setWordChord('[C]Paper boats', 0, null)).toBe('Paper boats');
    expect(setWordChord('', -1, 'C')).toBe('[C]');
  });
  it('lists the song’s chords in order', () => {
    expect(songChords('[C]a [G]b [C]c [Am]d')).toEqual(['C', 'G', 'Am']);
  });
});

describe('sections', () => {
  const song = ['# Verse 1', '[C]Paper boats on the [G]river', '[Am]Lanterns in the [F]rain', '', '# Verse 2', 'Every light is a letter', 'Nobody signs their name'].join('\n');
  it('copies chords from one verse to another by word', () => {
    const [v1, v2] = textSections(song);
    const out = copySectionChords(song, v1, v2).split('\n');
    expect(out[5]).toBe('[C]Every light is a [G]letter');
    expect(out[6]).toBe('[Am]Nobody signs their [F]name');
  });
  it('proposes chords from the matching iReal section', () => {
    const sections = textSections(song);
    const chartSection = matchChartSection(CHART, 'Verse 2');
    expect(chartSection?.label).toBe('A');
    const out = proposeChordsFromChart(song, sections[1], chartSection!).split('\n');
    expect(out[5]).toBe('[C]Every light [G]is a letter');
    expect(out[6]).toBe('[Am]Nobody signs [F]their name');
  });
  it('gives each section its progression', () => {
    expect(sectionProgressions(song)[0]).toEqual({ name: 'Verse 1', chords: ['C', 'G', 'Am', 'F'] });
  });
});

describe('checks', () => {
  it('finds chords the chart doesn’t play', () => {
    expect(chordsMissingFromChart('[C]a [Am]b [Bb]c [G7]d', CHART)).toEqual(['Bb']);
    expect(chordsMissingFromChart('[A#]a', { ...CHART, sections: [{ label: null, bars: [{ chords: ['Bb'] }] }] })).toEqual([]);
  });
  it('guesses the key and proposes a transposition', () => {
    expect(guessKey(['D', 'A', 'Bm', 'G', 'D'])).toMatchObject({ pc: 2, minor: false });
    const fix = checkKey('[D]a [A]b [Bm]c [G]d [D]e', 'C');
    expect(fix).toEqual({ found: 'D', expected: 'C', semitones: -2 });
    expect(applyKeyFix('[D]a [A]b [Bm]c [G]d', fix!)).toBe('[C]a [G]b [Am]c [F]d');
    expect(checkKey('[C]a [G]b [Am]c [F]d', 'C')).toBeNull();
    expect(checkKey('[Am]a [F]b [C]c [G]d [Am]e', 'Am')).toBeNull();
  });
});

describe('views', () => {
  it('starts from the member’s instrument', () => {
    expect(defaultSongView('Lead vocals')).toBe('lyrics');
    expect(defaultSongView('Voce e chitarra')).toBe('chords');
    expect(defaultSongView('Batteria')).toBe('structure');
    expect(defaultSongView('Sax')).toBe('structure');
    expect(defaultSongView(null)).toBe('chords');
  });
  it('falls back to what the song has', () => {
    expect(availableViews({ lyrics: 'Just words' })).toEqual(['lyrics']);
    expect(resolveView('structure', { lyrics: 'Just words' })).toBe('lyrics');
    expect(availableViews({ lyrics: '[C]words', chart: CHART })).toEqual(['lyrics', 'chords', 'structure']);
    expect(resolveView('lyrics', { chart: CHART })).toBe('chords');
  });
});

describe('the score view (sheet music, Phase 1)', () => {
  const SCORE = 'sb://song-files/band/score/tune.mxl';
  it('is there only for a song with a score, after the others', () => {
    expect(availableViews({ lyrics: '[C]words', chart: CHART, score: SCORE })).toEqual(['lyrics', 'chords', 'structure', 'score']);
    expect(availableViews({ lyrics: 'Just words' })).not.toContain('score');
    expect(availableViews({ score: SCORE })).toEqual(['score']);
  });

  it('falls back both ways: a score-only song opens on the score, a song without one on its chart', () => {
    expect(resolveView('lyrics', { score: SCORE })).toBe('score');
    expect(resolveView('structure', { score: SCORE })).toBe('score');
    expect(resolveView('score', { lyrics: '[C]words', chart: CHART })).toBe('structure');
    expect(resolveView('score', { lyrics: 'Just words' })).toBe('lyrics');
    expect(resolveView('score', { lyrics: 'Just words', score: SCORE })).toBe('score');
  });
});
