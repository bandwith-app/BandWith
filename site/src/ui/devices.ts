import { gsap } from 'gsap';
import { shot, type ShotDevice } from '../content/site';

/**
 * Device switcher: one real screen across every device and Duo posture.
 * The frame morphs to the device's shape (registered --ar), the capture
 * crossfades. Cycles on its own while visible until someone picks a tab.
 */

const AR: Record<ShotDevice, number> = {
  phone: 780 / 1688,
  tablet: 1600 / 1112,
  web: 1800 / 1125,
  duoClosed: 780 / 1135,
  duoBook: 1600 / 1126,
  duoLaptop: 900 / 1280,
};

export function initDevices(root: HTMLElement | null, reduce: boolean) {
  if (!root) return;
  const id = root.dataset.shot ?? 'calendar-month';
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-dev]'));
  const frame = root.querySelector<HTMLElement>('[data-frame]');
  const cap = root.querySelector<HTMLElement>('[data-dev-cap]');
  if (!frame || !tabs.length) return;

  let cur = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
  if (cur < 0) cur = 0;
  let auto = !reduce;
  let timer = 0;

  const show = (i: number, focus = false) => {
    cur = (i + tabs.length) % tabs.length;
    const tab = tabs[cur];
    const dev = tab.dataset.dev as ShotDevice;
    tabs.forEach((t, k) => {
      t.setAttribute('aria-selected', String(k === cur));
      t.tabIndex = k === cur ? 0 : -1;
    });
    if (focus) tab.focus();
    frame.dataset.frame = dev;
    frame.style.setProperty('--ar', String(AR[dev]));
    if (cap) cap.textContent = tab.dataset.cap ?? '';

    const old = frame.querySelector<HTMLImageElement>('img.is-on');
    const img = new Image();
    img.className = 'dv__img';
    img.alt = tab.dataset.alt ?? '';
    img.decoding = 'async';
    img.src = shot(id, dev);
    const swap = () => {
      frame.appendChild(img);
      img.classList.add('is-on');
      if (reduce) { old?.remove(); return; }
      gsap.fromTo(img, { autoAlpha: 0, scale: 1.03 }, { autoAlpha: 1, scale: 1, duration: 0.6, ease: 'power3.out', delay: 0.15 });
      if (old) gsap.to(old, { autoAlpha: 0, duration: 0.3, onComplete: () => old.remove() });
    };
    if (img.complete) swap(); else { img.onload = swap; img.onerror = swap; }
  };

  tabs.forEach((t, k) => {
    t.addEventListener('click', () => { auto = false; show(k); });
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (e.key === 'Home') { e.preventDefault(); auto = false; show(0, true); }
      else if (e.key === 'End') { e.preventDefault(); auto = false; show(tabs.length - 1, true); }
      else if (d) { e.preventDefault(); auto = false; show(cur + d, true); }
    });
  });
  show(cur);
  if (!auto) return;
  const run = (on: boolean) => {
    window.clearInterval(timer);
    if (on && auto) timer = window.setInterval(() => { if (auto && !document.hidden) show(cur + 1); }, 3200);
  };
  let inView = false;
  root.addEventListener('pointerenter', () => run(false));
  root.addEventListener('pointerleave', () => run(inView));
  root.addEventListener('focusin', () => run(false));
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; run(inView); }, { threshold: 0.5 }).observe(root);
}
