/**
 * "Ready to rock": the lime pills at the top stand for the steps just done,
 * so there are as many as the path has steps (six with a band, three solo),
 * not a number typed into the screen.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { wizardTotal } from '../onboardingSteps';

const onboarding = vi.hoisted(() => ({ path: 'creator' as 'creator' | 'solo' }));
vi.mock('@/lib/OnboardingContext', () => ({
  useOnboarding: () => ({
    path: onboarding.path,
    bandData: onboarding.path === 'creator' ? { name: 'Night Owls' } : null,
    invites: [],
    songs: [],
    profileData: { fullName: 'Alex Rivera' },
  }),
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { email: 'alex.rivera@example.com' } }) }));
vi.mock('@/lib/systemBars', () => ({ setStatusBarTone: vi.fn() }));

import { CompletionScreen } from '../CompletionScreen';

/** The row of pills: the first thing on the screen, above the title. */
const pills = () => {
  const title = screen.getByRole('heading', { name: /Ready to rock/i });
  const row = title.closest('.bw-auth-screen')!.querySelector('[aria-hidden="true"]')!;
  return row.children.length;
};

beforeEach(() => {
  onboarding.path = 'creator';
});

describe('Ready to rock', () => {
  it('shows one pill per step of the band path', () => {
    render(<CompletionScreen onComplete={() => {}} />);
    expect(pills()).toBe(wizardTotal('creator'));
    expect(pills()).toBe(6);
  });

  it('shows one pill per step of the solo path', () => {
    onboarding.path = 'solo';
    render(<CompletionScreen onComplete={() => {}} />);
    expect(pills()).toBe(wizardTotal('solo'));
    expect(pills()).toBe(3);
  });
});
