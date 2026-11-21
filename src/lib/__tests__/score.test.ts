import { describe, it, expect } from 'vitest';
import HARBOR from '../demo/scores/harbor-lights.musicxml?raw';
import NIGHT_FERRY from '../demo/scores/night-ferry.musicxml?raw';
import PAPER_BOATS from '../demo/scores/paper-boats.musicxml?raw';
import {
  DEMO_SCORE_PREFIX,
  isDemoScoreRef,
  isScoreFileName,
  osmdChordLabelTexts,
  osmdCustomChordNames,
  scoreContentType,
  scoreFacts,
  scoreKeyName,
  scoreTextAlternative,
  scoreXml,
  validateScoreFile,
} from '../score';


const enc = new TextEncoder();
/** A minimal zip with stored entries (method 0), as an .mxl. */
const zip = (files: Record<string, string>) => {
  const parts: number[] = [];
  const central: number[] = [];
  const le = (n: number, len: number) => Array.from({ length: len }, (_, i) => (n >>> (8 * i)) & 0xff);
  for (const [name, content] of Object.entries(files)) {
    const nameB = Array.from(enc.encode(name));
    const data = Array.from(enc.encode(content));
    const offset = parts.length;
    parts.push(...le(0x04034b50, 4), ...le(20, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4), ...le(0, 4));
    parts.push(...le(data.length, 4), ...le(data.length, 4), ...le(nameB.length, 2), ...le(0, 2), ...nameB, ...data);
    central.push(...le(0x02014b50, 4), ...le(20, 2), ...le(20, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4), ...le(0, 4));
    central.push(...le(data.length, 4), ...le(data.length, 4), ...le(nameB.length, 2), ...le(0, 2), ...le(0, 2));
    central.push(...le(0, 2), ...le(0, 2), ...le(0, 4), ...le(offset, 4), ...nameB);
  }
  const cdOffset = parts.length;
  const n = Object.keys(files).length;
  return new Uint8Array([
    ...parts,
    ...central,
    ...le(0x06054b50, 4), ...le(0, 2), ...le(0, 2), ...le(n, 2), ...le(n, 2), ...le(central.length, 4), ...le(cdOffset, 4), ...le(0, 2),
  ]);
};

const t = (k: string, v?: Record<string, string | number>) => k.replace(/\{(\w+)\}/g, (_, n) => String(v?.[n] ?? ''));

describe('score files', () => {
  it('takes MusicXML and compressed MusicXML by name', () => {
    expect(isScoreFileName('Tune.musicxml')).toBe(true);
    expect(isScoreFileName('tune.MXL')).toBe(true);
    expect(isScoreFileName('tune.xml')).toBe(true);
    expect(isScoreFileName('tune.pdf')).toBe(false);
    expect(isScoreFileName('tune')).toBe(false);
  });

  it('uploads with the MusicXML types the bucket allows (migration 170)', () => {
    expect(scoreContentType('tune.mxl')).toBe('application/vnd.recordare.musicxml');
    expect(scoreContentType('tune.musicxml')).toBe('application/vnd.recordare.musicxml+xml');
    expect(scoreContentType('tune.xml')).toBe('application/vnd.recordare.musicxml+xml');
    expect(scoreContentType('tune.pdf')).toBeNull();
  });

  it('says what is wrong with a picked file', () => {
    expect(validateScoreFile({ name: 'a.pdf', size: 10 }, t)).toMatch(/MusicXML/);
    expect(validateScoreFile({ name: 'a.mxl', size: 30 * 1024 * 1024 }, t)).toMatch(/20 MB/);
    expect(validateScoreFile({ name: 'a.mxl', size: 1000 }, t)).toBeNull();
  });

  it('reads plain and zipped MusicXML into the score text', async () => {
    expect(await scoreXml(enc.encode(HARBOR))).toContain('<score-partwise');
    const mxl = zip({
      'META-INF/container.xml': '<container><rootfiles><rootfile full-path="score/tune.musicxml"/></rootfiles></container>',
      'score/tune.musicxml': HARBOR,
    });
    expect(await scoreXml(mxl)).toContain('Harbor Lights');
  });

  it('refuses a file that is not a score', async () => {
    await expect(scoreXml(enc.encode('<html><body>hi</body></html>'))).rejects.toThrow('not-musicxml');
    await expect(scoreXml(enc.encode('not xml at all'))).rejects.toThrow('not-musicxml');
  });
});

describe('scoreFacts', () => {
  it('counts the bars of the part and reads its key and chords', () => {
    const f = scoreFacts(HARBOR);
    expect(f.bars).toBe(8);
    expect(f.title).toBe('Harbor Lights');
    expect(f.key).toBe('G');
    // BandWith's chord spelling (chordLabel), not OSMD's "Gmaj6".
    expect(f.chords).toEqual(['Gmaj7', 'Em7', 'Am7', 'D7', 'G6', 'Cmaj7', 'Bm7', 'E7', 'Am7', 'D7', 'Gmaj7']);
  });

  it('reads every demo score', () => {
    expect(scoreFacts(NIGHT_FERRY).bars).toBe(32);
    expect(scoreFacts(PAPER_BOATS).bars).toBe(16);
  });
});

describe('scoreKeyName', () => {
  it('names major and minor keys from the fifths', () => {
    expect(scoreKeyName(1, false)).toBe('G');
    expect(scoreKeyName(-3, false)).toBe('Eb');
    expect(scoreKeyName(0, true)).toBe('Am');
    expect(scoreKeyName(9, false)).toBeNull();
  });
});

describe('scoreTextAlternative', () => {
  it('lists bars, key and chords for screen readers', () => {
    const text = scoreTextAlternative(scoreFacts(HARBOR), 'Harbor Lights', 0, t);
    expect(text).toBe('Score: Harbor Lights. 8 bars, key of G. Chords: Gmaj7, Em7, Am7, D7, G6, Cmaj7, Bm7, E7, Am7, D7, Gmaj7.');
  });

  it('follows the transposition: key and chords move together', () => {
    const text = scoreTextAlternative(scoreFacts(HARBOR), 'Harbor Lights', 2, t);
    expect(text).toContain('key of A.');
    expect(text).toContain('Chords: Amaj7, F♯m7, Bm7, E7, A6');
  });
});

describe('osmdChordLabelTexts', () => {
  it('spells OSMD chord kinds the way the chord chart does', () => {
    const labels = osmdChordLabelTexts();
    expect(labels.majorsixth).toBe('6');
    expect(labels.majorseventh).toBe('maj7');
    expect(labels.minorseventh).toBe('m7');
    expect(labels.minor).toBe('m');
    expect(labels.dominant).toBe('7');
    expect(labels.halfdiminished).toBe('m7♭5');
    expect(labels.suspendedfourth).toBe('sus');
    expect(labels.major).toBeUndefined();
  });

  it("renames OSMD's built-in named chords the chart's way", () => {
    expect(osmdCustomChordNames()).toMatchObject({ '7sus4': '7sus', mi69: 'm69' });
  });
});

describe('demo scores', () => {
  it('recognises the demo references', () => {
    expect(isDemoScoreRef(`${DEMO_SCORE_PREFIX}harbor-lights.musicxml`)).toBe(true);
    expect(isDemoScoreRef('sb://song-files/b/score/x.mxl')).toBe(false);
    expect(isDemoScoreRef(null)).toBe(false);
  });
});
