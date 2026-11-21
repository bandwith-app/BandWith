#!/usr/bin/env node
/**
 * Writes the Academy's static pages (academy/seo/build.ts) into dist/, after
 * `vite build --config academy/vite.config.ts`: the last step of `build:web`,
 * the web build (Vercel, CI). Plain `pnpm build` (native apps) skips it, and
 * scripts/native-web-strip.mjs keeps it out of `cap copy` / `cap sync`:
 *
 *   dist/academy/<lang>/…/index.html   every article, area, FAQ, glossary × 6 languages
 *   dist/academy/sitemap.xml, llms.txt, llms-full.txt
 *   dist/robots.txt, dist/llms.txt
 *
 *   node academy/scripts/prerender.mjs                   build (needs dist/academy)
 *   node academy/scripts/prerender.mjs --update-lastmod  after editing the guide:
 *     refreshes academy/seo/lastmod.json (each page's content hash and the
 *     date it last changed, for the sitemap; the Vercel build has no git).
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, openSync, readSync, closeSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ACADEMY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.resolve(ACADEMY, '../dist');
const MANIFEST = path.join(ACADEMY, 'seo/lastmod.json');
const today = new Date().toISOString().slice(0, 10);

/** Width and height from a WebP header (VP8, VP8L, VP8X). */
function webpSize(file) {
  const fd = openSync(file, 'r');
  const b = Buffer.alloc(30);
  readSync(fd, b, 0, 30, 0);
  closeSync(fd);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const [b0, b1, b2, b3] = [b[21], b[22], b[23], b[24]];
    return { w: 1 + (((b1 & 0x3f) << 8) | b0), h: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
  }
  if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  return null;
}

const server = await createServer({
  configFile: path.join(ACADEMY, 'vite.config.ts'),
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});

try {
  const seo = await server.ssrLoadModule('/seo/build.ts');
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};

  if (process.argv.includes('--update-lastmod')) {
    const next = seo.updatedLastmod(manifest, today);
    writeFileSync(MANIFEST, `${JSON.stringify(next, null, 1)}\n`);
    const changed = Object.keys(next).filter((k) => manifest[k]?.h !== next[k].h).length;
    console.log(`academy/seo/lastmod.json: ${changed} page(s) changed on ${today}, ${Object.keys(next).length} in all.`);
  } else {
    const assets = path.join(DIST, 'academy/assets');
    if (!existsSync(assets)) throw new Error('dist/academy is missing: run `vite build --config academy/vite.config.ts` first.');
    const css = readdirSync(assets).filter((f) => f.endsWith('.css'));
    if (css.length !== 1) throw new Error(`Expected one stylesheet in dist/academy/assets, found: ${css.join(', ') || 'none'}`);
    const shotSize = (file) => {
      const f = path.join(ACADEMY, 'public', file);
      return existsSync(f) ? webpSize(f) : null;
    };
    const { pages, files } = seo.buildSite({ cssHref: `/academy/assets/${css[0]}`, shotSize, lastmod: manifest, today });
    let bytes = 0;
    for (const p of pages) {
      const out = path.join(DIST, p.path, 'index.html');
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, p.html);
      bytes += Buffer.byteLength(p.html);
    }
    for (const [rel, body] of Object.entries(files)) {
      const out = path.join(DIST, rel);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, body);
      bytes += Buffer.byteLength(body);
    }
    const stale = pages.filter((p) => p.lastmod === today && manifest[p.path.replace(/^\/academy\/|\/$/g, '')]?.d !== today).length;
    console.log(
      `Academy static pages: ${pages.length} pages + ${Object.keys(files).length} files, ${(bytes / 1e6).toFixed(1)} MB` +
        (stale ? ` (${stale} not in academy/seo/lastmod.json: run --update-lastmod)` : ''),
    );
  }
} finally {
  await server.close();
}
