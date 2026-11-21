// @vitest-environment node
/**
 * Startup size: the app's first JS (the entry chunk and every chunk it
 * imports statically) carries no translation dictionary. Each language is its
 * own chunk, loaded with a dynamic import for the language in use
 * (src/lib/i18n/index.ts). Before this, all five dictionaries were in the
 * startup graph (about 430 KB gzip).
 *
 * Runs a real production build of the app entry in memory (no dist/ written).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { build, type Rollup } from 'vite';

const root = path.resolve(__dirname, '..');
const LOCALES = ['it', 'es', 'fr', 'de', 'pt'] as const;
const localeFile = (l: string) => path.join(root, 'src/lib/i18n/locales', `${l}.ts`);
const ACADEMY = path.join(root, 'src/lib/i18n/locales/academy.ts');

let chunks: Map<string, Rollup.OutputChunk>;
let eager: Set<string>;
let eagerModules: Set<string>;

beforeAll(async () => {
  const out = await build({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    logLevel: 'silent',
    build: { write: false, rollupOptions: { input: { main: path.join(root, 'index.html') } } },
  });
  const outputs = (Array.isArray(out) ? out : [out as Rollup.RollupOutput]).flatMap((o) => o.output);
  chunks = new Map(outputs.filter((o): o is Rollup.OutputChunk => o.type === 'chunk').map((c) => [c.fileName, c]));
  const entry = [...chunks.values()].find((c) => c.isEntry);
  if (!entry) throw new Error('no entry chunk');
  eager = new Set();
  const stack = [entry.fileName];
  while (stack.length) {
    const f = stack.pop()!;
    if (eager.has(f)) continue;
    eager.add(f);
    stack.push(...chunks.get(f)!.imports);
  }
  eagerModules = new Set([...eager].flatMap((f) => Object.keys(chunks.get(f)!.modules)));
}, 180_000);

describe('startup bundle and the translation dictionaries', () => {
  it('builds the i18n module into the startup graph', () => {
    expect(eagerModules.has(path.join(root, 'src/lib/i18n/index.ts'))).toBe(true);
  });

  it('keeps every dictionary out of the startup graph', () => {
    const inStartup = [...LOCALES.map(localeFile), ACADEMY].filter((m) => eagerModules.has(m)).map((m) => path.relative(root, m));
    expect(inStartup).toEqual([]);
  });

  it('builds each language into a chunk of its own', () => {
    for (const l of LOCALES) {
      const holders = [...chunks.values()].filter((c) => localeFile(l) in c.modules);
      expect(holders, l).toHaveLength(1);
      const others = LOCALES.filter((o) => o !== l).filter((o) => localeFile(o) in holders[0].modules);
      expect(others, `${l} chunk also holds`).toEqual([]);
      expect(eager.has(holders[0].fileName), `${l} chunk is lazy`).toBe(false);
    }
  });
});
