import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';

/**
 * Owner's report, 11-24: on a solo account (no band) Settings › Members
 * opened a blank page with a loader that span forever. The screen started
 * "loading" and only ever stopped after fetching the selected band's members:
 * with no band nothing was fetched, so nothing stopped it.
 */
const band = vi.hoisted(() => ({
  selectedBand: null as { id: string; name: string; is_personal?: boolean } | null,
  loading: false,
  error: null as Error | null,
  refreshBands: vi.fn(async () => {}),
}));
const getBandMembers = vi.hoisted(() => vi.fn(async () => ({ data: [], error: null })));

vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({
    selectedBand: band.selectedBand,
    bands: band.selectedBand ? [band.selectedBand] : [],
    loading: band.loading,
    error: band.error,
    isAdmin: false,
    refreshBands: band.refreshBands,
    refreshMembers: vi.fn(),
  }),
  useOptionalBand: () => undefined,
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' }, profile: { id: 'me', full_name: 'Leo M.' } }) }));
vi.mock('@/lib/haptics', () => ({
  haptic: { tap: vi.fn(), medium: vi.fn(), confirm: vi.fn(), delete: vi.fn(), selection: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/services/bands', () => ({
  getBandMembers,
  removeMember: vi.fn(),
  updateMemberRole: vi.fn(),
  updateMemberBandDetails: vi.fn(),
  searchUsers: vi.fn(async () => ({ data: [], error: null })),
}));
vi.mock('@/app/components/band/DeputiesSection', () => ({ DeputiesSection: () => null }));
vi.mock('@/app/components/band/PendingInvitesSection', () => ({ PendingInvitesSection: () => null }));
vi.mock('@/app/components/band/MemberDetail', () => ({ MemberDetail: () => null }));
vi.mock('@/app/components/academy/AcademyHelpButton', () => ({ AcademyHelpButton: () => null }));

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { BandMembersView } from '../BandMembersView';

const loader = () => document.querySelector('.animate-spin');

beforeEach(() => {
  band.selectedBand = null;
  band.loading = false;
  band.error = null;
  band.refreshBands.mockClear();
  getBandMembers.mockClear();
});
afterEach(cleanup);

describe('Band members with no band', () => {
  it('ends in "Band required" with Create a band, not in a loader', async () => {
    const onCreateBand = vi.fn();
    render(<BandMembersView onClose={() => {}} onCreateBand={onCreateBand} />);
    expect(await screen.findByRole('heading', { name: /band required/i })).toBeTruthy();
    expect(loader()).toBeNull();
    expect(getBandMembers).not.toHaveBeenCalled();
    // Nothing of a band's screen is offered.
    expect(screen.queryByRole('button', { name: /invite member/i })).toBeNull();
    expect(screen.queryByText(/no members yet/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /create a band/i }));
    expect(onCreateBand).toHaveBeenCalledTimes(1);
  });

  it('keeps its Back, so the screen can always be left', async () => {
    const onClose = vi.fn();
    render(<BandMembersView onClose={onClose} />);
    await screen.findByRole('heading', { name: /band required/i });
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a personal band (the planned hidden band of one) has no members list either', async () => {
    band.selectedBand = { id: 'band-p', name: 'Leo M.', is_personal: true };
    render(<BandMembersView onClose={() => {}} onCreateBand={() => {}} />);
    expect(await screen.findByRole('heading', { name: /band required/i })).toBeTruthy();
    expect(loader()).toBeNull();
  });

  it('bands that could not be loaded: it says so and offers Try again, no loader and no "Band required"', async () => {
    band.error = new Error('Failed to fetch');
    render(<BandMembersView onClose={() => {}} onCreateBand={() => {}} />);
    expect(await screen.findByRole('heading', { name: /can’t load your bands/i })).toBeTruthy();
    expect(loader()).toBeNull();
    expect(screen.queryByRole('heading', { name: /band required/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(band.refreshBands).toHaveBeenCalledTimes(1);
  });

  it('while the band list is still loading it waits (a band may come), then loads that band', async () => {
    band.loading = true;
    const { rerender } = render(<BandMembersView onClose={() => {}} />);
    expect(loader()).not.toBeNull();
    expect(screen.queryByRole('heading', { name: /band required/i })).toBeNull();

    band.loading = false;
    band.selectedBand = { id: 'band-1', name: 'Velvet Static' };
    await act(async () => {
      rerender(<BandMembersView onClose={() => {}} />);
    });
    expect(getBandMembers).toHaveBeenCalledWith('band-1');
    expect(await screen.findByText(/no members yet/i)).toBeTruthy();
    expect(loader()).toBeNull();
  });
});
