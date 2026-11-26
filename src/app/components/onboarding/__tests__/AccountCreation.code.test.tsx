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
  authError: null as string | null,
  clearAuthError: vi.fn(),
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    signIn: mocks.signIn,
    signUp: mocks.signUp,
    signInWithGoogle: vi.fn(),
    signInWithApple: vi.fn(),
    authError: mocks.authError,
    clearAuthError: mocks.clearAuthError,
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
import { callbackProblemText } from '@/lib/authCallback';

const ONBOARDING_CONTEXT = Object.values(
  import.meta.glob('/src/lib/OnboardingContext.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)[0];

const EMAIL = 'alex@example.com';
const REFUSED = { name: 'AuthApiError', status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' };
const WRONG = 'That code doesn’t match. Check it and try again, or send a new one.';
const EXPIRED = 'This code has expired. Send a new one.';
const AUTO_CHECK = 'The code is checked as soon as you enter the last digit.';
const PASSWORD = 'correct horse';

/** A promise the test settles when it wants: a request still on its way. */
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** "Send a new code" rests a minute after the sign-up's own email. */
const waitOutResendCooldown = async () => {
  await act(async () => {
    vi.advanceTimersByTime(60_000);
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
  const ui = () => <AccountCreation onBack={() => {}} onComplete={onComplete} onSignIn={onSignIn} {...props} />;
  const view = render(ui());
  // (t(): the helper also runs in Italian.)
  if (mocks.path !== 'joiner') fireEvent.change(screen.getByPlaceholderText(t('Your name')), { target: { value: 'Alex' } });
  if (!props.prefilledEmail) fireEvent.change(screen.getByPlaceholderText('you@email.com'), { target: { value: EMAIL } });
  fireEvent.change(screen.getByPlaceholderText(t('Password')), { target: { value: PASSWORD } });
  fireEvent.submit(document.getElementById('account-creation-form') as HTMLFormElement);
  await flush();
  expect(screen.getByRole('heading', { name: t('Check your email') })).toBeInTheDocument();
  return { onComplete, onSignIn, rerender: () => view.rerender(ui()) };
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
  mocks.authError = null;
  mocks.clearAuthError.mockReset().mockImplementation(() => {
    mocks.authError = null;
  });
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
    expect(mocks.setAccountData).toHaveBeenCalledWith({ email: EMAIL, authMethod: 'email' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the password never reaches the onboarding state: the session is enough', async () => {
    await signUpToCodeStep();
    await type('482913');
    expect(mocks.setAccountData).toHaveBeenCalledTimes(1);
    expect(mocks.setAccountData.mock.calls[0][0]).not.toHaveProperty('password');
    expect(JSON.stringify(mocks.setAccountData.mock.calls)).not.toContain(PASSWORD);
  });

  it('nor with a sign-up that needs no confirmation', async () => {
    mocks.signUp.mockResolvedValue({ error: null, session: { access_token: 'a' }, existing: false });
    const onComplete = vi.fn();
    render(<AccountCreation onBack={() => {}} onComplete={onComplete} />);
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByPlaceholderText('you@email.com'), { target: { value: EMAIL } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: PASSWORD } });
    fireEvent.submit(document.getElementById('account-creation-form') as HTMLFormElement);
    await flush();
    expect(mocks.setAccountData).toHaveBeenCalledWith({ email: EMAIL, authMethod: 'email' });
    expect(JSON.stringify(mocks.setAccountData.mock.calls)).not.toContain(PASSWORD);
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('the onboarding state has no place for a password', () => {
    const accountData = ONBOARDING_CONTEXT.match(/accountData:\s*\{[^}]*\}\s*\|\s*null;/)?.[0] ?? '';
    expect(accountData).toContain('email: string');
    expect(accountData).not.toMatch(/password/i);
  });

  it('tells screen readers that the last digit checks the code on its own', async () => {
    await signUpToCodeStep();
    expect(codeField()).toHaveAccessibleDescription(expect.stringContaining(AUTO_CHECK));
    // Still tied to the field while an error shows.
    mocks.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: REFUSED });
    await type('000000');
    expect(codeField()).toHaveAccessibleDescription(expect.stringContaining(WRONG));
    expect(codeField()).toHaveAccessibleDescription(expect.stringContaining(AUTO_CHECK));
  });

  it('an expired confirmation link opened from the email says so here, and a new code can be sent', async () => {
    const { rerender } = await signUpToCodeStep();
    // The phone app comes back from the link with the callback's error (AuthContext).
    mocks.authError = callbackProblemText('link_expired', false).body;
    await act(async () => {
      rerender();
    });
    expect(mocks.clearAuthError).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toBe('This link has expired or was already used. Ask for a new one.');
    expect(codeField()).not.toHaveAttribute('aria-invalid');
    await waitOutResendCooldown();
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();
    // It goes away once the person acts on it.
    await type('4');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('another problem with the link (no connection) keeps its own sentence', async () => {
    const { rerender } = await signUpToCodeStep();
    mocks.authError = callbackProblemText('network', false).body;
    await act(async () => {
      rerender();
    });
    expect(screen.getByRole('alert').textContent).toBe('Check your connection and try again.');
  });

  it('while a code is being checked, a new one cannot be sent', async () => {
    const check = pending<unknown>();
    mocks.verifyOtp.mockReturnValueOnce(check.promise);
    await signUpToCodeStep();
    await waitOutResendCooldown();
    await type('482913');
    const send = screen.getByRole('button', { name: 'Send a new code' });
    expect(send).toBeDisabled();
    fireEvent.click(send);
    await flush();
    expect(mocks.resend).not.toHaveBeenCalled();

    // Refused: the code is still in the field, with its message.
    await act(async () => {
      check.resolve({ data: { user: null, session: null }, error: REFUSED });
    });
    await flush();
    expect(codeField().value).toBe('482913');
    expect(screen.getByRole('alert').textContent).toBe(WRONG);
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();
  });

  it('while a new code is being sent, the old one is not checked', async () => {
    const sending = pending<unknown>();
    mocks.resend.mockReturnValueOnce(sending.promise);
    const { onComplete } = await signUpToCodeStep();
    await waitOutResendCooldown();
    await type('48291');
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    await flush();
    expect(codeField()).toHaveAttribute('readonly');
    expect(verifyButton()).toBeDisabled();
    await type('482913');
    fireEvent.submit(document.getElementById('confirm-email-code-form') as HTMLFormElement);
    await flush();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();

    await act(async () => {
      sending.resolve({ data: {}, error: null });
    });
    await flush();
    expect(codeField().value).toBe('');
    expect(codeField()).not.toHaveAttribute('readonly');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('an empty field never says the code does not match', async () => {
    mocks.verifyOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: REFUSED });
    await signUpToCodeStep();
    await waitOutResendCooldown();
    await type('000000');
    expect(screen.getByRole('alert').textContent).toBe(WRONG);
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    await flush();
    expect(codeField().value).toBe('');
    expect(screen.queryByText(WRONG)).toBeNull();
    expect(codeField()).not.toHaveAttribute('aria-invalid');
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

  // Reddit report, 26 Nov 2026: "Send a new code" pressed 7 s after the
  // sign-up email went out. Supabase sends one email a minute per address
  // (429 over_email_send_rate_limit) and the screen said "Too many attempts"
  // with the button live again, so every press failed the same way.
  it('Send a new code rests for a minute from the sign-up itself, with the seconds left', async () => {
    await signUpToCodeStep();
    const waiting = screen.getByRole('button', { name: 'Send a new code (60 s)' });
    expect(waiting).toBeDisabled();
    fireEvent.click(waiting);
    await flush();
    expect(mocks.resend).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(18_000);
    });
    expect(screen.getByRole('button', { name: 'Send a new code (42 s)' })).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(42_000);
    });
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();
  });

  it('a resend refused for coming too soon waits the seconds Supabase gives and points to the spam folder', async () => {
    mocks.resend.mockResolvedValueOnce({ data: {}, error: { status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.' } });
    await signUpToCodeStep();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('We just sent you a code. Check your inbox and your spam folder.');
    expect(screen.getByRole('button', { name: 'Send a new code (42 s)' })).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(42_000);
    });
    expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();
  });

  it('a resend refused for another reason says why and can be tried again', async () => {
    mocks.resend.mockResolvedValueOnce({ data: {}, error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } });
    await signUpToCodeStep();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toBe('Check your connection and try again.');
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
    for (const control of [codeField(), verifyButton(), screen.getByRole('button', { name: /^Send a new code/ })]) {
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
    expect(screen.getByRole('button', { name: 'Invia un nuovo codice (60 s)' })).toBeDisabled();
    await waitOutResendCooldown();
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
