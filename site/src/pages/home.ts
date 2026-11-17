// core/boot first: its base CSS must come before the page's own styles.
import { boot, finish } from '../core/boot';
import '../styles/hero.css';
import '../styles/home.css';
import '../styles/roles.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { clock } from '../motion/clock';
import { createHeroEq } from '../ui/heroEq';
import { initHeroScreen } from '../ui/heroScreen';
import { initNoise } from '../ui/noise';
import { initNight } from '../ui/night';
import { initRack } from '../ui/rack';
import { initRoles } from '../ui/roles';
import { initDevices } from '../ui/devices';

const ctx = boot();
const { reduce, fine } = ctx;

/* ───────────── Hero: LED equalizer + the screen a notification opens ───────────── */
const hero = document.querySelector<HTMLElement>('[data-hero]')!;
const eq = createHeroEq(hero.querySelector<HTMLCanvasElement>('[data-hero-eq]')!, clock, reduce);

if (eq && !reduce) {
  let onScreen = true;
  const run = () => (onScreen && !document.hidden ? eq.start() : eq.stop());
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; run(); }).observe(hero);
  document.addEventListener('visibilitychange', run);
  run();
  if (fine) {
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      eq.pointer((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height, true);
    });
    hero.addEventListener('pointerleave', () => eq.pointer(0.5, 0.5, false));
    window.addEventListener('blur', () => eq.pointer(0.5, 0.5, false));
  }
  hero.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('a, button')) return;
    const r = hero.getBoundingClientRect();
    eq.shock((e.clientX - r.left) / r.width);
  });
  ScrollTrigger.create({ trigger: hero, start: 'top top', end: 'bottom top', onUpdate: (st) => eq.scroll(st.progress) });
}

initHeroScreen(hero, clock, reduce, (x) => eq?.shock(x));

if (!reduce) {
  gsap.timeline({ delay: 0.2 })
    .fromTo('[data-hero-kicker]', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.7 })
    .fromTo('.hero__title .line > span', { yPercent: 110 }, { yPercent: 0, duration: 1.2, ease: 'expo.out', stagger: 0.12 }, '-=0.4')
    .fromTo('[data-hero-lead]', { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0 }, '-=0.75')
    .fromTo('[data-hero-cta], .hero__cap', { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, stagger: 0.08 }, '-=0.7')
    .fromTo('[data-hero-stage]', { autoAlpha: 0, y: 60, scale: 0.96 }, { autoAlpha: 1, y: 0, scale: 1, duration: 1.4, ease: 'expo.out' }, 0.5);
  gsap.to('.hero__copy', { yPercent: -14, autoAlpha: 0.25, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 1 } });
  gsap.to('[data-hero-stage]', { y: -60, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 1 } });
}

/* ───────────── Sections ───────────── */
initNoise(document.querySelector('[data-noise]'), ctx);
initNight(document.querySelector('[data-night]'), ctx);
initRack(document.querySelector('[data-rack]'), clock, reduce);
initRoles(document.querySelector('[data-roles]'), reduce);
initDevices(document.querySelector('[data-devices]'), reduce);

finish(ctx);
