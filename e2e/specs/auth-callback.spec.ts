import { test, expect, type App } from '../fixtures';

/**
 * A sign-in or reset link that can't sign in (expired, already used, server
 * error) explains why and offers a way forward. Never a blank page, never a
 * spinner that doesn't end, and Back to sign in really gets there.
 */

test.use({ autoOpen: false });

const EXPIRED =
  '/auth/callback?bw_recovery=1&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
const EXPIRED_IN_FRAGMENT =
  '/auth/callback?bw_recovery=1#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
const SERVER_ERROR = '/auth/callback?error=server_error&error_description=Unable+to+exchange+external+code';

const alert = (app: App) => app.page.getByRole('alert').filter({ visible: true }).first();

async function signedOut(app: App) {
  // After the fixture's own init script: every load starts signed out.
  await app.page.addInitScript(() => localStorage.removeItem('bw-demo-session'));
}

test.describe('auth callback errors', () => {
  test('@smoke an expired reset link says so and offers a new link', async ({ app }) => {
    await signedOut(app);
    await app.page.goto(EXPIRED);
    await expect(alert(app)).toContainText(app.t('Link expired'));
    await expect(app.button('Send a new link').first()).toBeVisible();
    await expect(app.button('Back to sign in').first()).toBeVisible();
    await app.check('expired reset link');

    await app.button('Send a new link').first().click();
    await expect(app.page).not.toHaveURL(/auth\/callback/);
    // The forgot-password screen: an email field and a way to send.
    await expect(app.page.getByRole('textbox').or(app.page.locator('input[type=email]')).first()).toBeVisible();
    await app.check('forgot password after an expired link');
  });

  test('an expired link reported in the URL fragment is handled the same way', async ({ app }) => {
    await signedOut(app);
    await app.page.goto(EXPIRED_IN_FRAGMENT);
    await expect(alert(app)).toContainText(app.t('Link expired'));
    await app.check('expired link (fragment)');
  });

  test('@smoke a server error explains and goes back to sign in', async ({ app }) => {
    await signedOut(app);
    // Opened from the app, so there is a page to go back to.
    await app.page.goto('/');
    await expect(app.button('Sign in').first()).toBeVisible();
    await app.settle();
    await app.page.goto(SERVER_ERROR);
    await expect(alert(app)).toContainText(app.t('Sign-in didn’t complete'));
    await expect(app.button('Send a new link')).toHaveCount(0);
    await app.check('sign-in error');

    await app.button('Back to sign in').first().click();
    await expect(app.page).not.toHaveURL(/auth\/callback/);
    await expect(app.page.getByText(app.t('Sign-in didn’t complete'))).toHaveCount(0);
    await expect(app.page.locator('input').first()).toBeVisible();
    await app.check('sign in after an error');
    // Back must not return to the dead link.
    await app.page.goBack();
    await expect(app.page).not.toHaveURL(/auth\/callback/);
    await expect(app.page.getByRole('alert').filter({ hasText: app.t('Sign-in didn’t complete') })).toHaveCount(0);
    await expect(app.button('Sign in').first().or(app.page.locator('input').first())).toBeVisible();
  });

  test('signed in already: Back to sign in lands in the app, not on the dead link', async ({ app }) => {
    await app.page.goto(SERVER_ERROR);
    await expect(alert(app)).toBeVisible();
    await app.button('Back to sign in').first().click();
    await expect(app.page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(app.page).not.toHaveURL(/auth\/callback/);
  });
});
