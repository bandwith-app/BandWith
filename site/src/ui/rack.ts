import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * Home rack: eleven channel strips. When the rack comes into view the band
 * "sound-checks" it: every fader rises to its own level and its meter lights
 * to match, left to right. Hover or focus a live strip and it goes to full.
 */
export function initRack(root: HTMLElement | null, reduce: boolean) {
  if (!root) return;
  const strips = Array.from(root.querySelectorAll<HTMLElement>('[data-strip]'));
  const LEVELS = [0.62, 0.48, 0.7, 0.4, 0.55, 0.66, 0.92, 0.5, 0.58, 0.44, 0.6];

  const light = (s: HTMLElement, lv: number) => {
    const cells = Array.from(s.querySelectorAll<HTMLElement>('.strip__meter i')).reverse();
    const on = Math.round(lv * cells.length);
    cells.forEach((c, i) => c.classList.toggle('on', i < on));
  };

  strips.forEach((s, i) => {
    const lv = { v: reduce ? LEVELS[i % LEVELS.length] : 0 };
    const target = LEVELS[i % LEVELS.length];
    const apply = () => { s.style.setProperty('--lv', lv.v.toFixed(3)); light(s, lv.v); };
    apply();
    if (!reduce) {
      ScrollTrigger.create({
        trigger: root, start: 'top 75%', once: true,
        onEnter: () => gsap.to(lv, { v: target, duration: 1.1, ease: 'expo.out', delay: i * 0.06, onUpdate: apply }),
      });
    }
    if (s.tagName === 'A') {
      const up = () => { gsap.to(lv, { v: 1, duration: reduce ? 0 : 0.45, ease: 'power3.out', overwrite: true, onUpdate: apply }); };
      const down = () => { gsap.to(lv, { v: target, duration: reduce ? 0 : 0.6, ease: 'power3.out', overwrite: true, onUpdate: apply }); };
      s.addEventListener('pointerenter', up);
      s.addEventListener('focus', up);
      s.addEventListener('pointerleave', down);
      s.addEventListener('blur', down);
    }
  });
}
