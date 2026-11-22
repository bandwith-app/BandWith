import { describe, expect, it } from 'vitest';
import { beatAt, beatsInBar, bestSample, clockSample, parseClickState } from '../stageClick';

const state = { seq: 1, from: 'lead', on: true, bpm: 120, beats: 4, bars: null, startAt: 10_000, songId: 'row-1' };

describe('stage click', () => {
  it('checks messages', () => {
    expect(parseClickState(state)).toEqual(state);
    expect(parseClickState({ ...state, bpm: 5 })).toBeNull();
    expect(parseClickState({ ...state, beats: 0 })).toBeNull();
    expect(parseClickState({ ...state, bars: 2 })).toMatchObject({ bars: 2 });
    expect(parseClickState({ ...state, from: '' })).toBeNull();
    expect(parseClickState('x')).toBeNull();
  });

  it('measures the clock offset from the fastest round trip', () => {
    // Their clock is 250 ms ahead; the trips take 40, 200 and 60 ms (uneven).
    const s1 = clockSample(1000, 1000 + 250 + 20, 1040);
    const s2 = clockSample(2000, 2000 + 250 + 150, 2200);
    const s3 = clockSample(3000, 3000 + 250 + 30, 3060);
    expect(bestSample([s1, s2, s3])).toEqual({ offset: 250, rtt: 40 });
    expect(bestSample([])).toBeNull();
  });

  it('puts every phone on the same beat whatever its clock', () => {
    // Leader time 11_250 = beat 2 at 120 BPM (500 ms a beat), half way through.
    const leader = beatAt(state, 11_250, 0);
    const member = beatAt(state, 11_000, 250); // member's clock is 250 ms behind
    expect(leader).toEqual(member);
    expect(leader).toMatchObject({ beat: 2, phase: 0.5, count: 3, downbeat: false, done: false });
    expect(beatAt(state, 9_000, 0).beat).toBe(-1);
    expect(beatAt(state, 12_000, 0)).toMatchObject({ beat: 4, downbeat: true, count: 1 });
  });

  it('stops a count-in after its bars', () => {
    const countIn = { ...state, bars: 1 };
    expect(beatAt(countIn, 11_999, 0).done).toBe(false);
    expect(beatAt(countIn, 12_000, 0).done).toBe(true);
  });

  it('reads beats in a bar from the time signature', () => {
    expect(beatsInBar('3/4')).toBe(3);
    expect(beatsInBar('6/8')).toBe(6);
    expect(beatsInBar(undefined)).toBe(4);
  });
});

describe('the click in compound and odd meters', () => {
  it('6/8: ticks at three times the dotted BPM, counted in two', async () => {
    const { clickForSong } = await import('../stageClick');
    const { meterOf } = await import('../meter');
    const c = clickForSong(60, meterOf('6/8'));
    expect(c).toEqual({ bpm: 180, beats: 6, groups: [3, 3] });
    const state = { bpm: c.bpm, beats: c.beats, groups: c.groups, bars: null, startAt: 0 };
    const at = (tick: number) => beatAt(state, tick * (60000 / 180) + 1, 0);
    expect([0, 1, 2, 3, 4, 5].map((k) => at(k).count)).toEqual([1, 1, 1, 2, 2, 2]);
    expect([0, 1, 2, 3, 4, 5].map((k) => at(k).onBeat)).toEqual([true, false, false, true, false, false]);
    expect(at(6).downbeat).toBe(true);
  });

  it('7/8 grouped 2+2+3; 4/4 unchanged (every tick a beat, no groups)', async () => {
    const { clickForSong } = await import('../stageClick');
    const { meterOf } = await import('../meter');
    expect(clickForSong(120, meterOf('7/8'))).toEqual({ bpm: 240, beats: 7, groups: [2, 2, 3] });
    expect(clickForSong(96, meterOf('4/4'))).toEqual({ bpm: 96, beats: 4, groups: null });
  });

  it('accepts groups that add up to the bar, refuses others; tick rates above 300', () => {
    const base = { seq: 1, from: 'a', on: true, bpm: 360, beats: 12, bars: null, startAt: 1, songId: null };
    expect(parseClickState({ ...base, groups: [3, 3, 3, 3] })).toMatchObject({ bpm: 360, groups: [3, 3, 3, 3] });
    expect(parseClickState({ ...base, groups: [3, 3] })).toBeNull();
    expect(parseClickState({ ...base, bpm: 2000 })).toBeNull();
  });
});
