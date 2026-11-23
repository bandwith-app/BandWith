/**
 * CI skips the app's E2E shards when a pull request only touches the docs or
 * the product site (the handbook PR of 11-23 waited 50 minutes for shards that
 * could not be affected, and timed out twice). The decision lives in
 * scripts/ci-changed-areas.mjs; the workflow shape it relies on is checked here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper, no types
import { needsAppE2E } from './ci-changed-areas.mjs';

describe('needsAppE2E', () => {
  it('skips the app shards for docs-only changes', () => {
    expect(needsAppE2E(['docs/handbook/en/ch-basics.html', 'docs/handbook/build.py', 'README.md'])).toBe(false);
  });
  it('skips the app shards for site-only changes', () => {
    expect(needsAppE2E(['site/get/index.html', 'site/src/i18n/dict/it.json'])).toBe(false);
  });
  it('runs them as soon as one file is outside docs and site', () => {
    expect(needsAppE2E(['docs/plans/x.md', 'src/app/App.tsx'])).toBe(true);
    expect(needsAppE2E(['site/index.html', 'e2e/specs/site.spec.ts'])).toBe(true);
    expect(needsAppE2E(['academy/content/music.ts'])).toBe(true);
    expect(needsAppE2E(['.github/workflows/ci.yml'])).toBe(true);
    expect(needsAppE2E(['package.json'])).toBe(true);
    expect(needsAppE2E(['supabase/migrations/200_x.sql'])).toBe(true);
  });
  it('runs them when the list is empty or unknown (fail safe)', () => {
    expect(needsAppE2E([])).toBe(true);
    expect(needsAppE2E(['', '  '])).toBe(true);
  });
  it('does not treat look-alike paths as docs', () => {
    expect(needsAppE2E(['src/docs/notes.md'])).toBe(true);
    expect(needsAppE2E(['docsx/a.md'])).toBe(true);
  });
});

describe('ci.yml E2E layout', () => {
  const ci = readFileSync(path.resolve(__dirname, '../.github/workflows/ci.yml'), 'utf8');
  const job = (id: string) => {
    const m = new RegExp(`\\n  ${id}:\\n([\\s\\S]*?)(?=\\n  [a-z0-9-]+:\\n|$)`).exec(ci);
    return m ? m[1] : '';
  };

  it('splits the app specs over 8 shards, in step with the --shard flag', () => {
    expect(job('e2e')).toMatch(/shard: \[1, 2, 3, 4, 5, 6, 7, 8\]/);
    expect(job('e2e')).toMatch(/--shard=\$\{\{ matrix\.shard \}\}\/8/);
    expect(job('e2e')).toMatch(/name: E2E \(\$\{\{ matrix\.shard \}\}\/8\)/);
  });

  it('runs the app shards and the lifecycles only when the app can be affected', () => {
    for (const id of ['e2e', 'e2e-lifecycles']) {
      expect(job(id)).toMatch(/needs: changes/);
      expect(job(id)).toMatch(/if: needs\.changes\.outputs\.app == 'true'/);
    }
  });

  it('always runs the site specs, in their own job', () => {
    expect(job('e2e-site')).toMatch(/pnpm e2e:site/);
    expect(job('e2e-site')).not.toMatch(/if: needs\.changes/);
    expect(job('e2e')).not.toMatch(/e2e:site/);
  });

  it('has one "E2E" gate that fails unless every E2E job passed or was skipped on purpose', () => {
    const gate = job('e2e-gate');
    expect(gate).toMatch(/name: E2E\n/);
    expect(gate).toMatch(/if: always\(\)/);
    expect(gate).toMatch(/needs: \[changes, e2e, e2e-lifecycles, e2e-site\]/);
    expect(gate).toMatch(/success\|skipped\)/);
    // A failed "changes" job must not pass as "everything skipped".
    expect(gate).toMatch(/needs\.changes\.result/);
  });
});
