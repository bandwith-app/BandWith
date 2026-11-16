import { test, expect, type App } from '../fixtures';
import { openEvent, eventDetail, back, SEED } from '../support/flows';
import { openWith } from '../support/rehearsal';

/**
 * Rider & stage (#177): a gig's rider, stage plot and input list. On phones
 * (and the Duo) it is its own screen opened from the gig overview; on
 * tablets it is a tab of the gig workspace.
 */

const isWide = (app: App) => app.page.evaluate(() => document.documentElement.hasAttribute('data-bw-wide'));

/** Opens Rider & stage of the gig on screen: the screen on phones, the tab on tablets. */
async function openRiderStage(app: App) {
  if (await isWide(app)) {
    await app.page.getByRole('tab', { name: app.t('RIDER & STAGE') }).click();
    await expect(app.page.getByRole('tab', { name: app.t('RIDER & STAGE') })).toHaveAttribute('aria-selected', 'true');
  } else {
    await eventDetail(app).getByRole('button', { name: `${app.t('OPEN')}: ${app.t('RIDER & STAGE')}` }).click();
    await expect(riderScreen(app)).toBeVisible();
  }
  await app.settle();
}

/** Back to the gig overview: Back on phones, the Overview tab on tablets. */
async function closeRiderStage(app: App) {
  if (await isWide(app)) await app.page.getByRole('tab', { name: app.t('OVERVIEW') }).click();
  else await back(app);
  await app.settle();
}

/** The Rider & stage screen: a layer on phones, a pane (region) in Duo Laptop pose. */
const riderScreen = (app: App) =>
  app.page
    .getByRole('dialog', { name: app.t('Rider & stage') })
    .or(app.page.getByRole('region', { name: app.t('Rider & stage'), exact: true }))
    .first();

/** The gig overview is the screen in front again (hero edit pencil / stage mode button). */
async function expectGigOverview(app: App, title: string) {
  await expect(riderScreen(app)).toHaveCount(0);
  await expect(eventDetail(app)).toBeVisible();
  await expect(eventDetail(app).getByText(title).first()).toBeVisible();
  await expect(app.page.getByRole('button', { name: app.t('Open stage mode') })).toBeVisible();
}

/** Text of the rider screen (phone) or the gig workspace (tablet). */
const riderText = async (app: App) =>
  (await riderScreen(app).count()) ? riderScreen(app).innerText() : eventDetail(app).innerText();

test.describe('Rider & stage as admin', () => {
  test('Back and Escape return to the gig, also from the input-list editor', async ({ app }) => {
    await openEvent(app, SEED.wedding);
    test.skip(await isWide(app), 'tablets show Rider & stage as a tab of the gig, not a screen');

    // In-app Back.
    await openRiderStage(app);
    await app.check('Rider & stage');
    await back(app);
    await expectGigOverview(app, SEED.wedding);

    // Escape (system back).
    await openRiderStage(app);
    await app.page.keyboard.press('Escape');
    await app.settle();
    await expectGigOverview(app, SEED.wedding);

    // From the input-list editor: Escape closes the editor first, then Back goes to the gig.
    await openRiderStage(app);
    await riderScreen(app).getByRole('button', { name: app.t('EDIT LIST') }).click();
    await expect(app.page.getByRole('button', { name: app.t('Edit channel {n}', { n: 1 }), exact: true })).toBeVisible();
    await app.check('input list editor');
    await app.page.keyboard.press('Escape');
    await app.settle();
    await expect(app.page.getByRole('button', { name: app.t('Edit channel {n}', { n: 1 }), exact: true })).toHaveCount(0);
    await expect(riderScreen(app)).toBeVisible();
    await app.page.keyboard.press('Escape');
    await app.settle();
    await expectGigOverview(app, SEED.wedding);
  });

  test('tablet: the Rider & stage tab and back to Overview', async ({ app }) => {
    await openEvent(app, SEED.wedding);
    test.skip(!(await isWide(app)), 'phones open Rider & stage as a screen');
    await openRiderStage(app);
    await expect(eventDetail(app).getByText(app.t('Technical rider · v{version}', { version: 3 }))).toBeVisible();
    await app.check('Rider & stage tab');
    await app.page.getByRole('tab', { name: app.t('OVERVIEW') }).click();
    await expect(app.page.getByRole('tab', { name: app.t('OVERVIEW') })).toHaveAttribute('aria-selected', 'true');
  });

  test('a sent rider never says "seen"', async ({ app }) => {
    // The wedding's rider was opened by the venue (status "viewed" in the seed).
    await openEvent(app, SEED.wedding);
    expect(await eventDetail(app).innerText()).not.toMatch(/\bseen\b/i);
    await openRiderStage(app);
    await expect(app.page.getByText(app.t('Technical rider · v{version}', { version: 3 })).first()).toBeVisible();
    expect(await riderText(app)).not.toMatch(/\bseen\b/i);
  });
});

test.describe('Rider & stage input list', () => {
  test.use({ autoOpen: false });

  test('BUILD FROM LINEUP, then UPDATE / KEEP THIS LIST after a lineup change', async ({ app }) => {
    test.slow(); // two layers, a lineup edit and a reload of demo data
    // A saved stage with no channels yet: the app offers to build them from the lineup.
    await openWith(app, (db, ids) => {
      const wedding = ids.byTitle('Client A — Wedding').id;
      db.event_stage.find((s) => s.event_id === wedding)!.inputs = [];
    });
    await openEvent(app, SEED.wedding);
    await openRiderStage(app);
    await expect(app.page.getByText(app.t('Make the channels from the instruments on the lineup.'))).toBeVisible();
    await app.button('BUILD FROM LINEUP').first().click();
    await expect(app.page.getByText(app.t('Make the channels from the instruments on the lineup.'))).toHaveCount(0);
    // Channels now come from the lineup's instruments.
    const inputs = app.page.getByRole('region', { name: app.t('Input list') }).first();
    await expect(inputs).toContainText(/kick/i);
    await expect(inputs).toContainText(/bass/i);
    await app.check('input list built from lineup');

    // Lena leaves the lineup (Lineup EDIT on the overview).
    await closeRiderStage(app);
    await eventDetail(app).getByRole('button', { name: `${app.t('EDIT')}: ${app.t('LINEUP')}`, exact: false }).first().click();
    const lena = app.page.getByRole('checkbox', { name: 'Lena P.', exact: true });
    await lena.click();
    await expect(lena).toHaveAttribute('aria-checked', 'false');
    await app.page.getByRole('dialog').getByRole('button', { name: app.t('Save'), exact: true }).click();
    await expect(app.page.getByRole('dialog')).toHaveCount(0);

    // The list was made from the old lineup: update it or keep it.
    await openRiderStage(app);
    await expect(app.page.getByText(app.t('The lineup changed since this list was made from it.'))).toBeVisible();
    await expect(app.button('UPDATE FROM LINEUP').first()).toBeVisible();
    await app.button('KEEP THIS LIST').first().click();
    await expect(app.page.getByText(app.t('The lineup changed since this list was made from it.'))).toHaveCount(0);
  });
});

test.describe('Rider & stage as member', () => {
  test.use({ role: 'member' });

  test('@smoke read-only: no edit actions, no "seen"', async ({ app }) => {
    await openEvent(app, SEED.wedding);
    await openRiderStage(app);
    await expect(app.page.getByText(app.t('Technical rider · v{version}', { version: 3 })).first()).toBeVisible();
    for (const label of ['EDIT LIST', 'CREATE RIDER', 'SHARE LINK WITH THE VENUE']) {
      await expect(app.page.getByRole('button', { name: app.t(label), exact: true })).toHaveCount(0);
    }
    await expect(app.page.getByRole('button', { name: app.t('Edit who brings what') })).toHaveCount(0);
    await expect(app.page.getByRole('button', { name: app.t('Edit the stage plot') })).toHaveCount(0);
    expect(await riderText(app)).not.toMatch(/\bseen\b/i);
    await app.check('Rider & stage (member)');
  });
});
