import { t } from '@/lib/i18n';
import { authErrorKind, authErrorMessage } from '@/lib/authErrors';

/**
 * Sign-up confirmation by code. After "Create account" with email and
 * password, the confirmation email carries a code that is typed into "Check
 * your email" (ConfirmEmailCode.tsx); the link in the same email stays as a
 * fallback, and is all that older app versions know.
 *
 * Everything the code depends on is here, in one place.
 */

/**
 * Digits in the code. Must equal the Supabase project's setting
 * Authentication → Sign In / Providers → Email → "Email OTP length":
 * the app asks for exactly this many digits.
 */
export const SIGNUP_CODE_LENGTH = 6;

/**
 * How long a code lasts: Supabase's "Email OTP expiration", 3600 s by
 * default. The server never says whether a refused code was wrong or too old
 * (both are `otp_expired`), so this only picks the sentence: a code refused
 * later than this after it was sent has surely expired.
 */
export const SIGNUP_CODE_TTL_MS = 60 * 60_000;

/**
 * Supabase sends one email a minute per address (Authentication → Rate
 * Limits → "Minimum interval per user", 60 s): "Send a new code" rests that
 * long after every email, the sign-up's own included.
 */
export const SIGNUP_CODE_RESEND_COOLDOWN_MS = 60_000;

/**
 * A resend refused for coming too soon (429): how many seconds to wait, from
 * Supabase's "you can only request this after 52 seconds", or a whole minute
 * when it doesn't say. Null for any other refusal.
 */
export function resendWaitSeconds(error: unknown): number | null {
  if (authErrorKind(error) !== 'rate_limit') return null;
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  const seconds = Number(/after (\d+) seconds?/i.exec(message)?.[1]);
  return seconds > 0 ? seconds : SIGNUP_CODE_RESEND_COOLDOWN_MS / 1000;
}

/**
 * The verifyOtp type for a sign-up code. In @supabase/auth-js 2.108 `signup`
 * and `magiclink` are deprecated for verifyOtp and `email` is "an OTP sent to
 * the user's email during sign-up or sign-in" (its own example for a sign-up
 * code); the server picks the sign-up confirmation for an address that isn't
 * confirmed yet. Resending still takes `signup` (ResendParams).
 */
export const SIGNUP_CODE_OTP_TYPE = 'email' as const;

/** The digits of what was typed or pasted ("482 913", "Your code: 482913"), the code's length at most. */
export const codeDigits = (raw: string): string => raw.replace(/\D/g, '').slice(0, SIGNUP_CODE_LENGTH);

export type SignupCodeErrorKind = 'wrong' | 'expired' | 'other';

/**
 * Why the code was refused. `sentAt` is when the last code was sent from this
 * screen (the sign-up itself, or "Send a new code").
 */
export function signupCodeErrorKind(error: unknown, sentAt: number, now: number = Date.now()): SignupCodeErrorKind {
  // `otp_expired` ("Token has expired or is invalid") lands on link_expired.
  if (authErrorKind(error) !== 'link_expired') return 'other';
  return now - sentAt > SIGNUP_CODE_TTL_MS ? 'expired' : 'wrong';
}

/** A sentence for the user, in the app's language. */
export function signupCodeErrorMessage(error: unknown, sentAt: number, now: number = Date.now()): string {
  switch (signupCodeErrorKind(error, sentAt, now)) {
    case 'wrong':
      return t('That code doesn’t match. Check it and try again, or send a new one.');
    case 'expired':
      return t('This code has expired. Send a new one.');
    default:
      return authErrorMessage(error);
  }
}
