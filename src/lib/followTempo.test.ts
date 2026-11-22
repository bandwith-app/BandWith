import { describe, expect, it } from 'vitest';
import type { SongChart } from './ireal';
import { buildTimeline, playheadAt, startPlayhead, holdSection, type Timeline } from './playhead';
import { barForCell, barForLine, barForSection, followContext, followFrame, leaderStartAt, type FollowContext } from './followTempo';

const chart = (sections: [string, { chords: string[]; fermata?: boolean; repeatStart?: boolean; repeatEnd?: boolean }[]][]): SongChart => ({
  v: 1,
  source: 'ireal',
  title: 'Hudson Line',
  time: '4/4',
  sections: sections.map(([label, bars]) => ({ label, bars })),
});
const bars = (...c: string[]) => c.map((x) => ({ chords: [x] }));

// 4/4 at 120: 2 s a bar.
const T = 1_000_000;
const at = (ctx: FollowContext, ms: number, state = startPlayhead({ from: 'leader', songId: 's1', bpm: 120, startAt: T })) =>
  followFrame(ctx, playheadAt(ctx.timeline, state, T + ms), state);
const ctxOf = (song: { chart?: SongChart; lyrics?: string }): FollowContext => followContext(buildTimeline(song) as Timeline, song.lyrics);

describe('follow the tempo: what lights up', () => {
  // Verse (4 bars) · Chorus (2 bars, played twice) · Bridge (2 bars, a fermata on the last)
  const c = chart([
    ['Verse', bars('C', 'F', 'G', 'C')],
    ['Chorus', [{ chords: ['F'], repeatStart: true }, { chords: ['G'], repeatEnd: true }]],
    ['Bridge', [{ chords: ['Am'] }, { chords: ['G'], fermata: true }]],
  ]);
  const lyrics = '# Verse\nWalking down to Canal Street\nThe train is running late\n# Chorus\nHold on\nHold on tight\n# Bridge\nWait for me';
  const tl = ctxOf({ chart: c, lyrics });

  it('lights the chart cell being played, and its section', () => {
    expect(at(tl, 2_500)).toMatchObject({ cell: '0:1', chartSection: 0 });
    // Bar 6 of the song is the second pass of the chorus: the same two cells again.
    expect(at(tl, 12_500)).toMatchObject({ cell: '1:0', chartSection: 1 });
  });

  it('says what comes next and in how many bars', () => {
    expect(at(tl, 500).status).toEqual({ kind: 'next', label: 'Chorus', bars: 4 });
    expect(at(tl, 6_500).status).toEqual({ kind: 'next', label: 'Chorus', bars: 1 });
  });

  it('highlights the current line, spread over its section', () => {
    expect(at(tl, 500).line).toBe('0:0');
    expect(at(tl, 4_500).line).toBe('0:1');
    expect(at(tl, 8_500).line).toBe('1:0');
  });

  it('on a repeat with no lines of its own, reads the lines of the first time', () => {
    // Second chorus (bars 6–7): the chorus lines again, not the last line stuck.
    expect(at(tl, 12_500).line).toBe('1:0');
    expect(at(tl, 14_500).line).toBe('1:1');
  });

  it('waits on the fermata: one state, "waiting for the leader"', () => {
    expect(at(tl, 60_000).status).toEqual({ kind: 'waiting' });
  });

  it('shows starting before bar 1, holding while held, the last section at the end', () => {
    expect(at(tl, -800).status).toEqual({ kind: 'starting' });
    const start = startPlayhead({ from: 'leader', songId: 's1', bpm: 120, startAt: T });
    const held = holdSection(start, T + 1_000, tl.timeline);
    expect(followFrame(tl, playheadAt(tl.timeline, held, T + 1_000), held).status).toEqual({ kind: 'holding', label: 'Verse' });
    expect(at(tl, 16_500).status).toEqual({ kind: 'last', label: 'Bridge' });
  });
});

describe('follow the tempo: lyrics with no chart', () => {
  const lyrics = '# Intro\nHey\n# Chorus x2\nNew York nights\nCity lights';
  const tl = ctxOf({ lyrics });

  it('knows which lyric section each played section is (x2 played twice)', () => {
    expect(tl.lyricOf).toEqual([0, 1, 1]);
  });

  it('names the next section without its "x2"', () => {
    expect(at(tl, 500).status).toEqual({ kind: 'next', label: 'Chorus', bars: 2 });
  });

  it('highlights the lyric section for the structure view', () => {
    // Intro: 1 line = 2 bars; Chorus: 2 lines = 4 bars, twice.
    expect(at(tl, 500)).toMatchObject({ lyricSection: 0, cell: null, chartSection: null });
    expect(at(tl, 4_500)).toMatchObject({ lyricSection: 1, line: '1:0' });
    // Second chorus: its lines again.
    expect(at(tl, 12_500)).toMatchObject({ lyricSection: 1, line: '1:0' });
    expect(at(tl, 16_500)).toMatchObject({ lyricSection: 1, line: '1:1' });
  });
});

describe('follow the tempo: the leader taps to re-align', () => {
  const c = chart([
    ['Verse', [{ chords: ['C'], repeatStart: true }, { chords: ['G'], repeatEnd: true }]],
    ['Chorus', bars('F', 'C')],
  ]);
  const tl = ctxOf({ chart: c, lyrics: '# Verse\nOne\n# Chorus\nTwo\nThree' });
  // Played: Verse twice (bars 0–1, 2–3), Chorus (4–5).

  it('a tapped bar goes to its nearest time through', () => {
    expect(barForCell(tl, 0, 1, 0)).toBe(1);
    expect(barForCell(tl, 0, 1, 3)).toBe(3);
    expect(barForCell(tl, 1, 0, 0)).toBe(4);
    expect(barForCell(tl, 9, 9, 0)).toBeNull();
  });

  it('a tapped line goes to the bar it starts in', () => {
    expect(barForLine(tl, '1:1', 0)).toBe(5);
    expect(barForLine(tl, '0:0', 3)).toBe(2);
    expect(barForLine(tl, '7:0', 0)).toBeNull();
  });

  it('a tapped section goes to its first bar', () => {
    expect(barForSection(tl, { chart: 1 }, 0)).toBe(4);
    expect(barForSection(tl, { chart: 0 }, 3)).toBe(2);
    const lyr = ctxOf({ lyrics: '# Verse\nA\n# Chorus\nB' });
    expect(barForSection(lyr, { lyric: 1 }, 0)).toBe(2);
  });
});

describe('follow the tempo: when the leader starts', () => {
  it('starts on the click’s next downbeat when the leader’s click runs', () => {
    const click = { on: true, bpm: 120, beats: 4, startAt: 10_000 };
    // A bar is 2 s; now 11 000 + lead 700 → the downbeat at 12 000.
    expect(leaderStartAt({ now: 11_000, click, barMs: 2_000 })).toBe(12_000);
    // Too close to the next downbeat: the one after.
    expect(leaderStartAt({ now: 11_500, click, barMs: 2_000 })).toBe(14_000);
  });

  it('with no click: one bar to get ready, after the network lead', () => {
    expect(leaderStartAt({ now: 11_000, click: null, barMs: 2_000 })).toBe(11_000 + 700 + 2_000);
  });
});
