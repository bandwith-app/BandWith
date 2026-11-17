import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { Ctx } from '../core/boot';
import { fitCrop, focusCrop, type Region } from './crop';

/** The screen that answers each question, zoomed to the part that answers it. */
const ANSWERS: { shot: string; region: Region; where: string; c: string }[] = [
  { shot: 'shot-poll-card', region: { y0: 0.13, y1: 0.44 }, where: 'CH 04 · Rehearsals', c: '#3c72ff' },
  { shot: 'gig-workspace-member', region: { y0: 0.02, y1: 0.45 }, where: 'CH 01 · The gig', c: 'var(--lime)' },
  { shot: 'music-stage', region: { y0: 0.4, y1: 0.9 }, where: 'CH 06 · Setlist', c: 'var(--lime)' },
  { shot: 'people-find-deputy', region: { y0: 0.29, y1: 0.76 }, where: 'CH 09 · Deputies', c: 'var(--personal)' },
  { shot: 'quote-client-confirmation', region: { y0: 0, y1: 0.31 }, where: 'CH 02 · Quotes', c: 'var(--quote)' },
  { shot: 'basics-home-admin', region: { y0: 0.64, y1: 0.88 }, where: 'CH 03 · Payouts', c: 'var(--lime)' },
];

/**
 * "Chaos, then order". A late-night group chat, one message per question a
 * band asks every week. Scrolling sorts them one by one: the bubble
 * straightens, gets its answer (a channel of the app) and the phone shows the
 * part of the real screen that answers it. Desktop: pinned and scroll-driven.
 * Elsewhere: each message sorts itself as it reaches the middle of the screen.
 */
export function initNoise(root: HTMLElement | null, ctx: Ctx) {
  if (!root) return;
  const items = Array.from(root.querySelectorAll<HTMLElement>('[data-noise-item]'));
  const crop = root.querySelector<HTMLElement>('[data-noise-crop]');
  const where = root.querySelector<HTMLElement>('[data-noise-where]');
  const count = root.querySelector<HTMLElement>('[data-noise-n]');
  const pin = root.querySelector<HTMLElement>('[data-noise-pin]');
  const n = items.length;

  // Every bubble starts a little askew, like a chat at 1 a.m.
  items.forEach((el, i) => {
    el.style.setProperty('--r', `${[-2.4, 1.8, -1.2, 2.6, -2, 1.4][i % 6]}deg`);
    el.style.setProperty('--dx', `${[-14, 22, -6, 30, 4, -20][i % 6]}px`);
  });

  let step = -1;
  const set = (k: number) => {
    k = Math.max(0, Math.min(n, k));
    if (k === step) return;
    step = k;
    items.forEach((el, i) => el.classList.toggle('is-sorted', i < k));
    const a = ANSWERS[Math.max(0, k - 1)];
    if (crop && a) {
      focusCrop(crop, a.region, `/shots/${a.shot}@phone.webp`);
      window.setTimeout(() => { if (where) where.textContent = a.where; crop.style.setProperty('--c', a.c); }, 240);
    }
    root.classList.toggle('is-done', k >= n);
    if (count) count.textContent = String(k);
  };

  if (crop) fitCrop(crop, ANSWERS[0].region);
  if (ctx.reduce) { set(n); return; }
  set(0);

  const mm = gsap.matchMedia();
  mm.add({ pinned: '(min-width: 1081px) and (min-height: 640px)', loose: '(max-width: 1080px), (max-height: 639px)' }, (c) => {
    if (c.conditions?.pinned && pin) {
      root.classList.add('is-pinned');
      // One message per ~55% of a screen; a beat of stillness at both ends.
      const st = ScrollTrigger.create({
        trigger: root, pin, start: 'top top', end: () => `+=${window.innerHeight * (0.55 * n + 0.6)}`,
        scrub: true, anticipatePin: 1,
        onUpdate: (self) => set(Math.floor(self.progress * (n + 0.6) + 0.15)),
      });
      return () => { st.kill(); root.classList.remove('is-pinned'); step = -1; set(0); };
    }
    const sts = items.map((el, i) => ScrollTrigger.create({
      trigger: el, start: 'top 62%', end: 'bottom top',
      onEnter: () => set(Math.max(step, i + 1)),
      onLeaveBack: () => set(i),
    }));
    return () => sts.forEach((s) => s.kill());
  });
}
