import { gsap } from 'gsap';
import type { Ctx } from '../core/boot';

/**
 * "One night": one gig from the client's yes to the last payout.
 * Desktop: the section pins and the night slides sideways; seven cells in
 * the head keep the time: the scene in view is lit, the ones still to come
 * are outlined. Elsewhere, and with reduced motion: scenes stack vertically,
 * each with its own time in its own cell.
 */
export function initNight(root: HTMLElement | null, ctx: Ctx) {
  if (!root) return;
  const pin = root.querySelector<HTMLElement>('[data-night-pin]');
  const track = root.querySelector<HTMLElement>('[data-night-track]');
  const scenes = Array.from(root.querySelectorAll<HTMLElement>('[data-night-scene]'));
  const cells = Array.from(root.querySelectorAll<HTMLElement>('[data-night-cell]'));
  if (!pin || !track || !scenes.length) return;

  let now = -1;
  const setNow = (i: number) => {
    if (i === now) return;
    now = i;
    scenes.forEach((s, k) => s.classList.toggle('is-now', k === i));
    cells.forEach((c, k) => { c.classList.toggle('is-on', k === i); c.classList.toggle('is-next', k > i); });
  };
  setNow(0);

  if (ctx.reduce) return;
  const mm = gsap.matchMedia();
  mm.add('(min-width: 1081px) and (min-height: 640px)', () => {
    root.classList.add('is-pinned');
    const dist = () => Math.max(0, track.scrollWidth - window.innerWidth);
    const tween = gsap.to(track, {
      x: () => -dist(), ease: 'none',
      scrollTrigger: {
        trigger: root, pin, start: 'top top', end: () => `+=${dist()}`, scrub: 0.6, anticipatePin: 1, invalidateOnRefresh: true,
        onUpdate: (self) => setNow(Math.min(scenes.length - 1, Math.round(self.progress * (scenes.length - 1)))),
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
}
