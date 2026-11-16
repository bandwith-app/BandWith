import { defineLifecycle } from './lifecycle.ts';

/**
 * (g) Auth callback and password reset: a link that can't sign in explains
 * why and offers the way forward; Back never returns to the dead link.
 *
 * From the code:
 * - src/app/auth/callback.tsx: an error in the query or the fragment
 *   (callbackUrlError) shows CallbackProblemScreen (role alert, no
 *   auto-redirect). A reset link (bw_recovery=1) says "Link expired" and
 *   offers "Send a new link" and "Back to sign in"; any other link says
 *   "Sign-in didn’t complete" with "Back to sign in" only
 *   (src/lib/authCallback.ts callbackProblemText).
 * - Both buttons use location.replace(authScreenUrl(…)) → /?bw_screen=…, so
 *   Back can't return to the callback.
 * - ForgotPasswordScreen.tsx: "Reset password" → "Send reset link" → "Check
 *   your email" with "Back to sign in".
 * - Already signed in: Back to sign in lands in the app (Home).
 * - Academy: start.ts "Sign in and reset your password".
 */
export const auth = defineLifecycle({
  id: 'auth',
  title: 'Auth callback & reset',
  summary: 'Expired reset link (query or fragment) → Send a new link → reset → Check your email → sign in; server error → Back to sign in; Back never returns to the dead link.',
  role: 'admin',
  initial: 'start',
  states: {
    start: {
      see: 'Nothing open yet.',
      on: { EXPIRED_LINK: 'expired', EXPIRED_IN_FRAGMENT: 'expired', SERVER_ERROR_LINK: 'serverError', SERVER_ERROR_SIGNED_IN: 'serverErrorSignedIn' },
    },
    expired: {
      see: '"Link expired" (role alert) with Send a new link and Back to sign in; no endless spinner.',
      on: { SEND_NEW_LINK: 'resetForm', BACK_TO_SIGN_IN: 'signIn' },
    },
    resetForm: {
      see: '"Reset password" with an email field and Send reset link; the callback address is gone.',
      on: { SEND_RESET_LINK: 'checkEmail' },
    },
    checkEmail: {
      see: '"Check your email" with the address, and Back to sign in.',
      on: { BACK_TO_SIGN_IN: 'signIn' },
    },
    serverError: {
      see: '"Sign-in didn’t complete" (role alert) with Back to sign in and no Send a new link.',
      on: { BACK_TO_SIGN_IN: 'signIn' },
    },
    signIn: {
      see: 'The sign-in screen: an email field, no error, not on /auth/callback.',
      on: { BROWSER_BACK: 'notDeadLink' },
    },
    notDeadLink: {
      see: 'Back from sign-in: still not the callback, no error shown.',
    },
    serverErrorSignedIn: {
      see: 'Signed in already: "Sign-in didn’t complete" with Back to sign in.',
      on: { BACK_TO_APP: 'home' },
    },
    home: {
      see: 'Home, not on /auth/callback.',
    },
  },
  events: {
    EXPIRED_LINK: { do: 'Signed out, on sign-in: open /auth/callback?bw_recovery=1&error=access_denied&error_code=otp_expired…' },
    EXPIRED_IN_FRAGMENT: { do: 'Signed out, on sign-in: open the same error in the URL fragment (#error=…).' },
    SERVER_ERROR_LINK: { do: 'Signed out, on sign-in: open /auth/callback?error=server_error…' },
    SERVER_ERROR_SIGNED_IN: { do: 'Signed in: open /auth/callback?error=server_error…' },
    SEND_NEW_LINK: { do: 'Tap Send a new link.' },
    SEND_RESET_LINK: { do: 'Type an email, tap Send reset link.' },
    BACK_TO_SIGN_IN: { do: 'Tap Back to sign in.' },
    BACK_TO_APP: { do: 'Tap Back to sign in.' },
    BROWSER_BACK: { do: 'Browser Back.' },
  },
  wide: ['EXPIRED_LINK SEND_NEW_LINK SEND_RESET_LINK BACK_TO_SIGN_IN BROWSER_BACK'],
  knownBugs: [],
  manual: [
    'A real expired or used link from Supabase, a code exchanged twice, a reset link opened in another browser ("other_browser"), and the new password form after a valid link: the demo has no auth server.',
    'Native deep links (Capacitor launch URL handled once): device only.',
  ],
});
