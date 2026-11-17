/**
 * Footer wordmark as a spectrum analyser, on hover only. Every dot column of
 * the LED word becomes a band with its own life (asynchronous hits, fast
 * attack, slow release, a peak dot that holds and then falls). Bands near the
 * pointer get more energy, so the cursor plays the word. The letters stay
 * readable underneath; on leave the bands drain and the word lights back up.
 */

type Dot = { el: SVGCircleElement; row: number; letter: boolean };
type Band = { dots: Dot[]; env: number; lv: number; peak: number; hold: number; rate: number; tilt: number };

const ROWS = 7;

export function initFootEq(host: HTMLElement | null, reduce: boolean) {
  const svg = host?.querySelector('svg');
  if (!host || !svg || reduce) return;
  const circles = Array.from(svg.querySelectorAll<SVGCircleElement>('circle'));
  if (!circles.length) return;

  // dotSvg() writes the matrix column by column, 7 dots each (row 0 = top).
  const bands: Band[] = [];
  circles.forEach((el, k) => {
    const x = Math.floor(k / ROWS);
    const row = ROWS - 1 - (k % ROWS);     // 0 = bottom
    if (!bands[x]) bands[x] = { dots: [], env: 0, lv: 0, peak: 0, hold: 0, rate: 2 + Math.random() * 4, tilt: 0 };
    bands[x].dots.push({ el, row, letter: !el.hasAttribute('opacity') });
  });
  const n = bands.length;
  bands.forEach((b, x) => { b.tilt = 1 - 0.35 * (x / n); });   // a little more low end on the left

  let mode: 'off' | 'play' | 'drain' = 'off';
  let raf = 0;
  let last = 0;
  let px = -1;            // pointer column, -1 when unknown
  let drainAt = 0;

  function paint(word: number) {
    // word: how bright the letters are under the bars (0.4 while playing → 1 at rest)
    bands.forEach((b) => {
      const top = Math.floor(b.peak);
      b.dots.forEach((d) => {
        let o: number;
        if (d.row < b.lv - 0.15) o = 1;                         // the bar
        else if (d.row === top && b.peak > 0.6) o = 0.95;       // peak hold
        else o = d.letter ? word : 0.07;
        d.el.style.opacity = o.toFixed(2);
      });
    });
  }

  function restore() {
    bands.forEach((b) => b.dots.forEach((d) => { d.el.style.opacity = d.letter ? '1' : ''; }));
  }

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    let alive = mode === 'play';
    bands.forEach((b, x) => {
      if (mode === 'play') {
        // Each band fires on its own clock: async, never in lockstep.
        if (Math.random() < b.rate * dt) {
          const near = px < 0 ? 0 : Math.exp(-(((x - px) / 7) ** 2));
          b.env = Math.max(b.env, Math.min(1, (0.18 + Math.random() * 0.5) * b.tilt + near * 0.5));
          b.rate = 2 + Math.random() * 4 + near * 4;
        }
        b.env = Math.max(0.05, b.env * Math.exp(-5.5 * dt));
      } else {
        b.env *= Math.exp(-9 * dt);
      }
      const target = b.env * ROWS;
      b.lv += (target - b.lv) * (target > b.lv ? 1 - Math.exp(-dt * 40) : 1 - Math.exp(-dt * 8));
      // Peak: holds ~0.3s, then falls 6 rows/s.
      if (b.lv >= b.peak) { b.peak = b.lv; b.hold = 0.3; }
      else if ((b.hold -= dt) <= 0) b.peak = Math.max(b.lv, b.peak - 6 * dt);
      if (b.lv > 0.05 || b.peak > 0.4) alive = true;
    });
    const t = mode === 'drain' ? Math.min(1, (now - drainAt) / 500) : 0;
    paint(0.4 + 0.6 * t);
    if (alive || t < 1) raf = requestAnimationFrame(frame);
    else { raf = 0; mode = 'off'; restore(); }
  }

  function play() {
    mode = 'play';
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function stop() {
    if (mode !== 'play') return;
    mode = 'drain';
    drainAt = performance.now();
    px = -1;
  }

  const col = (e: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    px = ((e.clientX - r.left) / r.width) * n;
  };
  host.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { col(e); play(); } });
  host.addEventListener('pointermove', (e) => { if (mode === 'play') col(e); });
  host.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') stop(); });
  // Touch: a tap plays it for a couple of seconds, centred on the finger.
  let burst = 0;
  host.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    col(e);
    play();
    clearTimeout(burst);
    burst = window.setTimeout(stop, 2200);
  });
}
