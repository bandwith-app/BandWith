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
const roster = vi.hoisted(() => ({ pending: false, fail: false }));

vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({ selectedBand: bandA, refreshMembers: () => {} }),
}));
vi.mock('@/lib/services/bands', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/bands')>()),
  getBandRoster: async (bandId: string) => {
    rosterCalls.push(bandId);
    if (roster.pending) return new Promise(() => {});
    if (roster.fail) return { data: null, error: new Error('network') };
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
const publish = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ data: null, error: new Error('lost') })));
vi.mock('@/lib/services/rehearsalPolls', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/rehearsalPolls')>()),
  createOrPublishAdminPoll: (...a: unknown[]) => publish(...a),
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

describe('Publish waits for that band to load (Claude #297 round 3)', () => {
  const withSlot = { ...proposal, options: [{ id: 'o1', proposed_date: '2099-12-07', start_time: '20:00', end_time: '22:00' }] };
  const publishButtons = () => screen.getAllByRole('button', { name: /Publish poll/ }) as HTMLButtonElement[];

  it("stays off while band B's members are still loading", async () => {
    roster.pending = true;
    render(<RehearsalPollModal isOpen onClose={() => {}} bandId="bB" adminId="admin" initialProposal={withSlot} />);
    await act(async () => {});
    expect(publishButtons().length).toBeGreaterThan(0);
    for (const b of publishButtons()) expect(b.disabled).toBe(true);
    roster.pending = false;
  });

  it('turns on once they are in', async () => {
    roster.pending = false;
    render(<RehearsalPollModal isOpen onClose={() => {}} bandId="bB" adminId="admin" initialProposal={withSlot} />);
    await act(async () => {});
    expect(publishButtons().some((b) => !b.disabled)).toBe(true);
  });
});

describe("band B's roster failed to load (Claude #297 round 3)", () => {
  const withSlot = { ...proposal, options: [{ id: 'o1', proposed_date: '2099-12-07', start_time: '20:00', end_time: '22:00' }] };
  it('says so and keeps Publish off (never "everyone")', async () => {
    roster.fail = true;
    render(<RehearsalPollModal isOpen onClose={() => {}} bandId="bB" adminId="admin" initialProposal={withSlot} />);
    await act(async () => {});
    expect(screen.getAllByText("Couldn't load this band's members. Close and reopen to try again.").length).toBeGreaterThan(0);
    for (const b of screen.getAllByRole('button', { name: /Publish poll/ }) as HTMLButtonElement[]) expect(b.disabled).toBe(true);
    roster.fail = false;
  });
});

describe('one request id per opening (Codex #297 round 3 B1)', () => {
  it('a second tap on Publish after an error sends the same id', async () => {
    roster.fail = false;
    publish.mockClear();
    const withSlot = { ...proposal, options: [{ id: 'o1', proposed_date: '2099-12-07', start_time: '20:00', end_time: '22:00' }] };
    render(<RehearsalPollModal isOpen onClose={() => {}} bandId="bB" adminId="admin" initialProposal={withSlot} />);
    await act(async () => {});
    const btn = () => (screen.getAllByRole('button', { name: /Publish poll/ }) as HTMLButtonElement[]).find((b) => !b.disabled)!;
    await act(async () => { fireEvent.click(btn()); });
    await act(async () => { fireEvent.click(btn()); });
    expect(publish).toHaveBeenCalledTimes(2);
    const ids = publish.mock.calls.map((c) => (c[0] as { clientId?: string }).clientId);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
  });
});
