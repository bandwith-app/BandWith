import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { initNavMark } from './navMark';
import { storageGet, storageSet } from '../core/storage';
import { fitCrop, focusCrop, parseRegion } from './crop';

/**
 * The nav as a small channel strip (every page).
 * - Logo: a three-band meter that plays only while hovered (navMark.ts).
 * - Deck: Features (opens the rack panel), One night, Guide. One fader cap
 *   glides to the item under the pointer and parks on the current page.
 * - Features panel (≥1081px): the eleven channels in four groups; the row
 *   under the pointer (or focus) previews a zoomed piece of its screen.
 * - After the first screen the bar tightens; over bone sheets it turns light.
 * - ≤1080px: the menu button opens the pill into a full-height sheet.
 */

type Opts = {
  nav: HTMLElement;
  reduce: boolean;
  time: () => number;
  lock: (on: boolean) => void;
};

export function initNav({ nav, reduce, time, lock }: Opts) {
  const brand = nav.querySelector<HTMLElement>('[data-brand]');
  const mark = nav.querySelector<SVGSVGElement>('[data-mark]');
  if (brand && mark) initNavMark(brand, mark, time, reduce);

  /* ── Rolling labels ── */
  nav.querySelectorAll<HTMLElement>('[data-roll]').forEach((el) => {
    const txt = el.textContent ?? '';
    el.innerHTML = `<span class="sr-only">${txt}</span>` + Array.from(txt).map((ch, i) => { const c = ch === " " ? "\u00a0" : ch; return `<span class="ch" style="--i:${i}" aria-hidden="true"><i data-c="${c}">${c}</i></span>`; }).join('');
  });

  /* ── Current page ── */
  const page = document.body.dataset.page ?? '';
  nav.querySelectorAll<HTMLElement>('[data-nav-page]').forEach((a) => {
    if (a.dataset.navPage === page) { a.classList.add('is-active'); a.setAttribute('aria-current', 'page'); }
  });
  if (document.body.dataset.channel) nav.querySelector('[data-rack-btn]')?.classList.add('is-active');

  /* ── Deck + fader cap ── */
  const deck = nav.querySelector<HTMLElement>('[data-deck]');
  const cap = nav.querySelector<HTMLElement>('[data-cap]');
  const items = Array.from(deck?.querySelectorAll<HTMLElement>('.nav__item') ?? []);
  let hovered: HTMLElement | null = null;
  let capShown = false;
  const parked = () => items.find((a) => a.classList.contains('is-active')) ?? null;

  function moveCap(to: HTMLElement | null, instant = false) {
    if (!cap || !deck) return;
    if (!to) {
      capShown = false;
      gsap.to(cap, { autoAlpha: 0, scaleX: 0.6, duration: 0.35, ease: 'power2.out', overwrite: 'auto' });
      return;
    }
    const x = to.offsetLeft;
    const w = to.offsetWidth;
    const fast = instant || reduce || !capShown;
    gsap.to(cap, { x, width: w, autoAlpha: 1, scaleX: 1, duration: fast ? (capShown || reduce ? 0 : 0.4) : 0.55, ease: fast ? 'power3.out' : 'expo.out', overwrite: 'auto' });
    if (!capShown && !reduce) gsap.set(cap, { x, width: w });
    capShown = true;
  }
  items.forEach((a) => {
    a.addEventListener('pointerenter', () => { hovered = a; moveCap(a); });
    a.addEventListener('focus', () => { hovered = a; moveCap(a); });
    a.addEventListener('blur', () => { hovered = null; moveCap(parked()); });
  });
  deck?.addEventListener('pointerleave', () => { hovered = null; moveCap(parked()); });
  window.addEventListener('resize', () => moveCap(hovered ?? parked(), true));
  document.fonts?.ready.then(() => moveCap(hovered ?? parked(), true));

  /* ── Light over bone sheets; tighter after the first screen ── */
  const lightSheets = document.querySelectorAll<HTMLElement>('.sec--bone, [data-light]');
  let panelOpen = false;
  function sync() {
    const r = nav.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    let light = false;
    lightSheets.forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.top <= mid && b.bottom >= mid) light = true;
    });
    nav.classList.toggle('is-light', light && !nav.classList.contains('is-open') && !panelOpen);
    nav.classList.toggle('is-tight', window.scrollY > window.innerHeight * 0.6);
  }

  /* ── Features panel (≥1081px) ── */
  const rackBtn = nav.querySelector<HTMLButtonElement>('[data-rack-btn]');
  const panel = document.querySelector<HTMLElement>('[data-rack-panel]');
  let closeT = 0;
  if (rackBtn && panel) {
    const crop = panel.querySelector<HTMLElement>('[data-fp-crop]');
    const chOut = panel.querySelector<HTMLElement>('[data-fp-ch]');
    const nameOut = panel.querySelector<HTMLElement>('[data-fp-name]');
    const lineOut = panel.querySelector<HTMLElement>('[data-fp-line]');
    const strips = Array.from(panel.querySelectorAll<HTMLElement>('[data-fp]'));
    const current = strips.find((s) => s.getAttribute('href') === location.pathname) ?? strips.find((s) => !s.classList.contains('is-soon')) ?? strips[0];
    let shown: HTMLElement | null = null;

    const preview = (s: HTMLElement) => {
      if (s === shown) return;
      shown = s;
      strips.forEach((x) => x.classList.toggle('is-on', x === s));
      if (crop && s.dataset.shot) {
        if (panel.hidden) { const img = crop.querySelector('img'); if (img) img.src = s.dataset.shot; }
        else focusCrop(crop, parseRegion(s.dataset.crop), s.dataset.shot);
      }
      if (chOut) chOut.textContent = s.dataset.ch ?? '';
      if (nameOut) nameOut.textContent = s.dataset.name ?? '';
      if (lineOut) lineOut.textContent = s.classList.contains('is-soon') ? `${s.dataset.line} Page coming soon.` : s.dataset.line ?? '';
      panel.style.setProperty('--c', s.style.getPropertyValue('--c'));
    };
    strips.forEach((s) => {
      s.addEventListener('pointerenter', () => preview(s));
      s.addEventListener('focus', () => preview(s));
    });

    const setPanel = (on: boolean, focus = false) => {
      window.clearTimeout(closeT);
      if (on === panelOpen) return;
      panelOpen = on;
      rackBtn.setAttribute('aria-expanded', String(on));
      sync();
      if (on) {
        shown = null;
        panel.hidden = true;
        preview(current);
        panel.hidden = false;
        if (crop) fitCrop(crop, parseRegion(current.dataset.crop));
        if (!reduce) gsap.fromTo(panel, { autoAlpha: 0, y: -10, clipPath: 'inset(0% 0% 100% 0% round 32px)' }, { autoAlpha: 1, y: 0, clipPath: 'inset(0% 0% 0% 0% round 32px)', duration: 0.6, ease: 'expo.out' });
        if (focus) (strips.find((s) => s.tagName === 'A') ?? strips[0]).focus({ preventScroll: true });
      } else if (reduce) panel.hidden = true;
      else gsap.to(panel, { autoAlpha: 0, y: -6, duration: 0.25, ease: 'power2.in', onComplete: () => { if (!panelOpen) panel.hidden = true; } });
    };
    const later = () => { window.clearTimeout(closeT); closeT = window.setTimeout(() => setPanel(false), 260); };

    rackBtn.addEventListener('click', (e) => setPanel(!panelOpen, e.detail === 0));
    if (matchMedia('(hover: hover)').matches) {
      rackBtn.addEventListener('pointerenter', () => { window.clearTimeout(closeT); closeT = window.setTimeout(() => setPanel(true), 90); });
      rackBtn.addEventListener('pointerleave', later);
      panel.addEventListener('pointerenter', () => window.clearTimeout(closeT));
      panel.addEventListener('pointerleave', later);
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panelOpen) { setPanel(false); rackBtn.focus(); }
    });
    document.addEventListener('pointerdown', (e) => {
      if (panelOpen && !panel.contains(e.target as Node) && !rackBtn.contains(e.target as Node)) setPanel(false);
    });
    window.addEventListener('scroll', () => { if (panelOpen && !panel.matches(':hover')) setPanel(false); }, { passive: true });
  }

  sync();
  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: sync, onRefresh: sync });

  /* ── Intro: the pill opens from the logo outwards (first page of a visit) ── */
  if (!reduce && !storageGet('bw-nav-seen', 'session')) {
    storageSet('bw-nav-seen', '1', 'session');
    const w = nav.offsetWidth;
    const kids = nav.querySelectorAll('.nav__brand, .nav__deck .nav__item, .nav__actions > *:not([hidden])');
    gsap.timeline({ delay: 0.15 })
      .fromTo(nav, { clipPath: `inset(0px ${w - 64}px 0px 0px round 999px)` }, { clipPath: 'inset(0px 0px 0px 0px round 999px)', duration: 1.3, ease: 'expo.inOut', clearProps: 'clipPath' })
      .fromTo(kids, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.7, ease: 'expo.out', stagger: 0.05, clearProps: 'transform,opacity,visibility' }, 0.55);
  }

  /* ── Menu sheet (≤1080px) ── */
  const btn = nav.querySelector<HTMLButtonElement>('[data-menu-btn]');
  const menu = document.querySelector<HTMLElement>('[data-menu]');
  if (!btn || !menu) return;
  const rows = Array.from(menu.querySelectorAll<HTMLElement>('.menu__row'));
  const words = menu.querySelectorAll<HTMLElement>('.menu__w');
  const foot = menu.querySelector<HTMLElement>('.menu__foot');
  let open = false;
  let kb = false;
  window.addEventListener('keydown', () => { kb = true; }, true);
  window.addEventListener('pointerdown', () => { kb = false; }, true);
  let tl: gsap.core.Timeline | null = null;

  function setOpen(on: boolean, focus = true) {
    if (on === open) return;
    open = on;
    btn!.setAttribute('aria-expanded', String(on));
    btn!.setAttribute('aria-label', on ? 'Close menu' : 'Open menu');
    nav.classList.toggle('is-open', on);
    sync();
    lock(on);
    tl?.kill();
    const navH = nav.offsetHeight;
    if (on) {
      menu!.hidden = false;
      const h = menu!.offsetHeight;
      if (reduce) gsap.set(menu, { clipPath: 'none' });
      else {
        tl = gsap.timeline()
          .fromTo(menu, { clipPath: `inset(0px 0px ${h - navH}px 0px round 27px)` }, { clipPath: 'inset(0px 0px 0px 0px round 27px)', duration: 0.75, ease: 'expo.inOut' })
          .fromTo(words, { yPercent: 110 }, { yPercent: 0, duration: 0.9, ease: 'expo.out', stagger: 0.035 }, 0.3)
          .fromTo(rows, { '--rule': 0 }, { '--rule': 1, duration: 0.8, ease: 'expo.out', stagger: 0.035 }, 0.3)
          .fromTo(foot, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.7, ease: 'expo.out' }, 0.55);
      }
      if (focus && kb) menu!.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
    } else {
      const h = menu!.offsetHeight;
      const done = () => { menu!.hidden = true; };
      if (reduce) done();
      else {
        tl = gsap.timeline({ onComplete: done })
          .to([foot, ...rows], { autoAlpha: 0, duration: 0.2, ease: 'power2.in' })
          .to(menu, { clipPath: `inset(0px 0px ${h - navH}px 0px round 27px)`, duration: 0.55, ease: 'expo.inOut' }, 0.05)
          .set([foot, ...rows], { clearProps: 'opacity,visibility' });
      }
      if (focus && kb) btn!.focus({ preventScroll: true });
    }
  }

  btn.addEventListener('click', () => setOpen(!open));
  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false, false)));
  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key !== 'Tab') return;
    const f = [btn, ...Array.from(menu.querySelectorAll<HTMLElement>('a'))];
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  });
  matchMedia('(min-width: 1081px)').addEventListener('change', (m) => { if (m.matches) setOpen(false, false); });
}
