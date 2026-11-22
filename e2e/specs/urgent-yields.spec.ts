import { test, expect, type App } from '../fixtures';
import { escapeRe, SEED } from '../support/flows';

/**
 * The urgent pop-up (an unanswered gig invitation) never draws over an open
 * sheet, modal or Stage mode: it steps aside while one is open and comes back
 * when it closes, on every device and Duo posture.
 */

const urgent = (app: App) => app.page.getByRole('alert').filter({ hasText: app.t('Urgent') });

async function gigId(app: App): Promise<string> {
  const db = await app.readDb();
  const ev = (db.events as Array<{ id: string; title: string }>).find((e) => e.title === SEED.gigToday);
  if (!ev) throw new Error('seed gig not found');
  return ev.id;
}

test('@smoke the urgent pop-up steps aside for an open sheet and comes back when it closes', async ({ app }) => {
  // The suite closes the pop-up whenever it is in the way: not here.
  await app.page.removeLocatorHandler(app.page.getByRole('button', { name: app.t('Dismiss alert'), exact: true }));
  await expect(urgent(app)).toBeVisible({ timeout: 15_000 });

  // A sheet opens on its own (the "setlist ready without signal" push).
  const id = await gigId(app);
  await app.page.evaluate((eventId) => {
    window.dispatchEvent(new CustomEvent('push-navigate', { detail: { screen: 'event', eventId, livePack: true } }));
  }, id);
  const sheet = app.page.getByRole('dialog', { name: new RegExp(escapeRe(app.t('Have the setlist with you, even without signal.'))) });
  await expect(sheet).toBeVisible();
  await expect(urgent(app)).toHaveCount(0);
  await app.check('sheet open, urgent pop-up out of the way');

  // Closed: the pop-up is back.
  await sheet.getByRole('button', { name: app.t('Not now'), exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(urgent(app)).toBeVisible({ timeout: 10_000 });
});

test('Stage mode keeps the stage: the urgent pop-up waits until Stage closes', async ({ app }) => {
  test.skip(test.info().project.name === 'duo-laptop', 'laptop posture: Stage controls live on the Deck');
  await app.page.removeLocatorHandler(app.page.getByRole('button', { name: app.t('Dismiss alert'), exact: true }));
  await expect(urgent(app)).toBeVisible({ timeout: 15_000 });
  const id = await gigId(app);
  await app.page.evaluate((eventId) => {
    window.dispatchEvent(new CustomEvent('push-navigate', { detail: { screen: 'event', eventId } }));
  }, id);
  // Stage opened while the pop-up waits (as from a push or the other screen).
  const open = app.page.getByRole('button', { name: app.t('Open stage mode'), exact: true }).first();
  await expect(open).toBeAttached();
  await open.evaluate((b) => (b as HTMLButtonElement).click());
  const stage = app.page.getByRole('dialog', { name: app.t('Stage mode: {title}', { title: SEED.gigToday }) });
  await expect(stage).toBeAttached();
  await expect(urgent(app)).toHaveCount(0);
  await app.check('Stage open, urgent pop-up waiting');

  await app.page.keyboard.press('Escape');
  await expect(stage).toHaveCount(0);
  await expect(urgent(app)).toBeVisible({ timeout: 10_000 });
});
