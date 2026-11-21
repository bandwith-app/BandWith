// @vitest-environment node
/**
 * The quote wizard (QuoteCreationWizard.tsx, the biggest screen) loads only
 * when a quote is created or edited: it is a chunk of its own, outside the
 * startup graph and outside the signed-in app's graph (AuthenticatedApp and
 * every chunk it imports statically), which every signed-in user loads.
 * Before this, QuotesExpanded imported it statically, so it sat in the
 * AuthenticatedApp chunk.
 *
 * Runs a real production build of the app entry in memory (no dist/ written).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { build, type Rollup } from 'vite';

const root = path.resolve(__dirname, '..');
const WIZARD = path.join(root, 'src/app/components/quotes/QuoteCreationWizard.tsx');
const SIGNED_IN = path.join(root, 'src/app/AuthenticatedApp.tsx');

let chunks: Map<string, Rollup.OutputChunk>;

/** A chunk and every chunk it imports statically, as module ids. */
const staticGraph = (start: Rollup.OutputChunk) => {
  const seen = new Set<string>();
  const stack = [start.fileName];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    stack.push(...chunks.get(f)!.imports);
  }
  return { files: seen, modules: new Set([...seen].flatMap((f) => Object.keys(chunks.get(f)!.modules))) };
};
const chunkWith = (id: string) => [...chunks.values()].filter((c) => id in c.modules);

beforeAll(async () => {
  const out = await build({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    logLevel: 'silent',
    build: { write: false, rollupOptions: { input: { main: path.join(root, 'index.html') } } },
  });
  const outputs = (Array.isArray(out) ? out : [out as Rollup.RollupOutput]).flatMap((o) => o.output);
  chunks = new Map(outputs.filter((o): o is Rollup.OutputChunk => o.type === 'chunk').map((c) => [c.fileName, c]));
}, 180_000);

describe('the quote wizard is loaded on demand', () => {
  it('is not in the startup graph', () => {
    const entry = [...chunks.values()].find((c) => c.isEntry)!;
    expect(staticGraph(entry).modules.has(WIZARD)).toBe(false);
  });

  it('is not in the signed-in app graph', () => {
    const [app] = chunkWith(SIGNED_IN);
    expect(app, 'AuthenticatedApp chunk').toBeDefined();
    expect(staticGraph(app).modules.has(WIZARD)).toBe(false);
  });

  it('is a chunk of its own, reached by a dynamic import', () => {
    const holders = chunkWith(WIZARD);
    expect(holders).toHaveLength(1);
    expect(SIGNED_IN in holders[0].modules, 'shares the AuthenticatedApp chunk').toBe(false);
    const importers = [...chunks.values()].filter((c) => c.dynamicImports.includes(holders[0].fileName));
    expect(importers.length).toBeGreaterThan(0);
  });
});
