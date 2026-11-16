import { test, expect, type App } from '../fixtures';
import type { Locator } from '@playwright/test';
import { eventDetail, openEvent, SEED, systemBack } from '../support/flows';
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
