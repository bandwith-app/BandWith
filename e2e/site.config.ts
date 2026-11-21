import { defineConfig, devices } from '@playwright/test';

/**
 * Product site (site/): the static build served by `vite preview`, on a
 * desktop (Chromium) and a phone (WebKit). Specs in e2e/site.
 *
 * The country never comes from a real lookup here: each spec answers
 * /api/geo itself (page.route), the way Vercel's edge function would.
 * Supabase (capacity counter, waitlist) is answered by the specs too.
 */
const PORT = Number(process.env.SITE_E2E_PORT || 5191);
const CI = !!process.env.CI;

export default defineConfig({
  testDir: './site',
  outputDir: './.results-site',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'site-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'site-phone', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command:
      `vite build --config site/vite.config.ts --outDir ../e2e/.site --emptyOutDir --logLevel warn` +
      ` && vite preview --config site/vite.config.ts --outDir ../e2e/.site --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
