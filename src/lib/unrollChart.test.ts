import { describe, expect, it } from 'vitest';
import type { ChartBar, SongChart } from './ireal';
import { parseMusic } from './ireal';
import { MAX_BARS, unrollChart, unrolledSections } from './unrollChart';

/** A chart from sections written as bars: "C" is a bar with one chord; props add signs. */
type B = string | (Partial<ChartBar> & { c?: string });
const bar = (b: B): ChartBar => (typeof b === 'string' ? { chords: b.split(' ') } : { chords: b.c ? b.c.split(' ') : [], ...b, c: undefined } as ChartBar);
const chart = (sections: [string | null, B[]][], time = '4/4'): SongChart => ({
  v: 1,
  source: 'ireal',
  title: 'Test',
  time,
  sections: sections.map(([label, bars]) => ({ label, bars: bars.map(bar) })),
});
/** The first chord of each played bar, joined: "C D E". */
const played = (c: SongChart, opts?: { time?: string }) => unrollChart(c, opts).map((b) => b.chords[0] ?? '·').join(' ');

describe('unrollChart', () => {
  it('plays a chart with no road map as written, bar by bar', () => {
    const c = chart([['A', ['C', 'F', 'G', 'C']], ['B', ['Am', 'Dm']]]);
    expect(played(c)).toBe('C F G C Am Dm');
    const bars = unrollChart(c);
    expect(bars[4]).toMatchObject({ section: 1, bar: 0, label: 'B', time: '4/4', pass: 1 });
  });

  it('plays a { } repeat twice, numbering the passes', () => {
    const c = chart([['A', [{ c: 'C', repeatStart: true }, 'F', { c: 'G', repeatEnd: true }, 'Am']]]);
    expect(played(c)).toBe('C F G C F G Am');
    expect(unrollChart(c).map((b) => b.pass)).toEqual([1, 1, 1, 2, 2, 2, 1]);
  });

  it('plays the 1st ending, then the 2nd', () => {
    const c = chart([
      ['A', [{ c: 'C', repeatStart: true }, 'F', { c: 'G', ending: 1 }, { c: 'G7', repeatEnd: true }, { c: 'Am', ending: 2 }, 'Dm']],
      ['B', ['E']],
    ]);
    expect(played(c)).toBe('C F G G7 C F Am Dm E');
  });

  it('plays three endings in turn', () => {
    const c = chart([
      ['A', [{ c: 'C', repeatStart: true }, { c: 'D', ending: 1, repeatEnd: true }, { c: 'E', ending: 2, repeatEnd: true }, { c: 'F', ending: 3 }]],
    ]);
    expect(played(c)).toBe('C D C E C F');
  });

  it('reads "3x" and "x4" written in the repeat', () => {
    expect(played(chart([['A', [{ c: 'C', repeatStart: true, text: '3x' }, { c: 'G', repeatEnd: true }]]]))).toBe('C G C G C G');
    expect(played(chart([['A', [{ c: 'C', repeatStart: true }, { c: 'G', repeatEnd: true, text: 'x4' }]]]))).toBe('C G C G C G C G');
  });

  it('repeats a section marked "4x" with no repeat signs', () => {
    const c = chart([['Intro', ['C', { c: 'G', text: '4x' }]], ['A', ['F']]]);
    expect(played(c)).toBe('C G C G C G C G F');
  });

  it('"4x" on the first bar of a section repeats the whole section, not that bar', () => {
    const c = chart([['Vamp', [{ c: 'C', text: '4x' }, 'D', 'E']], ['A', ['F']]]);
    expect(played(c)).toBe('C D E C D E C D E C D E F');
    expect(unrollChart(c).map((b) => b.pass)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 1]);
  });

  it('after a 1st / 2nd ending block, a } with no { repeats from the double bar that closes it', () => {
    // {A |1.B} |2.C || D E} | F
    const c = chart([
      ['A', [{ c: 'A', repeatStart: true }, { c: 'B', ending: 1, repeatEnd: true }, { c: 'C', ending: 2, doubleEnd: true }, 'D', { c: 'E', repeatEnd: true }, 'F']],
    ]);
    expect(played(c)).toBe('A B A C D E D E F');
  });

  it('repeats a } with no { from the last double bar (or the start)', () => {
    expect(played(chart([['A', ['C', { c: 'G', repeatEnd: true }]]]))).toBe('C G C G');
    const c = chart([['A', ['C', { c: 'D', doubleEnd: true }]], ['B', ['E', { c: 'F', repeatEnd: true }, 'G']]]);
    expect(played(c)).toBe('C D E F E F G');
  });

  it('D.C. al Fine: back to the start, stop at Fine', () => {
    const c = chart([['A', ['C', { c: 'F', text: 'Fine' }]], ['B', ['Am', { c: 'G', text: 'D.C. al Fine' }]]]);
    expect(played(c)).toBe('C F Am G C F');
  });

  it('D.S. al Coda: back to the segno, at the coda sign jump to the coda', () => {
    const c = chart([
      ['Intro', ['E']],
      ['A', [{ c: 'C', segno: true }, { c: 'F', coda: true }, 'G']],
      ['B', ['Am', { c: 'Dm', text: 'D.S. al Coda', final: true }]],
      ['Coda', [{ c: 'Bb', coda: true }, { c: 'C', final: true }]],
    ]);
    expect(played(c)).toBe('E C F G Am Dm C F Bb C');
  });

  it('D.C. al Coda with "To Coda" written as text', () => {
    const c = chart([
      ['A', ['C', { c: 'F', text: 'To Coda' }, 'G']],
      ['B', [{ c: 'Am', text: 'D.C. al Coda' }]],
      ['Coda', [{ c: 'D', coda: true }, { c: 'E', final: true }]],
    ]);
    expect(played(c)).toBe('C F G Am C F D E');
  });

  it('after D.C. the repeat is not taken again and the last ending plays', () => {
    const c = chart([
      ['A', [{ c: 'C', repeatStart: true }, { c: 'D', ending: 1, repeatEnd: true }, { c: 'E', ending: 2 }]],
      ['B', [{ c: 'F', text: 'D.C.' }]],
    ]);
    expect(played(c)).toBe('C D C E F C E F');
  });

  it('D.C. al 2nd ending plays that ending, then stops', () => {
    const c = chart([
      ['A', [{ c: 'C', repeatStart: true }, { c: 'D', ending: 1, repeatEnd: true }, { c: 'E', ending: 2, final: true }]],
    ]);
    // Without a jump: C D C E, the end.
    expect(played(c)).toBe('C D C E');
    const withJump = chart([
      ['A', ['C', { c: 'D', ending: 1, repeatStart: false }, { c: 'G', text: 'D.C. al 2nd ending' }, { c: 'E', ending: 2, final: true }]],
    ]);
    expect(played(withJump)).toBe('C D G C E');
  });

  it('resolves % and %% to the bars they repeat (%% is one cell, two bars)', () => {
    const c = chart([['A', ['C', '%', 'F', 'G', { c: '%%', span: 2 }, 'Am']]]);
    const bars = unrollChart(c);
    expect(bars.map((b) => b.chords.join(' '))).toEqual(['C', 'C', 'F', 'G', 'F', 'G', 'Am']);
    // Both bars of %% point at the same cell on the chart.
    expect(bars[4]).toMatchObject({ section: 0, bar: 4 });
    expect(bars[5]).toMatchObject({ section: 0, bar: 4, part: 1 });
  });

  it('keeps time signature changes with their bar, also after a jump back', () => {
    const c = chart([['A', ['C', { c: 'F', time: '3/4' }, { c: 'G', time: '4/4', text: 'D.C. al Fine' }]], ['B', []]]);
    c.sections[0].bars[0].text = 'Fine';
    const bars = unrollChart(c);
    expect(bars.map((b) => `${b.chords[0]}:${b.time}`)).toEqual(['C:4/4', 'F:3/4', 'G:4/4', 'C:4/4']);
  });

  it("starts in the song's own time signature when the song gives one", () => {
    const c = chart([['A', ['C', 'G']]], '4/4');
    expect(unrollChart(c, { time: '6/8' }).map((b) => b.time)).toEqual(['6/8', '6/8']);
  });

  it('flags fermatas and "ad lib" / "vamp" / "on cue" bars to wait on', () => {
    const c = chart([['A', [{ c: 'C', fermata: true }, { c: 'F', text: 'vamp' }, { c: 'G', text: 'Solo ad lib' }, { c: 'Am', text: 'on cue' }, 'Dm']]]);
    expect(unrollChart(c).map((b) => !!b.hold)).toEqual([true, true, true, true, false]);
  });

  it('never loops forever on a broken road map', () => {
    // Two D.S. and repeats pointing at each other.
    const c = chart([['A', [{ c: 'C', segno: true, repeatStart: true }, { c: 'G', repeatEnd: true, text: 'D.S. al Coda x16' }]]]);
    const bars = unrollChart(c);
    expect(bars.length).toBeLessThanOrEqual(MAX_BARS);
    expect(bars.length).toBeGreaterThan(0);
    expect(unrollChart(null)).toEqual([]);
    expect(unrollChart({ ...c, sections: [] })).toEqual([]);
  });

  it('plays an iReal chart parsed from its music string', () => {
    // *A {C |F |N1G |G7 } N2A- |D- ] *B E |F Z
    const { sections, time } = parseMusic('T44*A{C |F |N1G |G7 }|N2A- |D- ]*B E |F Z');
    const c: SongChart = { v: 1, source: 'ireal', title: 'x', time, sections };
    expect(played(c)).toBe('C F G G7 C F A- D- E F');
  });
});

describe('unrolledSections', () => {
  it('splits the played bars into section passes, a repeat starting a new pass', () => {
    const c = chart([
      ['A', [{ c: 'C', repeatStart: true }, { c: 'G', repeatEnd: true }]],
      ['B', ['F', 'F']],
    ]);
    expect(unrolledSections(unrollChart(c))).toEqual([
      { label: 'A', section: 0, start: 0, length: 2 },
      { label: 'A', section: 0, start: 2, length: 2 },
      { label: 'B', section: 1, start: 4, length: 2 },
    ]);
  });
});
