import { describe, it, expect, beforeEach } from 'vitest';
import {
  authScreenFromUrl,
  authScreenUrl,
  callbackProblem,
  callbackProblemText,
  callbackUrlError,
  markLaunchUrlHandled,
  wasLaunchUrlHandled,
} from '../authCallback';
import { setLocalePref } from '../i18n';
import vercelJson from '../../../vercel.json?raw';

// The link a tester got (Android Chrome): reset link already used.
const TESTER_SEARCH =
  '?bw_recovery=1&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
const TESTER_HASH = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';

describe('auth callback errors', () => {
  beforeEach(() => setLocalePref('en'));

  it('reads the error from the query or the fragment', () => {
    expect(callbackUrlError(TESTER_SEARCH, TESTER_HASH)).toEqual({
      error: 'access_denied',
      code: 'otp_expired',
      description: 'Email link is invalid or has expired',
    });
    expect(callbackUrlError('?bw_recovery=1', TESTER_HASH)?.code).toBe('otp_expired');
    expect(callbackUrlError('?code=abc', '')).toBeNull();
    expect(callbackUrlError('', '')).toBeNull();
  });

  it('tells an expired link from a cancelled sign-in', () => {
    expect(callbackProblem(callbackUrlError(TESTER_SEARCH, TESTER_HASH))).toBe('link_expired');
    expect(callbackProblem({ error: 'access_denied', code: '', description: 'The user denied the request' })).toBe('cancelled');
    expect(callbackProblem({ code: 'flow_state_not_found', message: 'invalid flow state, no valid flow state found' })).toBe('link_expired');
    expect(callbackProblem({ code: 'bad_code_verifier' })).toBe('link_expired');
    expect(callbackProblem({ code: 'pkce_code_verifier_not_found', message: 'PKCE code verifier not found in storage.' })).toBe('other_browser');
    expect(callbackProblem({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' })).toBe('network');
    expect(callbackProblem(null)).toBe('unknown');
    expect(callbackProblem(new Error('boom'))).toBe('unknown');
  });

  it('explains a used reset link and offers a new one', () => {
    const text = callbackProblemText('link_expired', true);
    expect(text.title).toBe('Link expired');
    expect(text.body).toMatch(/email apps open links before you do/);
    expect(callbackProblemText('other_browser', true).body).toMatch(/same browser/);
    expect(callbackProblemText('cancelled', false).title).toBe('Sign-in didn’t complete');
    expect(callbackProblemText('unknown', false).body).toMatch(/Sign in again/);
    expect(callbackProblemText('network', true).body).toBe('Check your connection and try again.');
  });

  it('translates', () => {
    setLocalePref('it');
    expect(callbackProblemText('link_expired', true).title).toBe('Link scaduto');
  });
});

describe('screen to open after a dead link', () => {
  it('only accepts the two screens', () => {
    expect(authScreenFromUrl('?bw_screen=forgot-password')).toBe('forgot-password');
    expect(authScreenFromUrl('?bw_screen=sign-in')).toBe('sign-in');
    expect(authScreenFromUrl('?bw_screen=flow')).toBeNull();
    expect(authScreenFromUrl('')).toBeNull();
    expect(authScreenUrl('https://bandwith-beryl.vercel.app', 'forgot-password')).toBe(
      'https://bandwith-beryl.vercel.app/?bw_screen=forgot-password'
    );
  });
});

describe('native launch link', () => {
  beforeEach(() => sessionStorage.clear());

  it('is handled once per run', () => {
    const url = 'com.bandwith.app://auth/callback?code=abc';
    expect(wasLaunchUrlHandled(url)).toBe(false);
    markLaunchUrlHandled(url);
    expect(wasLaunchUrlHandled(url)).toBe(true);
    expect(wasLaunchUrlHandled('com.bandwith.app://auth/callback?code=def')).toBe(false);
  });
});

describe('vercel.json', () => {
  it('serves the app at /auth/callback (Google sign-in and email links come back there)', () => {
    const cfg = JSON.parse(vercelJson);
    expect(cfg.rewrites).toContainEqual({ source: '/auth/callback', destination: '/index.html' });
    // Only that path: the static pages (deputy.html, quote.html, academy/…) stay as they are.
    expect(cfg.rewrites).toHaveLength(1);
  });
});
