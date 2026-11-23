import { t } from '@/lib/i18n';
import { authErrorKind } from '@/lib/authErrors';

/**
 * What went wrong when an auth link (password reset, Google / Apple sign-in)
 * came back to /auth/callback (web) or to the app's deep link (native).
 *
 * - `link_expired`: the link or its code was already used or is too old.
 *   Email apps and link scanners often open links before the person does.
 * - `other_browser`: the code can only be exchanged where the flow started
 *   (PKCE code verifier), and this browser doesn't have it.
 * - `cancelled`: the person backed out of Google / Apple.
 * - `beta_full`: Google / Apple would create a new account, and every beta
 *   spot is taken (migration 128).
 */
export type AuthCallbackProblem = 'link_expired' | 'other_browser' | 'cancelled' | 'beta_full' | 'network' | 'unknown';

type UrlError = { error: string; code: string; description: string };

/** The error Supabase put on the callback URL (query first, then the #fragment), or null. */
export function callbackUrlError(search: string, hash: string): UrlError | null {
  for (const raw of [search, hash]) {
    const p = new URLSearchParams(raw.replace(/^[?#]/, ''));
    const error = p.get('error') ?? '';
    const code = p.get('error_code') ?? '';
    const description = p.get('error_description') ?? '';
    if (error || code || description) return { error, code, description };
  }
  return null;
}

/** Classifies a URL error (callbackUrlError) or an error thrown by the code exchange. */
export function callbackProblem(err: unknown): AuthCallbackProblem {
  const e = err as { error?: unknown; code?: unknown; description?: unknown; message?: unknown } | null | undefined;
  if (!e) return 'unknown';
  const code = typeof e.code === 'string' ? e.code : '';
  if (code === 'pkce_code_verifier_not_found') return 'other_browser';
  const message = typeof e.description === 'string' && e.description ? e.description : e.message;
  const kind = authErrorKind({ ...(e as object), code, message });
  if (kind === 'link_expired') return 'link_expired';
  if (kind === 'network') return 'network';
  if (kind === 'beta_full') return 'beta_full';
  // access_denied without a more precise code: Google / Apple cancelled.
  if (e.error === 'access_denied' || code === 'access_denied') return 'cancelled';
  return 'unknown';
}

/** The words of the error screen. `recovery`: it was a password-reset link. */
export function callbackProblemText(problem: AuthCallbackProblem, recovery: boolean): { title: string; body: string } {
  if (problem === 'network') {
    return { title: t('Sign-in didn’t complete'), body: t('Check your connection and try again.') };
  }
  if (problem === 'beta_full') {
    return { title: t('BandWith is full for now'), body: t('Join the waitlist on bandwith.fun. Invited by a band? Sign up with the email the invite was sent to.') };
  }
  if (recovery) {
    if (problem === 'other_browser') {
      return {
        title: t('Link expired'),
        body: t('Open the reset link in the same browser where you asked for it. Ask for a new link and open it there.'),
      };
    }
    return {
      title: t('Link expired'),
      body: t('This reset link has expired or was already used. Some email apps open links before you do, and that uses them up. Ask for a new link and open it straight away.'),
    };
  }
  return {
    title: t('Sign-in didn’t complete'),
    body: t('Google or Apple sign-in was cancelled, or this link is no longer valid. Sign in again.'),
  };
}

export { recoveryRefusedText } from './authErrors';

/** Query flag on the app root: open the welcome flow on this screen (set by the callback error screen). */
export const AUTH_SCREEN_PARAM = 'bw_screen';
export type AuthScreenTarget = 'sign-in' | 'forgot-password';
/**
 * Query flag on the app root, set by the site's "Create your account" /
 * "Sign up" buttons (`/?start=signup&src=…`): open on the Create account form.
 */
export const START_PARAM = 'start';
/** Links that already say where to go (a band invite, a deputy request): they win over `start`. */
const INVITE_LINK_PARAMS = ['invite', 'deputy'];

/**
 * The screen the address asks the signed-out flow to open on, or null for
 * the normal start (Welcome). `bw_screen` first; then `start=signup`, unless
 * the link is an invite.
 */
export function authScreenFromUrl(search: string): AuthScreenTarget | 'sign-up' | null {
  const p = new URLSearchParams(search);
  const v = p.get(AUTH_SCREEN_PARAM);
  if (v === 'sign-in' || v === 'forgot-password') return v;
  if (p.get(START_PARAM) === 'signup' && !INVITE_LINK_PARAMS.some((name) => p.has(name))) return 'sign-up';
  return null;
}

/** Takes used-up flags off the address bar (same history entry), so a refresh or Back opens the normal start. */
export function dropUrlParams(names: string[]): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!names.some((name) => url.searchParams.has(name))) return;
  for (const name of names) url.searchParams.delete(name);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

/** Address of the app root opened on `screen`. */
export function authScreenUrl(origin: string, screen: AuthScreenTarget): string {
  return `${origin}/?${AUTH_SCREEN_PARAM}=${screen}`;
}

/**
 * Native: the deep link that cold-started the app stays the launch URL for
 * the whole run (Capacitor's getLaunchUrl), also after the WebView reloads
 * (sign-out reloads it). Its code was already exchanged (or its error already
 * shown), so remember the launch link handled and never handle it twice.
 * sessionStorage: it survives the reload, not a new start of the app.
 */
const HANDLED_URL_KEY = 'bw-auth-launch-url';
export function wasLaunchUrlHandled(url: string): boolean {
  try {
    return sessionStorage.getItem(HANDLED_URL_KEY) === url;
  } catch {
    return false;
  }
}
export function markLaunchUrlHandled(url: string): void {
  try {
    sessionStorage.setItem(HANDLED_URL_KEY, url);
  } catch {
    // storage unavailable: a stale launch link fails quietly instead (AuthContext)
  }
}
