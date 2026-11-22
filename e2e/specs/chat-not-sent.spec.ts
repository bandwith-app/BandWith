import { test, expect, type App } from '../fixtures';
import { openChatTab } from '../support/hub';

/**
 * A message that could not be sent (offline) stays as a "Not sent" bubble
 * while a new draft is in the composer. Its Try again and Delete must be
 * real touch targets (at least 44 × 44 px, Claude review #291 r4), and Try
 * again saves it once.
 */

const composer = (app: App) => app.page.getByRole('textbox', { name: app.t('Message') });

test.describe('a message that was not sent', () => {
  test.use({ role: 'admin' });

  test('Try again and Delete are 44 px targets, and Try again saves it once @smoke', async ({ app }) => {
    const { page } = app;
    await openChatTab(app);
    await page.getByRole('button', { name: /^Velvet Static(,|$)/ }).first().click();
    await expect(composer(app)).toBeVisible();

    const text = 'Load-in moved to 5:30 at the side door';
    // The chat checks who may write when it opens: let that finish online
    // (offline it fails closed and hides the composer).
    await expect(page.getByText('+1, then straight into September').first()).toBeVisible();
    await app.settle();

    // Offline: the send fails; typing the next draft right away keeps the
    // failed message as a bubble (an empty composer would get it back).
    const bubble = page.getByRole('button', { name: new RegExp(`^${app.t('Try again')}: Load-in moved`) });
    await page.context().setOffline(true);
    for (let attempt = 0; attempt < 5; attempt++) {
      await composer(app).fill(text);
      await page.getByRole('button', { name: app.t('Send message'), exact: true }).click();
      await composer(app).fill('next draft');
      if (await bubble.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) break;
    }
    await page.context().setOffline(false);

    const tryAgain = page.getByRole('button', { name: new RegExp(`^${app.t('Try again')}: Load-in moved`) });
    const del = page.getByRole('button', { name: new RegExp(`^${app.t('Delete unsent message: {text}').replace('{text}', '')}`) });
    await expect(tryAgain).toBeVisible();
    await expect(del).toBeVisible();
    for (const [label, target] of [['Try again', tryAgain], ['Delete', del]] as const) {
      const box = await target.boundingBox();
      expect(box, label).not.toBeNull();
      // 44 CSS px (a scaled viewport reports 43.99998).
      expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(43.9);
      expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(43.9);
    }
    // The two targets don't overlap.
    const a = (await tryAgain.boundingBox())!;
    const b = (await del.boundingBox())!;
    const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(overlap, 'Try again and Delete overlap').toBe(false);
    await app.check('Not sent bubble');

    await tryAgain.click();
    await expect(page.getByText(app.t('Not sent'))).toHaveCount(0);
    await expect(page.getByText(text)).toHaveCount(1);
    await expect(composer(app)).toHaveValue('next draft');
  });
});
