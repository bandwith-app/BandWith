import { gsap } from 'gsap';
import type { Clock } from '../motion/clock';
import { fitCrop, focusCrop, type Region } from './crop';

/**
 * Hero screen: one push notification lands on top of a zoomed piece of the
 * app, and the piece below is where that notification takes you. Copy follows
 * the app's own push texts; the screens are the Academy captures (demo band
 * Velvet Static, gig "Client A — Wedding").
 */

type Push = {
  kind: 'gig' | 'rehearsal' | 'quote';
  title: string;
  body: string;
  shot: string;
  region: Region;
  where: string;
  alt: string;
};

export const PUSHES: Push[] = [
  {
    kind: 'gig', title: 'Gig confirmed', body: 'Client A — Wedding · Sat 21 Nov · 20:30 is on. Check your lineup and times.',
    shot: 'gig-workspace-admin', region: { y0: 0.02, y1: 0.34 }, where: 'CH 01 · The gig',
    alt: 'The gig page: Client A — Wedding at Villa Necchi, Saturday 21 November.',
  },
  {
    kind: 'rehearsal', title: 'Vote on rehearsal times', body: 'New availability poll: “Extra rehearsal next week”.',
    shot: 'shot-poll-card', region: { y0: 0.13, y1: 0.44 }, where: 'CH 04 · The poll',
    alt: 'A rehearsal poll with three dates, three of five people answered.',
  },
  {
    kind: 'quote', title: 'The client replied', body: 'Northwind Conferences: “Could you add a DJ set after the band?”',
    shot: 'quote-client-confirmation', region: { y0: 0, y1: 0.31 }, where: 'CH 02 · The quote',
    alt: 'The quote page: sent, viewed, now discussing, with the client’s question.',
  },
  {
    kind: 'gig', title: 'Show readiness 5/6', body: 'Client A — Wedding: lyrics and charts are still to do.',
    shot: 'gig-workspace-admin', region: { y0: 0.47, y1: 0.96 }, where: 'CH 01 · Show readiness',
    alt: 'Show readiness: setlist, rider, contract, lineup and deposit done; lyrics to do.',
  },
  {
    kind: 'gig', title: 'Setlist updated', body: 'Rooftop set changed. Check the running order before the gig.',
    shot: 'music-setlist-editor', region: { y0: 0.27, y1: 0.8 }, where: 'CH 06 · The setlist',
    alt: 'The setlist editor searching the song library.',
  },
];
const KIND_LABEL = { gig: 'Gig', rehearsal: 'Rehearsal', quote: 'Quote' };
const KIND_COLOR = { gig: 'var(--lime)', rehearsal: '#3c72ff', quote: 'var(--quote)' };
const src = (id: string) => `/shots/${id}@phone.webp`;

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

export function initHeroScreen(hero: HTMLElement, clock: Clock, reduce: boolean, onPush: (x: number) => void) {
  const list = hero.querySelector<HTMLElement>('[data-toasts]');
  const crop = hero.querySelector<HTMLElement>('[data-hero-crop]');
  const where = hero.querySelector<HTMLElement>('[data-hero-where]');
  if (!list || !crop) return;
  const img = crop.querySelector<HTMLImageElement>('.crop__img');

  // Warm the cache so every swap is instant.
  PUSHES.forEach((p) => { const i = new Image(); i.src = src(p.shot); });

  let i = 0;
  const show = (animate: boolean) => {
    const p = PUSHES[i % PUSHES.length];
    i++;
    const li = toast(p);
    const old = list.firstElementChild as HTMLElement | null;
    list.prepend(li);
    const label = () => { if (where) { where.textContent = p.where; crop.style.setProperty('--c', KIND_COLOR[p.kind]); } };
    if (!animate) {
      label();
      old?.remove();
      fitCrop(crop, p.region);
      if (img) { img.src = src(p.shot); img.alt = p.alt; }
      return;
    }
    if (old) gsap.to(old, { autoAlpha: 0, y: 8, scale: 0.97, duration: 0.3, ease: 'power2.in', onComplete: () => old.remove() });
    gsap.fromTo(li, { autoAlpha: 0, y: -18, scale: 0.96 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.9, ease: 'expo.out', delay: old ? 0.25 : 0 });
    focusCrop(crop, p.region, src(p.shot), p.alt);
    window.setTimeout(label, 260);
    const r = crop.getBoundingClientRect();
    const h = hero.getBoundingClientRect();
    onPush((r.left + r.width / 2 - h.left) / h.width);
  };

  // First screen without a banner: the gig, as it is.
  fitCrop(crop, PUSHES[0].region);
  if (reduce) { show(false); return; }

  // A banner once the intro has played, then one every two bars while the hero is on screen.
  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(hero);
  let started = false;
  window.setTimeout(() => { started = true; show(true); }, 1700);
  clock.onStep((step) => {
    if (!started || !visible || document.hidden || step % 32) return;
    show(true);
  });
}
