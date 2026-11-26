/**
 * Sign-up confirmation by code: the email carries a 6-digit code typed into
 * "Check your email" (the link stays in the email as a fallback). The length,
 * the lifetime and the verification type live in one place, src/lib/signupCode.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { setLocalePref } from '@/lib/i18n';
import {
  SIGNUP_CODE_LENGTH,
  SIGNUP_CODE_OTP_TYPE,
  SIGNUP_CODE_RESEND_COOLDOWN_MS,
  SIGNUP_CODE_TTL_MS,
  resendWaitSeconds,
  codeDigits,
  signupCodeErrorKind,
  signupCodeErrorMessage,
} from '../signupCode';

const NOW = Date.UTC(2026, 10, 23, 12, 0, 0);
// What Supabase Auth answers for a wrong code and for an expired one alike.
const REFUSED = { name: 'AuthApiError', status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' };

describe('sign-up code: constants', () => {
  it('is 6 digits, verified as an email code, resent once a minute, valid for an hour', () => {
    expect(SIGNUP_CODE_LENGTH).toBe(6);
    // auth-js 2.108: `signup` is deprecated for verifyOtp, `email` is the sign-up / sign-in code.
    expect(SIGNUP_CODE_OTP_TYPE).toBe('email');
    expect(SIGNUP_CODE_RESEND_COOLDOWN_MS).toBe(60_000);
    expect(SIGNUP_CODE_TTL_MS).toBe(60 * 60_000);
  });
});

describe('codeDigits', () => {
  it('keeps digits only', () => {
    expect(codeDigits('12a3-45 6')).toBe('123456');
    expect(codeDigits('abc')).toBe('');
    expect(codeDigits('')).toBe('');
  });

  it('takes a whole pasted code, with spaces or text around it', () => {
    expect(codeDigits(' 482 913 ')).toBe('482913');
    expect(codeDigits('Your code: 482913.')).toBe('482913');
  });

  it('never keeps more than the code length', () => {
    expect(codeDigits('1234567890')).toBe('123456');
  });
});

describe('signupCodeErrorKind', () => {
  it('a refused code sent a moment ago is a wrong code', () => {
    expect(signupCodeErrorKind(REFUSED, NOW - 5 * 60_000, NOW)).toBe('wrong');
  });

  it('a refused code older than its lifetime has expired', () => {
    expect(signupCodeErrorKind(REFUSED, NOW - SIGNUP_CODE_TTL_MS - 1, NOW)).toBe('expired');
  });

  it('reads the refusal from the message when there is no code', () => {
    expect(signupCodeErrorKind({ status: 403, message: 'Token has expired or is invalid' }, NOW - 1000, NOW)).toBe('wrong');
  });

  it('leaves every other error to the shared auth messages', () => {
    expect(signupCodeErrorKind({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, NOW, NOW)).toBe('other');
    expect(signupCodeErrorKind({ status: 429, code: 'over_request_rate_limit', message: 'Too many requests' }, NOW, NOW)).toBe('other');
  });
});

describe('signupCodeErrorMessage', () => {
  beforeEach(() => setLocalePref('en'));

  it('says the code does not match, and how to get another', () => {
    expect(signupCodeErrorMessage(REFUSED, NOW - 1000, NOW)).toBe(
      'That code doesn’t match. Check it and try again, or send a new one.',
    );
  });

  it('says an old code has expired', () => {
    expect(signupCodeErrorMessage(REFUSED, NOW - SIGNUP_CODE_TTL_MS - 1, NOW)).toBe('This code has expired. Send a new one.');
  });

  it('keeps the shared sentences for the network and for too many attempts', () => {
    expect(signupCodeErrorMessage({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, NOW, NOW)).toBe(
      'Check your connection and try again.',
    );
    expect(signupCodeErrorMessage({ status: 429, code: 'over_request_rate_limit' }, NOW, NOW)).toBe(
      'Too many attempts. Wait a minute and try again.',
    );
  });

  it('is translated', () => {
    setLocalePref('it');
    expect(signupCodeErrorMessage(REFUSED, NOW - 1000, NOW)).not.toBe(
      'That code doesn’t match. Check it and try again, or send a new one.',
    );
    expect(signupCodeErrorMessage(REFUSED, NOW - SIGNUP_CODE_TTL_MS - 1, NOW)).not.toBe('This code has expired. Send a new one.');
    setLocalePref('en');
  });
});

describe('resendWaitSeconds', () => {
  const tooSoon = (message: string) => ({ status: 429, code: 'over_email_send_rate_limit', message });

  it('reads the seconds Supabase gives for a resend that came too soon', () => {
    expect(resendWaitSeconds(tooSoon('For security purposes, you can only request this after 53 seconds.'))).toBe(53);
    expect(resendWaitSeconds(tooSoon('For security purposes, you can only request this after 1 second.'))).toBe(1);
  });

  it('waits the whole minute when the refusal does not say how long', () => {
    expect(resendWaitSeconds(tooSoon('Email rate limit exceeded'))).toBe(SIGNUP_CODE_RESEND_COOLDOWN_MS / 1000);
  });

  it('is null for any other refusal', () => {
    expect(resendWaitSeconds({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' })).toBeNull();
    expect(resendWaitSeconds(null)).toBeNull();
  });
});
