import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CHORD_SYMBOL_TOKENS,
  IREAL_MARKERS,
  IREAL_PREFIXES,
  LEGEND_SYMBOLS,
  MUSIC_SYMBOLS,
  chordTokenSymbol,
  clearUnknownMarkers,
  irealTime,
  isPlayedChord,
  textSymbols,
  unknownMarkers,
} from '../musicSymbols';
import { parseMusic, unscrambleMusic } from '../ireal';
import it_ from '../i18n/locales/it';
import es from '../i18n/locales/es';
import fr from '../i18n/locales/fr';
import de from '../i18n/locales/de';
import pt from '../i18n/locales/pt';

// Made-up charts (no real song) that use every marker iReal Pro writes.
const CORPUS = [
  // Repeats, endings, segno/coda, D.C., time change, small/large, spacers, fermata, slash, two-bar repeat, end.
  '{*AT44C^7 A-7 |D-7 G7 |N1E-7 A7 }|N2D-7 G7 |C6 |x Z' +
    '*B[Fh7 Bb7b9 |Ebo7 |S<D.C. al Coda>Ab-^7/G |Q n Z',
  '[*iT34sC,lG7,|fC p p |r|   |T44Bb^7 |YC7(Db7) |<Fine>F6 ]' +
    '*v[W/E A-7 |<3x>D7sus |<D.S. al 2nd End.>G7 U]',
  // Spellings from the old irealbook:// format and the shorthand expansions.
  unscrambleMusic('1r34LbKcu7[T44C^7XyQLZKcl LZD-7 G7 Z'),
];

describe('musicSymbols registry', () => {
  beforeEach(() => clearUnknownMarkers());
  afterAll(() => {
    // Logged so a new marker shows in the test output, not on someone's screen.
    if (unknownMarkers().size) console.warn('Unknown chart markers:', Object.fromEntries(unknownMarkers()));
  });

  it('gives every iReal marker and chord token a known symbol', () => {
    for (const id of [...Object.values(IREAL_MARKERS), ...Object.values(IREAL_PREFIXES), ...Object.values(CHORD_SYMBOL_TOKENS), ...LEGEND_SYMBOLS]) {
      expect(MUSIC_SYMBOLS[id], id).toBeDefined();
    }
  });

  it('reads the whole corpus without an unknown marker', () => {
    for (const music of CORPUS) parseMusic(music);
    expect(Object.fromEntries(unknownMarkers())).toEqual({});
  });

  it('reports a marker it does not know instead of drawing it', () => {
    parseMusic('[C7 |@ |D7 ]');
    expect(unknownMarkers().get('@')).toBe(1);
  });

  it('tells symbol tokens from chords', () => {
    expect(chordTokenSymbol('%')).toBe('repeat-bar');
    expect(chordTokenSymbol('%%')).toBe('repeat-two-bars');
    expect(chordTokenSymbol('N.C.')).toBe('no-chord');
    expect(chordTokenSymbol('/')).toBe('slash');
    expect(chordTokenSymbol('C^7')).toBeNull();
    expect(isPlayedChord('Bb7/D')).toBe(true);
    expect(isPlayedChord('%')).toBe(false);
  });

  it('reads iReal time signatures', () => {
    expect(irealTime('44')).toBe('4/4');
    expect(irealTime('34')).toBe('3/4');
    expect(irealTime('68')).toBe('6/8');
    expect(irealTime('12')).toBe('12/8');
    expect(irealTime('4')).toBeNull();
  });

  it('reads the road map written on a bar', () => {
    expect(textSymbols('D.C. al Coda')).toEqual([{ id: 'dc-al-coda' }]);
    expect(textSymbols('D.S. al Fine')).toEqual([{ id: 'ds-al-fine' }]);
    expect(textSymbols('D.C. al 2nd End.')).toEqual([{ id: 'dc-al-ending', n: 2 }]);
    expect(textSymbols('D.S. al 1st End.')).toEqual([{ id: 'ds-al-ending', n: 1 }]);
    expect(textSymbols('DC al Coda')).toEqual([{ id: 'dc-al-coda' }]);
    expect(textSymbols('Fine')).toEqual([{ id: 'fine' }]);
    expect(textSymbols('3x')).toEqual([{ id: 'repeat-times', n: 3 }]);
    expect(textSymbols('x4')).toEqual([{ id: 'repeat-times', n: 4 }]);
    expect(textSymbols('To Coda')).toEqual([{ id: 'to-coda' }]);
    expect(textSymbols('D.C. on cue')).toEqual([{ id: 'dc' }]);
    expect(textSymbols('Fine D.S. al Coda')).toEqual([{ id: 'fine' }, { id: 'ds-al-coda' }]);
  });

  it('keeps a player’s own words as a comment', () => {
    expect(textSymbols('Solo on AABA')).toEqual([{ id: 'comment', text: 'Solo on AABA' }]);
    expect(textSymbols('')).toEqual([]);
    expect(textSymbols(undefined)).toEqual([]);
  });

  it('names every symbol in all five languages', () => {
    const missing: string[] = [];
    for (const [lang, dict] of Object.entries({ it: it_, es, fr, de, pt })) {
      for (const def of Object.values(MUSIC_SYMBOLS)) {
        if (def.render === 'hidden') continue;
        if (!(dict as Record<string, string>)[def.name]) missing.push(`${lang}: ${def.name}`);
      }
      for (const key of ['Symbols', 'Full screen', 'Exit full screen', 'What the symbols mean']) {
        if (!(dict as Record<string, string>)[key]) missing.push(`${lang}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
