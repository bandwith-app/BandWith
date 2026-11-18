import { describe, expect, it } from 'vitest';
import {
  SONG, parseSong, progression, songBody, transposeChord, transposeKey, transposeAll,
  prefersFlats, foldSemitones, semitoneLabel, pretty, pitchClass,
} from '../src/ui/demos/songs';

const chordsOf = (text: string) => [...text.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);

describe('Songs demo: transposing on your screen', () => {
  it('reads note names', () => {
    expect(pitchClass('C')).toBe(0);
    expect(pitchClass('F#')).toBe(6);
    expect(pitchClass('Bb')).toBe(10);
    expect(pitchClass('Cb')).toBe(11);
    expect(pitchClass('H')).toBeNull();
  });

  it('spells the moved key the way players write it', () => {
    expect(transposeKey('G', 0)).toBe('G');
    expect(transposeKey('G', 1)).toBe('Ab');
    expect(transposeKey('G', 2)).toBe('A');
    expect(transposeKey('G', -1)).toBe('F#');
    expect(transposeKey('G', -2)).toBe('F');
    expect(transposeKey('G', 3)).toBe('Bb');
    expect(transposeKey('G', 6)).toBe('Db');
    expect(transposeKey('G', 5)).toBe('C');
    expect(transposeKey('Em', 2)).toBe('F#m');
    expect(transposeKey('Em', 3)).toBe('Gm');
  });

  it('uses flats in flat keys and sharps in sharp keys', () => {
    expect(prefersFlats('G', 1)).toBe(true); // Ab
    expect(prefersFlats('G', 2)).toBe(false); // A
    expect(prefersFlats('G', -1)).toBe(false); // F#, not Gb
    expect(prefersFlats('G', -2)).toBe(true); // F
    expect(prefersFlats('Em', -2)).toBe(true); // Dm
  });

  it('moves root and bass and keeps the quality', () => {
    expect(transposeChord('D/F#', 1, true)).toBe('Eb/G');
    expect(transposeChord('D/F#', 2, false)).toBe('E/G#');
    expect(transposeChord('Bm7', 1, true)).toBe('Cm7');
    expect(transposeChord('Am7', -2, true)).toBe('Gm7');
    expect(transposeChord('G7', 3, true)).toBe('Bb7');
    expect(transposeChord('Em', 0, true)).toBe('Em');
    expect(transposeChord('N.C.', 4, false)).toBe('N.C.');
  });

  it('moves every chord of the song consistently for the target key', () => {
    const chords = ['G', 'G/B', 'Em', 'C', 'Bm7', 'Am7', 'G7'];
    expect(transposeAll(chords, 'G', 1)).toEqual(['Ab', 'Ab/C', 'Fm', 'Db', 'Cm7', 'Bbm7', 'Ab7']);
    expect(transposeAll(chords, 'G', 2)).toEqual(['A', 'A/C#', 'F#m', 'D', 'C#m7', 'Bm7', 'A7']);
    expect(transposeAll(chords, 'G', -1)).toEqual(['F#', 'F#/A#', 'D#m', 'B', 'A#m7', 'G#m7', 'F#7']);
    // Twelve semitones round is the same song.
    expect(transposeAll(chords, 'G', 12)).toEqual(chords);
  });

  it('counts the shorter way round and labels the offset', () => {
    expect(foldSemitones(7)).toBe(-5);
    expect(foldSemitones(6)).toBe(6);
    expect(foldSemitones(-6)).toBe(6);
    expect(foldSemitones(-13)).toBe(-1);
    expect(semitoneLabel(2)).toBe('+2');
    expect(semitoneLabel(-3)).toBe('−3');
    expect(semitoneLabel(0)).toBe('0');
    expect(pretty('Bb/F#')).toBe('B♭/F♯');
  });
});

describe('Songs demo: the song', () => {
  const sections = parseSong(SONG.text);

  it('is in the band format with named sections and inline chords', () => {
    expect(sections.map((s) => s.name)).toEqual(['Verse 1', 'Chorus', 'Verse 2']);
    expect(sections.every((s) => s.lines.length === 2)).toBe(true);
    expect(progression(sections[1])).toEqual(['C', 'D', 'Em', 'Bm7', 'C', 'D', 'G', 'G7']);
  });

  it('hides chords in Lyrics, shows them moved in Chords and Structure', () => {
    expect(songBody('lyrics', 0)).not.toContain('class="sgc"');
    const up = songBody('chords', 1);
    expect(up).toContain('>A♭/C<');
    expect(up).not.toContain('>G/B<');
    expect(songBody('structure', 2)).toContain('>C♯m7<');
    // The text itself, the band's copy, never changes.
    expect(chordsOf(SONG.text)).toContain('G/B');
  });

  it('spells every chord of the song inside the target key’s scale, at every offset', () => {
    const LETTERS = 'CDEFGAB';
    const NAT = [0, 2, 4, 5, 7, 9, 11];
    const notes = (c: string) => { const m = c.match(/^([A-G][b#]?).*?(?:\/([A-G][b#]?))?$/)!; return [m[1], m[2]].filter(Boolean) as string[]; };
    for (let k = -5; k <= 6; k++) {
      const key = transposeKey(SONG.key, k);
      const t = LETTERS.indexOf(key[0]);
      const tonic = pitchClass(key)!;
      // The major scale of the key, spelled one letter per degree.
      const scale = NAT.map((iv, d) => {
        const letter = LETTERS[(t + d) % 7];
        const diff = ((tonic + iv - NAT[LETTERS.indexOf(letter)]) % 12 + 18) % 12 - 6;
        return letter + (diff > 0 ? '#'.repeat(diff) : 'b'.repeat(-diff));
      });
      for (const c of transposeAll(chordsOf(SONG.text), SONG.key, k)) {
        for (const n of notes(c)) expect(scale, `${c} in ${key} (${k})`).toContain(n);
      }
    }
  });

  it('has no exclamation marks', () => {
    expect(SONG.text).not.toMatch(/!/);
  });
});
