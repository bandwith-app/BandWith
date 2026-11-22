// #296 round 12: a sign-out that failed wipes this device (signOutWipe), which
// signs out locally and then waits for a sync pass still running for the
// account that left (twice, 6 s each) before the reload. The sign-in form used
// to show for that whole time: a bandmate who signed in then had the pass go on
// under their session, so the first account's edits were saved as theirs.
// From the start of the wipe to the reload only "Signing out…" shows.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

const A = { id: '6f1c2a4e-1111-4a5b-9c3d-aaaaaaaaaaaa', email: 'a@example.test' };
const signedIn = { isAuthenticated: true, loading: false, userMode: null, profile: { id: A.id }, isPasswordRecovery: false, user: A, signOut: async () => ({ error: null }) };
const signedOut = { ...signedIn, isAuthenticated: false, profile: null, user: null };
const auth = vi.hoisted(() => ({ current: null as unknown }));
/** Promises the test lets go: the wipe's local sign-out and its cache clear. */
const gate = vi.hoisted(() => {
  const make = () => {
    let open: () => void = () => {};
    const promise = new Promise<void>((r) => {
      open = r;
    });
    return { promise, open };
  };
  return { make, signOut: make(), clear: make(), clearing: false };
});

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ bands: [{ id: 'b1' }], loading: false, refreshBands: async () => {}, error: null }),
}));
vi.mock('@/lib/OnboardingContext', () => ({
  useOnboarding: () => ({ startOnboarding: () => {}, goToStep: () => {}, resetOnboarding: () => {}, path: null, joinedEarly: false }),
}));
vi.mock('@/lib/deputyClaim', () => ({
  claimPendingDeputyToken: async () => {},
  deputyTokenFromUrl: () => null,
  pendingDeputyToken: () => null,
  savePendingDeputyToken: () => {},
  useDeputyClaim: () => ({ pending: false, result: null, dismiss: () => {} }),
}));
vi.mock('@/lib/services/deputies', () => ({ listMyDeputyGigs: async () => ({ data: { bands: [] }, error: null }) }));
vi.mock('@/lib/services/invitations', () => ({ inviteTokenFromUrl: () => null }));
vi.mock('@/lib/chartInbox', () => ({ isOpenedFileUrl: () => false, receiveChartFile: async () => {} }));
vi.mock('@/lib/appLock', () => ({ appLockSupported: () => false, markUnlocked: () => {}, shouldLockOnLaunch: () => false }));
vi.mock('@/lib/i18n/serverLocale', () => ({ useServerLocaleSync: () => {} }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: async () => ({ data: null, error: null }),
    auth: {
      // The wipe's first step: this device's session ends, so the app is signed out from here on.
      signOut: vi.fn(async () => {
        await gate.signOut.promise;
        auth.current = signedOut;
        return { error: null };
      }),
    },
  },
}));
// The screens App chooses between, as stand-ins.
vi.mock('../auth/callback', () => ({ default: () => <div data-testid="auth-callback" /> }));
vi.mock('../AuthenticatedApp', () => ({ default: () => <div data-testid="app" /> }));
vi.mock('../components/onboarding/OnboardingFlow', () => ({
  default: () => (
    <form aria-label="Sign in">
      <input aria-label="Email" />
      <button type="submit">Sign in</button>
    </form>
  ),
}));
// What the wipe works on: the clear waits for the test, the queues are held with no pass running.
vi.mock('@/lib/offline/storage', () => ({
  KEEP_ON_SIGN_OUT_PREFIXES: ['bw:live_refused:', 'bw:rehearsal_notes_rejected:', 'bw:chat_outbox:'],
  listOfflineKeys: async () => [],
  getOfflineItem: async () => null,
  setOfflineItem: async () => {},
  removeOfflineItem: async () => {},
  clearOfflineCache: async () => {
    gate.clearing = true;
    await gate.clear.promise;
  },
}));
vi.mock('@/lib/offline/syncQueue', () => ({ withOfflineQueuesHeld: <T,>(fn: () => Promise<T>) => fn() }));
vi.mock('@/lib/regiaAudio', () => ({ clearDownloadedAudio: async () => {} }));

import App from '../App';
import { wipeAfterFailedSignOut } from '@/lib/signOutWipe';

const signInForm = () => screen.queryByRole('form', { name: 'Sign in' });
const notice = () => screen.queryByRole('status');
/** Lazy screens and effects land. */
const settled = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));

describe('#296 round 12: a failed sign-out’s wipe blocks the sign-in screen until the reload', () => {
  beforeEach(() => {
    localStorage.clear();
    gate.signOut = gate.make();
    gate.clear = gate.make();
    gate.clearing = false;
  });

  // In this order: once started, the wipe is never "over" in this page (only a reload ends it).
  it('signed out, no wipe: the sign-in form shows (the stand-in works)', async () => {
    auth.current = signedOut;
    render(<App />);
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  // expect.soft: every line is checked, so a run on the old code shows each thing that was on screen.
  it('from the start of the wipe until after it ends: only "Signing out…", never the sign-in form, the app or the auth callback', async () => {
    auth.current = signedIn;
    const view = render(<App />);
    expect(await screen.findByTestId('app')).toBeInTheDocument();

    // IdentityHub's catch: sign-out threw, the device is wiped.
    let done = false;
    const wipe = wipeAfterFailedSignOut().then(() => {
      done = true;
    });
    // At once, before the wipe's first step (the local sign-out) has ended.
    await settled();
    expect.soft(screen.queryByTestId('app'), 'the app, at the start of the wipe').toBeNull();
    expect.soft(notice()?.textContent, 'the notice, at the start of the wipe').toBe('Signing out…');
    expect.soft(notice()?.getAttribute('aria-busy')).toBe('true');
    expect.soft(notice()?.getAttribute('aria-live')).toBe('polite');
    // Focus is on the notice, not left on a screen that is gone.
    expect.soft(notice() !== null && document.activeElement === notice(), 'focus on the notice').toBe(true);

    // This device's session ends: the app is signed out, a pass for A may still be running.
    gate.signOut.open();
    await waitFor(() => expect(gate.clearing).toBe(true));
    view.rerender(<App />);
    await settled();
    expect(done).toBe(false);
    expect.soft(signInForm(), 'the sign-in form, during the wipe').toBeNull();
    expect.soft(screen.queryByTestId('auth-callback')).toBeNull();
    expect.soft(notice()?.textContent, 'the notice, during the wipe').toBe('Signing out…');

    // The wipe ends; the reload comes next (IdentityHub). Until then nothing changes.
    gate.clear.open();
    await wipe;
    view.rerender(<App />);
    await settled();
    expect.soft(signInForm(), 'the sign-in form, after the wipe, before the reload').toBeNull();
    expect.soft(notice()?.textContent, 'the notice, after the wipe').toBe('Signing out…');
    expect.soft(document.querySelectorAll('input, button, a[href]'), 'anything to type in or press').toHaveLength(0);
  });

  it('an auth callback URL opened during the wipe signs nobody in', async () => {
    auth.current = signedOut;
    window.history.replaceState({}, '', '/auth/callback?code=abc');
    try {
      render(<App />);
      await settled();
      expect.soft(screen.queryByTestId('auth-callback')).toBeNull();
      expect.soft(notice()?.textContent).toBe('Signing out…');
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });
});
