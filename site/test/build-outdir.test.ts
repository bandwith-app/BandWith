/**
 * The site builds into any outDir (pnpm e2e:site builds into e2e/.site): the
 * generated files (robots.txt, sitemap.xml, llms*.txt, vercel.json) are read
 * from and written to that build, never to site/dist.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const SITE = path.resolve(__dirname, '..');
const ROOT = path.resolve(SITE, '..');
const VITE = path.join(ROOT, 'node_modules/.bin/vite');

describe('a build into another folder', () => {
  it('writes the generated files next to its own pages', () => {
    const out = mkdtempSync(path.join(tmpdir(), 'bw-site-'));
    const siteDist = path.join(SITE, 'dist');
    // A stale site/dist must not be read instead of this build.
    rmSync(siteDist, { recursive: true, force: true });
    try {
      // As pnpm e2e:site does (e2e/site.config.ts), in its own process: esbuild needs plain Node.
      execFileSync(VITE, ['build', '--config', 'site/vite.config.ts', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { cwd: ROOT, stdio: 'pipe' });
      for (const f of ['index.html', 'robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt', 'vercel.json']) {
        expect(existsSync(path.join(out, f)), f).toBe(true);
      }
      expect(readFileSync(path.join(out, 'llms-full.txt'), 'utf8')).toContain('URL: https://bandwith.fun/faq/');
      expect(existsSync(siteDist)).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
