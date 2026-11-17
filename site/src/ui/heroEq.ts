import type { Clock } from '../motion/clock';

/**
 * Hero equalizer: a full-width LED spectrum analyser at the foot of the hero,
 * drawn with Canvas 2D in the brand's rounded-square dots (same cells as the
 * logo). It plays a silent groove on the page clock (112 BPM): kick on every
 * beat in the low end, snare on 2 and 4 in the low mids, a melody wandering
 * through the mids, hi-hats on the eighths at the top. Fast attack, slow
 * release and a peak dot that holds, then falls, like a real meter.
 * The pointer pushes energy into the bands under it, a tap sends a shockwave,
 * every push notification sends one from the screen, and scrolling away
 * drains it. With reduced motion it is one still frame.
 */

export type HeroEq = {
  shock(x: number): void;
  pointer(x: number, y: number, on: boolean): void;
  scroll(p: number): void;
  start(): void;
  stop(): void;
};

type Col = { lv: number; peak: number; hold: number; seed: number };

const SPB = 60 / 112;                       // seconds per beat
const LIME = [213, 251, 70] as const;

/** Deterministic smooth noise per column (no Math.random in the draw loop). */
function hash(n: number) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
function vnoise(x: number) { const i = Math.floor(x); const f = x - i; const u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; }

/** The groove: target level 0..1 for column position x (0 = lows) at time t. */
export function groove(x: number, t: number, seed: number) {
  const beat = t / SPB;
  const ph = beat % 1;                                  // 0..1 inside the beat
  const bar = Math.floor(beat) % 4;
  const kick = Math.exp(-ph * 6.5);
  const snare = bar % 2 === 1 ? Math.exp(-ph * 5) : 0;  // beats 2 and 4
  const hat = Math.exp(-((beat * 2) % 1) * 11);         // eighths
  const melodyAt = 0.42 + 0.2 * Math.sin(t * 0.55) + 0.08 * Math.sin(t * 1.7);
  const g = (c: number, w: number) => Math.exp(-((x - c) ** 2) / w);

  let v = 0.05 + 0.12 * (1 - x) * (1 - x);                                // pink-ish floor
  v += 0.62 * kick * g(0.05, 0.006) + 0.3 * kick * g(0.14, 0.01);         // kick + its body
  v += 0.22 * (0.6 + 0.4 * Math.sin(t * 2.3)) * g(0.1, 0.004);            // bass line
  v += 0.42 * snare * g(0.33, 0.02);                                      // snare
  v += 0.34 * g(melodyAt, 0.008) * (0.7 + 0.3 * Math.sin(t * 3.1));       // melody
  v += 0.32 * hat * Math.max(0, (x - 0.62) / 0.38) ** 0.8;                 // hats
  v += 0.2 * (vnoise(x * 13 + t * 2.4) - 0.5);                           // slow movement across bands
  v += 0.07 * (vnoise(t * 9 + seed * 31) - 0.5);                          // grain, per column
  return v;
}

export function createHeroEq(canvas: HTMLCanvasElement, clock: Clock, reduce: boolean): HeroEq | null {
  const c2d = canvas.getContext('2d');
  if (!c2d) return null;
  const ctx: CanvasRenderingContext2D = c2d;

  let W = 0, H = 0, dpr = 1;
  let size = 12, gap = 4, pitch = 16, cols = 0, rows = 0, ox = 0;
  let bands: Col[] = [];
  const ptr = { x: 0.5, y: 0.5, on: false, amt: 0 };
  const shocks: { x: number; t: number }[] = [];
  let drain = 0;
  let raf = 0, last = 0, running = false;

  function layout() {
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    size = Math.max(7, Math.min(13, Math.round(W / 112)));
    gap = Math.max(3, Math.round(size * 0.4));
    pitch = size + gap;
    cols = Math.max(1, Math.floor((W + gap) / pitch));
    rows = Math.max(1, Math.floor((H + gap) / pitch));
    ox = (W - (cols * pitch - gap)) / 2;
    const prev = bands;
    bands = Array.from({ length: cols }, (_, i) => prev[i] ?? { lv: 0, peak: 0, hold: 0, seed: i });
  }

  function step(dt: number, t: number) {
    const now = performance.now() / 1000;
    ptr.amt += ((ptr.on ? 1 : 0) - ptr.amt) * (1 - Math.exp(-dt * 6));
    for (let i = shocks.length - 1; i >= 0; i--) if (now - shocks[i].t > 1.8) shocks.splice(i, 1);
    const keep = Math.pow(1 - drain, 1.4);
    for (let i = 0; i < cols; i++) {
      const b = bands[i];
      const x = cols > 1 ? i / (cols - 1) : 0.5;
      let v = groove(x, t, b.seed);
      if (ptr.amt > 0.01) v += ptr.amt * (0.25 + 0.45 * ptr.y) * Math.exp(-((x - ptr.x) ** 2) / 0.004);
      for (const s of shocks) {
        const age = now - s.t;
        const front = Math.abs(x - s.x) - age * 0.75;
        v += 0.75 * Math.exp(-(front * front) / 0.0025) * Math.exp(-age * 1.9);
      }
      const target = Math.min(1, Math.max(0, v)) * keep * rows;
      b.lv += (target - b.lv) * (target > b.lv ? 1 - Math.exp(-dt * 38) : 1 - Math.exp(-dt * 7));
      if (b.lv >= b.peak) { b.peak = b.lv; b.hold = 0.42; }
      else if ((b.hold -= dt) <= 0) b.peak = Math.max(b.lv, b.peak - rows * 1.1 * dt);
    }
  }

  // Cells are drawn in a few batches (one path per tone), not one fill per cell.
  const TONES = 6;
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const off = new Path2D();
    const peak = new Path2D();
    const hot = new Path2D();
    const lit = Array.from({ length: TONES }, () => new Path2D());
    const rad = size * 0.3;
    const cell = (p: Path2D, x: number, y: number) => (p.roundRect ? p.roundRect(x, y, size, size, rad) : p.rect(x, y, size, size));
    for (let i = 0; i < cols; i++) {
      const b = bands[i];
      const x = ox + i * pitch;
      const on = Math.round(b.lv);
      const pk = Math.min(rows - 1, Math.floor(b.peak));
      for (let r = 0; r < rows; r++) {
        const y = H - (r + 1) * pitch + gap;
        if (r < on - 1) cell(lit[Math.min(TONES - 1, Math.floor((r / rows) * TONES))], x, y);
        else if (r === on - 1) cell(hot, x, y);
        else if (r === pk && pk > on) cell(peak, x, y);
        else cell(off, x, y);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fill(off);
    // One lime, brighter as the bar rises; the top cell of each bar glows.
    for (let k = 0; k < TONES; k++) {
      ctx.fillStyle = `rgba(${LIME[0]},${LIME[1]},${LIME[2]},${(0.32 + 0.5 * (k / (TONES - 1))).toFixed(3)})`;
      ctx.fill(lit[k]);
    }
    ctx.fillStyle = `rgba(${LIME[0]},${LIME[1]},${LIME[2]},0.75)`;
    ctx.fill(peak);
    ctx.shadowColor = 'rgba(213,251,70,0.9)';
    ctx.shadowBlur = size * 1.2;
    ctx.fillStyle = `rgb(${LIME[0]},${LIME[1]},${LIME[2]})`;
    ctx.fill(hot);
    ctx.shadowBlur = 0;
  }

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    step(dt, clock.time());
    draw();
    raf = running ? requestAnimationFrame(frame) : 0;
  }

  function still() {
    // A loud moment on the downbeat, settled: the shape the groove makes.
    const t = SPB * 8.06;
    for (let k = 0; k < 40; k++) step(1 / 60, t - (40 - k) / 60);
    bands.forEach((b) => { b.peak = Math.max(b.peak, b.lv + 1.2); });
    draw();
  }

  layout();
  new ResizeObserver(() => { layout(); if (reduce || !running) still(); }).observe(canvas);

  const api: HeroEq = {
    shock(x) { if (!reduce) shocks.push({ x, t: performance.now() / 1000 }); },
    pointer(x, y, on) { ptr.x = x; ptr.y = y; ptr.on = on; },
    scroll(p) { drain = Math.min(1, Math.max(0, p)); },
    start() {
      if (reduce || running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
  };
  if (reduce) still();
  return api;
}
