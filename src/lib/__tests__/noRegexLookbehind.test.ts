/**
 * Safari / WKWebView before 16.4 throws a SyntaxError on a regex lookbehind
 * ((?<= or (?<!) when the module loads: the app would be a blank screen on
 * iPadOS 16.3 before React mounts. None in the app's code, the Academy or
 * the public pages.
 */
import { describe, expect, it } from 'vitest';

type Fs = {
  readdirSync(p: string, o: { withFileTypes: true }): Array<{ name: string; isDirectory(): boolean }>;
  readFileSync(p: string, e: 'utf8'): string;
  existsSync(p: string): boolean;
};
const NODE_FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ NODE_FS)) as Fs;
const { process } = globalThis as unknown as { process: { cwd(): string } };
const ROOT = process.cwd();

function files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '__tests__') return [];
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return files(p);
    return /\.(ts|tsx|js|mjs|html)$/.test(e.name) ? [p] : [];
  });
}

const LOOKBEHIND = /\(\?<[=!]/;

describe('no regex lookbehind in code that runs on old Safari', () => {
  it('finds none in src/, academy/ or public/', () => {
    const hits = ['src', 'academy', 'public'].flatMap((d) => files(`${ROOT}/${d}`)).flatMap((f) =>
      fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => (LOOKBEHIND.test(line) ? `${f.slice(ROOT.length + 1)}:${i + 1}` : null))
        .filter((x): x is string => x !== null),
    );
    expect(hits).toEqual([]);
  });
});
