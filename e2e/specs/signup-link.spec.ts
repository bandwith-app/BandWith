import { test, expect, type App } from '../fixtures';
import { back } from '../support/flows';
import { LOCALES } from '../support/i18n';

/**
 * The site's "Create your account" / "Sign up" buttons open the app at
 * `/?start=signup&src=…`. Signed out, that is the Create account form, not
 * the Welcome screen with one more tap; Back still leads to Welcome. Signed
 * in, the link opens the app as usual.
 */

const SITE_LINK = '/?start=signup&src=site-nav';
const INVITE = '3f2b8c1e-7a4d-4e5f-9b6a-1c2d3e4f5a6b';

const createAccount = (app: App) =>
  app.page.getByRole('heading', { name: new RegExp(app.t('Create account'), 'i') }).first();
const getStarted = (app: App) => app.page.getByRole('button', { name: app.t('Get started'), exact: true });

test.describe('sign-up link from the site, signed out', () => {
  test.use({ autoOpen: false });

  test.beforeEach(async ({ app }) => {
    // After the fixture's own init script: every load starts signed out.
    await app.page.addInitScript(() => localStorage.removeItem('bw-demo-session'));
  });

  test('@smoke ?start=signup opens Create account; Back leads to Welcome', async ({ app }) => {
    await app.page.goto(SITE_LINK);
    await expect(createAccount(app)).toBeVisible();
    await expect(getStarted(app)).toHaveCount(0);
    await expect(app.page.getByText(app.t('Your account first, then your band. About two minutes.'))).toBeVisible();
    // The flag is used up: only what the site added for itself stays.
    await expect.poll(() => new URL(app.page.url()).search).toBe('?src=site-nav');
    await app.check('Create account from the site link');

    await back(app);
    await expect(getStarted(app)).toBeVisible();
    await expect(createAccount(app)).toBeHidden();
    await app.check('Welcome after Back');

    // A reload opens the normal start, not the form again.
    await app.page.reload();
    await expect(getStarted(app)).toBeVisible();
    await expect(createAccount(app)).toHaveCount(0);
  });

  test('an invite link wins over start=signup', async ({ app }) => {
    await app.page.goto(`/?start=signup&invite=${INVITE}`);
    // (The demo has no such invite: Welcome says the link isn't valid any more.)
    await expect(getStarted(app)).toBeVisible();
    await expect(createAccount(app)).toHaveCount(0);
    await expect.poll(() => new URL(app.page.url()).search).toBe('');
  });

  test('?bw_screen=sign-in still opens the sign-in screen', async ({ app }) => {
    await app.page.goto('/?bw_screen=sign-in');
    await expect(app.page.getByPlaceholder('you@yourband.com')).toBeVisible();
    await expect(createAccount(app)).toHaveCount(0);
  });

  for (const lang of LOCALES) {
    test.describe(`320 px wide phone, ${lang}`, () => {
      test.use({ lang, viewport: { width: 320, height: 568 } });

      test('the set-up line takes two lines at most', async ({ app }) => {
        test.skip(test.info().project.name !== 'phone-portrait', 'a small-phone check: one profile is enough');
        expect(app.page.viewportSize()?.width).toBe(320);
        await app.page.goto(SITE_LINK);
        await expect(createAccount(app)).toBeVisible();
        const line = app.page.getByText(app.t('Your account first, then your band. About two minutes.'));
        await expect(line).toBeVisible();
        const lines = await line.evaluate((el) => {
          const cs = getComputedStyle(el);
          return Math.round(el.getBoundingClientRect().height / parseFloat(cs.lineHeight));
        });
        expect(lines, `lines of "${await line.textContent()}"`).toBeLessThanOrEqual(2);
        await app.check(`Create account at 320 px (${lang})`);
      });
    });
  }
});

test('signed in: the site link opens the app as usual', async ({ app }) => {
  await app.page.goto(SITE_LINK);
  await expect(app.page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(createAccount(app)).toHaveCount(0);
  // Signing out later (it reloads the page) must start on Welcome: the flag is gone.
  await expect.poll(() => new URL(app.page.url()).search).toBe('?src=site-nav');
});
