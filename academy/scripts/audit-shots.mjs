#!/usr/bin/env node
/**
 * How every Academy screenshot is drawn, measured in a real browser: the check
 * a unit test can't make (academy/seo/shots.test.ts guards the causes).
 *
 *   pnpm build:web                                        # dist/academy with the static pages
 *   python3 -m http.server 4451 --bind 127.0.0.1 -d dist  # in another shell
 *   node academy/scripts/audit-shots.mjs [--base http://127.0.0.1:4451] [--out <folder>]
 *
 * As a phone (390 px, 3×), a tablet (820 px, 2×, touch) and a desktop window
 * (1440 px, 2×), it opens every article on the static pages and in the guide
 * the app shows (each device variant), and lists each screenshot that is
 *   distorted  drawn at another ratio than its file's (over 1%)
 *   upscaled   drawn with more device pixels than the file has (blurry)
 *   cut        taller than its frame (it scrolls inside: fine for a long phone screen, wrong elsewhere)
 *   gap        shorter than its frame
 *   missing    not loaded
 *   undeclared / declared wrong: no width and height, or not the file's (the page jumps)
 * Writes <out>/render-audit.json (one row per drawing) and exits 1 on any finding.
 */
import { chromium } from '@playwright/test';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const BASE = opt('--base', 'http://127.0.0.1:4451');
const OUT = path.resolve(opt('--out', path.join(HERE, '../../docs/handbook/out/shots-audit')));
mkdirSync(OUT, { recursive: true });
const ids = readdirSync(path.join(HERE, '../../dist/academy/en/a'));
const VIEWS = [
  { name: '390', width: 390, height: 844, dpr: 3, touch: true },
  { name: '820', width: 820, height: 1180, dpr: 2, touch: true },
  { name: '1440', width: 1440, height: 900, dpr: 2, touch: false },
];
const DEVICES = ['phone', 'tablet', 'web', 'duoClosed', 'duoBook', 'duoLaptop'];
const measure = () =>
  Promise.all(
    [...document.querySelectorAll('figure.shot img')].map(async (img) => {
      img.loading = 'eager';
      if (!img.complete) await new Promise((r) => { img.onload = img.onerror = r; });
      try { await img.decode(); } catch {}
      const r = img.getBoundingClientRect();
      const screen = img.closest('.shot__screen');
      const s = screen.getBoundingClientRect();
      const frame = img.closest('.shot__frame').getBoundingClientRect();
      const cs = getComputedStyle(img);
      return {
        src: (img.currentSrc || img.getAttribute('src')).split('/').pop(),
        nat: [img.naturalWidth, img.naturalHeight],
        attr: (() => {
          const file = (img.currentSrc || img.getAttribute('src')).split('/').pop();
          const el = [...(img.parentElement.tagName === 'PICTURE' ? img.parentElement.children : [img])].find((e) => (e.getAttribute('srcset') || e.getAttribute('src') || '').endsWith(file)) ?? img;
          return [el.getAttribute('width'), el.getAttribute('height')];
        })(),
        box: [+r.width.toFixed(2), +r.height.toFixed(2)],
        screen: [+s.width.toFixed(2), +s.height.toFixed(2)],
        frame: [+frame.width.toFixed(2), +frame.height.toFixed(2)],
        fit: cs.objectFit,
        scroll: [screen.clientHeight, screen.scrollHeight],
        dpr: devicePixelRatio,
      };
    }),
  );
const browser = await chromium.launch();
const rows = [];
for (const v of VIEWS) {
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.dpr, hasTouch: v.touch, isMobile: v.touch, colorScheme: 'dark' });
  const page = await ctx.newPage();
  // static pages
  for (const id of ids) {
    await page.goto(`${BASE}/academy/en/a/${id}/`, { waitUntil: 'domcontentloaded' });
    for (const m of await page.evaluate(measure)) rows.push({ view: v.name, where: 'static', article: id, device: m.src.replace(/.*@|\.webp/g, ''), ...m });
  }
  // the app's Academy (and /academy/ on the web), each device variant
  for (const dev of DEVICES) {
    await page.goto(`${BASE}/academy/?embed=1&theme=dark&device=${dev}#/a/${ids[0]}`, { waitUntil: 'load' });
    for (const id of ids) {
      await page.evaluate((h) => { location.hash = h; }, `#/a/${id}`);
      await page.waitForFunction((i) => location.hash.endsWith(i) && document.querySelector('.article'), id);
      for (const m of await page.evaluate(measure)) rows.push({ view: v.name, where: 'app', article: id, device: dev, ...m });
    }
  }
  await ctx.close();
}
await browser.close();
// findings
const out = [];
for (const r of rows) {
  const natAR = r.nat[0] / r.nat[1];
  const boxAR = r.box[0] / r.box[1];
  const stretch = Math.abs(boxAR / natAR - 1);
  const f = [];
  if (!r.nat[0]) f.push('missing');
  else {
    if (stretch > 0.01) f.push(`distorted ${(boxAR / natAR).toFixed(3)}x (drawn ${r.box.join('×')} for ${r.nat.join('×')})`);
    if (r.box[0] * r.dpr > r.nat[0] * 1.01) f.push(`upscaled ${(r.box[0] * r.dpr / r.nat[0]).toFixed(2)}x at dpr ${r.dpr}`);
    if (r.scroll[1] > r.scroll[0] + 1) f.push(`cut: ${r.scroll[0]} of ${r.scroll[1]} px shown`);
    if (r.screen[1] > r.box[1] + 1) f.push(`gap: image ${r.box[1]} in a ${r.screen[1]} px screen`);
    if (!r.attr[0]) f.push('undeclared: no width and height (the page jumps as it loads)');
    else if (+r.attr[0] !== r.nat[0] || +r.attr[1] !== r.nat[1]) f.push(`declared ${r.attr.join('×')} != file ${r.nat.join('×')}`);
  }
  out.push({ ...r, findings: f });
}
writeFileSync(path.join(OUT, 'render-audit.json'), JSON.stringify(out, null, 1));
const tally = {};
for (const r of out) for (const f of r.findings) { const k = `${r.where} @${r.view} ${f.split(/[ :]/)[0]}`; tally[k] = (tally[k] ?? 0) + 1; }
console.log(`${out.length} renderings of ${new Set(out.map((r) => r.src)).size} files in ${ids.length} articles`);
console.table(tally);
const bad = (k) => new Set(out.filter((r) => r.findings.some((f) => f.startsWith(k))).map((r) => r.src));
for (const k of ['distorted', 'upscaled', 'cut', 'gap', 'missing', 'undeclared', 'declared']) console.log(k, bad(k).size, 'files');
for (const r of out.filter((x) => x.findings.length).slice(0, 40)) console.log(`${r.where} @${r.view} ${r.article} ${r.src}: ${r.findings.join('; ')}`);
console.log(path.join(OUT, 'render-audit.json'));
process.exit(out.some((r) => r.findings.length) ? 1 : 0);
