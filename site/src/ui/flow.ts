import { fitCrop, focusCrop, parseRegion } from './crop';

/**
 * Feature walkthrough: numbered steps on the left, one sticky screen on the
 * right (CSS sticky, no pin; on phones it sticks on top). The step crossing
 * the middle of the screen becomes current; the screen pans and zooms to the
 * part of the capture the step talks about (data-shot + data-region) and its
 * status badge changes. A step with data-glow shows the Stage click glow.
 */
export function initFlow(root: HTMLElement | null) {
  if (!root) return;
  const steps = Array.from(root.querySelectorAll<HTMLElement>('[data-flow-step]'));
  const badge = root.querySelector<HTMLElement>('[data-flow-badge]');
  const device = root.querySelector<HTMLElement>('[data-flow-device]');
  if (!steps.length || !device) return;
  fitCrop(device, parseRegion(steps[0].dataset.region));

  let cur = -1;
  const set = (i: number) => {
    if (i === cur) return;
    cur = i;
    const s = steps[i];
    steps.forEach((el, k) => el.classList.toggle('is-on', k === i));
    device?.classList.toggle('is-glow', s.hasAttribute('data-glow'));
    if (badge) badge.lastChild!.textContent = s.dataset.badge ?? '';
    badge?.setAttribute('data-tone', /bluetooth/i.test(s.dataset.badge ?? '') ? 'bt' : 'live');
    focusCrop(device, parseRegion(s.dataset.region), s.dataset.shot);
  };

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) set(steps.indexOf(e.target as HTMLElement)); });
  }, { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((s) => io.observe(s));
  set(0);
}
