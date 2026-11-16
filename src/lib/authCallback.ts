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
 */
export type AuthCallbackProblem = 'link_expired' | 'other_browser' | 'cancelled' | 'network' | 'unknown';

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
  // access_denied without a more precise code: Google / Apple cancelled.
  if (e.error === 'access_denied' || code === 'access_denied') return 'cancelled';
  return 'unknown';
}

/** The words of the error screen. `recovery`: it was a password-reset link. */
export function callbackProblemText(problem: AuthCallbackProblem, recovery: boolean): { title: string; body: string } {
  if (problem === 'network') {
    return { title: t('Sign-in didn’t complete'), body: t('Check your connection and try again.') };
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

/** Query flag on the app root: open the welcome flow on this screen (set by the callback error screen). */
export const AUTH_SCREEN_PARAM = 'bw_screen';
export type AuthScreenTarget = 'sign-in' | 'forgot-password';

export function authScreenFromUrl(search: string): AuthScreenTarget | null {
  const v = new URLSearchParams(search).get(AUTH_SCREEN_PARAM);
  return v === 'sign-in' || v === 'forgot-password' ? v : null;
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
