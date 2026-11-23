import { describe, expect, it } from 'vitest';
import { parseLine, proposeChordsFromChart, songChords, textSections } from '../songFormat';
import type { ChartSection } from '../ireal';

// Audit 09 #12: a chart section "C D | E F" on the line "Hello again" gave
// "[C]Hello [E]again [D] [F]": chords landing on a taken word went to the end.
describe('chords from the chart keep their order', () => {
  const section: ChartSection = { label: 'A', bars: [{ chords: ['C', 'D'] }, { chords: ['E', 'F'] }] };

  it('keeps successive chords together on their word', () => {
    const lyrics = '# Verse\nHello again';
    const out = proposeChordsFromChart(lyrics, textSections(lyrics)[0], section).split('\n');
    expect(out[1]).toBe('[C][D]Hello [E][F]again');
    expect(songChords(out[1])).toEqual(['C', 'D', 'E', 'F']);
    const words = parseLine(out[1]).words;
    expect(words.map((w) => w.chords.map((c) => c.chord))).toEqual([['C', 'D'], ['E', 'F']]);
  });

  it('a line with one word holds every chord in order', () => {
    const lyrics = '# Verse\nHello';
    const out = proposeChordsFromChart(lyrics, textSections(lyrics)[0], section).split('\n');
    expect(out[1]).toBe('[C][D][E][F]Hello');
  });
});
