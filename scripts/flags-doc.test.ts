/**
 * docs/flags.md, "The keys": a kill switch the app never reads does nothing.
 * The table must say so, in the same words, for every key no source file reads
 * (useFlag / isFlagOn), and must not say it for a key that is read. Release
 * check of #299 (11-23): count_in and follow_tempo ship unwired.
 *
 * The PGlite suites of the release read its migrations from the checkout
 * first: once the PR branches are deleted, a suite that only knows the branch
 * SKIPs, which fails the strict run on main (same check).
 */
import { describe, expect, it } from 'vitest';

const fs = (await import(/* @vite-ignore */ 'node:fs')) as {
  readFileSync: (p: string, e: 'utf8') => string;
  readdirSync: (p: string, o: { withFileTypes: true }) => Array<{ name: string; isDirectory(): boolean }>;
};
const { process } = globalThis as unknown as { process: { cwd(): string } };
const read = (p: string) => fs.readFileSync(`${process.cwd()}/${p}`, 'utf8');

const NOT_WIRED = 'Not wired in this release: switching it off does nothing';

const sources = (dir: string): string[] =>
  fs.readdirSync(`${process.cwd()}/${dir}`, { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'test' ? [] : sources(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });

describe('docs/flags.md says which kill switches the app reads', () => {
  const doc = read('docs/flags.md');
  const rows = [...doc.matchAll(/^\| `(\w+)` \|(.*)\|\s*$/gm)].map((m) => ({ key: m[1], row: m[2] }));
  const defaults = [...(read('src/lib/appFlags.ts').match(/APP_FLAG_DEFAULTS = \{([\s\S]*?)\n\}/)?.[1] ?? '').matchAll(/^\s+(\w+): (?:true|false),/gm)].map((m) => m[1]);
  const read_ = new Set<string>();
  for (const f of sources('src')) for (const m of read(f).matchAll(/(?:useFlag|isFlagOn)\('(\w+)'\)/g)) read_.add(m[1]);

  it('has a row for every key of APP_FLAG_DEFAULTS', () => {
    expect(defaults.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.key).sort()).toEqual([...defaults].sort());
  });

  it('a key no source file reads is marked as not wired; a key that is read is not', () => {
    for (const { key, row } of rows) {
      if (read_.has(key)) expect(row, `${key} is read by the app`).not.toContain(NOT_WIRED);
      else expect(row, `${key} is read nowhere in src`).toContain(NOT_WIRED);
    }
  });

  it('the release checklist only tells to switch off a key that works', () => {
    const checklist = read('docs/release-checklist.md');
    for (const [, key] of checklist.matchAll(/UPDATE public\.app_flags SET enabled = (?:false|true)[^\n]*WHERE key = '(\w+)'/g)) expect(read_.has(key), key).toBe(true);
  });
});

describe('the release PGlite suites read a release migration from the checkout first', () => {
  // The four that only knew the PR branch (#299 check: 4 of 22 failed with no
  // branch refs), and chat_audit, which fell back to a pinned older commit of
  // 175 and so passed on a copy that isn't main's.
  for (const suite of ['chat_member_left_integrated', 'chat_participants_guard', 'money_fixes', 'rehearsal_poll_privacy_publish', 'chat_audit']) {
    it(`${suite}: the checkout is tried before any origin/<branch>`, () => {
      const code = read(`supabase/tests/${suite}.pglite.mjs`)
        .split('\n')
        .filter((l) => !/^\s*\/\//.test(l) && !/^import /.test(l))
        .join('\n');
      const branch = code.search(/['`]origin\//);
      expect(branch, 'still falls back to its branch').toBeGreaterThan(-1);
      const here = code.indexOf('existsSync(');
      expect(here, 'reads the checkout').toBeGreaterThan(-1);
      expect(here).toBeLessThan(branch);
    });
  }
});
