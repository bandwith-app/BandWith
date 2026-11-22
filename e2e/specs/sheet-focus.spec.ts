import { test, expect, type App } from '../fixtures';
import { isWide, openCreate } from '../support/flows';
import type { Locator } from '@playwright/test';

/**
 * Keyboard focus in modal layers (src/lib/focusTrap.ts): while a sheet or
 * the iPad composer is open, Tab and Shift+Tab cycle inside it and never
 * reach the controls behind the scrim.
 */

const focusInside = (layer: Locator) => layer.evaluate((el) => el.contains(document.activeElement));

async function cycle(app: App, layer: Locator, key: 'Tab' | 'Shift+Tab', presses: number) {
  for (let i = 0; i < presses; i++) {
    await app.page.keyboard.press(key);
    expect(await focusInside(layer), `${key} #${i + 1} stays in the layer`).toBe(true);
  }
}

const tabStops = (layer: Locator) =>
  layer.evaluate(
    (el) =>
      el.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')
        .length,
  );

test('@smoke Tab and Shift+Tab stay inside the Create sheet', async ({ app }) => {
  await app.tab('Create');
  const sheet = app.page.getByRole('dialog').last();
  await expect(sheet).toBeVisible();
  await expect.poll(() => focusInside(sheet), 'focus moves into the sheet').toBe(true);
  const stops = await tabStops(sheet);
  // From the start of the sheet backwards (the audit's path), then forwards past the end.
  await cycle(app, sheet, 'Shift+Tab', stops + 2);
  await cycle(app, sheet, 'Tab', stops + 2);
  await app.page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});

test('@smoke Tab stays inside the iPad composer', async ({ app }) => {
  test.skip(!(await isWide(app)), 'the composer is the tablet layout');
  await openCreate(app, 'New gig');
  const composer = app.page.locator('[data-bw-composer]').last();
  await expect(composer).toBeVisible();
  await expect.poll(() => focusInside(composer), 'focus moves into the composer').toBe(true);
  // A few laps past both ends.
  const stops = Math.min(await tabStops(composer), 60);
  await cycle(app, composer, 'Shift+Tab', 4);
  await cycle(app, composer, 'Tab', stops + 2);
});

test('@smoke iPad composer: Rider & stage → Edit list from the keyboard opens an editor focus can reach', async ({ app }) => {
  test.skip(!(await isWide(app)), 'the composer is the tablet layout');
  await openCreate(app, 'New gig');
  const composer = app.page.locator('[data-bw-composer]').last();
  await expect(composer).toBeVisible();
  // Keyboard only: focus the button, press Enter.
  const riderButton = composer.getByRole('button', { name: new RegExp(`^${app.t('Rider & stage')}`) }).first();
  await riderButton.focus();
  await app.page.keyboard.press('Enter');
  const sheet = app.page.getByRole('dialog').filter({ hasText: app.t('Rider & stage') }).last();
  await expect(sheet).toBeVisible();
  await expect.poll(() => focusInside(sheet)).toBe(true);
  const editList = sheet.getByRole('button', { name: app.t('EDIT LIST') }).first();
  await editList.focus();
  await app.page.keyboard.press('Enter');
  const editor = app.page.getByRole('dialog', { name: app.t('Edit input list') });
  await expect(editor).toBeVisible();
  await expect.poll(() => focusInside(editor), 'focus moves into the editor').toBe(true);
  await cycle(app, editor, 'Tab', (await tabStops(editor)) + 2);
  await cycle(app, editor, 'Shift+Tab', 4);
});
