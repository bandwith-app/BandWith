import { describe, expect, it } from 'vitest';
import {
  applyVoiceSuggestions,
  assignedParts,
  effectiveVocalParts,
  isMyPart,
  lyricsForExport,
  parseVocalParts,
  setLineVoice,
  suggestVoiceParts,
  wordVoices,
} from '../voiceParts';
import { normalizeLyrics } from '../songFormat';

describe('Voice picker: set a part on a line or a few words', () => {
  it('reads the part of each word', () => {
    expect(wordVoices('Lead {bv}(ooh, [Am]yeah){/bv} home')).toEqual(['lead', 'bv', 'bv', 'lead']);
    expect(wordVoices('{v2}[C]Paper boats{/v2}')).toEqual(['v2', 'v2']);
  });

  it('marks the whole line, chords kept, and a second tap clears it', () => {
    const line = '[C]Paper boats on the [G]river';
    const bv = setLineVoice(line, 'bv');
    expect(bv).toBe('{bv}[C]Paper boats on the [G]river{/bv}');
    expect(setLineVoice(bv, 'bv')).toBe(line);
    expect(setLineVoice(bv, 'lead')).toBe(line);
    expect(setLineVoice(bv, 'all')).toBe('{all}[C]Paper boats on the [G]river{/all}');
  });

  it('marks a few words only', () => {
    const line = '[C]Paper boats on the [G]river';
    expect(setLineVoice(line, 'v2', { from: 3, to: 4 })).toBe('[C]Paper boats on {v2}the [G]river{/v2}');
    const two = setLineVoice(setLineVoice(line, 'v2', { from: 3, to: 4 }), 'bv', { from: 0, to: 0 });
    expect(two).toBe('{bv}[C]Paper{/bv} boats on {v2}the [G]river{/v2}');
    // Tapping the same part on those words again clears just them.
    expect(setLineVoice(two, 'v2', { from: 3, to: 4 })).toBe('{bv}[C]Paper{/bv} boats on the [G]river');
    expect(setLineVoice(line, 'v2', { from: 4, to: 3 })).toBe('[C]Paper boats on {v2}the [G]river{/v2}');
  });

  it('keeps a line already in the band’s form after normalizeLyrics', () => {
    const line = setLineVoice('[C]Paper boats on the [G]river', 'bv', { from: 1, to: 2 });
    expect(line).toBe('[C]Paper {bv}boats on{/bv} the [G]river');
    expect(normalizeLyrics(line)).toBe(line);
  });
});

describe('one-tap suggestion on paste or import', () => {
  const TEXT = ['# Chorus', '[C]Paper boats on the river', '(ooh, [Am]yeah)', 'All: all the way home', 'Tutti: fino a casa', '  ( hey )  ', '(not) closed here'].join('\n');

  it('proposes backing for lines in parentheses and all for "All:" / "Tutti:"', () => {
    expect(suggestVoiceParts(TEXT)).toEqual([
      { line: 2, voice: 'bv' },
      { line: 3, voice: 'all' },
      { line: 4, voice: 'all' },
      { line: 5, voice: 'bv' },
    ]);
  });

  it('applies them only when asked, dropping the "All:" label', () => {
    const out = applyVoiceSuggestions(TEXT, suggestVoiceParts(TEXT)).split('\n');
    expect(out[2]).toBe('{bv}(ooh, [Am]yeah){/bv}');
    expect(out[3]).toBe('{all}all the way home{/all}');
    expect(out[4]).toBe('{all}fino a casa{/all}');
    expect(out[5]).toBe('  {bv}( hey ){/bv}');
    expect(out[6]).toBe('(not) closed here');
  });

  it('skips lines that already have a part', () => {
    expect(suggestVoiceParts('{v2}(ooh){/v2}\nAll: {bv}hey{/bv}')).toEqual([]);
  });
});

describe('who sings what', () => {
  const me = '11111111-1111-4111-8111-111111111111';
  const sam = '22222222-2222-4222-8222-222222222222';

  it('reads only known parts and ids from the stored json', () => {
    expect(parseVocalParts({ bv: [me, sam, me, 3], v2: 'x', foo: [me], lead: [] })).toEqual({ bv: [me, sam] });
    expect(parseVocalParts(null)).toBeNull();
    expect(parseVocalParts('nope')).toBeNull();
    expect(parseVocalParts({})).toBeNull();
  });

  it('takes the setlist’s override over the song’s', () => {
    expect(effectiveVocalParts({ bv: [me] }, { bv: [sam] })).toEqual({ bv: [sam] });
    expect(effectiveVocalParts({ bv: [me] }, null)).toEqual({ bv: [me] });
    expect(effectiveVocalParts(null, null)).toBeNull();
  });

  it('gives my parts, or nothing so the instrument decides', () => {
    expect(assignedParts({ lead: [me], sp: [me], bv: [sam] }, me)).toEqual(['lead', 'sp']);
    expect(assignedParts({ bv: [sam] }, me)).toBeUndefined();
    expect(assignedParts(null, me)).toBeUndefined();
    expect(isMyPart('sp', ['lead', 'sp'])).toBe(true);
    expect(isMyPart('bv', ['lead', 'sp'])).toBe(false);
  });
});

describe('export', () => {
  const LYRICS = '# Chorus\n{bv}(ooh, [Am]yeah){/bv}\nLead and {v2}high{/v2}\n{all}Home{/all}';
  const names = { lead: 'Lead', v2: '2nd voice', bv: 'Backing', all: 'All', sp: 'Spoken' };

  it('strips the parts', () => {
    expect(lyricsForExport(LYRICS, 'strip', names)).toBe('# Chorus\n(ooh, [Am]yeah)\nLead and high\nHome');
  });

  it('writes them as labels', () => {
    expect(lyricsForExport(LYRICS, 'labels', names)).toBe('# Chorus\nBacking: (ooh, [Am]yeah)\nLead and (2nd voice: high)\nAll: Home');
  });
});

describe('rehearsal notes on a line show its part', () => {
  const LYRICS = '# Verse 1\nPaper boats\n# Chorus\n[F]Hold the line\n{bv}(ooh, [G]yeah){/bv}\nMorning comes';
  it('finds the part and the line number in its section', async () => {
    const { linePart } = await import('../rehearsalNotes');
    expect(linePart(LYRICS, 'Chorus', '(ooh, yeah)')).toEqual({ voice: 'bv', index: 2 });
    expect(linePart(LYRICS, 'Chorus', 'Hold the line')).toEqual({ voice: 'lead', index: 1 });
    expect(linePart(LYRICS, null, '(ooh, yeah)')).toEqual({ voice: 'bv', index: 2 });
    expect(linePart(LYRICS, 'Chorus', 'Not in the song')).toBeNull();
    expect(linePart(null, 'Chorus', '(ooh, yeah)')).toBeNull();
  });
});

describe('ChordPro export', () => {
  it('writes the song with sections and the parts as labels, or stripped', async () => {
    const { songToChordPro } = await import('../voiceParts');
    const names = { lead: 'Lead', v2: '2nd voice', bv: 'Backing', all: 'All', sp: 'Spoken' };
    const song = { title: 'Paper Boats', artist: 'The Demo Band', key: 'C', lyrics: '# Chorus\n[F]Hold the line\n{bv}(ooh, [G]yeah){/bv}' };
    expect(songToChordPro(song, 'labels', names)).toBe(
      '{title: Paper Boats}\n{artist: The Demo Band}\n{key: C}\n\n{comment: Chorus}\n[F]Hold the line\nBacking: (ooh, [G]yeah)\n',
    );
    expect(songToChordPro({ ...song, artist: null, key: null }, 'strip', names)).toBe('{title: Paper Boats}\n\n{comment: Chorus}\n[F]Hold the line\n(ooh, [G]yeah)\n');
  });
});
