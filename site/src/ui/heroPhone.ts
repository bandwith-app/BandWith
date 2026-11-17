import { gsap } from 'gsap';
import type { Clock } from '../motion/clock';

/**
 * Hero phone: the real admin home rising out of the equalizer, with the
 * app's own push notifications (copy from 046_server_notifications_and_push
 * and rehearsalPolls.ts) landing on the beat.
 */

type Push = { kind: 'gig' | 'rehearsal' | 'quote' | 'personal'; title: string; body: string };

const PUSHES: Push[] = [
  { kind: 'rehearsal', title: 'Vote on rehearsal times', body: 'New availability poll: “Extra rehearsal before Rossi wedding”.' },
  { kind: 'gig', title: 'Gig confirmed', body: 'Wedding Rossi · Sat 12 Dec · 19:30 is on. Check your lineup and times.' },
  { kind: 'rehearsal', title: 'Rehearsal confirmed', body: 'Locked in for Thu 17 Dec at 21:00 (Sala Prove Bloom).' },
  { kind: 'quote', title: 'Quote accepted', body: 'Ducati Xmas Party accepted your quote · €3,172.' },
  { kind: 'gig', title: 'Setlist updated', body: 'Wedding Rossi changed. Check the running order before the gig.' },
  { kind: 'gig', title: 'Payment received', body: '350.00 EUR · Wedding Rossi' },
];
const KIND_LABEL = { gig: 'Gig', rehearsal: 'Rehearsal', quote: 'Quote', personal: 'Personal' };

function toast(p: Push) {
  const li = document.createElement('li');
  li.className = 'toast';
  li.dataset.kind = p.kind;
  li.innerHTML =
    `<img class="toast__app" src="/brand/app-icon.png" alt="" width="38" height="38" />` +
    `<span class="toast__body"><span class="toast__meta"><span>BandWith</span><i></i>${KIND_LABEL[p.kind]}<em>now</em></span>` +
    `<b>${p.title}</b><span class="toast__txt">${p.body}</span></span>`;
  return li;
}

export function initHeroPhone(hero: HTMLElement, clock: Clock, reduce: boolean, onPush: (x: number) => void) {
  const stage = hero.querySelector<HTMLElement>('[data-hero-stage]');
  const list = hero.querySelector<HTMLElement>('[data-toasts]');
  const phone = hero.querySelector<HTMLElement>('[data-hero-phone]');
  if (!stage || !list || !phone) return;

  // Desktop: the phone starts just under the first title line (measured, so it never covers type).
  const line = hero.querySelector<HTMLElement>('.hero__title .line');
  const place = () => {
    if (!line) return;
    let top = 0;
    for (let n: HTMLElement | null = line; n && n !== hero; n = n.offsetParent as HTMLElement | null) top += n.offsetTop;
    stage.style.setProperty('--stage-top', `${Math.round(top + line.offsetHeight + 24)}px`);
  };
  place();
  new ResizeObserver(place).observe(hero);
  document.fonts?.ready.then(place);

  let i = 0;
  const push = (animate: boolean) => {
    const li = toast(PUSHES[i % PUSHES.length]);
    i++;
    // One banner at a time: the old one drops back and fades as the new one lands.
    const old = list.firstElementChild as HTMLElement | null;
    list.prepend(li);
    if (old) {
      if (animate) gsap.to(old, { autoAlpha: 0, y: 10, scale: 0.97, duration: 0.28, ease: 'power2.in', onComplete: () => old.remove() });
      else old.remove();
    }
    if (!animate) return;
    gsap.fromTo(li, { autoAlpha: 0, y: -22, scale: 0.96 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.9, ease: 'expo.out', delay: old ? 0.3 : 0 });
    const r = phone.getBoundingClientRect();
    const h = hero.getBoundingClientRect();
    onPush((r.left + r.width / 2 - h.left) / h.width);
  };

  if (reduce) {
    push(false);
    return;
  }

  // First notification once the intro has played, then one every two bars while the hero is on screen.
  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(hero);
  let started = false;
  window.setTimeout(() => { started = true; push(true); }, 1900);
  clock.onStep((step) => {
    if (!started || !visible || document.hidden || step % 32) return;
    push(true);
  });

  // Pointer tilt (fine pointers only).
  if (matchMedia('(pointer: fine)').matches) {
    const rx = gsap.quickTo(phone, 'rotationX', { duration: 0.8, ease: 'power3.out' });
    const ry = gsap.quickTo(phone, 'rotationY', { duration: 0.8, ease: 'power3.out' });
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      ry(((e.clientX - r.left) / r.width - 0.5) * 10);
      rx(-((e.clientY - r.top) / r.height - 0.5) * 8);
    });
    hero.addEventListener('pointerleave', () => { rx(0); ry(0); });
  }
}
