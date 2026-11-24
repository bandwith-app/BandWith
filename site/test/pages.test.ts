import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { CHANNELS } from '../src/content/features';
import { PAGES } from '../src/content/pages';
import { DEMOS } from '../src/content/demos/index';
import { pageMain, pageHead, WORDS } from '../src/content/pageRender';
import { FRAGMENTS } from '../src/content/fragments';
import { SHOT_SIZE } from '../src/content/site';
import { JSDOM } from 'jsdom';
import { BY_ID } from '../../academy/content';
import { SHOT_FILES } from '../../academy/content/shotFiles';

const SITE = path.resolve(__dirname, '..');
const phone = (id: string) => (SHOT_FILES[id] ?? []).includes('phone');
const SHOTS = path.resolve(SITE, '../academy/public/shots');
const SPRITE = readFileSync(path.join(SITE, 'partials/sprite.html'), 'utf8');

describe('channel pages', () => {
  it('has a content file and an HTML page for every channel, and every channel is live', () => {
    for (const c of CHANNELS) {
      expect(PAGES[c.slug], c.slug).toBeDefined();
      expect(existsSync(path.join(SITE, 'features', c.slug, 'index.html')), c.slug).toBe(true);
      expect(c.live, c.slug).toBe(true);
    }
  });

  for (const c of CHANNELS) {
    const p = PAGES[c.slug];
    if (!p) continue;
    describe(c.slug, () => {
      it('uses phone captures that exist, with sane regions', () => {
        const regions = [{ shot: p.hero.shot, region: p.hero.region }, ...p.flow.steps];
        for (const s of regions) {
          expect(phone(s.shot), `${s.shot}@phone`).toBe(true);
          const [a, b] = s.region;
          expect(a >= 0 && b <= 1 && b - a >= 0.12, `${s.shot} ${a}–${b}`).toBe(true);
        }
      });

      it('links Academy articles that exist and icons that are in the sprite', () => {
        for (const l of p.learn) expect(BY_ID.has(l.id), l.id).toBe(true);
        for (const i of p.hero.chips.map((x) => x.icon)) {
          expect(SPRITE, i).toContain(`id="i-${i}"`);
        }
      });

      it('has the walkthrough and roles the template expects', () => {
        expect(p.flow.steps.length).toBeGreaterThanOrEqual(3);
        expect(p.flow.steps.length).toBeLessThanOrEqual(4);
        expect(p.roles.rows.length).toBeGreaterThanOrEqual(4);
        // "Learn it" counts its articles in words, two columns: an even number, ten at most.
        expect(p.learn.length % 2, 'learn list fills its two columns').toBe(0);
        expect(p.learn.length).toBeLessThanOrEqual(10);
        expect(new Set(p.learn.map((l) => l.id)).size, 'no article twice').toBe(p.learn.length);
        if (p.demo) expect(DEMOS[p.demo.kind]?.() ?? '', `demo ${p.demo.kind}`).not.toBe('');
      });

      // "The small things": three up, then the spec sheet (no bento).
      it('features three capabilities, each with the product: a capture that exists or a drawn fragment', () => {
        const d = p.details;
        expect(d.featured).toHaveLength(3);
        for (const f of d.featured) {
          expect(f.title.length, f.title).toBeGreaterThan(3);
          expect(f.tag.length, `tag of ${f.title}`).toBeGreaterThan(1);
          expect(f.tag.length, `tag of ${f.title}`).toBeLessThanOrEqual(28);
          expect(f.body.length, `${f.title}: ${f.body.length} characters`).toBeLessThanOrEqual(160);
          if ('fragment' in f.ui) {
            const frag = FRAGMENTS[f.ui.fragment];
            expect(frag, f.ui.fragment).toBeDefined();
            expect(frag.alt.length).toBeGreaterThan(20);
            expect(frag.html).toContain('class="frag');
            continue;
          }
          const device = f.ui.device ?? 'phone';
          expect(existsSync(path.join(SHOTS, `${f.ui.shot}@${device}.webp`)), `${f.ui.shot}@${device}`).toBe(true);
          expect((SHOT_FILES[f.ui.shot] ?? []).includes(device), `${f.ui.shot}@${device} in the Academy's list`).toBe(true);
          expect(SHOT_SIZE[device]).toBeDefined();
          const [y0, y1, x0 = 0, x1 = 1] = f.ui.region;
          expect(y0 >= 0 && y1 <= 1 && y1 - y0 >= 0.12, `${f.ui.shot} ${y0}–${y1}`).toBe(true);
          expect(x0 >= 0 && x1 <= 1 && x1 - x0 >= 0.3, `${f.ui.shot} x ${x0}–${x1}`).toBe(true);
          expect(f.ui.alt.length, `alt of ${f.title}`).toBeGreaterThan(20);
        }
      });

      it('lists the rest one line each, under two to four labels, every row of two full', () => {
        const d = p.details;
        expect(d.groups.length).toBeGreaterThanOrEqual(2);
        expect(d.groups.length).toBeLessThanOrEqual(4);
        for (const g of d.groups) {
          expect(g.label.length, g.label).toBeLessThanOrEqual(28);
          expect(g.items.length, g.label).toBeGreaterThanOrEqual(2);
          expect(g.items.length % 2, `${g.label}: two columns, no hole`).toBe(0);
          for (const x of g.items) {
            expect(x.line.length, `${x.title}: ${x.line.length} characters`).toBeLessThanOrEqual(120);
            expect(x.line.length, x.title).toBeGreaterThan(30);
          }
        }
        const titles = [...d.featured, ...d.groups.flatMap((g) => g.items)].map((x) => x.title);
        expect(new Set(titles).size, 'no capability twice').toBe(titles.length);
        // The lead says how many are left, in words.
        const rest = d.groups.reduce((n, g) => n + g.items.length, 0);
        expect(d.lead).toContain(`The other ${WORDS[rest].toLowerCase()} are sorted`);
      });

      it('renders them as three numbered panels and a spec sheet with headings in order', () => {
        const doc = new JSDOM(`<main>${pageMain(c.slug)}</main>`).window.document;
        const sec = doc.querySelector('section.details')!;
        expect(doc.querySelector('.bento, .bento__c'), 'no bento left').toBeNull();
        const feats = [...sec.querySelectorAll('ol.feats > li.feat')];
        expect(feats.map((f) => f.querySelector('.feat__no')?.textContent)).toEqual(['01', '02', '03']);
        for (const f of feats) {
          const ui = f.querySelector('.feat__ui')!;
          const img = ui.querySelector('img.crop__img');
          // The product is there for everyone: a capture with its alt, or a fragment named as an image.
          if (img) expect(img.getAttribute('alt')?.length ?? 0).toBeGreaterThan(20);
          else expect(ui.getAttribute('role') === 'img' && (ui.getAttribute('aria-label')?.length ?? 0) > 20).toBe(true);
          expect(f.querySelector('h3.feat__t')?.textContent).toBeTruthy();
        }
        const items = p.details.groups.flatMap((g) => g.items);
        expect(sec.querySelectorAll('.spec__g h3.spec__l').length).toBe(p.details.groups.length);
        expect([...sec.querySelectorAll('.spec__items > li.spec__i > h4')].map((h) => h.textContent)).toEqual(items.map((x) => x.title));
        expect(sec.querySelector('.spec__head')?.textContent).toContain(`And ${WORDS[items.length].toLowerCase()} more`);
        // h2 (the section) → h3 (panels, labels) → h4 (lines): no level skipped.
        const levels = [...sec.querySelectorAll('h2, h3, h4')].map((h) => Number(h.tagName[1]));
        expect(levels[0]).toBe(2);
        levels.forEach((l, i) => { if (i) expect(l - levels[i - 1], `heading ${i}`).toBeLessThanOrEqual(1); });
      });

      it('renders a page with one h1 and no leftovers', () => {
        const html = pageMain(c.slug);
        expect(html.match(/<h1/g)).toHaveLength(1);
        expect(html).not.toMatch(/undefined|\[object Object\]/);
        // Devices are shown once, on the home page: no device switcher here.
        expect(html).not.toMatch(/data-devices(?!-demo)/);
        expect(pageHead(c.slug)).toContain(`<title>${p.title.replace(/&/g, '&amp;')} · BandWith</title>`);
      });

      it('keeps the calm voice: no exclamation marks', () => {
        const text = JSON.stringify(p);
        expect(text).not.toMatch(/!/);
      });
    });
  }

  // The approved mockup (2026-11-23, "Three up, then the spec sheet") is the Stage page.
  it('stage: the three panels and the three labels of the approved design', () => {
    const d = PAGES.stage.details;
    expect(d.featured.map((f) => f.title)).toEqual(['Follow the tempo', 'Ready before the gig', 'The stage manager plays the songs']);
    expect(d.featured.map((f) => ('fragment' in f.ui ? f.ui.fragment : ''))).toEqual(['stage-tempo', 'stage-offline', 'stage-manager']);
    expect(d.groups.map((g) => [g.label, g.items.length])).toEqual([['Keeping time', 2], ['On your own screen', 4], ['Running the set', 4]]);
  });

  it('draws fragments with the app’s own labels, and every fragment is used', () => {
    const used = new Set(Object.values(PAGES).flatMap((p) => p.details.featured).flatMap((f) => ('fragment' in f.ui ? [f.ui.fragment] : [])));
    expect([...used].sort()).toEqual(Object.keys(FRAGMENTS).sort());
    const text = (k: string) => FRAGMENTS[k].html.replace(/<[^>]+>/g, ' ');
    // src/lib/i18n (English source): "Next: {section} in {n} bars", "Offline: {n} of {m} members ready", "Audio ready {ready}/{total}".
    expect(text('stage-tempo')).toMatch(/Next: Chorus in 2 bars/);
    expect(text('stage-offline')).toMatch(/Offline: 4 of 5 members ready/);
    expect(text('stage-offline')).toMatch(/Who has the setlist on their phone for no signal\./);
    expect(text('stage-manager')).toMatch(/Audio ready 10\/10/);
    expect(text('stage-manager')).toMatch(/Now playing/);
    expect(text('rider-brings')).toMatch(/BAND BRINGS[\s\S]*VENUE PROVIDES[\s\S]*The venue agreed to this/);
  });
});
