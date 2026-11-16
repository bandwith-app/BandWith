import { defineConfig } from '@playwright/test';
import { DEVICE_PROJECTS } from './support/devices';

/**
 * End-to-end suite: the demo-mode web app (in-memory fake backend with the
 * seed in src/lib/demo/seed.ts) on every device profile the app supports.
 *
 * - Full flow set: phone portrait (WebKit) and iPad landscape (WebKit).
 * - Every other profile runs the @smoke tests: layout and privacy checks on
 *   the main screens, as admin and as member.
 *
 * The app is built once in demo mode (`import.meta.env.DEV` must be true,
 * hence NODE_ENV/--mode development) and served by `vite preview`.
 */
const PORT = Number(process.env.E2E_PORT || 4319);
const CI = !!process.env.CI;

export default defineConfig({
  testDir: './specs',
  outputDir: './.results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : CI ? 3 : undefined,
  reporter: CI
    ? [['github'], ['list'], ['html', { open: 'never', outputFolder: './.report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: './.report' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    timezoneId: 'Europe/Rome',
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  // Tags: @smoke runs everywhere; @laptop only on the Duo in Laptop pose
  // (fold checks); untagged tests are the full flow set.
  projects: DEVICE_PROJECTS.map((p) => ({
    name: p.name,
    use: p.use,
    grep: p.full ? undefined : p.name === 'duo-laptop' ? /@smoke|@laptop/ : /@smoke/,
    grepInvert: p.full ? /@laptop/ : undefined,
  })),
  webServer: {
    command:
      `NODE_ENV=development VITE_DEMO_MODE=true vite build --mode development --outDir e2e/.app --emptyOutDir --logLevel warn` +
      ` && vite preview --outDir e2e/.app --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
