import { test, expect, type App } from '../fixtures';
import { escapeRe, SEED, systemBack } from '../support/flows';

/**
 * The urgent pop-up (an unanswered gig invitation) never draws over an open
 * sheet, modal or Stage mode: it steps aside while one is open and comes back
 * when it closes, on every device and Duo posture.
 */

const urgent = (app: App) => app.page.getByRole('alert').filter({ hasText: app.t('Urgent') });

/**
 * The suite closes the pop-up whenever it is in the way, also while the app
 * opens (before the test starts): stop that and open the app again, so the
 * invitation shows up waiting (it is only state: nothing was answered).
 */
async function waitingInvite(app: App) {
  await app.page.removeLocatorHandler(app.page.getByRole('button', { name: app.t('Dismiss alert'), exact: true }));
  await app.page.reload();
  await expect(urgent(app)).toBeVisible({ timeout: 20_000 });
}

async function gigId(app: App): Promise<string> {
  const db = await app.readDb();
  const ev = (db.events as Array<{ id: string; title: string }>).find((e) => e.title === SEED.gigToday);
  if (!ev) throw new Error('seed gig not found');
  return ev.id;
}

test('@smoke the urgent pop-up steps aside for an open sheet and comes back when it closes', async ({ app }) => {
  await waitingInvite(app);

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

test('@smoke system Back with the pop-up waiting closes the sheet, not the hidden pop-up', async ({ app }) => {
  await waitingInvite(app);
  // New chat has no back handler of its own: the app's back chain closes it.
  // Opened while the pop-up waits (its scrim covers the tabs: a programmatic click).
  const chatTab = app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Chat'))}(,|$)`) }).first();
  await chatTab.evaluate((b) => (b as HTMLButtonElement).click());
  await app.settle();
  await app.page.evaluate(() => window.dispatchEvent(new CustomEvent('bw:new-chat')));
  const sheet = app.page.getByRole('dialog', { name: app.t('New chat'), exact: true });
  await expect(sheet).toBeVisible();
  await expect(urgent(app)).toHaveCount(0);

  await systemBack(app);
  await expect(sheet).toBeHidden();
  // The pop-up was only waiting: it is back once the sheet is gone.
  await expect(urgent(app)).toBeVisible({ timeout: 10_000 });
  await app.check('sheet closed by Back, urgent pop-up back');
  // Shown on its own, Back closes it as before.
  await systemBack(app);
  await expect(urgent(app)).toHaveCount(0);
});

for (const w of [
  { item: 'New gig', close: 'Close gig wizard', field: 'New gig' },
  { item: 'New quote', close: 'Close quote wizard', field: 'Client full name' },
]) {
  test(`@smoke the urgent pop-up waits while the ${w.item === 'New gig' ? 'gig editor' : 'quote wizard'} is open`, async ({ app }) => {
    await waitingInvite(app);
    // Create (+) under the pop-up's scrim: a programmatic click; the menu is a sheet, so the pop-up steps aside.
    const create = app.page.getByRole('button', { name: app.t('Create'), exact: true }).first();
    await create.evaluate((b) => (b as HTMLButtonElement).click());
    const menu = app.page.getByRole('dialog').last();
    await menu.getByRole('button', { name: new RegExp(`^${escapeRe(app.t(w.item))}`, 'i') }).first().click();
    await app.settle();
    // The editor is open (the menu has closed): the pop-up still waits, nothing covers the form.
    const field = app.page
      .getByPlaceholder(app.t(w.field))
      .or(app.page.getByRole('textbox', { name: app.t(w.field), exact: true }))
      .filter({ visible: true })
      .first();
    await expect(field).toBeVisible();
    await expect(urgent(app)).toHaveCount(0);
    await field.click({ timeout: 3_000 });
    await app.check(`${w.item} open, urgent pop-up waiting`);

    // Closed (untouched: it just closes): the pop-up is back.
    // ✕ on phones; Cancel where the wizard sits beside its preview (Duo book, iPad).
    await app.page
      .getByRole('button', { name: app.t(w.close), exact: true })
      .or(app.page.getByRole('button', { name: app.t('Cancel'), exact: true }))
      .filter({ visible: true })
      .first()
      .click();
    await expect(urgent(app)).toBeVisible({ timeout: 10_000 });
  });
}

test('Stage mode keeps the stage: the urgent pop-up waits until Stage closes', async ({ app }) => {
  test.skip(test.info().project.name === 'duo-laptop', 'laptop posture: Stage controls live on the Deck');
  await waitingInvite(app);
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
