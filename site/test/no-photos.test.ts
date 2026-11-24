/**
 * The site has no photos (2026-11): what gives a page its rhythm is the
 * brand's own mark and three flat fields, ink, paper and lime.
 * - No page points at a photo, the files and the credit are gone.
 * - A channel hero is built on the mark's grid: the page's screen in the tall
 *   cell, its chips in four cells (the first one lime), the empty cell empty.
 * - "One gig" on Home: seven scenes on flat fields, their seven times in cells.
 * In a browser: e2e/site/no-photos.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { PAGES as FILES, englishPage } from '../tools/pages';
import { CHANNELS } from '../src/content/features';
import { PAGES } from '../src/content/pages';
import { pageMain, pageHead } from '../src/content/pageRender';

const SITE = path.resolve(__dirname, '..');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = path.join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

describe('no photos anywhere', () => {
  it('has no photo files and no folder for them', () => {
    expect(existsSync(path.join(SITE, 'public/photos'))).toBe(false);
  });

  it('no page loads a photo, as an image, a preload or a background', () => {
    for (const rel of Object.values(FILES)) {
      const html = englishPage(rel);
      expect(html, rel).not.toMatch(/\/photos\//);
      const doc = new JSDOM(html).window.document;
      // Every image is the product (an Academy capture), the brand, or an install guide's poster.
      const srcs = [...doc.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '');
      expect(srcs.filter((s) => !/^\/(shots|brand|videos|icons)\//.test(s)), rel).toEqual([]);
    }
  });

  it('no style or script still knows about photos', () => {
    const files = [...walk(path.join(SITE, 'src')), ...walk(path.join(SITE, 'partials'))].filter((f) => /\.(css|ts|html)$/.test(f));
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, path.relative(SITE, f)).not.toMatch(/\/photos\/|\.photo\b|class="photo|fhero__photo|nt--photo|photo--noise/);
    }
  });

  it('the footer credits no photographer', () => {
    const foot = readFileSync(path.join(SITE, 'partials/foot.html'), 'utf8');
    expect(foot).not.toMatch(/Unsplash|foot__credit|Photos on/);
    for (const lang of ['it', 'es']) expect(readFileSync(path.join(SITE, `src/i18n/dict/${lang}.json`), 'utf8')).not.toMatch(/Unsplash/);
  });
});

describe('a channel hero is built on the mark', () => {
  for (const c of CHANNELS) {
    it(`${c.slug}: the screen in the tall cell, the chips in four cells, one of them lime, the empty cell empty`, () => {
      const p = PAGES[c.slug];
      const doc = new JSDOM(`<main>${pageMain(c.slug)}</main>`).window.document;
      const hero = doc.querySelector('section.fhero')!;
      const mark = hero.querySelector('.mk.fhero__mark')!;
      expect(mark).not.toBeNull();
      // Six square cells around the tall one: the mark's seven shapes. Column 2, row 1 is nobody's.
      const cells = [...mark.querySelectorAll<HTMLElement>('.mk__c')];
      const at = cells.map((el) => el.getAttribute('style')!.replace('grid-area: ', '').replace(/\s/g, ''));
      expect(at.sort()).toEqual(['1/1', '1/3', '2/1', '2/3', '3/1', '3/3']);
      expect(mark.querySelectorAll('.mk__tall')).toHaveLength(1);
      // One lime cell, top right, with the page's first chip.
      const lime = cells.filter((el) => el.classList.contains('mk__c--lime'));
      expect(lime).toHaveLength(1);
      expect(lime[0].getAttribute('style')).toContain('1 / 3');
      expect(lime[0].textContent).toBe(p.hero.chips[0].label);
      // Every chip is in a cell, and the cells are for the eye: the list is what a screen reader gets.
      expect(cells.map((el) => el.textContent).filter(Boolean)).toEqual(p.hero.chips.slice(0, 4).map((x) => x.label));
      expect(mark.querySelector('.mk__cells')!.getAttribute('aria-hidden')).toBe('true');
      expect([...hero.querySelectorAll('ul.fhero__chips li')].map((li) => li.textContent)).toEqual(p.hero.chips.map((x) => x.label));
      // The page's own screen, whole, in the tall cell: the image a visitor waits for.
      const img = mark.querySelector<HTMLImageElement>('.mk__tall img.crop__img')!;
      expect(img.getAttribute('src')).toBe(`/shots/${p.hero.shot}@phone.webp`);
      expect(img.getAttribute('alt')).toBe(p.hero.alt);
      expect(img.getAttribute('fetchpriority')).toBe('high');
      expect(pageHead(c.slug)).toContain(`<link rel="preload" as="image" href="/shots/${p.hero.shot}@phone.webp"`);
      expect(hero.querySelectorAll('img')).toHaveLength(1);
    });

    it(`${c.slug}: ink, a lime band for "Try it", paper for the demo, then the mark again by the next channel`, () => {
      const doc = new JSDOM(`<main>${pageMain(c.slug)}</main>`).window.document;
      const tone = (s: Element) => (s.classList.contains('band') ? 'lime' : s.classList.contains('sec--bone') ? 'paper' : 'ink');
      const tones = [...doc.querySelectorAll('main > section')].map(tone);
      expect(tones.slice(0, 5)).toEqual(['ink', 'ink', 'lime', 'paper', 'ink']);
      expect(tones[tones.length - 1]).toBe('ink');
      // The band names the demo; the demo keeps the anchor the tests and the text exports know.
      const band = doc.querySelector('section.band')!;
      expect(band.id).toBe('try-it');
      expect(doc.querySelector('.fhero__cta a.btn--lime')!.getAttribute('href')).toBe('#try-it');
      expect(band.nextElementSibling!.id).toBe('try');
      expect(band.querySelector('.mk--sign .mk__spot')!.getAttribute('style')).toContain('1 / 2'); // the empty cell points at the demo
      const next = doc.querySelector('section.nextch .mk--sign')!;
      expect(next.querySelector('.mk__spot--lime')!.getAttribute('style')).toContain('3 / 3');
      expect(next.getAttribute('aria-hidden')).toBe('true');
    });
  }
});

describe('one gig, on three flat fields', () => {
  const doc = new JSDOM(englishPage('index.html')).window.document;
  const night = doc.querySelector('#night')!;
  const scenes = [...night.querySelectorAll('[data-night-scene]')];

  it('seven scenes: ink for the day, paper for load-in and pay, lime for the show', () => {
    const tone = (s: Element) => (s.classList.contains('nt--lime') ? 'lime' : s.classList.contains('nt--paper') ? 'paper' : 'ink');
    expect(scenes.map((s) => `${s.getAttribute('data-time')} ${tone(s)}`)).toEqual([
      '11:30 ink', '14:02 ink', '16:40 ink', '17:00 paper', '21:00 lime', '22:10 ink', '23:45 paper',
    ]);
    for (const s of scenes) {
      expect(s.querySelector('.photo, img[src*="photos"]')).toBeNull();
      // Each scene says its own time in a cell, so it reads without the head (stacked, reduced motion).
      expect(s.querySelector('.nt__time .cell')!.textContent).toBe(s.getAttribute('data-time'));
    }
  });

  it('seven time cells in the head instead of the clock and the progress line', () => {
    expect([...night.querySelectorAll('.night__cells [data-night-cell]')].map((c) => c.textContent)).toEqual(scenes.map((s) => s.getAttribute('data-time')));
    expect(night.querySelector('.night__cells')!.getAttribute('aria-hidden')).toBe('true');
    expect(night.querySelector('[data-night-clock], .night__clock, [data-night-bar], .night__bar')).toBeNull();
  });

  it('the chat section sits on flat ink', () => {
    expect(doc.querySelector('#noise .photo, #noise > img')).toBeNull();
  });
});
