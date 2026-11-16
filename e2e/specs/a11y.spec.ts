import AxeBuilder from '@axe-core/playwright';
import { test, expect, type App } from '../fixtures';
import { openEvent, eventDetail, isWide, openCreate, SEED } from '../support/flows';
import { editSheet, openEditor } from '../support/event';

/**
 * Accessibility (axe, WCAG 2.0/2.1 A and AA) on the screens the screen-map
 * crawler flagged: no critical or serious violation. A layer on top is
 * scanned on its own (what is under it is covered).
 *
 * Phone portrait (the Calendar month grid on the Duo in Laptop pose).
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Known and not fixed here: the app chrome's icon buttons (bell, profile,
 * the Duo rail's tabs) show a count or initials that their names leave out
 * or put in brackets. Renaming them touches every screen and language; a
 * follow-up. Everything else on these screens must pass.
 */
const CHROME_NAME_MISMATCH = /aria-label="(Notifications|Open Identity and Account Hub|Open profile|Close profile|Chat)\b/;

async function scan(app: App, where: string, layer?: import('@playwright/test').Locator) {
  await app.settle();
  let builder = new AxeBuilder({ page: app.page }).setLegacyMode(true).withTags(TAGS);
  if (layer) {
    await layer.evaluate((e) => {
      document.querySelectorAll('[data-a11y-scan]').forEach((x) => x.removeAttribute('data-a11y-scan'));
      e.setAttribute('data-a11y-scan', '');
    });
    builder = builder.include('[data-a11y-scan]');
  }
  const { violations } = await builder.analyze();
  const bad = violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) =>
      v.id === 'label-content-name-mismatch' ? { ...v, nodes: v.nodes.filter((n) => !CHROME_NAME_MISMATCH.test(n.html)) } : v,
    )
    .filter((v) => v.nodes.length > 0)
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ') + ' ' + n.html.slice(0, 160)).join(' | ')}`);
  // Soft: one run lists every screen that fails.
  expect.soft(bad, `axe on "${where}"`).toEqual([]);
}

test.describe('axe: no critical or serious violations', () => {
  test.beforeEach(async ({ app }, info) => {
    test.skip(info.project.name !== 'phone-portrait' || (await isWide(app)), 'phone portrait');
  });

  test('Home', async ({ app }) => {
    await scan(app, 'Home');
  });

  test('Calendar', async ({ app }) => {
    await app.tab('Calendar');
    await expect(app.page.getByRole('button', { name: new RegExp(SEED.gigToday) }).first()).toBeVisible();
    await scan(app, 'Calendar');
  });

  test('a gig: overview, Venue & location, Lineup and Setlist sheets', async ({ app }) => {
    await openEvent(app, SEED.gigToday);
    await scan(app, SEED.gigToday, eventDetail(app));
    const venue = await openEditor(app, eventDetail(app).getByRole('button', { name: app.t('Edit venue') }), 'Venue & location');
    await scan(app, 'Venue & location', venue);
    await app.page.keyboard.press('Escape');
    await expect(venue).toBeHidden();
    for (const [row, title] of [
      [/Lineup · \d+ of \d+ confirmed/, 'Lineup'],
      [/Setlist · \d+ songs/, 'Setlist'],
    ] as const) {
      await eventDetail(app).getByRole('button', { name: row }).click();
      const sheet = app.page.getByRole('dialog').last();
      await expect(sheet).toBeVisible();
      await scan(app, title, sheet);
      await app.page.keyboard.press('Escape');
      await expect(app.page.locator('[data-a11y-scan]')).toHaveCount(0);
    }
  });

  test('a rehearsal overview', async ({ app }) => {
    await openEvent(app, SEED.rehearsalTomorrow);
    await scan(app, SEED.rehearsalTomorrow, eventDetail(app));
  });

  test('Suggestions', async ({ app }) => {
    await app.page.getByRole('button', { name: /^Notifications/ }).filter({ visible: true }).first().click();
    await app.page.getByRole('button', { name: /Lyrics correction/ }).first().click();
    const view = app.page.getByRole('heading', { name: app.t('Suggestions') }).first();
    await expect(view).toBeVisible();
    await scan(app, 'Suggestions', app.page.locator('.bw-pane-detail').last());
  });

  test('New rehearsal', async ({ app }) => {
    await openCreate(app, 'New rehearsal');
    await scan(app, 'New rehearsal', app.page.locator('.bw-pane-detail').last());
  });
});

test.describe('axe: iPad', () => {
  test('New rehearsal (one-screen composer with the free-slot strip)', async ({ app }, info) => {
    test.skip(info.project.name !== 'ipad-landscape', 'the iPad composer');
    await openCreate(app, 'New rehearsal');
    const slot = app.page.getByLabel(/^\d{2}:\d{2}: \d+ of \d+ free$/).first();
    await expect(slot).toBeVisible();
    // The composer, not the gig open beside it.
    await scan(app, 'New rehearsal', app.page.getByRole('dialog').filter({ has: slot }));
  });
});

test.describe('axe: Duo Laptop pose', () => {
  test('@laptop a gig\'s Lineup and Setlist sheets (they scroll here)', async ({ app }) => {
    await openEvent(app, SEED.gigToday);
    for (const [row, title] of [
      [/Lineup · \d+ of \d+ confirmed/, 'Lineup'],
      [/Setlist · \d+ songs/, 'Setlist'],
    ] as const) {
      await eventDetail(app).getByRole('button', { name: row }).click();
      const sheet = app.page.getByRole('dialog').last();
      await expect(sheet).toBeVisible();
      await scan(app, title, sheet);
      await app.page.keyboard.press('Escape');
      await expect(app.page.locator('[data-a11y-scan]')).toHaveCount(0);
    }
  });

  test('@laptop Calendar month grid', async ({ app }) => {
    await app.tab('Calendar');
    await expect(app.page.getByRole('grid').first()).toBeVisible();
    await scan(app, 'Calendar month grid');
  });
});
