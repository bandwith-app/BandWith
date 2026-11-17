import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type { Ctx } from '../core/boot';
import { dotSvg } from './dotText';

/**
 * "One night": one gig from the client's yes to the last payout.
 * Desktop: the section pins and the night slides sideways, an LED clock
 * keeps the time of the scene in view. Elsewhere: scenes stack vertically,
 * each with its own time.
 */
export function initNight(root: HTMLElement | null, ctx: Ctx) {
  if (!root) return;
  const pin = root.querySelector<HTMLElement>('[data-night-pin]');
  const track = root.querySelector<HTMLElement>('[data-night-track]');
  const clockEl = root.querySelector<HTMLElement>('[data-night-clock]');
  const scenes = Array.from(root.querySelectorAll<HTMLElement>('[data-night-scene]'));
  const bar = root.querySelector<HTMLElement>('[data-night-bar]');
  if (!pin || !track || !scenes.length) return;

  let shown = '';
  const setClock = (i: number) => {
    const t = scenes[i]?.dataset.time ?? '';
    if (!clockEl || t === shown) return;
    shown = t;
    clockEl.innerHTML = dotSvg(t, 0.12);
    clockEl.setAttribute('aria-label', t);
    scenes.forEach((s, k) => s.classList.toggle('is-now', k === i));
    if (!ctx.reduce) gsap.fromTo(clockEl.querySelectorAll('circle:not([opacity])'), { opacity: 0.2 }, { opacity: 1, duration: 0.35, stagger: { each: 0.004, from: 'random' } });
  };
  setClock(0);

  if (ctx.reduce) return;
  const mm = gsap.matchMedia();
  mm.add('(min-width: 1081px) and (min-height: 640px)', () => {
    root.classList.add('is-pinned');
    const dist = () => Math.max(0, track.scrollWidth - window.innerWidth);
    const tween = gsap.to(track, {
      x: () => -dist(), ease: 'none',
      scrollTrigger: {
        trigger: root, pin, start: 'top top', end: () => `+=${dist()}`, scrub: 0.6, anticipatePin: 1, invalidateOnRefresh: true,
        onUpdate: (self) => {
          bar?.style.setProperty('--p', self.progress.toFixed(4));
          setClock(Math.min(scenes.length - 1, Math.round(self.progress * (scenes.length - 1))));
        },
      },
    });
    // Each scene's phone drifts a little against the slide (depth, not parallax text).
    const drifts = scenes.map((s) => {
      const dev = s.querySelector('[data-night-device]');
      return dev ? gsap.fromTo(dev, { xPercent: 12 }, {
        xPercent: -12, ease: 'none',
        scrollTrigger: { trigger: s, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true },
      }) : null;
    });
    return () => { drifts.forEach((d) => d?.kill()); tween.scrollTrigger?.kill(); tween.kill(); gsap.set(track, { x: 0 }); root.classList.remove('is-pinned'); };
  });
  mm.add('(max-width: 1080px), (max-height: 639px)', () => {
    const sts = scenes.map((s, i) => ScrollTrigger.create({ trigger: s, start: 'top 55%', end: 'bottom 55%', onToggle: (self) => self.isActive && setClock(i) }));
    return () => sts.forEach((s) => s.kill());
  });
}
