import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import path from 'path';
import { CHANNELS, GROUPS } from '../src/content/features';
import { PUSHES } from '../src/ui/heroScreen';
import { BY_ID } from '../../academy/content';
import { GENERATED } from '../src/content/render';

const SHOTS = path.resolve(__dirname, '../../academy/public/shots');

describe('site content', () => {
  it('has eleven channels numbered 1–11 with unique slugs', () => {
    expect(CHANNELS.map((c) => c.ch)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(new Set(CHANNELS.map((c) => c.slug)).size).toBe(11);
  });

  it('links only Academy articles that exist', () => {
    for (const c of CHANNELS) for (const id of c.academy) expect(BY_ID.has(id), `${c.slug} → ${id}`).toBe(true);
  });

  it('uses Academy captures that exist on every device', () => {
    for (const c of CHANNELS) expect(existsSync(path.join(SHOTS, `${c.shot}@phone.webp`)), c.shot).toBe(true);
    for (const id of ['calendar-month', 'music-stage'])
      for (const d of ['phone', 'tablet', 'web', 'duoClosed', 'duoBook', 'duoLaptop'])
        expect(existsSync(path.join(SHOTS, `${id}@${d}.webp`)), `${id}@${d}`).toBe(true);
  });

  it('links only pages that are built, in the menu and in the features panel', () => {
    for (const key of ['menu-rows', 'feature-panel']) {
      const html = GENERATED[key]();
      for (const c of CHANNELS) expect(html.includes(`href="/features/${c.slug}/"`), `${key} ${c.slug}`).toBe(c.live);
    }
  });

  it('puts every channel in exactly one menu group, with a crop inside its capture', () => {
    for (const c of CHANNELS) {
      expect(GROUPS).toContain(c.group);
      const [y0, y1] = c.crop;
      expect(y0 >= 0 && y1 <= 1 && y1 - y0 > 0.1, c.slug).toBe(true);
    }
    const panel = GENERATED['feature-panel']();
    expect(panel.match(/data-fp /g)?.length).toBe(11);
  });

  it('only zooms into hero captures that exist', () => {
    for (const p of PUSHES) {
      expect(existsSync(path.join(SHOTS, `${p.shot}@phone.webp`)), p.shot).toBe(true);
      expect(p.region.y0 >= 0 && p.region.y1 <= 1 && p.region.y1 > p.region.y0, p.title).toBe(true);
    }
  });
});
