/**
 * Privacy: the app and the Academy must not load fonts from Google
 * (fonts.googleapis.com / fonts.gstatic.com send every visitor's IP address
 * to Google, and the Privacy Policy says the monospace font is self-hosted).
 * Geist Mono ships with the web bundle instead, so it also works offline in
 * the iOS and Android apps.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');
const GOOGLE_FONT_HOSTS = /fonts\.(googleapis|gstatic)\.com/i;

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const pages = [
  ...readdirSync(root).filter((f) => f.endsWith('.html')).map((f) => path.join(root, f)),
  path.join(root, 'academy/index.html'),
  ...walk(path.join(root, 'public'), ['.html']),
];
const styles = [
  ...walk(path.join(root, 'src'), ['.css']),
  ...walk(path.join(root, 'academy/src'), ['.css']),
];
const scripts = [
  ...walk(path.join(root, 'src'), ['.ts', '.tsx']).filter((f) => !/__tests__|\.test\./.test(f)),
  ...walk(path.join(root, 'academy/src'), ['.ts', '.tsx']),
].filter((f) => /font/i.test(readFileSync(f, 'utf8')));

const rel = (f: string) => path.relative(root, f);

describe('no fonts from Google', () => {
  it.each([...pages, ...styles, ...scripts].map(rel))('%s does not point at Google font hosts', (file) => {
    expect(readFileSync(path.join(root, file), 'utf8')).not.toMatch(GOOGLE_FONT_HOSTS);
  });
});

describe('Geist Mono is self-hosted', () => {
  const facesFile = path.join(root, 'src/styles/geist-mono.css');

  it('has @font-face rules that point at files in the repo', () => {
    expect(existsSync(facesFile)).toBe(true);
    const css = readFileSync(facesFile, 'utf8');
    const faces = css.match(/@font-face\s*{[^}]*}/g) ?? [];
    expect(faces.length).toBe(3);
    for (const face of faces) {
      expect(face).toMatch(/font-family:\s*'Geist Mono'/);
      expect(face).toMatch(/unicode-range:/);
      const url = face.match(/url\('([^']+)'\)/)?.[1];
      expect(url, face).toBeTruthy();
      expect(url).not.toMatch(/^(https?:)?\/\//);
      const file = path.resolve(path.dirname(facesFile), url!);
      expect(existsSync(file), rel(file)).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(1000);
    }
  });

  it('ships the SIL Open Font License next to the files', () => {
    const licence = path.join(root, 'src/styles/fonts/OFL.txt');
    expect(existsSync(licence)).toBe(true);
    expect(readFileSync(licence, 'utf8')).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/i);
  });

  it('is loaded by the app and by the Academy', () => {
    expect(readFileSync(path.join(root, 'src/styles/fonts.css'), 'utf8')).toMatch(
      /@import\s+['"]\.\/geist-mono\.css['"]/,
    );
    expect(readFileSync(path.join(root, 'academy/src/main.tsx'), 'utf8')).toMatch(
      /import\s+['"]@\/styles\/geist-mono\.css['"]/,
    );
  });
});
