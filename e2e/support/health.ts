import { expect, type Page } from '@playwright/test';
import { allTranslations } from './i18n';

/**
 * Page health: what the manual device testers checked on every screen
 * (scratchpad chk.js), as one assertion.
 *
 * - nothing wider than the viewport (no horizontal page scroll, no visible
 *   control or heading pushed past the left/right edge unless a scroller
 *   clips it);
 * - no "undefined", "NaN", "[object Object]" or "Something went wrong"
 *   (in any of the six languages) in the visible text;
 * - no raw i18n keys (dotted.lower.case.keys);
 * - no uncaught JS errors or unhandled rejections since the page loaded;
 * - Duo Laptop pose: no interactive control on top intersects the fold band.
 */

export interface HealthReport {
  viewport: { w: number; h: number };
  docOverflow: number;
  offscreen: string[];
  badText: string | null;
  rawKeys: string[];
  errors: string[];
  onFold: string[];
}

const BAD_WORDS = [
  'undefined',
  'NaN',
  '[object Object]',
  ...allTranslations('Something went wrong'),
];

export interface HealthOptions {
  foldBand?: { top: number; bottom: number } | null;
  /** Extra JS error substrings to tolerate (keep this empty if you can). */
  ignoreErrors?: string[];
}

export async function readHealth(page: Page, opts: HealthOptions = {}): Promise<HealthReport> {
  return page.evaluate(
    ({ badWords, fold }) => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const visible = (e: Element) => {
        const s = getComputedStyle(e);
        if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const label = (e: Element) =>
        ((e.getAttribute('aria-label') || (e as HTMLElement).innerText || e.tagName) as string)
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40);

      // Controls and headings past the left/right edge, unless a scroller
      // (or a clipping box) that is itself on screen holds them.
      const offscreen: string[] = [];
      document.querySelectorAll('button,a,input,textarea,select,[role=button],h1,h2,h3,p').forEach((e) => {
        if (!visible(e)) return;
        const r = e.getBoundingClientRect();
        if (r.bottom < 0 || r.top > H) return;
        if (r.right <= W + 2 && r.left >= -2) return;
        let p = e.parentElement;
        while (p && p !== document.body) {
          const s = getComputedStyle(p);
          if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) {
            const pr = p.getBoundingClientRect();
            if (pr.right <= W + 2 && pr.left >= -2) return;
          }
          p = p.parentElement;
        }
        offscreen.push(`${label(e)} @${Math.round(r.left)}..${Math.round(r.right)}`);
      });

      const text = document.body.innerText || '';
      let badText: string | null = null;
      for (const w of badWords) {
        const re = new RegExp(`(^|[^A-Za-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`);
        const m = re.exec(text);
        if (m) {
          badText = `"${w}" in …${text.slice(Math.max(0, m.index - 50), m.index + 50).replace(/\s+/g, ' ')}…`;
          break;
        }
      }

      // dotted.lower.keys that look like untranslated i18n ids (not e-mails,
      // URLs or file names).
      const rawKeys = (text.match(/(^|[\s(])[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+){2,}(?=$|[\s),.:;])/g) || [])
        .map((k) => k.trim().replace(/^\(/, ''))
        .filter((k) => !/@|\/|\.(com|app|it|dev|example|png|jpe?g|pdf|ics|html?)$/i.test(k))
        .slice(0, 5);

      const onFold: string[] = [];
      if (fold) {
        document
          .querySelectorAll('button,[role=button],a[href],input,textarea,select,[role=tab],[role=checkbox],[role=switch],[role=option]')
          .forEach((e) => {
            if (!visible(e)) return;
            const r = e.getBoundingClientRect();
            if (r.bottom <= fold.top || r.top >= fold.bottom) return;
            if (r.right <= 0 || r.left >= W) return;
            // Only what the user can actually touch: on top somewhere in the band.
            const y = Math.min(Math.max((Math.max(r.top, fold.top) + Math.min(r.bottom, fold.bottom)) / 2, 0), H - 1);
            const xs = [r.left + r.width / 2, r.left + 4, r.right - 4].map((x) => Math.min(Math.max(x, 0), W - 1));
            const onTop = xs.some((x) => {
              const t = document.elementFromPoint(x, y);
              return !!t && (t === e || e.contains(t));
            });
            if (onTop) onFold.push(`${label(e)} @y${Math.round(r.top)}..${Math.round(r.bottom)}`);
          });
      }

      const errors = ((window as unknown as { __e2eErrors?: string[] }).__e2eErrors || []).slice(-10);
      return {
        viewport: { w: W, h: H },
        docOverflow: document.documentElement.scrollWidth > W + 1 ? document.documentElement.scrollWidth : 0,
        offscreen: offscreen.slice(0, 8),
        badText,
        rawKeys,
        errors,
        onFold: onFold.slice(0, 8),
      };
    },
    { badWords: BAD_WORDS, fold: opts.foldBand ?? null },
  );
}

/** Asserts page health; `where` names the screen in the failure message. */
export async function expectHealthy(page: Page, where: string, opts: HealthOptions = {}) {
  // Let entering layers finish their transition before measuring.
  await page.waitForTimeout(0);
  const h = await readHealth(page, opts);
  const errors = h.errors.filter((e) => !(opts.ignoreErrors ?? []).some((i) => e.includes(i)));
  const problems: string[] = [];
  if (h.docOverflow) problems.push(`page is ${h.docOverflow}px wide on a ${h.viewport.w}px screen`);
  if (h.offscreen.length) problems.push(`off screen: ${h.offscreen.join(' | ')}`);
  if (h.badText) problems.push(`bad text: ${h.badText}`);
  if (h.rawKeys.length) problems.push(`raw i18n keys: ${h.rawKeys.join(', ')}`);
  if (errors.length) problems.push(`JS errors: ${errors.join(' | ')}`);
  if (h.onFold.length) problems.push(`controls on the fold: ${h.onFold.join(' | ')}`);
  expect(problems, `page health on "${where}" (${h.viewport.w}×${h.viewport.h})`).toEqual([]);
}
