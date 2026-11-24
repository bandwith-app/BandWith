/**
 * The Academy's screenshots (academy/public/shots/<id>@<device>.webp) and the
 * frames they are drawn in: a capture must never be stretched, squashed or
 * make the page jump while it loads.
 *
 * - every capture has the shape of its device (a phone shot is a phone
 *   screen, not a narrow desktop window) and enough pixels for its frame;
 * - the index (content/shotFiles.ts) lists every file with its real size;
 * - every screenshot an article or the handbook shows exists, on the device
 *   it asks for;
 * - the guide in the app and the static pages give each <img> (and each
 *   <source> of a <picture>) the width and height of its file;
 * - the stylesheet keeps the natural ratio: with those two attributes an
 *   image that is only told its width keeps the attribute's height, which is
 *   how every screenshot on the static pages came out stretched.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SOURCE } from '../content/source';
import * as index from '../content/shotFiles';
import type { Block, ShotDevice } from '../content/types';
import { Blocks } from '../src/blocks';
import { buildSite } from './build';

const ROOT = path.resolve(__dirname, '..');
const SHOTS_DIR = path.join(ROOT, 'public/shots');
const HANDBOOK = path.resolve(ROOT, '../docs/handbook');

/** Width and height from a WebP header (VP8, VP8L, VP8X), read here on purpose: the test doesn't trust the index's own reader. */
function webpSize(file: string): { w: number; h: number } {
  const fd = openSync(file, 'r');
  const b = Buffer.alloc(30);
  readSync(fd, b, 0, 30, 0);
  closeSync(fd);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') throw new Error(`not a WebP: ${file}`);
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') return { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
  if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  throw new Error(`unknown WebP chunk ${chunk}: ${file}`);
}

/**
 * The screen each device is captured at (width ÷ height, in points) and the
 * fewest pixels its file may be wide: twice the widest frame it is drawn in
 * (styles.css), and three times the phone frames a 3× phone draws.
 */
const DEVICE: Record<ShotDevice, { ratio: number; minWidth: number }> = {
  phone: { ratio: 390 / 844, minWidth: 780 },
  tablet: { ratio: 1180 / 820, minWidth: 1600 },
  web: { ratio: 1440 / 900, minWidth: 1600 },
  duoClosed: { ratio: 466 / 678, minWidth: 780 },
  duoBook: { ratio: 951 / 669, minWidth: 1600 },
  duoLaptop: { ratio: 669 / 951, minWidth: 780 },
};
const RATIO_TOLERANCE = 0.01;

const files = readdirSync(SHOTS_DIR).sort();
const real = new Map(files.map((f) => [f, webpSize(path.join(SHOTS_DIR, f))]));
const SHOT_FILES = index.SHOT_FILES;
/** `<id>@<device>` → [width, height], written by academy/scripts/shot-files.mjs. */
const SHOT_SIZES = (index as { SHOT_SIZES?: Record<string, readonly [number, number]> }).SHOT_SIZES ?? {};

const shotBlocks = SOURCE.flatMap((m) =>
  m.articles.flatMap((a) => a.body.filter((b): b is Extract<Block, { type: 'shot' }> => b.type === 'shot').map((b) => ({ article: a.id, block: b }))),
);

/** Every <img> and <source> of the screenshots in a piece of HTML: file name, declared width and height. */
function declared(html: string): { tag: string; file: string; w: number | null; h: number | null }[] {
  const out = [];
  for (const m of html.matchAll(/<(img|source)\b[^>]*>/g)) {
    const src = /\b(?:src|srcset)="([^"]*shots\/[^"]+\.webp)"/.exec(m[0]);
    if (!src) continue;
    const num = (name: string) => {
      const v = new RegExp(`\\b${name}="(\\d+)"`).exec(m[0]);
      return v ? Number(v[1]) : null;
    };
    out.push({ tag: m[1], file: src[1].split('/').pop()!, w: num('width'), h: num('height') });
  }
  return out;
}

/** The declarations of every rule whose selector list has `selector` (media blocks included). */
function cssRules(css: string, selector: string): string[] {
  const out = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').some((s) => s.trim() === selector)) out.push(m[2]);
  }
  return out;
}

describe('Academy screenshots: the files', () => {
  it('are named <id>@<device>.webp', () => {
    expect(files.filter((f) => !/^[a-z0-9-]+@(phone|tablet|web|duoClosed|duoBook|duoLaptop)\.webp$/.test(f))).toEqual([]);
    expect(files.length).toBeGreaterThan(150);
  });

  it('have the shape of their device and enough pixels for their frame', () => {
    const wrong = files.flatMap((f) => {
      const { w, h } = real.get(f)!;
      const spec = DEVICE[f.replace(/.*@|\.webp/g, '') as ShotDevice];
      const off = Math.abs(w / h / spec.ratio - 1);
      return [
        ...(off > RATIO_TOLERANCE ? [`${f}: ${w}×${h} is ${(w / h).toFixed(3)}, its device is ${spec.ratio.toFixed(3)}`] : []),
        ...(w < spec.minWidth ? [`${f}: ${w} px wide, under ${spec.minWidth}`] : []),
      ];
    });
    expect(wrong).toEqual([]);
  });

  it('are indexed with their real size (run node academy/scripts/shot-files.mjs after a capture)', () => {
    const listed = Object.entries(SHOT_FILES).flatMap(([id, devices]) => devices.map((d) => `${id}@${d}.webp`));
    expect(listed.sort()).toEqual(files);
    const stale = files.flatMap((f) => {
      const { w, h } = real.get(f)!;
      const size = SHOT_SIZES[f.replace(/\.webp$/, '')];
      return size && size[0] === w && size[1] === h ? [] : [`${f}: the file is ${w}×${h}, the index says ${size ? size.join('×') : 'nothing'}`];
    });
    expect(stale).toEqual([]);
  });
});

describe('Academy screenshots: what the guides show', () => {
  it('every screenshot of an article exists, on the device it pins', () => {
    const missing = shotBlocks.flatMap(({ article, block: b }) => {
      const have = SHOT_FILES[b.id] ?? [];
      if (!have.length) return [`${article} → ${b.id}: no capture`];
      if (b.device && !have.includes(b.device)) return [`${article} → ${b.id}@${b.device}: not captured on that device`];
      return have.filter((d) => !real.has(`${b.id}@${d}.webp`)).map((d) => `${article} → ${b.id}@${d}.webp: no file`);
    });
    expect(missing).toEqual([]);
    expect(shotBlocks.length).toBeGreaterThan(40);
  });

  it('every screenshot of the handbook exists on the device it asks for', () => {
    const missing = [];
    let seen = 0;
    for (const lang of ['it', 'en']) {
      for (const f of readdirSync(path.join(HANDBOOK, lang)).filter((n) => n.endsWith('.html'))) {
        const html = readFileSync(path.join(HANDBOOK, lang, f), 'utf8');
        for (const m of html.matchAll(/<figure\b[^>]*\bdata-shot="([^"]+)"[^>]*>/g)) {
          seen++;
          const device = /\bdata-device="([^"]+)"/.exec(m[0])?.[1] ?? 'phone';
          if (!existsSync(path.join(SHOTS_DIR, `${m[1]}@${device}.webp`))) missing.push(`${lang}/${f} → ${m[1]}@${device}`);
        }
      }
    }
    expect(missing).toEqual([]);
    expect(seen).toBeGreaterThan(40);
  });
});

describe('Academy screenshots: how they are drawn', () => {
  it('in the app, every <img> has the width and height of its file', () => {
    const wrong = [];
    for (const { article, block } of shotBlocks) {
      const imgs = declared(renderToStaticMarkup(createElement(Blocks, { blocks: [block] })));
      if (imgs.length !== 1) wrong.push(`${article} → ${block.id}: ${imgs.length} images`);
      for (const i of imgs) {
        const size = real.get(i.file);
        if (!size) wrong.push(`${article} → ${i.file}: no file`);
        else if (i.w !== size.w || i.h !== size.h) wrong.push(`${article} → ${i.file}: declared ${i.w}×${i.h}, the file is ${size.w}×${size.h}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('on the static pages, every <img> and <source> has the width and height of its file', () => {
    const pages = buildSite({ cssHref: '/academy/assets/index-test.css' }).pages.filter((p) => p.path.startsWith('/academy/en/a/'));
    const wrong = [];
    let seen = 0;
    for (const p of pages) {
      for (const i of declared(/<main[\s\S]*<\/main>/.exec(p.html)?.[0] ?? '')) {
        seen++;
        const size = real.get(i.file);
        if (!size) wrong.push(`${p.path} → ${i.file}: no file`);
        else if (i.w !== size.w || i.h !== size.h) wrong.push(`${p.path} → <${i.tag}> ${i.file}: declared ${i.w}×${i.h}, the file is ${size.w}×${size.h}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(seen).toBeGreaterThanOrEqual(shotBlocks.length);
  });

  it('the stylesheet keeps the natural ratio of an image that declares its size', () => {
    const css = readFileSync(path.join(ROOT, 'src/styles.css'), 'utf8');
    const rules = cssRules(css, '.shot__screen img');
    expect(rules.length).toBeGreaterThan(0);
    // width from the frame, height from the file's ratio: never the height attribute, never a fixed one
    expect(rules.join(';')).toMatch(/(^|[;\s])width:\s*100%/);
    expect(rules.join(';')).toMatch(/(^|[;\s])height:\s*auto/);
    for (const r of rules) expect(r).not.toMatch(/(^|[;\s])(height:\s*\d|object-fit:\s*(fill|cover))/);
  });

  it("the phone frame has the phone captures' ratio", () => {
    const css = readFileSync(path.join(ROOT, 'src/styles.css'), 'utf8');
    const frame = /aspect-ratio:\s*(\d+)\s*\/\s*(\d+)/.exec(cssRules(css, '.shot__screen').join(';'));
    expect(frame).not.toBeNull();
    expect(Math.abs(Number(frame![1]) / Number(frame![2]) / DEVICE.phone.ratio - 1)).toBeLessThan(RATIO_TOLERANCE);
  });
});
