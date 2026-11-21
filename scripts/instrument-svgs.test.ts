import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { renderToStaticMarkup } from 'react-dom/server';
import { INSTRUMENT_ICONS } from '../src/app/components/icons/brand-icons';

/**
 * The static instrument SVGs (the app's public/icons, and the site's
 * public/icons for its pages and share cards) are the app's Dot Icons, drawn
 * from the same source. After an icon changes, rewrite them with
 * `UPDATE_ICONS=1 pnpm vitest run scripts/instrument-svgs.test.ts`.
 */
const ROOT = path.resolve(__dirname, '..');
const DIRS = ['public/icons', 'site/public/icons'];

const svgFor = (Icon: (typeof INSTRUMENT_ICONS)[keyof typeof INSTRUMENT_ICONS]) =>
  `${renderToStaticMarkup(createElement(Icon))
    .replace(/ aria-hidden="true"/, '')
    .replace(/ class=""/, '')}\n`;

describe('static instrument SVGs', () => {
  for (const dir of DIRS) {
    for (const [key, Icon] of Object.entries(INSTRUMENT_ICONS)) {
      it(`${dir}/instrument-${key}.svg matches the app icon`, () => {
        const file = path.join(ROOT, dir, `instrument-${key}.svg`);
        const want = svgFor(Icon);
        if (process.env.UPDATE_ICONS) writeFileSync(file, want);
        expect(existsSync(file), file).toBe(true);
        expect(readFileSync(file, 'utf8')).toBe(want);
      });
    }
  }
});
