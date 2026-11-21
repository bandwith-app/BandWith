/**
 * The Academy's static pages (academy/seo: /academy/<lang>/…, sitemap,
 * robots.txt, llms.txt) are for the web only. The native apps open the
 * interactive guide offline and must not carry ~21 MB of HTML:
 *
 * - `pnpm build` (the native path: then `cap sync`) doesn't prerender;
 * - `build:web` does, and it is what Vercel and CI run;
 * - the `capacitor:copy:after` hook strips them from ios/App/App/public and
 *   android/app/src/main/assets/public anyway, after any `cap copy` / `cap sync`
 *   (in case the web build ran first in the same checkout).
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripWebOnly, nativePublicDir } from './native-web-strip.mjs';

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

describe('build targets', () => {
  it('the plain build (native) does not prerender; build:web does', () => {
    expect(pkg.scripts.build).not.toMatch(/prerender/);
    expect(pkg.scripts['build:web']).toMatch(/academy\/scripts\/prerender\.mjs/);
    expect(pkg.scripts['build:web']).toMatch(/vite build --config academy\/vite\.config\.ts/);
  });

  it('Vercel and CI build the web target', () => {
    expect(JSON.parse(read('vercel.json')).buildCommand).toBe('npm run build:web');
    expect(read('.github/workflows/ci.yml')).toMatch(/run: pnpm build:web/);
  });

  it('no native build script runs the web target', () => {
    for (const f of ['scripts/build-android-apk.sh', 'scripts/release-android.sh', 'scripts/deploy-android.ps1', 'scripts/emulator-check.sh']) {
      expect(read(f), f).not.toMatch(/build:web|prerender/);
    }
  });

  it('cap copy / cap sync run the strip hook', () => {
    expect(pkg.scripts['capacitor:copy:after']).toBe('node scripts/native-web-strip.mjs');
  });
});

describe('native-web-strip', () => {
  it('finds each platform’s public folder', () => {
    expect(nativePublicDir('/r', 'ios')).toBe(path.join('/r', 'ios/App/App/public'));
    expect(nativePublicDir('/r', 'android')).toBe(path.join('/r', 'android/app/src/main/assets/public'));
    expect(nativePublicDir('/r', 'web')).toBeNull();
  });

  it('removes the static Academy and crawler files, keeps the app and the interactive guide', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'bw-native-'));
    const put = (rel: string) => {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), 'x');
    };
    const keep = ['index.html', 'assets/index.js', 'academy/index.html', 'academy/assets/index.css', 'academy/shots/a@phone.webp', 'academy/favicon.svg'];
    const gone = [
      'robots.txt',
      'llms.txt',
      'academy/sitemap.xml',
      'academy/llms.txt',
      'academy/llms-full.txt',
      ...['en', 'it', 'es', 'fr', 'de', 'pt'].map((l) => `academy/${l}/a/create-a-gig/index.html`),
      'academy/en/index.html',
    ];
    [...keep, ...gone].forEach(put);
    const removed = stripWebOnly(dir);
    for (const f of keep) expect(existsSync(path.join(dir, f)), f).toBe(true);
    for (const f of gone) expect(existsSync(path.join(dir, f)), f).toBe(false);
    expect(readdirSync(path.join(dir, 'academy')).sort()).toEqual(['assets', 'favicon.svg', 'index.html', 'shots']);
    expect(removed.length).toBeGreaterThan(0);
    // nothing left to strip the second time
    expect(stripWebOnly(dir)).toEqual([]);
  });
});
