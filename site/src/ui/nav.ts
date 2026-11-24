import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { initNavMark } from './navMark';
import { storageGet, storageSet } from '../core/storage';

/**
 * The nav as a small channel strip (every page).
 * - Logo: a three-band meter that plays only while hovered (navMark.ts).
 * - Deck: Features (opens the panel), How it works (the night), Guide, FAQ. One fader cap
 *   glides to the item under the pointer and parks on the current page.
 * - Features panel (≥1081px), "The index": every page and its one-liner in four columns,
 *   the page dimmed behind. Features is a button with aria-expanded: Enter, Space or ↓
 *   opens it and puts focus on the first link; hover opens it after 120 ms; a click
 *   toggles. Tab reads the columns top to bottom; Esc, or Tab out of either end, closes
 *   and returns focus to the button. The current page has aria-current.
 * - After the first screen the bar tightens; over light sheets it turns light.
 * - ≤1080px: the menu button opens a sheet: account first, the four groups as an
 *   accordion (one open at a time, the current page's to begin with), the app pinned at
 *   the bottom. Focus stays inside, the page behind does not scroll, Esc closes.
 * - Reduced motion: both only fade.
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

  /* ── Current page: its row in the panel and in the sheet ── */
  const norm = (p: string) => p.replace(/index\.html$/, '').replace(/\/?$/, '/');
  const here = norm(location.pathname);
  const currentRows = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-mm-row]')).filter((a) => norm(a.getAttribute('href') ?? '') === here);
  currentRows.forEach((a) => { a.setAttribute('aria-current', 'page'); a.classList.add('is-current'); });

  /* ── Features panel (≥1081px) ── */
  const rackBtn = nav.querySelector<HTMLButtonElement>('[data-rack-btn]');
  const panel = document.querySelector<HTMLElement>('[data-rack-panel]');
  const scrim = document.querySelector<HTMLElement>('[data-rack-scrim]');
  let closeT = 0;
  if (rackBtn && panel) {
    const links = () => Array.from(panel.querySelectorAll<HTMLElement>('a[href]'));
    const layers = scrim ? [panel, scrim] : [panel];
    let openedAt = 0;

    const setPanel = (on: boolean, focus = false) => {
      window.clearTimeout(closeT);
      if (on === panelOpen) return;
      panelOpen = on;
      rackBtn.setAttribute('aria-expanded', String(on));
      sync();
      gsap.killTweensOf(layers);
      if (on) {
        openedAt = window.scrollY;
        layers.forEach((l) => { l.hidden = false; });
        // Opacity, not visibility: the links can take focus from the first frame.
        gsap.set(layers, { visibility: 'visible' });
        // Reduced motion: a fade only. Otherwise the panel also comes down a few pixels.
        if (reduce) gsap.fromTo(layers, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: 'none' });
        else {
          if (scrim) gsap.fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: 'power2.out' });
          gsap.fromTo(panel, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.5, ease: 'expo.out' });
        }
        if (focus) links()[0]?.focus({ preventScroll: true });
      } else {
        gsap.to(layers, { autoAlpha: 0, duration: reduce ? 0.12 : 0.22, ease: reduce ? 'none' : 'power2.in', onComplete: () => { if (!panelOpen) layers.forEach((l) => { l.hidden = true; }); } });
      }
    };
    const later = () => { window.clearTimeout(closeT); closeT = window.setTimeout(() => setPanel(false), 260); };
    const back = () => { setPanel(false); rackBtn.focus({ preventScroll: true }); };

    // A click toggles; from the keyboard (Enter, Space: a click with no pointer) focus goes to the first link.
    rackBtn.addEventListener('click', (e) => setPanel(!panelOpen, e.detail === 0));
    rackBtn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown') return;
      e.preventDefault();
      if (panelOpen) links()[0]?.focus({ preventScroll: true }); else setPanel(true, true);
    });
    if (matchMedia('(hover: hover)').matches) {
      rackBtn.addEventListener('pointerenter', () => { window.clearTimeout(closeT); closeT = window.setTimeout(() => setPanel(true), 120); });
      rackBtn.addEventListener('pointerleave', later);
      panel.addEventListener('pointerenter', () => window.clearTimeout(closeT));
      panel.addEventListener('pointerleave', later);
    }
    // Tab reads the panel in order; leaving it at either end closes it and goes back to the button.
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = links();
      const at = f.indexOf(document.activeElement as HTMLElement);
      if ((e.shiftKey && at === 0) || (!e.shiftKey && at === f.length - 1)) { e.preventDefault(); back(); }
    });
    panel.addEventListener('focusout', (e) => {
      const to = e.relatedTarget as Node | null;
      if (panelOpen && to && !panel.contains(to) && !rackBtn.contains(to)) setPanel(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panelOpen) back();
    });
    document.addEventListener('pointerdown', (e) => {
      if (panelOpen && !panel.contains(e.target as Node) && !rackBtn.contains(e.target as Node)) setPanel(false);
    });
    panel.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setPanel(false)));
    // The page moved on under it (a real scroll, not a pixel of settling): the panel steps aside.
    window.addEventListener('scroll', () => { if (panelOpen && Math.abs(window.scrollY - openedAt) > 24 && !panel.matches(':hover') && !panel.contains(document.activeElement)) setPanel(false); }, { passive: true });
    matchMedia('(max-width: 1080px)').addEventListener('change', (m) => { if (m.matches) setPanel(false); });
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
  const behind = Array.from(document.querySelectorAll<HTMLElement>('main, footer'));
  let open = false;
  let kb = false;
  window.addEventListener('keydown', () => { kb = true; }, true);
  window.addEventListener('pointerdown', () => { kb = false; }, true);

  // The four groups: an accordion, one open at a time; closed rows are hidden (out of the tab order).
  const groups = Array.from(menu.querySelectorAll<HTMLElement>('[data-acc-group]'));
  const head = (g: HTMLElement) => g.querySelector<HTMLButtonElement>('[data-acc-btn]')!;
  const setGroup = (g: HTMLElement | null) => groups.forEach((x) => {
    const on = x === g;
    x.classList.toggle('is-open', on);
    head(x).setAttribute('aria-expanded', String(on));
    const list = x.querySelector<HTMLElement>('[data-acc-panel]');
    if (list) list.hidden = !on;
  });
  const homeGroup = groups.find((g) => g.querySelector('[aria-current="page"]')) ?? null;
  setGroup(homeGroup);
  groups.forEach((g) => head(g).addEventListener('click', () => {
    const on = !g.classList.contains('is-open');
    setGroup(on ? g : null);
    if (on) g.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }));

  function setOpen(on: boolean, focus = true) {
    if (on === open) return;
    open = on;
    btn!.setAttribute('aria-expanded', String(on));
    btn!.setAttribute('aria-label', on ? 'Close menu' : 'Open menu');
    nav.classList.toggle('is-open', on);
    sync();
    lock(on);
    behind.forEach((el) => { el.inert = on; });
    gsap.killTweensOf(menu);
    if (on) {
      // Each time it opens on the group of the page you are on.
      setGroup(homeGroup);
      menu!.hidden = false;
      menu!.querySelector<HTMLElement>('[data-menu-scroll]')?.scrollTo(0, 0);
      const h = menu!.offsetHeight;
      const navH = nav.offsetHeight;
      // Reduced motion: a fade only. Otherwise the pill opens downwards into the sheet.
      gsap.set(menu, { visibility: 'visible' });
      if (reduce) gsap.fromTo(menu, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: 'none' });
      else gsap.fromTo(menu, { opacity: 1, clipPath: `inset(0px 0px ${h - navH}px 0px round 27px)` }, { clipPath: 'inset(0px 0px 0px 0px round 27px)', duration: 0.6, ease: 'expo.inOut', clearProps: 'clipPath' });
      if (focus && kb) menu!.querySelector<HTMLElement>('a[href]')?.focus({ preventScroll: true });
    } else {
      gsap.to(menu, { autoAlpha: 0, duration: reduce ? 0.12 : 0.25, ease: reduce ? 'none' : 'power2.in', onComplete: () => { if (!open) menu!.hidden = true; } });
      if (focus && kb) btn!.focus({ preventScroll: true });
    }
  }

  btn.addEventListener('click', () => setOpen(!open));
  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false, false)));
  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') { kb = true; setOpen(false); return; }
    if (e.key !== 'Tab') return;
    // Focus stays in the sheet: the close button, then every control that is showing.
    const f = [btn, ...Array.from(menu.querySelectorAll<HTMLElement>('a[href], button'))].filter((el) => el === btn || el.getClientRects().length > 0);
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
  });
  matchMedia('(min-width: 1081px)').addEventListener('change', (m) => { if (m.matches) setOpen(false, false); });
}
