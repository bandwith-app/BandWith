import { gsap } from 'gsap';

/**
 * Feature walkthrough: numbered steps on the left, one sticky phone on the
 * right (CSS sticky, no pin). The step crossing the middle of the screen
 * becomes current; the phone swaps to its capture and its status badge.
 * A step with data-glow shows the Stage click glow around the screen.
 */
export function initFlow(root: HTMLElement | null, reduce: boolean) {
  if (!root) return;
  const steps = Array.from(root.querySelectorAll<HTMLElement>('[data-flow-step]'));
  const img = root.querySelector<HTMLImageElement>('[data-flow-img]');
  const badge = root.querySelector<HTMLElement>('[data-flow-badge]');
  const device = root.querySelector<HTMLElement>('[data-flow-device]');
  if (!steps.length || !img) return;

  let cur = -1;
  const set = (i: number) => {
    if (i === cur) return;
    cur = i;
    const s = steps[i];
    steps.forEach((el, k) => el.classList.toggle('is-on', k === i));
    device?.classList.toggle('is-glow', s.hasAttribute('data-glow'));
    if (badge) badge.lastChild!.textContent = s.dataset.badge ?? '';
    badge?.setAttribute('data-tone', /bluetooth/i.test(s.dataset.badge ?? '') ? 'bt' : 'live');
    const src = s.dataset.shot;
    if (!src || img.getAttribute('src') === src) return;
    if (reduce) { img.src = src; return; }
    gsap.to(img, { autoAlpha: 0, duration: 0.18, onComplete: () => {
      img.src = src;
      gsap.to(img, { autoAlpha: 1, duration: 0.4, delay: 0.05 });
    } });
  };

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) set(steps.indexOf(e.target as HTMLElement)); });
  }, { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((s) => io.observe(s));
  set(0);
}
