import { test, expect, type App } from '../fixtures';
import type { Locator } from '@playwright/test';
import { escapeRe, eventDetail, openEvent, SEED, systemBack } from '../support/flows';
import { hubRow, openHub, openChatTab } from '../support/hub';

/**
 * Every layer closes with system Back (Android Back / Escape) and with its
 * own Back or ✕, landing on the screen it was opened from. Never a dead end,
 * never two layers closed at once.
 */

interface Layer {
  name: string;
  open: (app: App) => Promise<void>;
  /** Visible while the layer is open. */
  marker: (app: App) => Locator;
  /** Visible again once it closed. */
  under: (app: App) => Locator;
  /** The layer's own close/back control. */
  close: (app: App) => Locator;
  smoke?: boolean;
}

const homeTab = (app: App) => app.page.getByRole('button', { name: app.t('Home'), exact: true }).first();
const calendarHeading = (app: App) => app.page.getByRole('heading', { name: app.t('Calendar'), exact: true }).first();

const LAYERS: Layer[] = [
  {
    name: 'notifications',
    smoke: true,
    open: (app) => app.page.getByRole('button', { name: new RegExp(`^${app.t('Notifications')} \\(`) }).first().click(),
    marker: (app) => app.page.getByRole('button', { name: app.t('Close notifications'), exact: true }).first(),
    under: (app) => app.page.getByText(SEED.gigToday, { exact: false }).first(),
    close: (app) => app.page.getByRole('button', { name: app.t('Close notifications'), exact: true }).first(),
  },
  {
    name: 'Create menu',
    smoke: true,
    open: (app) => app.tab('Create'),
    marker: (app) => app.page.getByRole('dialog').last().getByRole('button', { name: new RegExp(`^${app.t('New gig')}`, 'i') }).first(),
    under: homeTab,
    close: (app) =>
      app.page
        .getByRole('button', { name: app.t('Close create menu'), exact: true })
        .or(app.page.getByRole('dialog').last().getByRole('button', { name: app.t('Close'), exact: true }))
        .filter({ visible: true })
        .first(),
  },
  {
    name: 'calendar search',
    open: async (app) => {
      await app.tab('Calendar');
      await app.page.getByRole('button', { name: app.t('Search events'), exact: true }).filter({ visible: true }).first().click();
    },
    marker: (app) => app.page.getByPlaceholder(app.t('Search title, venue, city, client…')).filter({ visible: true }).first(),
    under: calendarHeading,
    close: (app) => app.page.getByRole('button', { name: app.t('Close search'), exact: true }).filter({ visible: true }).first(),
  },
  {
    name: 'gig detail',
    smoke: true,
    open: (app) => openEvent(app, SEED.gigToday),
    marker: (app) => eventDetail(app),
    under: calendarHeading,
    close: (app) => app.page.getByRole('button', { name: app.t('Back'), exact: true }).filter({ visible: true }).last(),
  },
  {
    name: 'Account hub → Gear',
    open: async (app) => {
      await openHub(app);
      await hubRow(app, 'Gear & inventory').click();
      await app.settle();
    },
    marker: (app) => app.page.getByRole('button', { name: app.t('Add equipment'), exact: true }).first(),
    under: (app) => hubRow(app, 'Gear & inventory'),
    close: (app) =>
      app.page
        .getByRole('button', { name: app.t('Go back'), exact: true })
        .or(app.page.getByRole('button', { name: app.t('Back'), exact: true }))
        .filter({ visible: true })
        .last(),
  },
  {
    name: 'band chat',
    open: async (app) => {
      await openChatTab(app);
      await app.page.getByRole('button', { name: /^Velvet Static(,|$)/ }).first().click();
      await app.settle();
    },
    marker: (app) => app.page.getByRole('textbox', { name: app.t('Message') }),
    under: (app) => app.page.getByRole('button', { name: /^Velvet Static(,|$)/ }).first(),
    close: (app) => app.page.getByRole('button', { name: app.t('Back'), exact: true }).filter({ visible: true }).last(),
  },
];

for (const layer of LAYERS) {
  test.describe(layer.name, () => {
    test(`${layer.smoke ? '@smoke ' : ''}system Back closes it`, async ({ app }) => {
      await layer.open(app);
      await expect(layer.marker(app)).toBeVisible();
      await app.check(`${layer.name} open`);
      await systemBack(app);
      await expect(layer.marker(app)).toBeHidden();
      await expect(layer.under(app)).toBeVisible();
    });

    test('its own Back / ✕ closes it', async ({ app }) => {
      await layer.open(app);
      await expect(layer.marker(app)).toBeVisible();
      await layer.close(app).click();
      await app.settle();
      await expect(layer.marker(app)).toBeHidden();
      await expect(layer.under(app)).toBeVisible();
    });
  });
}

test.describe('inbox opened as Home loads', () => {
  test.use({ autoOpen: false });

  test('@smoke no gig opens behind the inbox, and Back (the Duo rail\'s too) closes the inbox', async ({ app }) => {
    const { page } = app;
    await page.goto('/');
    const bellName = `${app.t('Notifications')} (`;
    await expect(page.getByRole('button', { name: new RegExp(`^${escapeRe(bellName)}`) }).filter({ visible: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    // Tap the bell the moment it shows (on the open Duo, Home may not have
    // opened its next gig beside the dashboard yet), and note in the same
    // tick whether a gig was open already.
    const gigBefore = await page.evaluate((prefix) => {
      const had = !!document.querySelector('.bw-event-detail');
      const bell = [...document.querySelectorAll<HTMLElement>('button[aria-label]')].find((b) => {
        const r = b.getBoundingClientRect();
        return (b.getAttribute('aria-label') || '').startsWith(prefix) && r.width > 0 && r.height > 0;
      });
      bell?.click();
      return had;
    }, bellName);
    const inbox = page.getByRole('heading', { name: app.t('Inbox'), exact: true });
    await expect(inbox).toBeVisible();
    await expect(page.getByText(/Vote on rehearsal dates/i).first()).toBeVisible();
    // Home's events have arrived under the inbox (its gig card is there).
    await expect(page.getByText(SEED.gigToday, { exact: false }).first()).toBeAttached();
    await app.settle();
    if (!gigBefore) await expect(page.locator('.bw-event-detail')).toHaveCount(0);

    // The Duo rail's Back (Laptop pose: on the Deck), else system Back.
    const rail = page.getByRole('toolbar', { name: app.t('Screen actions, search and profile') });
    if (await rail.isVisible()) await rail.getByRole('button').first().click();
    else await systemBack(app);
    await app.settle();
    await expect(inbox).toBeHidden();
    // Two pages: the next gig shows beside Home once the inbox is closed.
    const twoPane = await page.evaluate(() => document.documentElement.hasAttribute('data-bw-two-pane'));
    if (twoPane) await expect(eventDetail(app)).toBeVisible();
    await app.check('Home after closing the inbox');
  });
});
