import { test, expect, type App } from '../fixtures';
import { escapeRe, eventDetail, openEvent, SEED } from '../support/flows';
import { hubRow, openHub } from '../support/hub';

/**
 * Migration 182: "Add to calendar" links made before it carried the account's
 * calendar link, so the app asks once to make a new one. The question sits
 * next to Add to calendar in the event and at the top of Settings → Calendar
 * sync, and must fit every device profile (phones, iPad, every Duo
 * posture; app.check measures overflow and the fold band).
 * The demo answers "ask" while localStorage bw-demo-calendar-review = 1.
 */

const askAgain = async (app: App) => {
  await app.page.evaluate(() => localStorage.setItem('bw-demo-calendar-review', '1'));
  await app.editDb(() => undefined); // reloads so the app asks the (demo) server
};

const notice = (app: App) => app.page.getByTestId('calendar-link-review').filter({ visible: true }).first();

async function expectFits(app: App, where: string) {
  const n = notice(app);
  await n.scrollIntoViewIfNeeded();
  await expect(n).toBeVisible();
  await expect(n.getByText(app.t('Check your calendar link'))).toBeVisible();
  for (const name of ['Make a new link', 'Keep my link']) {
    const b = n.getByRole('button', { name: app.t(name), exact: true });
    await b.scrollIntoViewIfNeeded();
    await expect(b, `${where}: ${name}`).toBeInViewport({ ratio: 1 });
  }
  const box = await n.boundingBox();
  const vw = await app.page.evaluate(() => document.documentElement.clientWidth);
  expect(box && box.x >= 0 && box.x + box.width <= vw + 1, `${where}: the notice stays inside the screen`).toBe(true);
  await app.check(where);
}

test.describe('Calendar link made before 182', () => {
  test('@smoke asked in the event, next to Add to calendar; Keep my link ends it', async ({ app }) => {
    await askAgain(app);
    await openEvent(app, SEED.wedding);
    await expect(eventDetail(app).getByTestId('add-to-calendar')).toBeVisible();
    await expectFits(app, 'event: calendar link notice');
    await notice(app).getByRole('button', { name: app.t('Keep my link'), exact: true }).click();
    await expect(app.page.getByTestId('calendar-link-review').filter({ visible: true })).toHaveCount(0);
    await app.check('event: notice gone');
  });

  test('@smoke asked in Settings → Calendar sync; Make a new link says to add it again', async ({ app }) => {
    await askAgain(app);
    await openHub(app);
    await hubRow(app, 'Settings & account').click();
    await app.settle();
    await app.page.getByRole('button', { name: new RegExp(`^${escapeRe(app.t('Calendar sync'))}`) }).filter({ visible: true }).first().click();
    await app.settle();
    await expectFits(app, 'Calendar sync: calendar link notice');
    await notice(app).getByRole('button', { name: app.t('Make a new link'), exact: true }).click();
    await expect(notice(app).getByText(app.t('New link ready'))).toBeVisible();
    await app.check('Calendar sync: new link ready');
  });
});
