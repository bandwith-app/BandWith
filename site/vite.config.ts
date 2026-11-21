/**
 * BandWith product site: a static multi-page site (no React), separate from the
 * app. Dev: pnpm dev:site (port 5180). Build: pnpm build:site → site/dist.
 *
 * - Pages: PAGES below.
 * - Shared HTML (icon sprite, nav, footer) lives in site/partials and is
 *   inlined at build time where a page writes <!--#name-->.
 * - App screenshots come straight from the Academy captures
 *   (academy/public/shots), so the site and the guide always show the same
 *   screens: served at /shots/ in dev, copied into dist/shots on build.
 */
import { defineConfig, type Plugin } from 'vite';
import { readFileSync, readdirSync, mkdirSync, copyFileSync, existsSync, createReadStream, writeFileSync } from 'fs';
import path from 'path';
import { PAGES, fillPartials } from './tools/pages';
import { STUB, finalizePage, pageOf, translatorFor, writeMirrors, type Misses } from './tools/i18n';
import { INDEXED, NOT_FOUND, seoFiles } from './tools/seo';

const root = __dirname;
const SHOTS = path.resolve(root, '../academy/public/shots');

// Pages and their shared HTML: tools/pages.ts.

// Italian and Spanish copies of every page (/it/…, /es/…): stubs whose HTML is
// the English page, translated by tools/i18n.ts.
const MIRRORS = writeMirrors(root, Object.values(PAGES));

function partials(): Plugin {
  const misses: Misses = new Map();
  let building = false;
  let outDir = path.resolve(root, 'dist');
  return {
    name: 'bw-partials',
    configResolved(c) {
      building = c.command === 'build';
      // pnpm e2e:site builds into e2e/.site: the generated files go next to that build's pages.
      outDir = path.resolve(c.root, c.build.outDir);
    },
    configureServer(server) {
      // A stub's page is its English file: reload when any page or partial changes.
      server.watcher.on('change', (f) => { if (f.endsWith('.html')) server.ws.send({ type: 'full-reload' }); });
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html, ctx) => {
        const { lang, enRel } = pageOf(path.relative(root, ctx.filename));
        const source = html.includes(STUB) ? readFileSync(path.resolve(root, enRel), 'utf8') : html;
        return finalizePage(fillPartials(source), enRel, lang, misses);
      },
    },
    closeBundle() {
      if (!building) return;
      // robots.txt, sitemap.xml, llms.txt, llms-full.txt and the hosting config (tools/seo.ts).
      const missing = INDEXED.filter((rel) => !existsSync(path.join(outDir, rel)));
      if (missing.length) throw new Error(`bw-partials: built pages missing in ${outDir}: ${missing.join(', ')}`);
      const english = INDEXED.map((rel) => ({ rel, html: readFileSync(path.join(outDir, rel), 'utf8') }));
      for (const [name, body] of Object.entries(seoFiles(english))) writeFileSync(path.join(outDir, name), body);
      // For translators: every unit still in English on /it/ and /es/ (site/.i18n-missing.json).
      const list = [...misses].map(([text, pages]) => ({ text, pages: [...pages].sort() }));
      writeFileSync(path.resolve(root, '.i18n-missing.json'), JSON.stringify(list, null, 2) + '\n');
      // Keys the built pages used (with e2e/site/i18n-runtime.spec.ts BW_I18N_DUMP: keys no page needs).
      const hits = { it: [...translatorFor('it').hits], es: [...translatorFor('es').hits] };
      writeFileSync(path.resolve(root, '.i18n-hits.json'), JSON.stringify(hits) + '\n');
      if (list.length) this.warn(`${list.length} text units without a translation (site/.i18n-missing.json)`);
    },
  };
}

function academyShots(): Plugin {
  let outDir = path.resolve(root, 'dist');
  return {
    name: 'bw-academy-shots',
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    configureServer(server) {
      server.middlewares.use('/shots', (req, res, next) => {
        const file = path.join(SHOTS, decodeURIComponent((req.url ?? '').split('?')[0]));
        if (!file.startsWith(SHOTS) || !existsSync(file)) return next();
        res.setHeader('Content-Type', 'image/webp');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const out = path.join(outDir, 'shots');
      mkdirSync(out, { recursive: true });
      for (const f of readdirSync(SHOTS)) if (f.endsWith('.webp')) copyFileSync(path.join(SHOTS, f), path.join(out, f));
    },
  };
}

/**
 * /api/geo: on Vercel, the edge function site/api/geo.js (copied into the
 * build) answers the visitor's country from Vercel's own headers. Locally
 * there is no country (BW_GEO=ES or BW_GEO=CH-TI pretends one; ?geo=ES on
 * any page previews the popup without it).
 */
function geoApi(): Plugin {
  let outDir = path.resolve(root, 'dist');
  const answer = (_req: unknown, res: import('http').ServerResponse) => {
    const [country = null, region = ''] = (process.env.BW_GEO ?? '').toUpperCase().split('-').filter(Boolean);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ country, region }));
  };
  return {
    name: 'bw-geo',
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    configureServer(server) { server.middlewares.use('/api/geo', answer); },
    configurePreviewServer(server) { server.middlewares.use('/api/geo', answer); },
    closeBundle() {
      mkdirSync(path.join(outDir, 'api'), { recursive: true });
      copyFileSync(path.resolve(root, 'api/geo.js'), path.join(outDir, 'api/geo.js'));
    },
  };
}

export default defineConfig({
  root,
  base: '/',
  // The app's .env files (repo root): the site reads only VITE_SUPABASE_URL and
  // VITE_SUPABASE_PUBLISHABLE_KEY (public) for the beta counter and the waitlist.
  envDir: path.resolve(root, '..'),
  plugins: [partials(), academyShots(), geoApi()],
  server: { port: 5180, host: '127.0.0.1' },
  preview: { port: 5181, host: '127.0.0.1' },
  build: {
    outDir: path.resolve(root, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: Object.fromEntries([
        ...Object.entries(PAGES).map(([k, v]) => [k, path.resolve(root, v)]),
        // Served by Vercel for any missing path; no language copies, never indexed.
        ['notFound', path.resolve(root, NOT_FOUND)],
        ...MIRRORS.map((rel) => [rel.replace(/\/?index\.html$/, '').replace(/\//g, '-'), path.resolve(root, rel)]),
      ]),
    },
  },
});
