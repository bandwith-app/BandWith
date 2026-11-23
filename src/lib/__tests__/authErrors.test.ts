import { describe, it, expect, beforeEach } from 'vitest';
import { authErrorKind, authErrorMessage } from '../authErrors';
import { parseStoredSession, isOfflineAuthError } from '../authSession';
import { setLocalePref } from '../i18n';
import { passwordUpdateWithToken } from '../recoveryProof';

describe('auth errors in the app language', () => {
  beforeEach(() => setLocalePref('en'));

  it('reads the error code first', () => {
    expect(authErrorKind({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('invalid_credentials');
    expect(authErrorKind({ code: 'email_not_confirmed' })).toBe('email_not_confirmed');
    expect(authErrorKind({ code: 'over_email_send_rate_limit' })).toBe('rate_limit');
    expect(authErrorKind({ code: 'same_password' })).toBe('same_password');
    expect(authErrorKind({ code: 'weak_password' })).toBe('weak_password');
    expect(authErrorKind({ code: 'user_already_exists' })).toBe('already_registered');
    expect(authErrorKind({ code: 'otp_expired' })).toBe('link_expired');
  });

  it('falls back on the kind of error and its message', () => {
    expect(authErrorKind({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' })).toBe('network');
    expect(authErrorKind(new TypeError('Load failed'))).toBe('network');
    expect(authErrorKind({ message: 'For security purposes, you can only request this after 52 seconds.' })).toBe('rate_limit');
    expect(authErrorKind({ message: 'User already registered' })).toBe('already_registered');
    expect(authErrorKind({ status: 400, message: 'Something odd' })).toBe('unknown');
    expect(authErrorKind(null)).toBe('unknown');
  });

  it('never shows the server text', () => {
    expect(authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('Wrong email or password.');
    expect(authErrorMessage({ message: 'Something odd' })).toBe('Something went wrong. Please try again.');
    expect(authErrorMessage(new TypeError('Failed to fetch'))).toBe('Check your connection and try again.');
  });

  // Codex review #287 round 8 (M1): a 503 (or no answer) while setting the
  // new password is passing: the connection guidance, never the generic error.
  it('a server error or a lost connection during the password reset says to try again', async () => {
    const answer = (status: number) => async () => new Response(JSON.stringify({ message: 'upstream connect error' }), { status });
    for (const status of [500, 502, 503, 504]) {
      const { error } = await passwordUpdateWithToken('https://x.supabase.co', 'k', answer(status) as unknown as typeof fetch)('new-password-1', 'tok');
      expect(authErrorKind(error), String(status)).toBe('network');
      expect(authErrorMessage(error)).toBe('Check your connection and try again.');
    }
    const lost = await passwordUpdateWithToken('https://x.supabase.co', 'k', (async () => {
      throw new Error('The request timed out.');
    }) as unknown as typeof fetch)('new-password-1', 'tok');
    expect(authErrorKind(lost.error)).toBe('network');
    // Refusals keep their own sentences.
    const weak = await passwordUpdateWithToken('https://x.supabase.co', 'k', (async () =>
      new Response(JSON.stringify({ code: 'weak_password', msg: 'Password is too weak' }), { status: 422 })) as unknown as typeof fetch)('a', 'tok');
    expect(authErrorKind(weak.error)).toBe('weak_password');
    setLocalePref('it');
    expect(authErrorMessage({ status: 503 })).not.toBe(authErrorMessage({ message: 'x' }));
  });

  it('translates', () => {
    setLocalePref('it');
    expect(authErrorMessage({ code: 'invalid_credentials' })).toBe('Email o password errata.');
  });

  // Migration 128 refuses a new account when every beta spot is taken; Auth
  // answers with its generic database error, which then means "full".
  it('tells the person the beta is full, and what to do', () => {
    const refused = { status: 500, code: 'unexpected_failure', message: 'Database error saving new user' };
    expect(authErrorKind(refused)).toBe('beta_full');
    expect(authErrorMessage(refused)).toBe('BandWith is full for now. Join the waitlist on bandwith.fun. Invited by a band? Sign up with the email the invite was sent to.');
    for (const lang of ['it', 'es', 'fr', 'de', 'pt'] as const) {
      setLocalePref(lang);
      expect(authErrorMessage(refused), lang).not.toContain('Invited by a band');
      expect(authErrorMessage(refused), lang).toContain('bandwith.fun');
    }
  });
});

describe('stored session (offline start)', () => {
  const session = { access_token: 'a', refresh_token: 'r', expires_at: 1, user: { id: 'u1', email: 'leo@example.com' } };

  it('reads the session the library keeps on the device', () => {
    expect(parseStoredSession(JSON.stringify(session))?.user.id).toBe('u1');
    expect(parseStoredSession(JSON.stringify({ currentSession: session }))?.refresh_token).toBe('r');
  });

  it('ignores anything that cannot resume a session', () => {
    expect(parseStoredSession(null)).toBeNull();
    expect(parseStoredSession('{bad json')).toBeNull();
    expect(parseStoredSession(JSON.stringify({ ...session, refresh_token: '' }))).toBeNull();
    expect(parseStoredSession(JSON.stringify({ ...session, user: null }))).toBeNull();
  });

  it('only trusts it for network failures', () => {
    expect(isOfflineAuthError({ name: 'AuthRetryableFetchError', status: 0 }, true)).toBe(true);
    expect(isOfflineAuthError({ name: 'AuthApiError', status: 400 }, false)).toBe(true);
    expect(isOfflineAuthError({ name: 'AuthApiError', status: 400 }, true)).toBe(false);
    expect(isOfflineAuthError(null, true)).toBe(false);
  });
});
