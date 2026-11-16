import { expect } from '../fixtures';
import type { App } from '../fixtures';
import { auth } from './auth.model.ts';
import { stepsFor } from './steps.ts';

const EXPIRED =
  '/auth/callback?bw_recovery=1&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
const EXPIRED_IN_FRAGMENT =
  '/auth/callback?bw_recovery=1#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
const SERVER_ERROR = '/auth/callback?error=server_error&error_description=Unable+to+exchange+external+code';
const EMAIL = 'reset-test@example.com';

const alert = (app: App) => app.page.getByRole('alert').filter({ visible: true }).first();
const emailField = (app: App) => app.page.locator('input[type=email]').filter({ visible: true }).first();

/** Signed out (every later load too), on the sign-in screen, then the link: Back has a page to return to. */
async function fromSignIn(app: App, link: string) {
  await app.page.addInitScript(() => localStorage.removeItem('bw-demo-session'));
  await app.page.goto('/');
  await expect(app.button('Sign in').first()).toBeVisible({ timeout: 30_000 });
  await app.settle();
  await app.page.goto(link);
}

async function noDeadLink(app: App) {
  await expect(app.page).not.toHaveURL(/auth\/callback/);
  await expect(app.page.getByRole('alert').filter({ hasText: app.t('Sign-in didn’t complete') })).toHaveCount(0);
  await expect(app.page.getByRole('alert').filter({ hasText: app.t('Link expired') })).toHaveCount(0);
}

export const authSteps = stepsFor(auth, {
  boot: async () => {},
  states: {
    start: async () => {},
    expired: async ({ app }) => {
      await expect(alert(app)).toContainText(app.t('Link expired'));
      await expect(app.button('Send a new link').first()).toBeVisible();
      await expect(app.button('Back to sign in').first()).toBeVisible();
      await expect(app.page.getByText(app.t('Completing sign in...'))).toHaveCount(0);
      await app.check('expired reset link');
    },
    resetForm: async ({ app }) => {
      await noDeadLink(app);
      await expect(app.page.getByText(app.t('Reset password')).first()).toBeVisible();
      await expect(emailField(app)).toBeVisible();
      await app.check('reset password');
    },
    checkEmail: async ({ app }) => {
      await expect(app.page.getByText(app.t('Check your email')).first()).toBeVisible();
      await expect(app.page.getByText(EMAIL).first()).toBeVisible();
      await expect(app.button('Back to sign in').first()).toBeVisible();
      await app.check('check your email');
    },
    serverError: async ({ app }) => {
      await expect(alert(app)).toContainText(app.t('Sign-in didn’t complete'));
      await expect(app.button('Send a new link')).toHaveCount(0);
      await expect(app.button('Back to sign in').first()).toBeVisible();
      await app.check('sign-in error');
    },
    signIn: async ({ app }) => {
      await noDeadLink(app);
      await expect(emailField(app).or(app.page.locator('input').filter({ visible: true }).first())).toBeVisible();
      await expect(app.page.getByText(app.t('Check your email'))).toHaveCount(0);
      await app.check('sign in');
    },
    notDeadLink: async ({ app }) => {
      await noDeadLink(app);
      await expect(app.button('Sign in').first().or(app.page.locator('input').filter({ visible: true }).first())).toBeVisible();
    },
    serverErrorSignedIn: async ({ app }) => {
      await expect(alert(app)).toContainText(app.t('Sign-in didn’t complete'));
      await expect(app.button('Back to sign in').first()).toBeVisible();
    },
    home: async ({ app }) => {
      await expect(app.page.getByRole('button', { name: app.t('Home'), exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await expect(app.page).not.toHaveURL(/auth\/callback/);
    },
  },
  events: {
    EXPIRED_LINK: ({ app }) => fromSignIn(app, EXPIRED),
    EXPIRED_IN_FRAGMENT: ({ app }) => fromSignIn(app, EXPIRED_IN_FRAGMENT),
    SERVER_ERROR_LINK: ({ app }) => fromSignIn(app, SERVER_ERROR),
    SERVER_ERROR_SIGNED_IN: async ({ app }) => {
      await app.page.goto(SERVER_ERROR);
    },
    SEND_NEW_LINK: async ({ app }) => {
      await app.button('Send a new link').first().click();
      await expect(app.page).not.toHaveURL(/auth\/callback/);
      await app.settle();
    },
    SEND_RESET_LINK: async ({ app }) => {
      await emailField(app).fill(EMAIL);
      await app.button('Send reset link').first().click();
      await app.settle();
    },
    BACK_TO_SIGN_IN: async ({ app }) => {
      await app.button('Back to sign in').first().click();
      await expect(app.page).not.toHaveURL(/auth\/callback/);
      await app.settle();
    },
    BACK_TO_APP: ({ app }) => app.button('Back to sign in').first().click(),
    BROWSER_BACK: async ({ app }) => {
      await app.page.goBack();
      await app.settle();
    },
  },
});
