import { test, expect, type App } from '../fixtures';
import { openChatTab } from '../support/hub';

/**
 * A message sent with no connection waits as a bubble ("Waiting for
 * connection") while a new draft is in the composer, and goes out by itself
 * once back online (main, #291 r4). Its Try again and Delete must be real
 * touch targets (at least 44 × 44 px, Claude review #291 r4).
 */

const composer = (app: App) => app.page.getByRole('textbox', { name: app.t('Message') });

test.describe('a message that was not sent', () => {
  test.use({ role: 'admin' });

  test('a waiting message: Try again and Delete are 44 px targets, and it is sent once back online @smoke', async ({ app }) => {
    const { page } = app;
    await openChatTab(app);
    await page.getByRole('button', { name: /^Velvet Static(,|$)/ }).first().click();
    await expect(composer(app)).toBeVisible();

    const text = 'Load-in moved to 5:30 at the side door';
    // The chat checks who may write when it opens: let it answer online.
    await expect(page.getByText('+1, then straight into September').first()).toBeVisible();
    await app.settle();

    // Offline: the message waits as a bubble ("Waiting for connection") with
    // Try again and Delete, while the next draft is typed.
    const bubble = page.getByRole('button', { name: new RegExp(`^${app.t('Try again')}: Load-in moved`) });
    await page.context().setOffline(true);
    await composer(app).fill(text);
    await page.getByRole('button', { name: app.t('Send message'), exact: true }).click();
    await composer(app).fill('next draft');
    await expect(bubble).toBeVisible();
    await expect(page.getByText(app.t('Waiting for connection'))).toBeVisible();

    const tryAgain = bubble;
    const del = page.getByRole('button', { name: new RegExp(`^${app.t('Delete unsent message: {text}').replace('{text}', '')}`) });
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
    await app.check('Waiting bubble');

    // Back online: it goes out by itself, once; the draft stays.
    await page.context().setOffline(false);
    await expect(page.getByText(app.t('Waiting for connection'))).toHaveCount(0);
    await expect(page.getByText(app.t('Not sent'))).toHaveCount(0);
    await expect(page.getByText(text)).toHaveCount(1);
    await expect(composer(app)).toHaveValue('next draft');
  });

  // Main (#291 r4): offline the chat fails open. Nothing kept on this device
  // yet: the composer shows, and the message waits for the network.
  test('opened offline, the chat still takes a message and sends it once back online', async ({ app }) => {
    const { page } = app;
    await openChatTab(app);
    const row = page.getByRole('button', { name: /^Velvet Static(,|$)/ }).first();
    await expect(row).toBeVisible();
    await app.settle();
    await page.context().setOffline(true);
    await row.click();
    await expect(composer(app)).toBeVisible();
    await expect(page.getByText(app.t('You can only message in bands you are an active member of.'))).toHaveCount(0);

    const text = 'Parking is behind the venue';
    await composer(app).fill(text);
    await page.getByRole('button', { name: app.t('Send message'), exact: true }).click();
    await expect(page.getByText(app.t('Waiting for connection'))).toBeVisible();
    await page.context().setOffline(false);
    await expect(page.getByText(app.t('Waiting for connection'))).toHaveCount(0);
    await expect(page.getByText(text)).toHaveCount(1);
  });

  // Main (#291 r4): the text is kept on the device. Closed offline, the
  // chat's message is sent with the chat closed once back online, once.
  test('closed offline, the waiting message is sent with the chat closed, once', async ({ app }) => {
    const { page } = app;
    await openChatTab(app);
    const row = page.getByRole('button', { name: /^Velvet Static(,|$)/ }).first();
    await row.click();
    await expect(composer(app)).toBeVisible();
    await expect(page.getByText('+1, then straight into September').first()).toBeVisible();
    await app.settle();

    const text = 'Doors moved to 7:30';
    await page.context().setOffline(true);
    await composer(app).fill(text);
    await page.getByRole('button', { name: app.t('Send message'), exact: true }).click();
    await expect(page.getByText(app.t('Waiting for connection'))).toBeVisible();
    await page.getByRole('button', { name: app.t('Back'), exact: true }).first().click();
    await expect(composer(app)).toHaveCount(0);

    await page.context().setOffline(false);
    await app.settle();
    await row.click();
    await expect(page.getByText(text)).toHaveCount(1);
    await expect(page.getByText(app.t('Waiting for connection'))).toHaveCount(0);
  });
});
