/**
 * "Check your email" after Create account: the confirmation email carries a
 * 6-digit code, typed (or pasted) on this screen. Verifying it signs the
 * person in and the onboarding goes on, with no trip to the mail app's link
 * and no second password prompt. The link in the email still works: "I’ve
 * confirmed it: sign in" stays as a secondary action.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  path: 'creator' as 'creator' | 'joiner' | 'solo',
  signIn: vi.fn(),
  signUp: vi.fn(),
  setAccountData: vi.fn(),
  verifyOtp: vi.fn(),
  resend: vi.fn(),
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    signIn: mocks.signIn,
    signUp: mocks.signUp,
    signInWithGoogle: vi.fn(),
    signInWithApple: vi.fn(),
    authError: null,
    clearAuthError: vi.fn(),
  }),
}));
vi.mock('@/lib/OnboardingContext', () => ({
  useOnboarding: () => ({ setAccountData: mocks.setAccountData, path: mocks.path }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { verifyOtp: mocks.verifyOtp, resend: mocks.resend } },
  getAuthCallbackUrl: () => 'https://app.bandwith.fun/auth/callback',
}));

import { AccountCreation } from '../AccountCreation';
import { setLocalePref, t } from '@/lib/i18n';

const EMAIL = 'alex@example.com';
const REFUSED = { name: 'AuthApiError', status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' };
const WRONG = 'That code doesn’t match. Check it and try again, or send a new one.';
const EXPIRED = 'This code has expired. Send a new one.';

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const codeField = () => screen.getByLabelText('Confirmation code') as HTMLInputElement;
const verifyButton = () => screen.getByRole('button', { name: 'Verify' }) as HTMLButtonElement;
const type = async (value: string) => {
  fireEvent.change(codeField(), { target: { value } });
  await flush();
};

/** Create account with email and password, confirmation on: no session yet. */
async function signUpToCodeStep(props: Partial<React.ComponentProps<typeof AccountCreation>> = {}) {
  const onComplete = vi.fn();
  const onSignIn = vi.fn();
  render(<AccountCreation onBack={() => {}} onComplete={onComplete} onSignIn={onSignIn} {...props} />);
  // (t(): the helper also runs in Italian.)
  if (mocks.path !== 'joiner') fireEvent.change(screen.getByPlaceholderText(t('Your name')), { target: { value: 'Alex' } });
  if (!props.prefilledEmail) fireEvent.change(screen.getByPlaceholderText('you@email.com'), { target: { value: EMAIL } });
  fireEvent.change(screen.getByPlaceholderText(t('Password')), { target: { value: 'correct horse' } });
  fireEvent.submit(document.getElementById('account-creation-form') as HTMLFormElement);
  await flush();
  expect(screen.getByRole('heading', { name: t('Check your email') })).toBeInTheDocument();
  return { onComplete, onSignIn };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-23T12:00:00Z'));
  setLocalePref('en');
  mocks.path = 'creator';
  mocks.signIn.mockReset().mockResolvedValue({ error: { code: 'invalid_credentials', message: 'Invalid login credentials' } });
  mocks.signUp.mockReset().mockResolvedValue({ error: null, session: null, existing: false });
  mocks.setAccountData.mockReset();
  mocks.verifyOtp.mockReset().mockResolvedValue({ data: { user: { id: 'u1' }, session: { access_token: 'a' } }, error: null });
  mocks.resend.mockReset().mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Check your email: the 6-digit code', () => {
  it('asks for the code that was sent to the address, in a one-time-code field', async () => {
    await signUpToCodeStep();
    expect(screen.getByRole('status').textContent).toBe(
      `We sent a 6-digit code to ${EMAIL}. Enter it here to confirm your address and finish creating your account.`,
    );
    const input = codeField();
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('pattern', '[0-9]*');
    // No maxlength: a pasted "482 913" must not lose its last digit.
    expect(input).not.toHaveAttribute('maxlength');
    expect(verifyButton()).toBeDisabled();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it('keeps digits only, six at most', async () => {
    await signUpToCodeStep();
    await type('12ab3');
    expect(codeField().value).toBe('123');
    expect(verifyButton()).toBeDisabled();
    await type('1 2-3.4x5');
    expect(codeField().value).toBe('12345');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    await type('1234567890');
    expect(codeField().value).toBe('123456');
  });

  it('verifies on its own at the sixth digit, and the onboarding goes on', async () => {
    const { onComplete } = await signUpToCodeStep();
    await type('48291');
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    await type('482913');
    expect(mocks.verifyOtp).toHaveBeenCalledTimes(1);
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: EMAIL, token: '482913', type: 'email' });
    expect(onComplete).toHaveBeenCalledTimes(1);
    // The same hand-over as a sign-up that needs no confirmation: no second password prompt.
    expect(mocks.setAccountData).toHaveBeenCalledWith({ email: EMAIL, password: 'correct horse', authMethod: 'email' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('takes the whole code pasted at once, spaces and all', async () => {
    const { onComplete } = await signUpToCodeStep();
    await type('11');
    fireEvent.paste(codeField(), { clipboardData: { getData: () => ' 482 913 ' } });
    await flush();
    expect(codeField().value).toBe('482913');
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: EMAIL, token: '482913', type: 'email' });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('a wrong code says so, keeps the screen, and Verify tries again', async () => {
    mocks.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: REFUSED });
    const { onComplete } = await signUpToCodeStep();
    await type('000000');
    expect(screen.getByRole('alert').textContent).toBe(WRONG);
    expect(codeField()).toHaveAttribute('aria-invalid', 'true');
    expect(onComplete).not.toHaveBeenCalled();
    expect(mocks.setAccountData).not.toHaveBeenCalled();

    // Typing again clears the message; the corrected code goes through.
    await type('00000');
    expect(screen.queryByRole('alert')).toBeNull();
    await type('000001');
    expect(mocks.verifyOtp).toHaveBeenLastCalledWith({ email: EMAIL, token: '000001', type: 'email' });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('the Verify button submits a code that is already in the field', async () => {
    mocks.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { status: 0, name: 'AuthRetryableFetchError', message: 'Failed to fetch' } });
    const { onComplete } = await signUpToCodeStep();
    await type('482913');
    expect(screen.getByRole('alert').textContent).toBe('Check your connection and try again.');
    expect(verifyButton()).toBeEnabled();
    fireEvent.click(verifyButton());
    await flush();
    expect(mocks.verifyOtp).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('a code typed after its hour says it has expired', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: REFUSED });
    await signUpToCodeStep();
    await act(async () => {
      vi.advanceTimersByTime(61 * 60_000);
    });
    await type('482913');
    expect(screen.getByRole('alert').textContent).toBe(EXPIRED);
  });

  it('Send a new code: says a new code was sent, rests for a minute, and starts the hour again', async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: REFUSED });
    await signUpToCodeStep();
    await act(async () => {
      vi.advanceTimersByTime(61 * 60_000);
    });
    await type('482913');
    expect(screen.getByRole('alert').textContent).toBe(EXPIRED);

    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    await flush();
    expect(mocks.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: EMAIL,
      options: { emailRedirectTo: 'https://app.bandwith.fun/auth/callback' },
    });
    const sent = screen.getByRole('button', { name: 'New code sent' });
    expect(sent).toBeDisabled();
    // The old code no longer works: the field and its error are cleared.
    expect(codeField().value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(59_000);
    });
    expect(screen.getByRole('button', { name: 'New code sent' })).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();

    // A refusal right after a new code is a wrong code, not an expired one.
    await type('111111');
    expect(screen.getByRole('alert').textContent).toBe(WRONG);
  });

  it('a refused resend says why and can be tried again', async () => {
    mocks.resend.mockResolvedValueOnce({ data: {}, error: { status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.' } });
    await signUpToCodeStep();
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('Too many attempts. Wait a minute and try again.');
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();
  });

  it('keeps "I’ve confirmed it: sign in" for someone who used the link, below the code', async () => {
    const { onSignIn } = await signUpToCodeStep();
    const signIn = screen.getByRole('button', { name: 'I’ve confirmed it: sign in' });
    expect(verifyButton().compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(signIn);
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('Back returns to the form', async () => {
    await signUpToCodeStep();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Confirmation code')).toBeNull();
  });

  it('holds the Display in the Duo Laptop pose: title and text above the fold, the code and buttons below', async () => {
    await signUpToCodeStep();
    const display = document.querySelector('.bw-auth-screen.bw-fold-form > :first-child') as HTMLElement;
    expect(display).not.toBeNull();
    expect(display.contains(screen.getByRole('heading', { name: 'Check your email' }))).toBe(true);
    for (const control of [codeField(), verifyButton(), screen.getByRole('button', { name: 'Send a new code' })]) {
      expect(display.contains(control)).toBe(false);
    }
  });

  it('is translated', async () => {
    setLocalePref('it');
    mocks.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: REFUSED });
    await signUpToCodeStep();
    expect(screen.getByRole('status').textContent).toBe(
      `Abbiamo inviato un codice di 6 cifre a ${EMAIL}. Inseriscilo qui per confermare l’indirizzo e completare la creazione dell’account.`,
    );
    const input = screen.getByLabelText('Codice di conferma');
    expect(screen.getByRole('button', { name: 'Verifica' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Invia un nuovo codice' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'L’ho confermato: accedi' })).toBeEnabled();
    fireEvent.change(input, { target: { value: '000000' } });
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('Il codice non corrisponde. Controllalo e riprova, oppure inviane uno nuovo.');
  });
});

describe('joining a band from an invite', () => {
  beforeEach(() => {
    mocks.path = 'joiner';
  });

  it('a new address gets the same code step, and verifying it goes on to the profile', async () => {
    const { onComplete } = await signUpToCodeStep({ prefilledEmail: 'invited@example.com' });
    expect(mocks.signIn).toHaveBeenCalledWith('invited@example.com', 'correct horse');
    expect(mocks.signUp).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toContain('invited@example.com');
    await type('135790');
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: 'invited@example.com', token: '135790', type: 'email' });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('an address that already has an account still gets "Wrong password", not a code', async () => {
    mocks.signUp.mockResolvedValue({ error: null, session: null, existing: true });
    render(<AccountCreation onBack={() => {}} onComplete={() => {}} prefilledEmail="invited@example.com" onForgotPassword={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'not my password' } });
    fireEvent.submit(document.getElementById('account-creation-form') as HTMLFormElement);
    await flush();
    expect(screen.getByRole('alert').textContent).toContain('Wrong password for invited@example.com.');
    expect(screen.queryByLabelText('Confirmation code')).toBeNull();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
});
