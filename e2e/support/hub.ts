import { expect, type Locator } from '@playwright/test';
import type { App } from '../fixtures';
import { escapeRe } from './flows';

/**
 * The Account hub (Settings tab): identity, band, band assets and app
 * settings, and the pages it opens (Gear, Members, Contracts, Pricing…).
 */

/** Settings tab → the Account hub. */
export async function openHub(app: App) {
  await app.tab('Settings');
  await expect(app.page.getByRole('button', { name: app.t('Close Account Hub'), exact: true })).toBeVisible();
}

/** A hub row by the start of its accessible name ("Gear & inventory: 16 items…"). */
export const hubRow = (app: App, source: string): Locator =>
  app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t(source))}`, 'i') }).first();

/** Settings tab → hub → one of its pages. */
export async function openHubPage(app: App, source: string) {
  await openHub(app);
  await hubRow(app, source).click();
  await app.settle();
}

/** The "Go back" of a hub page (top-most one). */
export async function goBack(app: App) {
  await app.page.getByRole('button', { name: app.t('Go back'), exact: true }).last().click();
  await app.settle();
}

/** A filter/category chip by its label, whatever its count or letter case. */
export const chip = (app: App, label: string): Locator =>
  app.page.getByRole('button', { name: new RegExp(`^${escapeRe(label)}(\\s+\\d+)?$`, 'i') });

/**
 * The Chat tab. Its name carries the unread count ("Chat, 2 unread"), so
 * `app.tab('Chat')` (exact name) misses it.
 */
export async function openChatTab(app: App) {
  await app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Chat'))}(,|$)`) }).first().click();
  await app.settle();
}
