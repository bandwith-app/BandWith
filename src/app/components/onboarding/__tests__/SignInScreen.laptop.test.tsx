/**
 * Sign in on the iPhone Duo in Laptop pose: like the full-screen forms
 * (`.bw-fold-form`, rules in index.css), the title and the Google / Apple
 * buttons hold the Display and the email form starts on the Deck, so the
 * password field and Show password never rest across the fold.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    signIn: vi.fn(),
    signInWithGoogle: vi.fn(),
    signInWithApple: vi.fn(),
    isAuthenticated: false,
    authError: null,
    clearAuthError: vi.fn(),
  }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/services/biometric', () => ({
  checkBiometricAvailability: vi.fn(async () => ({ isAvailable: false, hasCredentials: false })),
}));

import { SignInScreen } from '../SignInScreen';

describe('Sign in in the Duo Laptop pose', () => {
  it('the title and Google / Apple hold the Display; email, password and Sign in start on the Deck', () => {
    render(<SignInScreen onBack={() => {}} onSuccess={() => {}} onForgotPassword={() => {}} onCreateAccount={() => {}} />);
    const display = document.querySelector('.bw-auth-screen.bw-fold-form > :first-child') as HTMLElement;
    expect(display).not.toBeNull();
    expect(display.contains(screen.getByRole('button', { name: /Continue with Google/i }))).toBe(true);
    expect(display.contains(screen.getByRole('button', { name: /Continue with Apple/i }))).toBe(true);
    expect(display.contains(screen.getByRole('heading', { name: /Sign in/i }))).toBe(true);

    for (const control of [
      screen.getByPlaceholderText('you@yourband.com'),
      screen.getByPlaceholderText('Your password'),
      screen.getByRole('button', { name: 'Show password' }),
      screen.getByRole('button', { name: /^Sign in$/i }),
    ]) {
      expect(display.contains(control)).toBe(false);
    }
  });

  it('Back stays in the top bar on every device', () => {
    render(<SignInScreen onBack={() => {}} onSuccess={() => {}} onForgotPassword={() => {}} />);
    const back = document.querySelector('.bw-duo-rail-back') as HTMLElement;
    expect(back.closest('.bw-status-clear')).not.toBeNull();
  });
});
