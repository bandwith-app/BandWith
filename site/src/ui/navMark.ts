/**
 * The logo as a three-band level meter. At rest it is the logo. While the
 * brand is hovered (or pressed on touch) its three columns turn into bands of
 * a spectrum analyser: a kick on the left, snare/mids in the middle, hats on
 * the right, each with a fast attack and a slower release, like real LED
 * meters. On leave the bands climb back, one after the other, into the logo.
 */

const NS = 'http://www.w3.org/2000/svg';
const H = 286;                 // viewBox height, the floor of every band
const STEP = 60 / 112 / 4;     // a 16th at the page tempo (same as the clock)
const DECAY = [4.2, 7, 11];    // per-band envelope decay (1/s): bass rings longest
const FLOOR = [0.16, 0.12, 0.1];

type Band = { rects: { el: SVGRectElement; y: number; h: number }[]; lv: number; env: number };

export function initNavMark(trigger: HTMLElement, svg: SVGSVGElement, time: () => number, reduce: boolean) {
  const rects = Array.from(svg.querySelectorAll<SVGRectElement>('rect'));
  if (!rects.length || reduce) return;

  // A ghost of the logo stays underneath, so the shape never disappears.
  const ghost = document.createElementNS(NS, 'g');
  ghost.setAttribute('class', 'mark__ghost');
  rects.forEach((r) => ghost.appendChild(r.cloneNode()));
  svg.insertBefore(ghost, svg.firstChild);

  const bands: Band[] = [0, 99, 198].map((x) => ({
    rects: rects.filter((r) => Number(r.getAttribute('x')) === x)
      .map((el) => ({ el, y: Number(el.getAttribute('y')), h: Number(el.getAttribute('height')) })),
    lv: 1, env: 1,
  }));

  // Level 0..1 of the full height: each cell keeps only what sits under the line.
  function draw(b: Band) {
    const line = H - b.lv * H;
    b.rects.forEach(({ el, y, h }) => {
      const top = Math.max(y, line);
      const vis = Math.max(0, y + h - top);
      el.setAttribute('y', top.toFixed(1));
      el.setAttribute('height', vis.toFixed(1));
    });
  }

  let playing = false;
  let raf = 0;
  let last = 0;
  let lastStep = -1;
  let leftAt = 0;
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);

  // One bar of a loose groove: four-on-the-floor-ish kick, backbeat, busy hats.
  function hit(s: number) {
    const [bass, mid, high] = bands;
    const k = s % 16;
    if (k % 4 === 0) bass.env = Math.max(bass.env, k % 8 ? rnd(0.7, 0.85) : rnd(0.88, 1));
    else if ((k === 6 || k === 14) && Math.random() > 0.4) bass.env = Math.max(bass.env, rnd(0.55, 0.7));
    if (k === 4 || k === 12) mid.env = Math.max(mid.env, rnd(0.6, 0.66));          // the middle column tops out at 0.65
    else if (k % 2 === 0 && Math.random() > 0.45) mid.env = Math.max(mid.env, rnd(0.3, 0.5));
    high.env = Math.max(high.env, k % 2 ? rnd(0.3, 0.6) : rnd(0.55, 0.92));
  }

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    let busy = false;
    if (playing) {
      const s = Math.floor(time() / STEP);
      if (s !== lastStep) { lastStep = s; hit(s); }
    }
    bands.forEach((b, i) => {
      if (playing) {
        b.env = Math.max(FLOOR[i] + Math.random() * 0.05, b.env * Math.exp(-DECAY[i] * dt));
        // Attack in ~20ms, release over ~150ms: the needle snaps up, falls back.
        const k = b.env > b.lv ? 1 - Math.exp(-dt * 48) : 1 - Math.exp(-dt * 9);
        b.lv += (b.env - b.lv) * k;
        busy = true;
      } else {
        // Back to the logo: each band climbs in turn, 70ms apart.
        if (now - leftAt < i * 70) { busy = true; return; }
        b.lv += (1 - b.lv) * (1 - Math.exp(-dt * 14));
        if (b.lv > 0.997) b.lv = 1; else busy = true;
      }
      draw(b);
    });
    raf = busy ? requestAnimationFrame(frame) : 0;
  }

  function play() {
    playing = true;
    lastStep = Math.floor(time() / STEP);
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function stop() {
    if (!playing) return;
    playing = false;
    leftAt = performance.now();
    if (!raf) { last = leftAt; raf = requestAnimationFrame(frame); }
  }

  trigger.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') play(); });
  trigger.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') stop(); });
  trigger.addEventListener('focus', () => { if (trigger.matches(':focus-visible')) play(); });
  trigger.addEventListener('blur', stop);
  // Touch has no hover: a press plays one bar.
  let burst = 0;
  trigger.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    play();
    clearTimeout(burst);
    burst = window.setTimeout(stop, 1600);
  });

  return { play, stop };
}
