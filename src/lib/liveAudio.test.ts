import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetLiveAudio, contextTimeAt, startAudioScheduler, wallNow, type ScheduledSound } from './liveAudio';

/** A fake AudioContext whose clock is the page's clock (s). */
const started: { when: number; hz: number }[] = [];
let stopped = 0;
class FakeCtx {
  state = 'running';
  outputLatency = 0;
  get currentTime() {
    return performance.now() / 1000;
  }
  getOutputTimestamp() {
    return { contextTime: performance.now() / 1000, performanceTime: performance.now() };
  }
  resume() {
    return Promise.resolve();
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x: unknown) => x };
  }
  createOscillator() {
    let hz = 0;
    return {
      type: '',
      frequency: { setValueAtTime: (v: number) => (hz = v) },
      connect: (g: unknown) => g,
      start: (when: number) => started.push({ when, hz }),
      stop: (when?: number) => {
        if (when === undefined) stopped++;
      },
    };
  }
  get destination() {
    return {};
  }
}

afterEach(() => {
  vi.useRealTimers();
  started.length = 0;
  stopped = 0;
  __resetLiveAudio();
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
});

describe('liveAudio', () => {
  it('maps a wall-clock time onto the audio clock, minus the output latency', () => {
    const c = { currentTime: 10, getOutputTimestamp: () => ({ contextTime: 10, performanceTime: 5000 }), outputLatency: 0.02 };
    const wall = performance.timeOrigin + 5000;
    expect(contextTimeAt(c as never, wall + 250, wall)).toBeCloseTo(10.23, 5);
  });

  it('schedules each sound once, at its time, a little ahead; Stop silences the rest', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
    const t0 = wallNow();
    const beats: ScheduledSound[] = [0, 500, 1000, 1500].map((ms, i) => ({ key: `b${i}`, at: t0 + 100 + ms, sound: { kind: i === 0 ? 'bar' : 'beat' } }));
    const stop = startAudioScheduler((from, to) => beats.filter((b) => b.at >= from - 1 && b.at <= to));
    vi.advanceTimersByTime(700);
    // Beats at +100 and +600 are on the audio clock, at their time, the downbeat higher.
    expect(started.map((s) => Math.round(s.when * 1000 - performance.now() + 700))).toEqual([100, 600]);
    expect(started[0].hz).toBeGreaterThan(started[1].hz);
    stop();
    vi.advanceTimersByTime(2000);
    expect(started).toHaveLength(2);
    expect(stopped).toBe(2);
  });

  it('does nothing where there is no Web Audio', () => {
    const stop = startAudioScheduler(() => [{ key: 'x', at: wallNow(), sound: { kind: 'bar' } }]);
    expect(started).toHaveLength(0);
    stop();
  });
});
