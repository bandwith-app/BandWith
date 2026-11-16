import { test, expect } from '../fixtures';
import { checkWholeScreen, openEvent, SEED } from '../support/flows';
import { openHub } from '../support/hub';

/**
 * Spanish and German (the longest words): the main screens are translated,
 * nothing runs off the screen, and no raw key or "undefined" shows.
 * app.check covers overflow, clipped controls, bad text and raw keys.
 */

for (const lang of ['es', 'de'] as const) {
  test.describe(`in ${lang}`, () => {
    test.use({ lang });

    test(`@smoke Home is translated and fits, top to bottom`, async ({ app }) => {
      const home = app.t('Home');
      expect(home, 'the Home tab has a translation').not.toBe('Home');
      await expect(app.page.getByRole('button', { name: home, exact: true }).first()).toBeVisible();
      await expect(app.page.getByText(SEED.gigToday, { exact: false }).first()).toBeVisible();
      await checkWholeScreen(app, `Home (${lang})`);
    });

    test('Calendar, a gig and the Account hub fit', async ({ app }) => {
      await app.tab('Calendar');
      await checkWholeScreen(app, `Calendar (${lang})`);
      await openEvent(app, SEED.gigToday);
      await checkWholeScreen(app, `gig (${lang})`);
      await app.page.getByRole('button', { name: app.t('Back'), exact: true }).last().click();
      await app.settle();
      await openHub(app);
      await checkWholeScreen(app, `Account hub (${lang})`);
    });
  });
}
