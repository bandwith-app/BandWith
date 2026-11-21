// The page's language first: on /it/ and /es/ it loads the dictionary before anything writes text.
import '../i18n/runtime';
import 'lenis/dist/lenis.css';
import '../styles/base.css';
import '../styles/parts.css';
import '../styles/lang.css';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { clock } from '../motion/clock';
import { dotSvg } from '../ui/dotText';
import { initNav } from '../ui/nav';
import { initFootEq } from '../ui/footEq';
import { renderCapacity } from './capacity';
import { initCrops } from '../ui/crop';
import { initLangSuggest } from '../ui/langSuggest';
import { initConsent } from '../ui/consent';

/**
 * Shared start for every page. `boot()` runs first (plugins, smooth scroll,
 * static decorations); the page wires its own sections; `finish()` adds the
 * shared motion and the nav last, so pinned sections have their final size.
 */

gsap.registerPlugin(ScrollTrigger, SplitText);
gsap.defaults({ ease: 'power3.out', duration: 0.9 });

export type Ctx = {
  reduce: boolean;
  fine: boolean;
  lenis: Lenis | null;
  scrollTo: (y: number | HTMLElement) => void;
  /** Pinned, scroll-driven scenes: wide screens with room, motion allowed. */
  canPin: () => boolean;
};

const PATTERNS: Record<string, number[]> = {
  gig: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  rehearsal: [0, 2, 4, 6, 8],
  quote: [0, 1, 2, 3, 5, 6, 7, 8],
  personal: [4],
};

export function boot(): Ctx {
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer: fine)').matches;
  (window as unknown as { __bwReady: boolean }).__bwReady = true;
  if (reduce) root.classList.remove('has-motion');

  document.querySelectorAll<HTMLElement>('.emark').forEach((el) => {
    const lit = new Set(PATTERNS[el.dataset.kind ?? 'gig']);
    el.innerHTML = Array.from({ length: 9 }, (_, i) => `<i class="${lit.has(i) ? 'on' : ''}"></i>`).join('');
  });
  document.querySelectorAll<HTMLElement>('[data-dot]').forEach((el) => {
    el.innerHTML = dotSvg(el.dataset.dot ?? '', 0.14);
  });

  // Lenis only where it helps: a mouse wheel on a desktop. Touch keeps native scrolling.
  let lenis: Lenis | null = null;
  if (!reduce && fine) {
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis!.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  if (!reduce) gsap.ticker.add(() => clock.tick());

  const nav = document.querySelector<HTMLElement>('[data-nav]');
  const offsetFor = (target: HTMLElement) => {
    // Sections with generous top padding need no offset; tight ones do.
    const clear = (nav?.getBoundingClientRect().bottom ?? 72) + 24;
    const pad = parseFloat(getComputedStyle(target).paddingTop) || 0;
    return Math.min(0, pad - clear);
  };
  const scrollTo = (to: number | HTMLElement) => {
    const y = typeof to === 'number' ? to : to.getBoundingClientRect().top + window.scrollY + offsetFor(to);
    if (lenis) lenis.scrollTo(y, { duration: 1.3 });
    else window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
  };

  // In-page links (also /#id links when already on that page) land below the floating nav.
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href*="#"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const url = new URL(a.href, location.href);
    if (url.pathname !== location.pathname || !url.hash) return;
    const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (!target) return;
    e.preventDefault();
    scrollTo(target);
    history.replaceState(null, '', url.hash);
    const focusable = target.matches('[tabindex], a, button, input') ? target : target.querySelector<HTMLElement>('h1, h2, [tabindex]');
    if (focusable) {
      if (!focusable.hasAttribute('tabindex') && !focusable.matches('a, button, input')) focusable.setAttribute('tabindex', '-1');
      window.setTimeout(() => focusable.focus({ preventScroll: true }), lenis ? 1300 : 0);
    }
  });

  // Arriving with a hash from another page: correct for the nav once layout settles.
  if (location.hash) {
    const t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (t) window.addEventListener('load', () => window.setTimeout(() => {
      const y = t.getBoundingClientRect().top + window.scrollY + offsetFor(t);
      if (lenis) lenis.scrollTo(y, { immediate: true }); else window.scrollTo({ top: y });
    }, 60));
  }

  const canPin = () => !reduce && window.innerWidth >= 1081 && window.innerHeight >= 640;
  return { reduce, fine, lenis, scrollTo, canPin };
}

export function finish(ctx: Ctx) {
  initCrops();
  const { reduce, fine, lenis } = ctx;

  if (!reduce) {
    // Headings: masked line reveal (SplitText keeps an accessible label).
    document.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => {
      gsap.set(el, { autoAlpha: 1 });
      SplitText.create(el, {
        type: 'lines', mask: 'lines', autoSplit: true,
        onSplit: (self) => gsap.fromTo(self.lines, { yPercent: 110 }, {
          yPercent: 0, duration: 1.1, ease: 'expo.out', stagger: 0.1,
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        }),
      });
    });

    document.querySelectorAll<HTMLElement>('[data-reveal-group]').forEach((g) => {
      gsap.fromTo(g.querySelectorAll('[data-reveal-item]'), { autoAlpha: 0, y: 28 }, {
        autoAlpha: 1, y: 0, duration: 0.9, ease: 'power4.out', stagger: 0.07,
        scrollTrigger: { trigger: g, start: 'top 85%', once: true },
      });
    });

    const litDots = document.querySelectorAll('[data-foot-word] circle:not([opacity])');
    if (litDots.length) {
      gsap.fromTo(litDots, { opacity: 0.14, scale: 0.6, transformOrigin: '50% 50%' }, {
        opacity: 1, scale: 1, duration: 0.5, ease: 'power3.out', stagger: { each: 0.006 },
        scrollTrigger: { trigger: '[data-foot-word]', start: 'top 92%', once: true },
      });
    }

    if (fine) {
      document.querySelectorAll<HTMLElement>('[data-magnetic]').forEach((el) => {
        const xTo = gsap.quickTo(el, 'x', { duration: 0.45 });
        const yTo = gsap.quickTo(el, 'y', { duration: 0.45 });
        el.addEventListener('pointermove', (e) => {
          const r = el.getBoundingClientRect();
          xTo((e.clientX - r.left - r.width / 2) * 0.2);
          yTo((e.clientY - r.top - r.height / 2) * 0.3);
        });
        el.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
      });
    }
  }

  initFootEq(document.querySelector<HTMLElement>('[data-foot-word]'), reduce);

  const nav = document.querySelector<HTMLElement>('[data-nav]');
  if (nav) initNav({ nav, reduce, time: () => clock.time(), lock: (on) => { if (on) lenis?.stop(); else lenis?.start(); } });

  void renderCapacity().then(() => ScrollTrigger.refresh());
  // One question at a time: the language first, then analytics cookies.
  initConsent(initLangSuggest());
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}
