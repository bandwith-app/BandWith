import { defineConfig } from '@playwright/test';

/**
 * `pnpm e2e:crawl:report`: rebuilds map.json, findings.md and the diagrams
 * from the runs already in out/runs (no browser, no crawl). The nightly
 * workflow uses it to merge the per-profile artifacts.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'report.spec.ts',
  outputDir: './out/.results',
  reporter: [['list']],
  timeout: 5 * 60_000,
});
