import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';

// Joining from an invite link: the invite is accepted as soon as the account
// exists, not only on the last screen. Someone who closes the app after
// choosing a password is already in the band (Mirage Music, 20 Nov).

vi.mock('../AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'salvo@example.com' }, refreshProfile: vi.fn() }),
}));

const chain: Record<string, unknown> = {};
for (const m of ['select', 'eq', 'single', 'insert', 'upsert', 'update']) chain[m] = () => chain;
chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
vi.mock('../supabase', () => ({
  supabase: { from: () => chain, storage: { from: () => ({}) } },
  getOnboardingProgress: vi.fn(),
  updateOnboardingProgress: vi.fn().mockResolvedValue({ data: null, error: null }),
  createOnboardingProgress: vi.fn(),
}));
vi.mock('../services/bands', () => ({ createBand: vi.fn() }));
vi.mock('../onboardingBandLogo', () => ({ storeOnboardingBandLogo: vi.fn() }));

const acceptInvitation = vi.fn();
vi.mock('../services/invitations', () => ({
  acceptInvitation: (...a: unknown[]) => acceptInvitation(...a),
  InviteError: class extends Error {},
  inviteErrorMessage: () => '',
  inviteToBand: vi.fn(),
  parseInviteCode: vi.fn(),
  previewInvitation: vi.fn(),
}));

import { OnboardingProvider, shouldJoinEarly, useOnboarding } from '../OnboardingContext';

const wrapper = ({ children }: { children: React.ReactNode }) => <OnboardingProvider>{children}</OnboardingProvider>;

describe('joining as soon as the account exists', () => {
  beforeEach(() => {
    acceptInvitation.mockReset();
  });

  it('accepts the invite from the link once, and remembers it', async () => {
    acceptInvitation.mockResolvedValue('band-1');
    const hook = renderHook(() => useOnboarding(), { wrapper });
    await act(async () => {
      hook.result.current.startOnboarding('joiner');
      hook.result.current.setInviteToken('tok-1');
    });
    let ok = false;
    await act(async () => {
      ok = await hook.result.current.joinEarly();
    });
    expect(ok).toBe(true);
    expect(acceptInvitation).toHaveBeenCalledWith({ token: 'tok-1' });
    expect(hook.result.current.joinedEarly).toBe(true);

    await act(async () => {
      await hook.result.current.joinEarly();
    });
    expect(acceptInvitation).toHaveBeenCalledTimes(1);
  });

  it('accepts an invite found by email lookup by its id', async () => {
    acceptInvitation.mockResolvedValue('band-1');
    const hook = renderHook(() => useOnboarding(), { wrapper });
    await act(async () => {
      hook.result.current.startOnboarding('joiner');
      hook.result.current.setPendingInvitationId('inv-9');
    });
    await act(async () => {
      await hook.result.current.joinEarly();
    });
    expect(acceptInvitation).toHaveBeenCalledWith({ invitationId: 'inv-9' });
  });

  it('stays quiet when it fails: the last screen tries again and says why', async () => {
    acceptInvitation.mockRejectedValue(new Error('invite_email_mismatch'));
    const hook = renderHook(() => useOnboarding(), { wrapper });
    await act(async () => {
      hook.result.current.startOnboarding('joiner');
      hook.result.current.setInviteToken('tok-1');
    });
    let ok = true;
    await act(async () => {
      ok = await hook.result.current.joinEarly();
    });
    expect(ok).toBe(false);
    expect(hook.result.current.joinedEarly).toBe(false);
  });

  it('does nothing outside the invite path', async () => {
    const hook = renderHook(() => useOnboarding(), { wrapper });
    await act(async () => {
      hook.result.current.startOnboarding('creator');
    });
    await act(async () => {
      await hook.result.current.joinEarly();
    });
    expect(acceptInvitation).not.toHaveBeenCalled();
  });
});

describe('when the flow joins', () => {
  const base = { path: 'joiner' as const, isAuthenticated: true, currentStep: 1, inviteToken: 'tok', pendingInvitationId: null };
  it('joins once the account exists, past the invite screen', () => {
    expect(shouldJoinEarly(base)).toBe(true);
    expect(shouldJoinEarly({ ...base, currentStep: 2 })).toBe(true);
    expect(shouldJoinEarly({ ...base, inviteToken: null, pendingInvitationId: 'inv-1' })).toBe(true);
  });
  it('waits while signed out, on the invite screen, or with nothing to accept', () => {
    expect(shouldJoinEarly({ ...base, isAuthenticated: false })).toBe(false);
    expect(shouldJoinEarly({ ...base, currentStep: 0 })).toBe(false);
    expect(shouldJoinEarly({ ...base, inviteToken: null })).toBe(false);
    expect(shouldJoinEarly({ ...base, path: 'creator' })).toBe(false);
  });
});
