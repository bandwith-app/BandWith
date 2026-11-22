import { describe, expect, it } from 'vitest';
import { COUNTIN_LEAD_MS, GO_MS, countInAt, countInPlan, parseCountInState, startCountIn, stopCountIn, type CountInState } from './countIn';
import { meterOf } from './meter';

const plan = (time: string, opts: Partial<CountInState> = {}) =>
  countInPlan({ bpm: 120, time, groups: null, bars: 1, pickup: 0, style: 'down', ...opts });
const labels = (p: ReturnType<typeof countInPlan>) => p.events.map((e) => e.label).join(' ');
const times = (p: ReturnType<typeof countInPlan>) => p.events.map((e) => Math.round(e.at));

describe('count-in: every meter', () => {
  it('4/4: 4 3 2 1 GO, a beat apart, GO on bar 1', () => {
    const p = plan('4/4');
    expect(labels(p)).toBe('4 3 2 1 GO');
    expect(times(p)).toEqual([0, 500, 1000, 1500, 2000]);
    expect(p.goAt).toBe(2000);
    expect(p.endAt).toBe(2000);
    expect(p.events[0].downbeat).toBe(true);
  });

  it('3/4, 2/4 and 5/4', () => {
    expect(labels(plan('3/4'))).toBe('3 2 1 GO');
    expect(labels(plan('2/4'))).toBe('2 1 GO');
    expect(labels(plan('5/4'))).toBe('5 4 3 2 1 GO');
    expect(plan('5/4').goAt).toBe(2500);
  });

  it('6/8 and 12/8: dotted beats, the eighths as three dots each', () => {
    // BPM is the dotted beat: 6/8 at 120 → 500 ms a count.
    const six = plan('6/8');
    expect(labels(six)).toBe('2 1 GO');
    expect(times(six)).toEqual([0, 500, 1000]);
    expect(six.events[0].dots).toBe(3);
    expect(labels(plan('12/8'))).toBe('4 3 2 1 GO');
  });

  it('7/8 and 5/8: the chart’s grouping, long and short counts', () => {
    const seven = plan('7/8');
    expect(labels(seven)).toBe('3 2 1 GO');
    // Quarter at 120 → eighth 250 ms: 2+2+3.
    expect(times(seven)).toEqual([0, 500, 1000, 1750]);
    expect(seven.events.map((e) => e.ticks)).toEqual([2, 2, 3, 0]);
    const grouped = plan('7/8', { groups: [3, 2, 2] });
    expect(times(grouped)).toEqual([0, 750, 1250, 1750]);
    expect(labels(plan('5/8'))).toBe('2 1 GO');
  });

  it('counts up when the band chose it', () => {
    expect(labels(plan('4/4', { style: 'up' }))).toBe('1 2 3 4 GO');
    expect(labels(plan('6/8', { style: 'up' }))).toBe('1 2 GO');
  });

  it('two bars for slow songs: the first in half time', () => {
    const p = plan('4/4', { bars: 2 });
    expect(labels(p)).toBe('2 1 4 3 2 1 GO');
    expect(times(p)).toEqual([0, 1000, 2000, 2500, 3000, 3500, 4000]);
    expect(p.events[0].half).toBe(true);
    expect(labels(plan('3/4', { bars: 2 }))).toBe('1 3 2 1 GO');
    expect(labels(plan('4/4', { bars: 2, style: 'up' }))).toBe('1 2 1 2 3 4 GO');
  });

  it('a pickup: GO on the beat the band comes in, bar 1 after it', () => {
    const p = plan('4/4', { pickup: 1 });
    expect(labels(p)).toBe('4 3 2 GO');
    expect(p.goAt).toBe(1500);
    expect(p.endAt).toBe(2000);
    expect(labels(plan('4/4', { pickup: 2, style: 'up' }))).toBe('1 2 GO');
    // In 6/8 the pickup is a dotted beat.
    expect(plan('6/8', { pickup: 1 }).goAt).toBe(500);
  });
});

describe('count-in on every phone', () => {
  const T = 10_000_000;
  const state = startCountIn({ from: 'leader', songId: 'row-1', bpm: 120, meter: meterOf('4/4'), now: T });
  const p = countInPlan(state);

  it('starts 1.5 s after the tap', () => {
    expect(state.startAt).toBe(T + COUNTIN_LEAD_MS);
    expect(countInAt(p, state, T + 100).stage).toBe('before');
  });

  it('a phone joining late lands on the right beat (with its clock offset)', () => {
    // My clock is 200 ms behind the leader's.
    const at = countInAt(p, state, T + COUNTIN_LEAD_MS + 1100 - 200, 200);
    expect(at).toMatchObject({ stage: 'count', event: 2 });
    expect(p.events[at.event].label).toBe('2');
    expect(at.phase).toBeCloseTo(0.2, 5);
  });

  it('GO for a moment, then done; the ring fills bar by bar', () => {
    expect(countInAt(p, state, state.startAt + 1000).barProgress).toBeCloseTo(0.5);
    expect(countInAt(p, state, state.startAt + 2000).stage).toBe('go');
    expect(countInAt(p, state, state.startAt + 2000 + GO_MS).stage).toBe('done');
  });

  it('Stop ends it (a newer state, off); malformed states are dropped', () => {
    const off = stopCountIn(state);
    expect(off.on).toBe(false);
    expect(off.seq).toBeGreaterThan(state.seq);
    expect(parseCountInState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(parseCountInState({ ...state, time: '4/3' })).toBeNull();
    expect(parseCountInState({ ...state, bars: 3 })).toBeNull();
    expect(parseCountInState({ ...state, style: 'sideways' })).toBeNull();
    expect(parseCountInState(null)).toBeNull();
  });

  it('keeps a pickup inside the bar and an odd grouping', () => {
    const odd = startCountIn({ from: 'l', songId: null, bpm: 120, meter: meterOf('7/8', [3, 2, 2]), pickup: 9, now: 0 });
    expect(odd.pickup).toBe(2);
    expect(odd.groups).toEqual([3, 2, 2]);
    expect(startCountIn({ from: 'l', songId: null, bpm: 120, meter: meterOf('6/8'), now: 0 }).groups).toBeNull();
  });
});

describe('count-in sound', () => {
  it('one sound per count on my clock, the downbeat and GO higher, once each', async () => {
    const { countInSounds } = await import('./countIn');
    const s = startCountIn({ from: 'l', songId: null, bpm: 120, meter: meterOf('3/4'), now: 1000 });
    const sounds = countInSounds(countInPlan(s), s, 200, { voice: null });
    expect(sounds.map((x) => x.at)).toEqual([2300, 2800, 3300, 3800]);
    expect(sounds.map((x) => x.sound.kind)).toEqual(['bar', 'beat', 'beat', 'bar']);
    expect(new Set(sounds.map((x) => x.key)).size).toBe(4);
    expect(countInSounds(countInPlan(s), s, 0, { voice: 'en' })[1].sound).toEqual({ kind: 'voice', word: '2', lang: 'en' });
  });
});
