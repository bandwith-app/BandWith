/**
 * "Check your email": the system Back (Android's Back button or gesture,
 * Escape on a keyboard) does what the Back button on the screen does: the
 * Create account form again, with what was typed in it. Before, the screen
 * was unknown to the app's back handling, and the onboarding, which only
 * knew "step 1", left for the Welcome screen.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  setAccountData: vi.fn(),
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    signIn: vi.fn(),
    signUp: mocks.signUp,
    signInWithGoogle: vi.fn(),
    signInWithApple: vi.fn(),
    authError: null,
    clearAuthError: vi.fn(),
  }),
}));
vi.mock('@/lib/OnboardingContext', () => ({
  useOnboarding: () => ({ setAccountData: mocks.setAccountData, path: 'creator' }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { verifyOtp: vi.fn(), resend: vi.fn() } },
  getAuthCallbackUrl: () => 'https://app.bandwith.fun/auth/callback',
}));

import { AccountCreation } from '../AccountCreation';
import { closeTopOverlay } from '@/lib/overlayBack';
import { setLocalePref } from '@/lib/i18n';

const NAME = 'Alex Rivera';
const EMAIL = 'alex.rivera@example.com';
const PASSWORD = 'correct horse';

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

async function signUpToCodeStep() {
  const onBack = vi.fn();
  render(<AccountCreation onBack={onBack} onComplete={() => {}} onSignIn={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: NAME } });
  fireEvent.change(screen.getByPlaceholderText('you@email.com'), { target: { value: EMAIL } });
  fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: PASSWORD } });
  fireEvent.submit(document.getElementById('account-creation-form') as HTMLFormElement);
  await flush();
  expect(screen.getByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
  return { onBack };
}

beforeEach(() => {
  setLocalePref('en');
  mocks.signUp.mockReset().mockResolvedValue({ error: null, session: null, existing: false });
  mocks.setAccountData.mockReset();
});

describe('Check your email: the system Back', () => {
  it('goes back to Create account with the fields kept, like the Back button on the screen', async () => {
    const { onBack } = await signUpToCodeStep();

    // What the onboarding asks first on Android Back / Escape (OnboardingFlow.handleBack).
    let handled = false;
    act(() => {
      handled = closeTopOverlay();
    });

    expect(handled, 'the screen takes the Back press').toBe(true);
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Check your email' })).toBeNull();
    expect((screen.getByPlaceholderText('Your name') as HTMLInputElement).value).toBe(NAME);
    expect((screen.getByPlaceholderText('you@email.com') as HTMLInputElement).value).toBe(EMAIL);
    expect((screen.getByPlaceholderText('Password') as HTMLInputElement).value).toBe(PASSWORD);
    // Not the step's own Back (the Welcome screen).
    expect(onBack).not.toHaveBeenCalled();
  });

  it('is the form’s again once the code screen is gone: the next Back is not taken', async () => {
    await signUpToCodeStep();
    act(() => {
      closeTopOverlay();
    });
    let handled = true;
    act(() => {
      handled = closeTopOverlay();
    });
    expect(handled).toBe(false);
  });
});
