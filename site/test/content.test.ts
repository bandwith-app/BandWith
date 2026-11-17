import { describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import path from 'path';
import { CHANNELS } from '../src/content/features';
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

  it('links only pages that are built', () => {
    const html = GENERATED['menu-rows']();
    for (const c of CHANNELS) expect(html.includes(`href="/features/${c.slug}/"`)).toBe(c.live);
  });
});
