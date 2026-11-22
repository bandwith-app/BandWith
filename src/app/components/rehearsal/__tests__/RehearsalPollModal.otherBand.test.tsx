/**
 * Codex #297 B4: band A is selected, an admin opens band B's proposal. The
 * builder must use B's roster (who votes) and B's songs, never A's.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

const bandA = {
  id: 'bA',
  name: 'Band A',
  members: [{ user_id: 'ann', profile: { full_name: 'Ann Alto' } }, { user_id: 'admin', profile: { full_name: 'Alex Admin' } }],
};
const rosterCalls = vi.hoisted(() => [] as string[]);
const pickerBands = vi.hoisted(() => [] as (string | undefined)[]);

vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: bandA, refreshMembers: () => {} }),
}));
vi.mock('@/lib/services/bands', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/bands')>()),
  getBandRoster: async (bandId: string) => {
    rosterCalls.push(bandId);
    return {
      data: bandId === 'bB'
        ? [{ user_id: 'bob', profile: { full_name: 'Bob Bass' } }, { user_id: 'admin', profile: { full_name: 'Alex Admin' } }]
        : [],
      error: null,
    };
  },
}));
vi.mock('@/app/components/ui/SongPicker', () => ({
  SongPicker: (p: { bandId?: string }) => {
    pickerBands.push(p.bandId);
    return <div data-testid="song-picker">{p.bandId}</div>;
  },
}));
vi.mock('@/lib/bandAvailability', async (orig) => ({
  ...(await orig<typeof import('@/lib/bandAvailability')>()),
  useBandFreeDays: () => null,
  useCandidateFreeCounts: () => new Map(),
}));
vi.mock('./../useFocusSuggestions', () => ({ useFocusSuggestions: () => ({ ready: true, songs: [] }) }));
vi.mock('@/lib/services/rehearsalPolls', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/rehearsalPolls')>()),
  createOrPublishAdminPoll: vi.fn(),
}));

import { RehearsalPollModal } from '../RehearsalPollModal';

const proposal = {
  id: 'p1', band_id: 'bB', created_by: 'bob', creator_role: 'member', title: 'Band B jam', status: 'proposed',
  created_at: '2099-01-01', updated_at: '2099-01-01', options: [],
} as any;

describe("an admin opens another band's proposal", () => {
  it("Who votes lists that band's members, not the selected band's", async () => {
    render(<RehearsalPollModal isOpen onClose={() => {}} bandId="bB" adminId="admin" initialProposal={proposal} />);
    await act(async () => {});
    expect(rosterCalls).toContain('bB');
    const who = screen.getAllByRole('group', { name: 'Who votes' })[0];
    expect(within(who).getByRole('button', { name: 'Bob Bass' })).toBeTruthy();
    expect(within(who).queryByRole('button', { name: 'Ann Alto' })).toBeNull();
  });

  it("the song picker lists that band's songs", async () => {
    render(<RehearsalPollModal isOpen onClose={() => {}} bandId="bB" adminId="admin" initialProposal={proposal} />);
    await act(async () => {});
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    expect(screen.getByTestId('song-picker').textContent).toBe('bB');
  });
});
