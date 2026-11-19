import { test, expect, DB_KEY } from '../fixtures';

/**
 * Minimum version (paid plans P4, migration 162). The demo answers
 * bw_app_version from its own app_versions rows. In the browser the platform
 * is the web, compared with the bundle's build stamp (VITE_WEB_BUILD).
 */
const screen = (app: { page: import('@playwright/test').Page }) => app.page.getByTestId('update-required');

test.describe('Minimum version', () => {
  test('@smoke no minimum written: the app runs as always', async ({ app }) => {
    await expect(screen(app)).toHaveCount(0);
    await app.check('Home, no minimum');
  });

  test('@smoke below the minimum: "Update BandWith", with Reload and Sign out', async ({ app }) => {
    // Not app.editDb: it waits for Home, which this screen hides on purpose.
    const db = await app.readDb();
    (db as Record<string, unknown>).app_versions = [{ platform: 'web', min_version: '999912312359' }];
    // The one automatic reload of the web is marked done: reloading in the
    // middle of a lazy chunk aborts its CSS preload, which the fixture counts.
    await app.page.evaluate(({ k, v }) => {
      localStorage.setItem(k, v);
      sessionStorage.setItem('bw-min-reloaded:999912312359', '1');
    }, { k: DB_KEY, v: JSON.stringify(db) });
    await app.page.reload();
    await expect(screen(app)).toBeVisible({ timeout: 20_000 });
    await expect(screen(app).getByRole('heading', { name: app.t('Update BandWith') })).toBeVisible();
    await expect(screen(app).getByRole('button', { name: app.t('Reload') })).toBeVisible();
    await expect(screen(app).getByRole('button', { name: app.t('Sign out') })).toBeVisible();
    await app.check('Update BandWith');
  });

  test('a newer version only (latest, no minimum): never blocks', async ({ app }) => {
    await app.editDb((db) => {
      db.app_versions = [{ platform: 'web', latest_version: '999912312359' }];
    });
    await app.settle();
    await expect(screen(app)).toHaveCount(0);
  });
});
