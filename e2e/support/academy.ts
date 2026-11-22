import { expect, type Locator } from '@playwright/test';
import type { App } from '../fixtures';

/**
 * The Academy "?" on a screen (AcademyHelpButton): visible inside `scope`.
 * With `open`, tapping it opens the guide at `article`, then Close brings the
 * screen back.
 */
export async function expectHelp(app: App, scope: Locator, article: string, open = false) {
  const help = scope.getByRole('button', { name: app.t('Help for this screen') }).filter({ visible: true }).first();
  await expect(help).toBeVisible();
  if (!open) return;
  await help.click();
  const guide = app.page.getByRole('dialog', { name: app.t('BandWith Academy') });
  await expect(guide.locator('iframe')).toHaveAttribute('src', new RegExp(`#/a/${article}$`));
  await guide.getByRole('button', { name: app.t('Close'), exact: true }).click();
  await expect(guide).toHaveCount(0);
}
