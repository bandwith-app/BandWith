import { describe, expect, it } from 'vitest';
import type { SongChart } from './ireal';
import { barMs, beatOfTick, meterOf, normalizeTime, parseGrouping, songMeter, tickBpm, tickMs } from './meter';
import { liveLines, lyricsHash, timingFromBars, validLineTiming } from './lineTiming';
import {
  buildTimeline,
  canFollow,
  continuePlayhead,
  holdSection,
  parsePlayheadState,
  playheadAt,
  realign,
  releaseHold,
  setPlayheadSpeed,
  startPlayhead,
  stopPlayhead,
  tickToBar,
} from './playhead';

const chart = (sections: [string, { chords: string[]; fermata?: boolean; time?: string; text?: string }[]][], time = '4/4'): SongChart => ({
  v: 1,
  source: 'ireal',
  title: 'Brooklyn Bridge Blues',
  time,
  sections: sections.map(([label, bars]) => ({ label, bars })),
});
const bars = (...c: string[]) => c.map((x) => ({ chords: [x] }));

describe('meter', () => {
  it('counts simple meters beat by beat', () => {
    expect(meterOf('4/4').beats).toEqual([1, 1, 1, 1]);
    expect(meterOf('3/4').beats).toEqual([1, 1, 1]);
    expect(meterOf('2/4').beats).toEqual([1, 1]);
    expect(meterOf('5/4').beats).toEqual([1, 1, 1, 1, 1]);
  });

  it('counts 6/8 and 12/8 in dotted beats of three eighths', () => {
    expect(meterOf('6/8')).toMatchObject({ beats: [3, 3], compound: true, starts: [0, 3] });
    expect(meterOf('12/8')).toMatchObject({ beats: [3, 3, 3, 3], compound: true });
    // BPM is the dotted beat: 6/8 at 60 = one second a dotted beat, two a bar.
    expect(barMs(meterOf('6/8'), 60)).toBeCloseTo(2000);
    expect(tickBpm(meterOf('6/8'), 60)).toBeCloseTo(180);
  });

  it('groups odd meters: the chart’s own grouping, else twos and a three', () => {
    expect(meterOf('7/8').beats).toEqual([2, 2, 3]);
    expect(meterOf('5/8').beats).toEqual([2, 3]);
    expect(meterOf('7/8', [3, 2, 2]).beats).toEqual([3, 2, 2]);
    expect(meterOf('7/8', [3, 3]).beats).toEqual([2, 2, 3]); // doesn't add up: ignored
    // BPM is the quarter: a 7/8 at 120 is 3.5 quarters.
    expect(barMs(meterOf('7/8'), 120)).toBeCloseTo(1750);
    expect(tickMs(meterOf('7/8'), 120)).toBeCloseTo(250);
  });

  it('reads the grouping written on the chart', () => {
    expect(parseGrouping('2+2+3', 7)).toEqual([2, 2, 3]);
    expect(parseGrouping('Solo (3 + 2 + 2)', 7)).toEqual([3, 2, 2]);
    expect(parseGrouping('2+2', 7)).toBeNull();
    const c = chart([['A', [{ chords: ['C'], text: '3+2+2' }]]], '7/8');
    expect(songMeter({ chart: c }).beats).toEqual([3, 2, 2]);
  });

  it("prefers the song's time signature, then the chart's, then 4/4", () => {
    expect(songMeter({ timeSignature: '3/4', chart: chart([['A', bars('C')]], '4/4') }).time).toBe('3/4');
    expect(songMeter({ chart: chart([['A', bars('C')]], '6/8') }).time).toBe('6/8');
    expect(songMeter({}).time).toBe('4/4');
    expect(normalizeTime(' 12 / 8 ')).toBe('12/8');
    expect(normalizeTime('4/3')).toBeNull();
    expect(normalizeTime('waltz')).toBeNull();
  });

  it("6/8 or 7/8 only from the chart (iReal, or no meter picked): the BPM counts every eighth, as before live mode", () => {
    const fromChart = songMeter({ chart: chart([['A', bars('C')]], '6/8') });
    expect(fromChart.perTick).toBe(true);
    expect(tickMs(fromChart, 120)).toBeCloseTo(500);
    expect(barMs(fromChart, 120)).toBeCloseTo(3000);
    expect(barMs(songMeter({ chart: chart([['A', bars('C')]], '7/8') }), 120)).toBeCloseTo(3500);
    // The admin picked 6/8 (even the chart's own): the BPM is the dotted beat.
    const picked = songMeter({ timeSignature: '6/8', chart: chart([['A', bars('C')]], '6/8') });
    expect(picked.perTick).toBeFalsy();
    expect(barMs(picked, 120)).toBeCloseTo(1000);
    // x/4 is the same either way.
    expect(barMs(songMeter({ chart: chart([['A', bars('C')]], '3/4') }), 120)).toBeCloseTo(1500);
  });

  it('a time change inside a chart-only song keeps the same BPM rule', () => {
    const c = chart([['A', [{ chords: ['C'] }, { chords: ['F'], time: '6/8' }]]], '4/4');
    const t = buildTimeline({ bpm: 120, chart: c });
    expect(t!.bars[1].meter.perTick).toBe(true);
    const picked = buildTimeline({ bpm: 120, timeSignature: '4/4', chart: c });
    expect(picked!.bars[1].meter.perTick).toBeFalsy();
  });

  it('finds the counted beat of a tick', () => {
    const m = meterOf('7/8');
    expect([0, 1, 2, 3, 4, 5, 6].map((t) => beatOfTick(m, t).beat)).toEqual([0, 0, 1, 1, 2, 2, 2]);
    expect(beatOfTick(m, 4).first).toBe(true);
    expect(beatOfTick(m, 5).first).toBe(false);
  });
});

describe('line timing', () => {
  it('keeps a line sung in the pickup (before bar 1), down to a bar of ticks early; refuses further', async () => {
    const { asLineTiming, MIN_LINE_TICK } = await import('./lineTiming');
    const lyrics = '# Verse\nOh\nOne\nTwo';
    const t = { ...timingFromBars(lyrics, [1, 1, 1], 4), at: [-1, 0, 4] };
    expect(asLineTiming(t)?.at).toEqual([-1, 0, 4]);
    expect(validLineTiming(t, lyrics)).not.toBeNull();
    expect(asLineTiming({ ...t, at: [MIN_LINE_TICK - 1, 0, 4] })).toBeNull();
    const c = chart([['Verse', bars('C', 'F')]]);
    const tl = buildTimeline({ chart: c, lyrics, lineTiming: t })!;
    expect(tl.lines[0]).toBeLessThan(0);
    const T = 1_000_000;
    const head = startPlayhead({ from: 'l', songId: 's', bpm: 120, startAt: T });
    expect(playheadAt(tl, head, T + 100).line).toBe(1);
  });

  const lyrics = '# Verse\n[C]Crossing the [F]bridge at night\nLights on the river\n\n# Chorus\n{bv}(ooh){/bv} Brooklyn [G]calls';

  it('lists the lines with words only (no chords, no voice markers)', () => {
    expect(liveLines(lyrics)).toEqual([
      { section: 0, line: 0, text: 'Crossing the bridge at night' },
      { section: 0, line: 1, text: 'Lights on the river' },
      { section: 1, line: 0, text: '(ooh) Brooklyn calls' },
    ]);
  });

  it('keeps the timing when only chords change, drops it when the words change', () => {
    const t = timingFromBars(lyrics, [2, 2, 4], 4);
    expect(t.at).toEqual([0, 8, 16]);
    expect(validLineTiming(t, lyrics)).not.toBeNull();
    expect(validLineTiming(t, lyrics.replace('[F]', '[Am]'))).not.toBeNull();
    expect(validLineTiming(t, lyrics.replace('Lights', 'Lamps'))).toBeNull();
    expect(validLineTiming(t, lyrics + '\nOne more line')).toBeNull();
    expect(validLineTiming({ v: 2 }, lyrics)).toBeNull();
    expect(lyricsHash(lyrics)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('timeline', () => {
  it('plays out the chart, with sections and the lyric lines on the matching sections', () => {
    const c = chart([['Verse', bars('C', 'F', 'G', 'C')], ['Chorus', bars('F', 'G')]]);
    const tl = buildTimeline({ chart: c, lyrics: '# Verse\nOne\nTwo\n# Chorus\nThree' })!;
    expect(tl.source).toBe('chart');
    expect(tl.bars).toHaveLength(6);
    expect(tl.sections.map((s) => [s.label, s.start, s.length])).toEqual([
      ['Verse', 0, 4],
      ['Chorus', 4, 2],
    ]);
    expect(tl.lines).toEqual([0, 2, 4]);
    expect(tl.timedLines).toBe(false);
  });

  it('uses the stored line timing (in ticks) when it matches the lyrics', () => {
    const lyrics = '# Verse\nOne\nTwo\nThree';
    const c = chart([['Verse', bars('C', 'F', 'G', 'C')]]);
    const tl = buildTimeline({ chart: c, lyrics, lineTiming: timingFromBars(lyrics, [1, 1, 2], 4) })!;
    expect(tl.lines).toEqual([0, 1, 2]);
    expect(tl.timedLines).toBe(true);
    expect(tickToBar(tl.bars, 6)).toBe(1.5);
  });

  it('with no chart: lyric sections, two bars a line, "x2" twice, stretched to the song length', () => {
    const tl = buildTimeline({ lyrics: '# Verse\nA\nB\n# Chorus x2\nC' })!;
    expect(tl.source).toBe('lyrics');
    expect(tl.sections.map((s) => [s.label, s.length])).toEqual([
      ['Verse', 4],
      ['Chorus x2', 2],
      ['Chorus x2', 2],
    ]);
    // 4/4 at 120 = 2 s a bar; 32 s → 16 bars instead of 8.
    const long = buildTimeline({ lyrics: '# Verse\nA\nB\n# Chorus x2\nC', bpm: 120, durationSeconds: 32 })!;
    expect(long.bars).toHaveLength(16);
    expect(buildTimeline({})).toBeNull();
  });

  it('a two-line "Chorus x2": the second pass has the lines too, and the playhead shows them', () => {
    const tl = buildTimeline({ lyrics: '# Verse\nA\nB\n# Chorus x2\nC\nD' })!;
    // Verse 0–4, Chorus 4–8, Chorus again 8–12: two bars a line.
    expect(tl.lines).toEqual([0, 2, 4, 6]);
    expect(tl.cues).toEqual([
      { at: 0, line: 0 },
      { at: 2, line: 1 },
      { at: 4, line: 2 },
      { at: 6, line: 3 },
      { at: 8, line: 2 },
      { at: 10, line: 3 },
    ]);
    const T = 1_000_000;
    const head = startPlayhead({ from: 'l', songId: 's', bpm: 120, startAt: T });
    // 4/4 at 120: 2 s a bar. Bar 9 = the second chorus' first line.
    expect(playheadAt(tl, head, T + 9 * 2000).line).toBe(2);
    expect(playheadAt(tl, head, T + 11 * 2000).line).toBe(3);
  });

  it('with a chart: a lyric "Chorus x2" goes on the next two choruses of the chart', () => {
    const c = chart([['Verse', bars('C', 'F')], ['Chorus', bars('F', 'G')], ['Chorus', bars('F', 'G')]]);
    const tl = buildTimeline({ chart: c, lyrics: '# Verse\nOne\n# Chorus x2\nTwo\nThree' })!;
    expect(tl.cues.map((q) => [q.at, q.line])).toEqual([
      [0, 0],
      [2, 1],
      [3, 2],
      [4, 1],
      [5, 2],
    ]);
  });

  it('can follow a song with a BPM and a chart or lyrics', () => {
    expect(canFollow({ bpm: 96, lyrics: 'One line' })).toBe(true);
    expect(canFollow({ bpm: null, lyrics: 'One line' })).toBe(false);
    expect(canFollow({ bpm: 96 })).toBe(false);
  });
});

describe('playhead', () => {
  // 4/4 at 120: 2 s a bar. A (4 bars) B (2 bars, the last with a fermata) C (2 bars).
  const c = chart([
    ['A', bars('C', 'F', 'G', 'C')],
    ['B', [{ chords: ['Am'] }, { chords: ['G'], fermata: true }]],
    ['C', bars('F', 'C')],
  ]);
  const tl = buildTimeline({ chart: c })!;
  const T = 1_000_000;
  const start = startPlayhead({ from: 'leader', songId: 's1', bpm: 120, startAt: T });

  it('derives bar, beat, section and the next section from the start time', () => {
    expect(playheadAt(tl, start, T - 500)).toMatchObject({ before: true, bar: 0 });
    expect(playheadAt(tl, start, T + 500)).toMatchObject({ bar: 0, beat: 1, section: 0, next: 1, barsToNext: 4 });
    expect(playheadAt(tl, start, T + 6_100)).toMatchObject({ bar: 3, beat: 0, barsToNext: 1 });
    expect(playheadAt(tl, start, T + 8_000)).toMatchObject({ bar: 4, section: 1 });
  });

  it('applies the clock offset like the click (their clock minus mine)', () => {
    // My clock is 300 ms behind the leader's: at my T + 1700 it is their T + 2000.
    expect(playheadAt(tl, start, T + 1_700, 300).bar).toBe(1);
  });

  it('waits at the end of a fermata bar, then continues from the next bar on the tap', () => {
    const at = playheadAt(tl, start, T + 30_000);
    expect(at).toMatchObject({ bar: 5, waiting: true, done: false });
    const next = continuePlayhead(start, T + 30_000, tl);
    expect(next.seq).toBeGreaterThan(start.seq);
    expect(playheadAt(tl, next, T + 30_100)).toMatchObject({ bar: 6, waiting: false, section: 2 });
  });

  it('a fermata on the last bar: Continue ends the song (it does not play the bar again)', () => {
    const end = buildTimeline({ chart: chart([['A', [{ chords: ['C'] }, { chords: ['G'], fermata: true }]]]) })!;
    const head = startPlayhead({ from: 'leader', songId: 's1', bpm: 120, startAt: T });
    expect(playheadAt(end, head, T + 10_000)).toMatchObject({ bar: 1, waiting: true, done: false });
    const next = continuePlayhead(head, T + 10_000, end);
    expect(playheadAt(end, next, T + 10_100)).toMatchObject({ bar: 1, waiting: false, done: true });
    expect(playheadAt(end, next, T + 14_000)).toMatchObject({ done: true });
    expect(parsePlayheadState(next)).toEqual(next);
  });

  it('re-aligns to a tapped bar: that bar starts now', () => {
    const moved = realign(start, 4, T + 1_000, tl);
    expect(playheadAt(tl, moved, T + 1_000 + 2_500)).toMatchObject({ bar: 5 });
  });

  it('Hold repeats the current section until released, then carries on', () => {
    const held = holdSection(start, T + 3_000, tl); // bar 1 of A
    expect(held.hold).toEqual([0, 3]);
    expect(held.bar).toBe(1);
    expect(held.startAt).toBe(T + 2_000);
    // 4 bars later it is bar 1 again (A, round again), not B.
    expect(playheadAt(tl, held, T + 11_000)).toMatchObject({ bar: 1, section: 0 });
    const released = releaseHold(held, T + 11_000, tl);
    expect(released.hold).toBeNull();
    expect(playheadAt(tl, released, T + 11_000 + 6_000)).toMatchObject({ bar: 4, section: 1 });
  });

  it('plays slower at a rehearsal speed, keeping its place', () => {
    const slow = setPlayheadSpeed(start, 120, 0.8, T + 3_000, tl);
    expect(slow.bpm).toBe(96);
    expect(slow.speed).toBe(0.8);
    // Bar 1 half way at T+3000; at 96 BPM a bar is 2.5 s.
    expect(playheadAt(tl, slow, T + 3_000).bar).toBe(1);
    expect(playheadAt(tl, slow, T + 3_000 + 1_300).bar).toBe(2);
  });

  it('stops, and ends past the last bar', () => {
    expect(stopPlayhead(start).on).toBe(false);
    const nofermata = buildTimeline({ chart: chart([['A', bars('C', 'G')]]) })!;
    expect(playheadAt(nofermata, start, T + 60_000)).toMatchObject({ done: true, bar: 1 });
  });

  it('follows the lyric lines', () => {
    const lyr = buildTimeline({ chart: c, lyrics: '# A\nOne\nTwo\n# B\nThree\n# C\nFour' })!;
    expect(playheadAt(lyr, start, T + 100).line).toBe(0);
    expect(playheadAt(lyr, start, T + 4_100).line).toBe(1);
    expect(playheadAt(lyr, start, T + 8_100).line).toBe(2);
  });

  it('checks a received state; anything malformed is dropped', () => {
    expect(parsePlayheadState(JSON.parse(JSON.stringify(start)))).toEqual(start);
    expect(parsePlayheadState({ ...start, hold: [3, 1] })).toBeNull();
    expect(parsePlayheadState({ ...start, bpm: 'fast' })).toBeNull();
    expect(parsePlayheadState({ ...start, from: '' })).toBeNull();
    expect(parsePlayheadState(null)).toBeNull();
  });
});
