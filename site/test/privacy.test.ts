import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

/**
 * The product site has no cookie banner, so it must not send visitors' IP
 * addresses to third parties it doesn't name in the Privacy Policy. Fonts are
 * self-hosted (site/public/fonts); Google Fonts hosts must never come back.
 */
const SITE = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', 'dist', 'public', 'test']);
const BANNED = ['fonts.googleapis.com', 'fonts.gstatic.com'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(SITE);
const pages = files.filter((f) => f.endsWith('index.html'));
const partial = (name: string) => readFileSync(path.join(SITE, 'partials', `${name}.html`), 'utf8');
// Same include rule as the bw-partials plugin in site/vite.config.ts (two passes).
const expand = (html: string) => html.replace(/<!--#([a-z-]+)-->/g, (_, n: string) => partial(n));
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8')).join('\n');

describe('site privacy: no third-party font hosts', () => {
  it('finds the site pages', () => {
    expect(pages.length).toBeGreaterThanOrEqual(13);
  });

  for (const page of pages) {
    const rel = path.relative(SITE, page);
    it(`${rel} loads nothing from Google Fonts`, () => {
      const html = expand(expand(readFileSync(page, 'utf8')));
      expect(html).toContain('<head');
      for (const host of BANNED) expect(html, `${rel} → ${host}`).not.toContain(host);
    });
  }

  it('no site source, style or partial points at Google Fonts', () => {
    for (const f of files.filter((x) => /\.(ts|css|html)$/.test(x))) {
      const src = readFileSync(f, 'utf8');
      for (const host of BANNED) expect(src, `${path.relative(SITE, f)} → ${host}`).not.toContain(host);
    }
  });

  it('self-hosts Geist Mono with its OFL licence next to the files', () => {
    const faces = css.match(/@font-face\s*{[^}]*}/g) ?? [];
    const geist = faces.filter((f) => /font-family:\s*'Geist Mono'/.test(f));
    expect(geist.length).toBeGreaterThanOrEqual(2);
    for (const face of geist) {
      for (const [, url] of face.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
        expect(url.startsWith('/fonts/'), url).toBe(true);
        expect(existsSync(path.join(SITE, 'public', url)), url).toBe(true);
      }
    }
    expect(readFileSync(path.join(SITE, 'public/fonts/OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE');
  });
});
