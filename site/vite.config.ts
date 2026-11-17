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
import { readFileSync, readdirSync, mkdirSync, copyFileSync, existsSync, createReadStream } from 'fs';
import path from 'path';
import { GENERATED } from './src/content/render';

const root = __dirname;
const SHOTS = path.resolve(root, '../academy/public/shots');

const PAGES: Record<string, string> = {
  home: 'index.html',
  stage: 'features/stage/index.html',
  get: 'get/index.html',
};

function partials(): Plugin {
  const read = (name: string) => readFileSync(path.resolve(root, 'partials', `${name}.html`), 'utf8');
  // <!--#name--> = a file in site/partials; <!--@name--> = generated from the channel list.
  const fill = (html: string) =>
    html
      .replace(/<!--#([a-z-]+)-->/g, (_, name: string) => read(name))
      .replace(/<!--@([a-z-]+)-->/g, (m, name: string) => GENERATED[name]?.() ?? m);
  return {
    name: 'bw-partials',
    transformIndexHtml: { order: 'pre', handler: (html) => fill(fill(html)) },
  };
}

function academyShots(): Plugin {
  return {
    name: 'bw-academy-shots',
    configureServer(server) {
      server.middlewares.use('/shots', (req, res, next) => {
        const file = path.join(SHOTS, decodeURIComponent((req.url ?? '').split('?')[0]));
        if (!file.startsWith(SHOTS) || !existsSync(file)) return next();
        res.setHeader('Content-Type', 'image/webp');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const out = path.resolve(root, 'dist/shots');
      mkdirSync(out, { recursive: true });
      for (const f of readdirSync(SHOTS)) if (f.endsWith('.webp')) copyFileSync(path.join(SHOTS, f), path.join(out, f));
    },
  };
}

export default defineConfig({
  root,
  base: '/',
  envDir: root,
  plugins: [partials(), academyShots()],
  server: { port: 5180, host: '127.0.0.1' },
  preview: { port: 5181, host: '127.0.0.1' },
  build: {
    outDir: path.resolve(root, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: Object.fromEntries(Object.entries(PAGES).map(([k, v]) => [k, path.resolve(root, v)])),
    },
  },
});
