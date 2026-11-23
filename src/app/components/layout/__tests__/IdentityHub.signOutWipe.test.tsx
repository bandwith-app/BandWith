// Claude review #287 r9 (round 10): a sign-out that throws is answered by a
// device wipe. The push revocation the sign-out queued, and a token
// deletion still pending, must survive it (`bandwith.push-*`).
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

const bandState = vi.hoisted(() => ({ isAdmin: false }));

// Who is signed in when the hold starts watching (main's condition, round 10).
const signedInNow = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: { user: { id: string } } | null) => void) => {
        cb('INITIAL_SESSION', signedInNow.uid ? { user: { id: signedInNow.uid } } : null);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => ({ error: null }),
    },
  },
}));
// The wipe itself (#296's signOutWipe): the real one, unless a test makes it fail part-way.
const wipe = vi.hoisted(() => ({ fail: null as null | (() => void) }));
vi.mock('@/lib/signOutWipe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/signOutWipe')>();
  return {
    ...actual,
    wipeAfterFailedSignOut: async () => {
      if (!wipe.fail) return actual.wipeAfterFailedSignOut();
      wipe.fail();
      throw new Error('wipe failed');
    },
  };
});
// The real wipe holds the offline queues (syncQueue): a test can make that step throw, so the
// real wipe rejects after it raised the real "Signing out…" flag (signOutWipeState).
const queues = vi.hoisted(() => ({ fail: false }));
vi.mock('@/lib/offline/syncQueue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/offline/syncQueue')>();
  return {
    ...actual,
    withOfflineQueuesHeld: <T,>(fn: () => Promise<T>, waitMs?: number) =>
      queues.fail ? Promise.reject(new Error('the queues could not be held')) : actual.withOfflineQueuesHeld(fn, waitMs),
  };
});
vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
const failingSignOut = vi.hoisted(() =>
  vi.fn(async () => {
    // The sign-out queued its revocation, then something threw.
    localStorage.setItem('bandwith.push-revoke', '[{"token":"t","userId":"user-1"}]');
    throw new Error('boom');
  }),
);
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ signOut: failingSignOut, user: { id: 'user-1' }, profile: { id: 'user-1', full_name: 'Leo M.' } }),
}));
vi.mock('@/lib/ThemeContext', () => ({
  useTheme: () => ({ mode: 'system', setMode: vi.fn(), resolvedTheme: 'light' }),
}));
vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({
    isAdmin: bandState.isAdmin,
    selectedBand: { id: 'band-1', name: 'The Band', members: [], member_count: 4 },
    bands: [],
    refreshBands: vi.fn(),
  }),
}));
vi.mock('@/lib/services/notificationPrefs', () => ({
  readLocalPref: () => true,
  loadNotificationPrefs: vi.fn(async () => ({})),
  saveNotificationPrefs: vi.fn(async () => {}),
}));
vi.mock('@/lib/services/pricing', () => ({
  uploadBandBrandingAsset: vi.fn(),
  getBandPricing: vi.fn(async () => null),
  saveBandPricing: vi.fn(),
}));
vi.mock('@/app/components/ui/VenueAutocomplete', () => ({ VenueAutocomplete: () => null }));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { IdentityHub } from '../IdentityHub';
import { signOutWipeRunning } from '@/lib/signOutWipeState';
import { markSignOutFailed, takeSignOutFailed } from '@/lib/signOutNotice';
import { useForgetSignOutFailed, useSignOutFailedNotice } from '@/app/hooks/useSignOutFailedNotice';
import { APP_TOAST_EVENT, type AppToast } from '@/lib/appToast';
import type { Band } from '@/app/data/bands';

afterEach(cleanup);

const renderHub = (role: 'ADMIN' | 'MEMBER') => {
  bandState.isAdmin = role === 'ADMIN';
  const band = { id: 1, name: 'The Band', role, initials: 'TB', members: 4, genre: '', plan: 'Free' } as Band;
  render(
    <IdentityHub
      isOpen
      onClose={() => {}}
      bands={[band]}
      selectedBand={band}
      setSelectedBand={() => {}}
      entityCounts={{ templates: 2, documents: 3, inventory: 5, repertoire: 40 }}
      onEntityDetailClick={() => {}}
    />,
  );
};

describe('IdentityHub failed sign-out', () => {
  it('the wipe keeps the push revocation and the pending token deletion', async () => {
    signedInNow.uid = null;
    localStorage.clear();
    localStorage.setItem('bandwith.push-delete-pending', '1');
    localStorage.setItem('bw:user-1:band:quotes', '{"cached":true}');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHub('MEMBER');
    fireEvent.click(screen.getByRole('button', { name: /^sign out/i }));
    await waitFor(() => expect(failingSignOut).toHaveBeenCalled());
    await waitFor(() => expect(localStorage.getItem('bw:user-1:band:quotes')).toBeNull());
    expect(localStorage.getItem('bandwith.push-revoke')).toContain('"userId":"user-1"');
    expect(localStorage.getItem('bandwith.push-delete-pending')).toBe('1');
    err.mockRestore();
  });

  // Main's condition (round 10): the held keys are user-1's. Someone else is
  // signed in by the time the restore runs: the restore gives that session
  // nothing. On #296's wipe (release/2026-11-23) the push queue never leaves
  // the device in the first place (signOutWipe keeps `bandwith.push-*`, a
  // decision of #296 round 10), so the keys are as the sign-out left them:
  // unchanged by the wipe, and the restore has nothing to write.
  it("another account signed in before the restore: the push keys are as the sign-out left them, the restore writes nothing", async () => {
    signedInNow.uid = 'user-2';
    localStorage.clear();
    localStorage.setItem('bandwith.push-delete-pending', '1');
    localStorage.setItem('bw:user-1:band:quotes', '{"cached":true}');
    failingSignOut.mockClear();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHub('MEMBER');
    fireEvent.click(screen.getByRole('button', { name: /^sign out/i }));
    await waitFor(() => expect(failingSignOut).toHaveBeenCalled());
    const setItem = vi.spyOn(localStorage, 'setItem');
    await waitFor(() => expect(localStorage.getItem('bw:user-1:band:quotes')).toBeNull());
    expect(localStorage.getItem('bandwith.push-revoke')).toBe('[{"token":"t","userId":"user-1"}]');
    expect(localStorage.getItem('bandwith.push-delete-pending')).toBe('1');
    // Nothing held is written for the other session after the wipe.
    await new Promise((r) => setTimeout(r, 50));
    const pushWrites = setItem.mock.calls.filter(([k]) => String(k).startsWith('bandwith.push-'));
    setItem.mockRestore();
    expect(pushWrites.every(([k, v]) => localStorage.getItem(String(k)) === v)).toBe(true);
    err.mockRestore();
  });

  // Claude delta review #287 r10: the wipe itself fails part-way (here it
  // throws after everything was cleared): the push state still comes back.
  // #296's wipe never calls localStorage.clear, so the failure comes from the
  // wipe module itself (mocked above).
  it('a wipe that fails still puts the push state back', async () => {
    signedInNow.uid = null;
    localStorage.clear();
    localStorage.setItem('bandwith.push-delete-pending', '1');
    failingSignOut.mockClear();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cleared = vi.fn(() => {
      for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
    });
    wipe.fail = cleared;
    try {
      renderHub('MEMBER');
      fireEvent.click(screen.getByRole('button', { name: /^sign out/i }));
      await waitFor(() => expect(failingSignOut).toHaveBeenCalled());
      await waitFor(() => expect(cleared).toHaveBeenCalled());
      await waitFor(() => expect(localStorage.getItem('bandwith.push-revoke')).toContain('user-1'));
      expect(localStorage.getItem('bandwith.push-delete-pending')).toBe('1');
    } finally {
      wipe.fail = null;
      err.mockRestore();
    }
  });
});

// release/2026-11-23, commit A: a wipe that throws reloads the page (only the
// reload ends #296's "Signing out…" screen). With the session still there the
// person came back signed in without a word; now the app says so once.
describe('a wipe that throws: said after the reload, when still signed in', () => {
  const MARK = 'bw:sign-out-failed';
  /** The app after the reload: its toast listener, then the reader (AuthenticatedApp's order). */
  const toasts: AppToast[] = [];
  const onToast: EventListener = (e) => void toasts.push((e as CustomEvent<AppToast>).detail);
  const SignedInApp = () => {
    React.useEffect(() => {
      window.addEventListener(APP_TOAST_EVENT, onToast);
      return () => window.removeEventListener(APP_TOAST_EVENT, onToast);
    }, []);
    useSignOutFailedNotice();
    return null;
  };
  const SignedOutApp = () => {
    useForgetSignOutFailed(true);
    return null;
  };
  const start = () => {
    signedInNow.uid = null;
    localStorage.clear();
    sessionStorage.clear();
    toasts.length = 0;
    failingSignOut.mockClear();
  };

  it('the real wipe rejects under the "Signing out…" flag with the session still stored: marked, then said once', async () => {
    start();
    localStorage.setItem('sb-project-auth-token', '{"access_token":"x"}');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    queues.fail = true;
    try {
      renderHub('MEMBER');
      fireEvent.click(screen.getByRole('button', { name: /^sign out/i }));
      await waitFor(() => expect(failingSignOut).toHaveBeenCalled());
      await waitFor(() => expect(sessionStorage.getItem(MARK)).not.toBeNull());
      // #296's flag is up (the page shows only "Signing out…"): nothing can be said before the reload.
      expect(signOutWipeRunning()).toBe(true);
      // The wipe stopped before it reached the session.
      expect(localStorage.getItem('sb-project-auth-token')).not.toBeNull();
      expect(toasts).toEqual([]);
    } finally {
      queues.fail = false;
      err.mockRestore();
    }
    cleanup();
    // After the reload, still signed in: said once, the mark is gone.
    render(<SignedInApp />);
    expect(toasts).toEqual([{ message: 'Couldn’t sign out. Try again.', type: 'error' }]);
    expect(sessionStorage.getItem(MARK)).toBeNull();
    cleanup();
    render(<SignedInApp />);
    expect(toasts).toHaveLength(1);
  });

  it('signed out after the reload: the sign-out did happen, the mark goes unsaid', () => {
    start();
    markSignOutFailed();
    render(<SignedOutApp />);
    expect(sessionStorage.getItem(MARK)).toBeNull();
    cleanup();
    // Signing in again later in this tab says nothing.
    render(<SignedInApp />);
    expect(toasts).toEqual([]);
  });

  it('a failed sign-out whose wipe succeeds leaves no mark', async () => {
    start();
    localStorage.setItem('bw:user-1:band:quotes', '{"cached":true}');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHub('MEMBER');
    fireEvent.click(screen.getByRole('button', { name: /^sign out/i }));
    await waitFor(() => expect(failingSignOut).toHaveBeenCalled());
    await waitFor(() => expect(localStorage.getItem('bw:user-1:band:quotes')).toBeNull());
    await new Promise((r) => setTimeout(r, 50));
    expect(sessionStorage.getItem(MARK)).toBeNull();
    err.mockRestore();
  });

  it('sessionStorage blocked (private mode): no mark, no notice, nothing thrown', () => {
    start();
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    try {
      expect(() => markSignOutFailed()).not.toThrow();
      expect(takeSignOutFailed()).toBe(false);
      render(<SignedInApp />);
      expect(toasts).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
