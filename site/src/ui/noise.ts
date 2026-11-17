import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { Ctx } from '../core/boot';

/**
 * "Chaos, then order". A late-night group chat, one message per question a
 * band asks every week. Scrolling sorts them one by one: the bubble
 * straightens, gets its answer (a channel of the app) and the phone shows the
 * real screen that answers it. Desktop: pinned and scroll-driven.
 * Elsewhere: each message sorts itself as it reaches the middle of the screen.
 */
export function initNoise(root: HTMLElement | null, ctx: Ctx) {
  if (!root) return;
  const items = Array.from(root.querySelectorAll<HTMLElement>('[data-noise-item]'));
  const shots = Array.from(root.querySelectorAll<HTMLElement>('[data-noise-shot]'));
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
    const on = Math.max(0, k - 1);
    shots.forEach((el, i) => el.classList.toggle('is-on', i === on));
    root.classList.toggle('is-done', k >= n);
    if (count) count.textContent = String(k);
  };

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
