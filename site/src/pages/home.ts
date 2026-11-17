// core/boot first: its base CSS must come before the page's own styles.
import { boot, finish } from '../core/boot';
import '../styles/hero.css';
import '../styles/home.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { clock } from '../motion/clock';
import type { EqField } from '../gl/eqField';
import { initHeroPhone } from '../ui/heroPhone';
import { initNoise } from '../ui/noise';
import { initNight } from '../ui/night';
import { initRack } from '../ui/rack';
import { initSides } from '../ui/sides';
import { initDevices } from '../ui/devices';

const ctx = boot();
const { reduce, fine } = ctx;

/* ───────────── Hero equalizer (Three.js, its own chunk) ───────────── */
const hero = document.querySelector<HTMLElement>('[data-hero]')!;
const heroCanvas = hero.querySelector<HTMLCanvasElement>('[data-hero-gl]')!;
const levels = new Float32Array(64);
const ptr = { x: 0.5, y: 0.3, on: false };
let shock = { x: 0.5, t: -10 };

function idleSpectrum(n: number, out: Float32Array) {
  const t = clock.time();
  const beat = clock.beatPhase();
  const kick = Math.exp(-beat * 5);
  const hat = Math.exp(-((beat + 0.5) % 1) * 9);
  for (let i = 0; i < n; i++) {
    const x = i / n;
    // Crescendo to the right: the copy sits left, the open space on the right gets the energy.
    const rise = x * x * (3 - 2 * x);
    let v = 0.12 + 0.62 * Math.pow(rise, 1.6) * (0.78 + 0.22 * Math.sin(t * 0.6 + x * 5));
    v += 0.08 * Math.sin(t * 0.9 + x * 7) + 0.05 * Math.sin(t * 2.1 + x * 17);
    v += kick * 0.2 * (0.4 + rise) + hat * 0.12 * Math.pow(x, 1.3) + 0.04 * Math.sin(t * 7.3 + i * 1.7);
    out[i] = v * 0.5;
  }
}

function frame(_dt: number, field: EqField) {
  const n = field.columns();
  const view = levels.subarray(0, n);
  idleSpectrum(n, view);
  const since = performance.now() / 1000 - shock.t;
  for (let i = 0; i < n; i++) {
    const x = i / Math.max(1, n - 1);
    if (ptr.on) view[i] += Math.exp(-((x - ptr.x) ** 2) / 0.006) * (0.12 + ptr.y * 0.55);
    if (since < 2) view[i] += Math.exp(-((Math.abs(x - shock.x) - since * 1.1) ** 2) / 0.004) * Math.exp(-since * 1.6) * 0.7;
    view[i] = Math.min(1, Math.max(0, view[i]));
  }
  field.setFrame(view);
  field.pointer(ptr.x, ptr.y, ptr.on);
}

import('../gl/eqField').then(({ createEqField, staticLevels }) => {
  const field = createEqField(heroCanvas, frame);
  if (!field) return;
  hero.classList.add('gl-ready');
  // Bars stay clear of the lead and CTAs: keep-out from the live layout.
  const copy = hero.querySelectorAll<HTMLElement>('[data-hero-lead], [data-hero-cta], [data-cap-line], .hero__title .line:last-child > span');
  const syncKeepOut = () => {
    const c = heroCanvas.getBoundingClientRect();
    let left = Infinity, right = -Infinity, bottom = -Infinity;
    copy.forEach((el) => {
      if (el.hidden) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      let top = 0;
      for (let n: HTMLElement | null = el; n && n !== hero; n = n.offsetParent as HTMLElement | null) top += n.offsetTop;
      left = Math.min(left, r.left - c.left);
      right = Math.max(right, r.right - c.left);
      bottom = Math.max(bottom, top + el.offsetHeight);
    });
    field.setKeepOut({ left, right, bottom: bottom + 28 });
  };
  syncKeepOut();
  new ResizeObserver(syncKeepOut).observe(hero);
  document.fonts?.ready.then(syncKeepOut);
  if (reduce) {
    staticLevels(field.columns(), levels);
    field.setFrame(levels);
    field.renderOnce();
    return;
  }
  new IntersectionObserver(([e]) => (e.isIntersecting ? field.start() : field.stop())).observe(hero);
  document.addEventListener('visibilitychange', () => (document.hidden ? field.stop() : field.start()));
  if (fine) {
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      ptr.x = (e.clientX - r.left) / r.width;
      ptr.y = 1 - (e.clientY - r.top) / r.height;
      ptr.on = true;
    });
    hero.addEventListener('pointerleave', () => (ptr.on = false));
    window.addEventListener('blur', () => (ptr.on = false));
  }
  hero.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('a, button')) return;
    const r = hero.getBoundingClientRect();
    shock = { x: (e.clientX - r.left) / r.width, t: performance.now() / 1000 };
  });
  ScrollTrigger.create({ trigger: hero, start: 'top top', end: 'bottom top', scrub: true, onUpdate: (st) => field.setScroll(st.progress) });
});

initHeroPhone(hero, clock, reduce, (x) => { shock = { x, t: performance.now() / 1000 }; });

if (!reduce) {
  gsap.timeline({ delay: 0.25 })
    .fromTo('[data-hero-kicker]', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.7 })
    .fromTo('.hero__title .line > span', { yPercent: 110 }, { yPercent: 0, duration: 1.2, ease: 'expo.out', stagger: 0.12 }, '-=0.4')
    .fromTo('[data-hero-lead]', { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0 }, '-=0.75')
    .fromTo('[data-hero-cta], .hero .cap-line', { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, stagger: 0.08 }, '-=0.7');
  gsap.to('.hero__inner', { yPercent: -18, autoAlpha: 0.2, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 1 } });
  gsap.fromTo('[data-hero-phone]', { yPercent: 40, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 1.6, ease: 'expo.out', delay: 0.9 });
  gsap.to('[data-hero-stage]', { yPercent: -8, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 1 } });
}

/* ───────────── Sections ───────────── */
initNoise(document.querySelector('[data-noise]'), ctx);
initNight(document.querySelector('[data-night]'), ctx);
initRack(document.querySelector('[data-rack]'), reduce);
initSides(document.querySelector('[data-sides]'), reduce);
initDevices(document.querySelector('[data-devices]'), reduce);

finish(ctx);
