import type { Locator } from '@playwright/test';
import { test, expect, type App } from '../fixtures';

/**
 * iPhone Duo: the rail's "Open profile" shows the Account hub on top of
 * whatever was open, in every posture that has the rail.
 *
 * Seen on the EV Duo simulator (1.0.6 gate, Laptop): from the inbox (the
 * list or a notification) and from Calendar's "Search events", "Open
 * profile" opened the hub (z-60) under the layer (inbox z-101, search z-70),
 * which stayed on screen, so the hub could not be seen or used.
 */

const railProfile = (app: App): Locator =>
  app.page.locator('.bw-duo-rail').getByRole('button', { name: new RegExp(`(^|, )${app.t('Open profile')}$`) });

const whoYouAre = (app: App): Locator =>
  app.page.getByRole('heading', { name: app.t('Who you are'), exact: true }).filter({ visible: true }).first();

/** The element is the top-most thing at its own centre. */
async function expectOnTop(el: Locator, what: string) {
  await expect(el).toBeVisible();
  const top = await el.evaluate((e) => {
    const r = e.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: !!t && (t === e || e.contains(t)), what: t ? `${t.tagName}.${(t as HTMLElement).className}`.slice(0, 120) : 'nothing' };
  });
  expect(top.ok, `${what} is covered by ${top.what}`).toBe(true);
}

async function openProfileFromRail(app: App) {
  await expect(railProfile(app)).toBeVisible();
  await railProfile(app).click();
  await app.settle();
  await expectOnTop(whoYouAre(app), 'the Account hub ("Who you are")');
}

async function openInbox(app: App) {
  await app.tab('Home');
  await app.page.getByRole('button', { name: new RegExp(`^${app.t('Notifications')}, \\d`) }).filter({ visible: true }).first().click();
  await expect(app.page.getByRole('heading', { name: app.t('Inbox'), exact: true })).toBeVisible();
  await app.settle();
}

test.describe('Duo rail: Open profile puts the Account hub on top', () => {
  test.beforeEach(async ({ duo }) => {
    test.skip(!duo, 'the rail is on the iPhone Duo only');
  });

  test('@smoke from the inbox', async ({ app }) => {
    await openInbox(app);
    await openProfileFromRail(app);
    await expect(app.page.getByRole('heading', { name: app.t('Inbox'), exact: true })).toBeHidden();
    await app.check('Account hub from the inbox');
  });

  test('@smoke from a notification', async ({ app }) => {
    await openInbox(app);
    // A notification's detail: its own page, or (Book) the page beside the list.
    const detail = app.page.getByRole('button', { name: app.t('Delete notification'), exact: true }).filter({ visible: true });
    // A gig invitation opens its detail page (the others open their screen).
    const rows = app.page.locator('ul li button').filter({ visible: true });
    const n = await rows.count();
    for (let i = 0; i < n && !(await detail.count()); i++) {
      const name = (await rows.nth(i).innerText()).toLowerCase();
      if (!/invit/.test(name)) continue;
      await rows.nth(i).click();
      await app.settle();
    }
    await expect(detail.first()).toBeVisible();
    await openProfileFromRail(app);
    await expect(detail).toHaveCount(0);
    await app.check('Account hub from a notification');
  });

  test('@smoke from Calendar search', async ({ app }) => {
    await app.tab('Calendar');
    await app.page.getByRole('button', { name: app.t('Search events'), exact: true }).filter({ visible: true }).first().click();
    const search = app.page.getByRole('dialog', { name: app.t('Search events') });
    await expect(search).toBeVisible();
    await openProfileFromRail(app);
    await expect(search).toBeHidden();
    await app.check('Account hub from Calendar search');
  });
});
