import { defineConfig } from '@playwright/test';
import { DEVICE_PROJECTS } from '../support/devices';

/**
 * Screen-map crawler (`pnpm e2e:crawl`): NOT part of the required CI suite.
 * One Playwright test per role, one project per device profile; each test
 * crawls the demo app as that role on that device and writes
 * out/runs/<role>__<profile>.json. The global teardown merges every run into
 * out/map.json, out/findings.md and the Mermaid diagrams.
 *
 * Env:
 *   CRAWL_PROFILES  phone-portrait,ipad-landscape,duo-laptop,duo-book (default)
 *   CRAWL_ROLES     admin,member,deputy,noband,signedout,client (default)
 *   CRAWL_MINUTES   time budget per role × profile, every role
 *   CRAWL_MINUTES_APP  the same for admin and member only (default 12; others 4)
 *   CRAWL_DEPTH     max clicks from a root (default 4)
 *   CRAWL_CLICKS    max clicks per state (default 30)
 *   CRAWL_FRESH=1   start over instead of resuming unfinished runs
 *   CRAWL_STRICT=1  reload + replay before every click
 *   CRAWL_DOCS=1    also refresh docs/screen-map from this run
 *   CRAWL_VERBOSE=1 log every state and click
 *   E2E_WORKERS     parallel crawls (default 2)
 */
const PORT = Number(process.env.E2E_PORT || 4319);
const CI = !!process.env.CI;
const PROFILES = (process.env.CRAWL_PROFILES || 'phone-portrait,ipad-landscape,duo-laptop,duo-book').split(',');

export default defineConfig({
  testDir: '.',
  testMatch: 'crawl.spec.ts',
  outputDir: './out/.results',
  // Each test has its own time budget; this is only the hard stop.
  timeout: 90 * 60_000,
  fullyParallel: true,
  retries: 0,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 2,
  reporter: [['list']],
  globalTeardown: './teardown.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    timezoneId: 'Europe/Rome',
    locale: 'en-US',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'off',
    screenshot: 'off',
  },
  projects: DEVICE_PROJECTS.filter((p) => PROFILES.includes(p.name)).map((p) => ({ name: p.name, use: p.use })),
  webServer: {
    command:
      `NODE_ENV=development VITE_DEMO_MODE=true vite build --mode development --outDir e2e/.app --emptyOutDir --logLevel warn` +
      ` && vite preview --outDir e2e/.app --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: '../..',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
