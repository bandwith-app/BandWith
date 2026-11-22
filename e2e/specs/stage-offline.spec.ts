import { test, expect, type App } from '../fixtures';
import { openEvent, eventDetail, SEED } from '../support/flows';

/**
 * Live mode with no signal (plan docs/plans/live-offline-and-tempo.md §3):
 * an event opened once with internet keeps its setlist on the device (the
 * live pack). With the network gone, the event still shows its songs, Stage
 * mode opens with them and says where they come from ("Offline · content
 * from …"). The demo backend fails every request while the browser is
 * offline (dev builds), like the real one.
 */

const isLaptop = () => test.info().project.name === 'duo-laptop';

const prefix = (app: App, source: string) => app.t(source, { time: '§' }).split('§')[0];

const stageDialog = (app: App) => app.page.getByRole('dialog', { name: app.t('Stage mode: {title}', { title: SEED.gigToday }) });

async function closeEvent(app: App) {
  await app.button('Back', { exact: true }).filter({ visible: true }).first().click();
  await app.settle();
}

/**
 * At the venue, no signal: phones go Home → "Go live" on the next gig. Wide
 * layouts (iPad, Duo book/laptop) keep the gig open in its pane, or open it
 * again from Search, and start Stage mode from there.
 */
async function reopenOffline(app: App) {
  await app.tab('Home');
  const goLive = app.button('Go live', { exact: true }).first();
  if (await goLive.click({ trial: true, timeout: 2500 }).then(() => true, () => false)) {
    await goLive.click();
    return;
  }
  const open = await eventDetail(app).getByText(SEED.gigToday).first().isVisible().catch(() => false);
  if (!open) {
    await app.page.keyboard.press('Escape');
    await app.settle();
    await openEvent(app, SEED.gigToday);
  }
  await app.button('Open stage mode', { exact: true }).first().click();
}

for (const role of ['admin', 'member'] as const) {
  test.describe(`Stage offline as ${role}`, () => {
    test.use({ role });

    test(`@smoke ${role}: a gig opened online keeps its setlist; offline, Stage mode opens with it and says so`, async ({ app, context }) => {
      test.slow();
      // Online: the gig's songs come down with the event.
      await openEvent(app, SEED.gigToday);
      const detail = eventDetail(app);
      await expect(detail.getByText(prefix(app, 'Offline ready · updated {time}'), { exact: false }).first()).toBeAttached();
      await closeEvent(app);

      // The network goes away (a venue with no signal).
      await context.setOffline(true);
      await reopenOffline(app);
      await expect(stageDialog(app)).toBeAttached();
      await app.settle();

      if (!isLaptop()) {
        const stage = stageDialog(app);
        // The kept songs, not "the setlist couldn't be loaded".
        await expect(stage.getByText(app.t('Offline: the setlist couldn’t be loaded.'))).toHaveCount(0);
        await expect(stage.getByText(prefix(app, 'Offline · content from {time}'), { exact: false })).toBeVisible();
        await expect(stage.getByRole('status').filter({ hasText: prefix(app, 'Offline · content from {time}') })).toBeVisible();
      } else {
        await expect(app.page.getByRole('region', { name: app.t('Song controls') })).toBeVisible();
      }
      await app.check('stage offline from the live pack');
      await context.setOffline(false);
    });
  });
}

test.describe('Stage offline without a pack', () => {
  test('@smoke never opened before: offline, Stage mode says the setlist could not be loaded', async ({ app, context }) => {
    // Nothing kept yet: the network goes before the gig is ever opened.
    await context.setOffline(true);
    await openEvent(app, SEED.wedding);
    await app.button('Open stage mode', { exact: true }).first().click();
    await app.settle();
    if (!isLaptop()) {
      const stage = app.page.getByRole('dialog', { name: app.t('Stage mode: {title}', { title: SEED.wedding }) });
      await expect(stage.getByText(app.t('Offline: the setlist couldn’t be loaded.'))).toBeVisible();
      await expect(stage.getByText(prefix(app, 'Offline · content from {time}'), { exact: false })).toHaveCount(0);
    }
    await context.setOffline(false);
  });
});
