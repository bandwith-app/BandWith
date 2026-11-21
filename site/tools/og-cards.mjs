/**
 * Share cards (Open Graph / Twitter), 1200×630, one per page and language:
 * site/public/og/<key>-<lang>.jpg, named by tools/seo.ts (cardPath).
 * The text is the page's own og:title, already translated, and the screen is
 * the page's hero capture, so a card always matches the page it shares.
 *
 * Run after a build (no server: the browser is handed site/dist as
 * https://bandwith.fun, the origin Typekit serves the display font to):
 *   pnpm build:site && node site/tools/og-cards.mjs
 * The cards are committed; site/test/seo.test.ts fails when one is missing.
 */
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, statSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(SITE, 'dist');
const OUT = path.join(SITE, 'public/og');
const ORIGIN = 'https://bandwith.fun';
const TYPES = { '.webp': 'image/webp', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.html': 'text/html' };

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = path.join(d, f);
  return statSync(p).isDirectory() ? walk(p) : f === 'index.html' ? [p] : [];
});
const attr = (html, re) => (re.exec(html)?.[1] ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const logo = readFileSync(path.join(SITE, 'public/brand/bandwith-logo.svg'), 'utf8').replace(/fill="#050505"/g, 'fill="#ffffff"');

function card({ title, sub, tag, shot, size }) {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://use.typekit.net/mzr4hzv.css">
<style>
@font-face { font-family: 'Geist Mono'; src: url('/fonts/geist-mono-latin.woff2') format('woff2'); font-weight: 400 600; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; background: #050505; color: #fff; overflow: hidden; }
body { position: relative; font-family: 'neue-haas-grotesk-display', 'Helvetica Neue', Helvetica, Arial, sans-serif; }
.glow { position: absolute; right: -120px; top: -160px; width: 760px; height: 760px; border-radius: 50%; background: radial-gradient(closest-side, rgba(213,251,70,.22), rgba(213,251,70,0)); }
.copy { position: absolute; left: 72px; top: 64px; bottom: 64px; width: 640px; display: flex; flex-direction: column; }
.logo { height: 38px; width: auto; align-self: flex-start; }
.logo svg { height: 38px; width: auto; display: block; }
.tag { margin-top: auto; font-family: 'Geist Mono', ui-monospace, monospace; font-size: 22px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: #d5fb46; display: flex; align-items: center; gap: 14px; }
.tag i { width: 12px; height: 12px; border-radius: 50%; background: #d5fb46; box-shadow: 0 0 14px #d5fb46; }
h1 { margin-top: 22px; font-weight: 700; font-size: ${size}px; line-height: .92; letter-spacing: -0.03em; text-transform: uppercase; }
p { margin-top: 22px; font-size: 30px; line-height: 1.2; color: rgba(255,255,255,.72); max-width: 600px; }
.url { margin-top: 30px; font-family: 'Geist Mono', ui-monospace, monospace; font-size: 18px; letter-spacing: .08em; text-transform: uppercase; color: rgba(255,255,255,.5); }
.phone { position: absolute; right: 84px; top: 70px; width: 330px; height: 714px; border-radius: 46px; padding: 10px; background: #1a1a1a; box-shadow: 0 0 0 2px #2a2a2a, 0 40px 80px rgba(0,0,0,.6); transform: rotate(4deg); }
.phone img { width: 100%; height: 100%; object-fit: cover; object-position: top; border-radius: 37px; display: block; }
</style></head><body>
<div class="glow"></div>
<div class="phone"><img src="${shot}" alt=""></div>
<div class="copy">
  <div class="logo">${logo}</div>
  <div class="tag"><i></i>${esc(tag)}</div>
  <h1>${esc(title)}</h1>
  ${sub ? `<p>${esc(sub)}</p>` : ''}
  <div class="url">bandwith.fun · iPhone · Android · Web</div>
</div>
</body></html>`;
}

const pages = walk(DIST).filter((f) => !f.includes(`${path.sep}404`));
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
// Only this origin is local; the rest (Typekit) goes to the network.
await page.route(`${ORIGIN}/**`, (route) => {
  const p = new URL(route.request().url()).pathname;
  const file = path.join(DIST, p.endsWith('/') ? `${p}index.html` : p);
  if (!file.startsWith(DIST)) return route.abort();
  try {
    return route.fulfill({ body: readFileSync(file), contentType: TYPES[path.extname(file)] ?? 'application/octet-stream' });
  } catch { return route.fulfill({ status: 404, body: '' }); }
});
await page.goto(`${ORIGIN}/404.html`);
for (const file of pages) {
  const rel = path.relative(DIST, file).split(path.sep).join('/');
  const m = /^(?:(it|es)\/)?(.*)index\.html$/.exec(rel);
  const lang = m[1] ?? 'en';
  const base = m[2];
  const key = base === '' ? 'home' : base.startsWith('features/') ? base.split('/')[1] : base.replace(/\/$/, '');
  const html = readFileSync(file, 'utf8');
  const og = attr(html, /<meta property="og:title" content="([^"]*)"/);
  const [title, ...rest] = og.split(' · ');
  const sub = rest.join(' · ');
  const chTag = attr(html, /class="label fhero__ch"[^>]*><span class="led"><\/span>([^<]*)</);
  const tag = chTag || attr(html, /<p class="label[^"]*"[^>]*><span class="led"><\/span>([^<]*)</) || 'BandWith';
  // The hero's screen (not the menu's previews); Get and FAQ have none of their own.
  const FALLBACK = { get: 'calendar-month', faq: 'shot-event-chat' };
  const shot = attr(html, /class="crop (?:fhero|hero)__crop"[^>]*>\s*<img class="crop__img" src="([^"]+)"/)
    || `/shots/${FALLBACK[key] ?? 'calendar-month'}@phone.webp`;
  const isHome = key === 'home';
  const t = isHome ? sub || title : title === 'BandWith' ? sub : title;
  const s = isHome ? '' : title === 'BandWith' ? '' : sub;
  const size = t.length > 22 ? 64 : t.length > 14 ? 80 : 96;
  await page.setContent(card({ title: t, sub: s, tag, shot, size }), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(OUT, `${key}-${lang}.jpg`);
  await page.screenshot({ path: out, type: 'jpeg', quality: 82 });
  console.log(path.relative(SITE, out), '←', og);
}
await browser.close();
