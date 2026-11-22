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
    },
  },
}));
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
  // signed in by the time the restore runs: nothing of user-1's comes back.
  it("another account signed in before the restore: the previous account's push state is not put back", async () => {
    signedInNow.uid = 'user-2';
    localStorage.clear();
    localStorage.setItem('bandwith.push-delete-pending', '1');
    localStorage.setItem('bw:user-1:band:quotes', '{"cached":true}');
    failingSignOut.mockClear();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHub('MEMBER');
    fireEvent.click(screen.getByRole('button', { name: /^sign out/i }));
    await waitFor(() => expect(failingSignOut).toHaveBeenCalled());
    await waitFor(() => expect(localStorage.getItem('bw:user-1:band:quotes')).toBeNull());
    expect(localStorage.getItem('bandwith.push-revoke')).toBeNull();
    expect(localStorage.getItem('bandwith.push-delete-pending')).toBeNull();
    err.mockRestore();
  });
});
