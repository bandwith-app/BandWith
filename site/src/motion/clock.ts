/**
 * Silent page clock (no audio). Emits 16th-note steps at 112 BPM so the
 * equalizer, the sequencer playhead and the nav mark move on one beat.
 */
export type StepListener = (step: number) => void;

const BPM = 112;
const SIXTEENTH = 60 / BPM / 4;

class Clock {
  private start = performance.now();
  private last = -1;
  private listeners = new Set<StepListener>();

  onStep(fn: StepListener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Seconds since load. */
  time() { return (performance.now() - this.start) / 1000; }

  /** 0..1 inside the current beat. */
  beatPhase() { return ((this.time() / (SIXTEENTH * 4)) % 1 + 1) % 1; }

  /** Call once per animation frame. */
  tick() {
    const s = Math.floor(this.time() / SIXTEENTH);
    if (s === this.last) return;
    this.last = s;
    this.listeners.forEach((fn) => fn(s % 64));
  }
}

export type { Clock };
export const clock = new Clock();
