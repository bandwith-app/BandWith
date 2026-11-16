/**
 * Poll builder: Back with nothing typed goes straight back to the rehearsal
 * wizard. "Discard this poll?" is only for a poll the admin actually changed.
 *
 * The roster refresh that runs when the builder opens re-renders it once
 * before the prefilled title lands; what the poll opens with must still be
 * the "nothing typed" baseline.
 */
import React, { useSyncExternalStore } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// The band roster as a store: refreshing it re-renders its readers at once.
const roster = (() => {
  let band = { id: 'b1', name: 'Band', members: [] as unknown[] };
  const subs = new Set<() => void>();
  return {
    get: () => band,
    subscribe: (fn: () => void) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    refresh: () => {
      band = { ...band, members: [] };
      subs.forEach((fn) => fn());
    },
  };
})();

vi.mock('@/lib/BandContext', () => ({
  useBand: () => ({
    selectedBand: useSyncExternalStore(roster.subscribe, roster.get),
    refreshMembers: roster.refresh,
  }),
}));
vi.mock('@/lib/bandAvailability', async (orig) => ({
  ...(await orig<typeof import('@/lib/bandAvailability')>()),
  useBandFreeDays: () => null,
  useCandidateFreeCounts: () => new Map(),
}));
vi.mock('@/lib/services/rehearsalPolls', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/rehearsalPolls')>()),
  createOrPublishAdminPoll: vi.fn(),
}));

import { RehearsalPollModal } from '../RehearsalPollModal';

describe('Poll builder with nothing typed', () => {
  it('Back returns to the rehearsal wizard without asking to discard', async () => {
    const back = vi.fn();
    render(<RehearsalPollModal isOpen onClose={() => {}} bandId="b1" adminId="a1" onScheduleDirectly={back} />);
    await act(async () => {});
    expect(screen.getByDisplayValue('Upcoming Rehearsal Availability')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Back' })[0]);
    expect(screen.queryByText('Discard this poll?')).toBeNull();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('a typed title still asks before going back', async () => {
    const back = vi.fn();
    render(<RehearsalPollModal isOpen onClose={() => {}} bandId="b1" adminId="a1" onScheduleDirectly={back} />);
    await act(async () => {});
    fireEvent.change(screen.getByDisplayValue('Upcoming Rehearsal Availability'), { target: { value: 'Horn run-through' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Back' })[0]);
    expect(screen.getByText('Discard this poll?')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });
});
