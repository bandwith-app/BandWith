import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * "Same gig. Two sides.": the admin's and a member's view of one gig, one
 * over the other, split by a handle. Drag anywhere on the phone, or use the
 * arrow keys (it is a native range input). On first view the handle sweeps
 * once so people see there is something to drag.
 */
export function initSides(root: HTMLElement | null, reduce: boolean) {
  const cmp = root?.querySelector<HTMLElement>('[data-cmp]');
  const range = cmp?.querySelector<HTMLInputElement>('[data-cmp-range]');
  if (!root || !cmp || !range) return;
  const lists = root.querySelectorAll<HTMLElement>('[data-side]');

  const set = (v: number) => {
    cmp.style.setProperty('--x', `${v}%`);
    // The side that owns more of the phone is the one being described.
    lists.forEach((l) => l.classList.toggle('is-lead', l.dataset.side === (v >= 50 ? 'admin' : 'member')));
    range.setAttribute('aria-valuetext', v >= 50 ? `Admin view, ${Math.round(v)}%` : `Member view, ${Math.round(100 - v)}%`);
  };
  range.addEventListener('input', () => set(Number(range.value)));
  set(Number(range.value));

  if (reduce) return;
  ScrollTrigger.create({
    trigger: cmp, start: 'top 70%', once: true,
    onEnter: () => {
      const o = { v: Number(range.value) };
      const upd = () => { range.value = String(o.v); set(o.v); };
      let touched = false;
      range.addEventListener('pointerdown', () => { touched = true; tl.kill(); }, { once: true });
      range.addEventListener('keydown', () => { touched = true; tl.kill(); }, { once: true });
      const tl = gsap.timeline({ delay: 0.3, onUpdate: () => { if (!touched) upd(); } })
        .to(o, { v: 78, duration: 0.9, ease: 'power3.inOut' })
        .to(o, { v: 22, duration: 1.2, ease: 'power3.inOut' })
        .to(o, { v: 50, duration: 0.8, ease: 'power3.out' });
    },
  });
}
