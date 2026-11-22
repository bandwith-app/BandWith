/**
 * Codex #297 r7 B4 (= Claude r6 #3): a new poll is saved but its notices
 * fail ("Try again"). The form keeps the id it got back, so the retry is
 * the same poll (the service replays it) and never a second one.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

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
const publish = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ data: null as unknown, error: null as unknown })));
vi.mock('@/lib/services/rehearsalPolls', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/rehearsalPolls')>()),
  createOrPublishAdminPoll: (...a: unknown[]) => publish(...a),
}));

import { RehearsalPollModal } from '../RehearsalPollModal';

describe('a new poll published, its notices failed, published again', () => {
  it('Try again sends the id of the poll it already made, as a new poll (no proposal id)', async () => {
    const saved = { id: '0b9a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d', band_id: 'bA', title: 'Thursday rehearsal' };
    publish.mockReset();
    publish.mockResolvedValueOnce({ data: saved, error: Object.assign(new Error("The poll is published, but the band couldn't be notified. Try again."), { code: 'poll_notify_failed' }) });
    publish.mockResolvedValueOnce({ data: saved, error: null });
    render(<RehearsalPollModal isOpen onClose={() => {}} bandId="bA" adminId="admin" />);
    await act(async () => {});
    for (const f of screen.getAllByLabelText('Poll title') as HTMLInputElement[]) fireEvent.change(f, { target: { value: 'Thursday rehearsal' } });
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Add selected days to poll' })[0]); });
    const btn = () => (screen.getAllByRole('button', { name: /Publish poll/ }) as HTMLButtonElement[]).find((b) => !b.disabled)!;
    await act(async () => { fireEvent.click(btn()); });
    expect(screen.getAllByText("The poll is published, but the band couldn't be notified. Try again.").length).toBeGreaterThan(0);
    await act(async () => { fireEvent.click(btn()); });
    expect(publish).toHaveBeenCalledTimes(2);
    const [first, second] = publish.mock.calls.map((c) => c[0] as { clientId?: string; pollId?: string });
    expect(second.clientId).toBe(saved.id);
    expect(second.pollId).toBeUndefined();
    expect(first.pollId).toBeUndefined();
  });
});
