import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

/**
 * Owner's report, 11-24: a solo account (no band) saw "Members" in Settings;
 * the page it opened loaded forever. With no band the hub shows the personal
 * calendar and the way to a band, and nothing that belongs to a band.
 */
const state = vi.hoisted(() => ({
  userMode: 'solo' as string | null,
  bands: [] as { id: string; name: string }[],
  selectedBand: null as { id: string; name: string; members: unknown[]; member_count: number } | null,
  loading: false,
  isAdmin: false,
}));

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    signOut: vi.fn(),
    user: { id: 'user-1', email: 'leo@example.com' },
    // A sign-up's own default role; the demo account's old one must not matter either.
    profile: { id: 'user-1', full_name: 'Leo M.', role: 'admin', user_mode: state.userMode },
    userMode: state.userMode,
  }),
}));
vi.mock('@/lib/ThemeContext', () => ({
  useTheme: () => ({ mode: 'system', setMode: vi.fn(), resolvedTheme: 'light' }),
}));
vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({
    isAdmin: state.isAdmin,
    selectedBand: state.selectedBand,
    bands: state.bands,
    loading: state.loading,
    error: null,
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

beforeEach(() => {
  state.userMode = 'solo';
  state.bands = [];
  state.selectedBand = null;
  state.loading = false;
  state.isAdmin = false;
});
afterEach(cleanup);

// What AuthenticatedApp hands the hub for an account with no band.
const placeholder = { id: 0, name: 'My calendar', role: 'MEMBER', initials: 'P', members: 1, genre: 'Solo', plan: 'Free' } as Band;

const renderHub = (over: Partial<React.ComponentProps<typeof IdentityHub>> = {}) => {
  const props = {
    onEditBand: vi.fn(),
    onEntityDetailClick: vi.fn(),
    onAddEntity: vi.fn(),
    onOpenPricing: vi.fn(),
    onOpenBandSettings: vi.fn(),
    ...over,
  };
  render(
    <IdentityHub
      isOpen
      onClose={() => {}}
      bands={[]}
      selectedBand={placeholder}
      setSelectedBand={() => {}}
      entityCounts={{ templates: 0, documents: 0, inventory: 0, repertoire: 0 }}
      {...props}
    />,
  );
  return props;
};

const bandOnly = [/^members/i, /^repertoire:/i, /^gear & inventory:/i, /^to-do lists:/i, /^contracts & docs:/i, /^pricing, fees & services/i, /^band settings$/i, /^new band$/i];

describe('Account hub with no band', () => {
  it('the solo path: no Members, no band assets, no band settings', () => {
    renderHub();
    for (const name of bandOnly) expect(screen.queryByRole('button', { name }), String(name)).toBeNull();
    expect(screen.queryByText(/band assets & workflows/i)).toBeNull();
    expect(screen.getByText(/^solo schedule$/i)).toBeTruthy();
    expect(screen.getByRole('heading', { name: /^my calendar$/i })).toBeTruthy();
  });

  it('one way on: Create a band', () => {
    const props = renderHub();
    fireEvent.click(screen.getByRole('button', { name: /^create a band$/i }));
    expect(props.onAddEntity).toHaveBeenCalledTimes(1);
  });

  it('no band although the profile never said "solo" (it left its last band): the same', () => {
    state.userMode = 'band_admin';
    // The stale placeholder an admin used to get: role ADMIN with no band behind it.
    renderHub({ selectedBand: { ...placeholder, name: 'My band', role: 'ADMIN' } as Band });
    for (const name of bandOnly) expect(screen.queryByRole('button', { name }), String(name)).toBeNull();
    expect(screen.queryByRole('button', { name: /^edit$/i, expanded: false })).toBeNull();
    expect(screen.getByRole('button', { name: /^create a band$/i })).toBeTruthy();
  });

  it('while the band list is loading nothing is taken away from a band account', () => {
    state.userMode = 'member';
    state.loading = true;
    renderHub();
    expect(screen.getByRole('button', { name: /^members/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^repertoire:/i })).toBeTruthy();
  });
});

describe('Account hub in a band (unchanged)', () => {
  it('a member sees Members and the band assets, and can start another band', () => {
    state.userMode = 'member';
    state.bands = [{ id: 'band-1', name: 'The Band' }];
    state.selectedBand = { id: 'band-1', name: 'The Band', members: [], member_count: 4 };
    const band = { id: 1, name: 'The Band', role: 'MEMBER', initials: 'TB', members: 4, genre: '', plan: 'Free' } as Band;
    const props = renderHub({ selectedBand: band, bands: [band] });
    fireEvent.click(screen.getByRole('button', { name: /^members \(4\)/i }));
    expect(props.onEditBand).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /^repertoire:/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^new band$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^create a band$/i })).toBeNull();
  });
});
