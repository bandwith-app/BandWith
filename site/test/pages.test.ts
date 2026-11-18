import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { CHANNELS } from '../src/content/features';
import { PAGES } from '../src/content/pages';
import { DEMOS } from '../src/content/demos/index';
import { pageMain, pageHead } from '../src/content/pageRender';
import { BY_ID } from '../../academy/content';
import { SHOT_FILES } from '../../academy/content/shotFiles';

const SITE = path.resolve(__dirname, '..');
const phone = (id: string) => (SHOT_FILES[id] ?? []).includes('phone');
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
        for (const i of [...p.hero.chips.map((x) => x.icon), ...p.details.items.map((x) => x.icon)]) {
          expect(SPRITE, i).toContain(`id="i-${i}"`);
        }
      });

      it('has the walkthrough, roles and details the template expects', () => {
        expect(p.flow.steps.length).toBeGreaterThanOrEqual(3);
        expect(p.flow.steps.length).toBeLessThanOrEqual(4);
        expect(p.roles.rows.length).toBeGreaterThanOrEqual(4);
        expect(p.details.items).toHaveLength(6);
        if (p.demo) expect(DEMOS[p.demo.kind]?.() ?? '', `demo ${p.demo.kind}`).not.toBe('');
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
});
