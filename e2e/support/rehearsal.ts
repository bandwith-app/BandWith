import { expect } from '@playwright/test';
import type { App } from '../fixtures';

type DemoDB = Record<string, Record<string, unknown>[]>;
type Row = Record<string, any>;

/**
 * Opens the app on demo data changed before the first screen: loads the
 * page once so the demo seeds its database, applies `mutate`, then opens the
 * app as usual (role, pop-ups, settle). Use with `test.use({ autoOpen: false })`.
 * Cheaper than `app.editDb` after `app.open()` (one load less).
 */
export async function openWith(app: App, mutate: (db: Record<string, Row[]>, ids: Ids) => void) {
  const { page } = app;
  await page.goto('/');
  // Wait for the app itself (not just the seed): navigating away while its
  // lazy chunks still load reports "Unable to preload CSS" errors.
  await expect(page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => !!localStorage.getItem('bw-demo-db-v6')), { timeout: 30_000 })
    .toBe(true);
  await page.evaluate(
    ({ fn }) => {
      const k = 'bw-demo-db-v6';
      const db = JSON.parse(localStorage.getItem(k) || '{}');
      const byTitle = (title: string) => db.events.find((e: Row) => e.title === title);
      const byName = (name: string) => db.profiles.find((p: Row) => p.full_name === name);
      // eslint-disable-next-line no-new-func
      new Function('db', 'ids', fn)(db, { me: '10000001-0000-4000-8000-000000000001', byTitle, byName });
      localStorage.setItem(k, JSON.stringify(db));
    },
    { fn: `(${mutate.toString()})(db, ids)` },
  );
  await app.open();
}

export interface Ids {
  me: string;
  byTitle: (title: string) => Row;
  byName: (name: string) => Row;
}

export type { DemoDB };
