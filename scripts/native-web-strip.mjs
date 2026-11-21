#!/usr/bin/env node
/**
 * Keeps the web-only files out of the native apps.
 *
 * The web build (`build:web`) adds the Academy's static pages for search
 * engines and AI assistants (/academy/<lang>/…, academy/sitemap.xml and
 * llms*.txt, robots.txt, llms.txt: academy/seo). The apps open the
 * interactive guide offline and don't need them (~21 MB of HTML).
 *
 * Runs as the `capacitor:copy:after` hook, so every `cap copy` / `cap sync`
 * (iOS, Android, any script) strips them from the platform's copy of dist,
 * even when the web build ran first in the same checkout.
 * Tests: scripts/native-web.test.ts.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LANGS = ['en', 'it', 'es', 'fr', 'de', 'pt'];
const FILES = ['robots.txt', 'llms.txt', 'academy/sitemap.xml', 'academy/llms.txt', 'academy/llms-full.txt'];

/** The folder `cap copy` fills for a platform, or null (web, unknown). */
export function nativePublicDir(root, platform) {
  if (platform === 'ios') return path.join(root, 'ios/App/App/public');
  if (platform === 'android') return path.join(root, 'android/app/src/main/assets/public');
  return null;
}

/** Removes the web-only files from a copy of dist; returns what it removed (relative paths). */
export function stripWebOnly(publicDir) {
  const removed = [];
  const academy = path.join(publicDir, 'academy');
  const targets = [
    ...FILES,
    ...(existsSync(academy) ? readdirSync(academy).filter((d) => LANGS.includes(d)).map((d) => `academy/${d}`) : []),
  ];
  for (const rel of targets) {
    const abs = path.join(publicDir, rel);
    if (!existsSync(abs)) continue;
    rmSync(abs, { recursive: true, force: true });
    removed.push(rel);
  }
  return removed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.CAPACITOR_ROOT_DIR || process.cwd();
  const platform = process.env.CAPACITOR_PLATFORM_NAME;
  const dir = nativePublicDir(root, platform);
  if (dir && existsSync(dir)) {
    const removed = stripWebOnly(dir);
    if (removed.length) console.log(`[native-web-strip] ${platform}: removed the web-only ${removed.join(', ')}`);
  }
}
