import { test, expect, DB_KEY, DEMO_USER_ID, type App } from '../fixtures';
import { checkWholeScreen } from '../support/flows';
import { LOCALES } from '../support/i18n';

/**
 * Create account with email and password, email confirmation on: "Check your
 * email" takes the 6-digit code from the email and the person is in the
 * onboarding, without leaving the app for a link and without a second
 * password prompt. "I’ve confirmed it: sign in" stays for whoever used the
 * link in the email instead.
 *
 * The demo confirms email only when asked (bw-demo-confirm-email = 1,
 * src/lib/demo/demoClient.ts); its code is DEMO_SIGNUP_CODE.
 */

const CODE = '482913';
const EMAIL = 'alex.rivera@example.com';

/** A new person on this device: signed out, no band yet, confirmation on. */
async function asNewPerson(app: App) {
  await app.page.evaluate(
    ({ k, me }) => {
      const d = JSON.parse(localStorage.getItem(k) || '{}');
      d.band_members = (d.band_members || []).filter((m: { user_id: string }) => m.user_id !== me);
      d.demo_deputy_gigs = [];
      d.band_deputies = (d.band_deputies || []).filter((x: { user_id?: string }) => x.user_id !== me);
      localStorage.setItem(k, JSON.stringify(d));
      for (const key of Object.keys(localStorage)) if (key.startsWith('bw:')) localStorage.removeItem(key);
      indexedDB.deleteDatabase('bandwith_offline_db');
      localStorage.removeItem('bw-demo-session');
      localStorage.setItem('bw-demo-confirm-email', '1');
    },
    { k: DB_KEY, me: DEMO_USER_ID },
  );
}

const heading = (app: App, source: string) => app.page.getByRole('heading', { name: new RegExp(app.t(source), 'i') }).first();
const codeField = (app: App) => app.page.getByLabel(app.t('Confirmation code'), { exact: true });
const verify = (app: App) => app.page.getByRole('button', { name: app.t('Verify'), exact: true });
const sendNew = (app: App) => app.page.getByRole('button', { name: app.t('Send a new code'), exact: true });
const usedTheLink = (app: App) => app.page.getByRole('button', { name: app.t('I’ve confirmed it: sign in'), exact: true });

/** Welcome → Create account → Continue: lands on "Check your email". */
async function signUp(app: App) {
  await asNewPerson(app);
  await app.page.goto('/?start=signup');
  await expect(heading(app, 'Create account')).toBeVisible();
  await app.page.getByPlaceholder(app.t('Your name'), { exact: true }).fill('Alex Rivera');
  await app.page.getByPlaceholder('you@email.com', { exact: true }).fill(EMAIL);
  await app.page.getByPlaceholder(app.t('Password'), { exact: true }).fill('correct horse battery');
  await app.page.getByRole('button', { name: app.t('Continue'), exact: true }).click();
  await expect(heading(app, 'Check your email')).toBeVisible();
  await expect(codeField(app)).toBeVisible();
}

test('@smoke sign up, type the code from the email, and the onboarding goes on', async ({ app }) => {
  await signUp(app);
  await expect(app.page.getByRole('status').filter({ hasText: EMAIL })).toBeVisible();
  await expect(codeField(app)).toHaveAttribute('inputmode', 'numeric');
  await expect(codeField(app)).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(verify(app)).toBeDisabled();
  await expect(usedTheLink(app)).toBeVisible();
  await app.check('Check your email');

  // A wrong code says so and keeps the screen.
  await codeField(app).fill('000000');
  await expect(
    app.page.getByRole('alert').filter({ hasText: app.t('That code doesn’t match. Check it and try again, or send a new one.') }),
  ).toBeVisible();
  await expect(heading(app, 'Check your email')).toBeVisible();
  await app.check('Check your email, wrong code');

  // A new code: the button says so and rests, the old digits are gone.
  await sendNew(app).click();
  const sent = app.page.getByRole('button', { name: app.t('New code sent'), exact: true });
  await expect(sent).toBeVisible();
  await expect(sent).toBeDisabled();
  await expect(codeField(app)).toHaveValue('');
  await expect(app.page.getByRole('alert')).toHaveCount(0);

  // Typed as people type it, a slip included: digits only, and the sixth one verifies.
  await codeField(app).pressSequentially('48a29 13');
  await expect(heading(app, 'What brings you here?')).toBeVisible();
  // In, with no second password prompt.
  await expect(app.page.getByPlaceholder('you@yourband.com')).toHaveCount(0);
  await expect(codeField(app)).toHaveCount(0);
  await app.check('What brings you here? after the code');
});

test('the whole code pasted at once verifies too', async ({ app }) => {
  await signUp(app);
  await codeField(app).fill(` ${CODE.slice(0, 3)} ${CODE.slice(3)} `);
  await expect(heading(app, 'What brings you here?')).toBeVisible();
});

test('confirmed through the link instead: "I’ve confirmed it: sign in" opens the sign-in screen', async ({ app }) => {
  await signUp(app);
  await usedTheLink(app).click();
  await expect(app.page.getByPlaceholder('you@yourband.com')).toBeVisible();
  await expect(codeField(app)).toHaveCount(0);
  await app.check('Sign in from Check your email');
});

for (const lang of LOCALES) {
  test.describe(`320 px wide phone, ${lang}`, () => {
    test.use({ lang, viewport: { width: 320, height: 568 } });

    test('the code field and its buttons fit', async ({ app }) => {
      test.skip(test.info().project.name !== 'phone-portrait', 'a small-phone check: one profile is enough');
      expect(app.page.viewportSize()?.width).toBe(320);
      await signUp(app);
      // With the longest state on screen: a refused code and its message.
      await codeField(app).fill('000000');
      await expect(
        app.page.getByRole('alert').filter({ hasText: app.t('That code doesn’t match. Check it and try again, or send a new one.') }),
      ).toBeVisible();

      for (const control of [codeField(app), verify(app), sendNew(app), usedTheLink(app)]) {
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box, 'on screen').not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(320);
      }
      // No label wider than its button (labels never wrap: they would be cut).
      for (const button of [verify(app), sendNew(app), usedTheLink(app)]) {
        const cut = await button.evaluate((el) => {
          const label = el.firstElementChild as HTMLElement;
          const s = getComputedStyle(el);
          const room = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
          return Math.ceil(label.getBoundingClientRect().width) - Math.floor(room);
        });
        expect(cut, `"${await button.textContent()}" is ${cut}px wider than its button`).toBeLessThanOrEqual(0);
      }
      // All six digits show in the field.
      const clipped = await codeField(app).evaluate((el: HTMLInputElement) => el.scrollWidth - el.clientWidth);
      expect(clipped).toBeLessThanOrEqual(1);
      await app.page.evaluate(() => window.scrollTo(0, 0));
      await checkWholeScreen(app, `Check your email at 320 px (${lang})`);
    });
  });
}
