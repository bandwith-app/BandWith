import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, act } from '@testing-library/react';

// P0: a member who joins (or leaves) mid-session shows up in the lineup
// pickers right away. The band context reloads the rosters on the band's
// join/leave notice, when the app comes back, and when a picker opens.
const h = vi.hoisted(() => ({
  members: [{ user_id: 'admin' }] as { user_id: string }[],
  notice: null as null | ((n: { type: string }) => void),
  resume: null as null | (() => void),
  getBands: vi.fn(),
}));
vi.mock('../AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 'admin' } }) }));
vi.mock('../offline/storage', () => ({
  getOfflineItem: vi.fn(async () => null),
  setOfflineItem: vi.fn(async () => {}),
  getCacheKey: (...parts: unknown[]) => parts.join(':'),
  syncCachedRoles: vi.fn(async () => false),
}));
vi.mock('../services/pricing', () => ({ getBandPricing: vi.fn(async () => ({})) }));
vi.mock('../services/bands', () => ({ getBands: h.getBands, getBand: vi.fn() }));
vi.mock('../services/notifications', () => ({
  subscribeToNotifications: (cb: (n: { type: string }) => void) => {
    h.notice = cb;
    return () => {};
  },
}));
vi.mock('../appResume', () => ({
  onAppResume: (cb: () => void) => {
    h.resume = cb;
    return () => {};
  },
}));

import { BandProvider, useBand } from '../BandContext';

h.getBands.mockImplementation(async () => ({
  data: [{ id: 'b1', name: 'Band', user_role: 'admin', members: h.members.map((m) => ({ ...m })) }],
  error: null,
}));

function Roster() {
  const { selectedBand, refreshMembers } = useBand();
  return (
    <div>
      <span data-testid="count">{selectedBand?.members?.length ?? 0}</span>
      <button onClick={() => void refreshMembers()}>open picker</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  h.members = [{ user_id: 'admin' }];
});

describe('band rosters stay current', () => {
  it('reloads on a join notice, on resume and when a picker opens', async () => {
    render(<BandProvider><Roster /></BandProvider>);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));

    h.members = [{ user_id: 'admin' }, { user_id: 'new' }];
    await act(async () => h.notice?.({ type: 'member_joined' }));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));

    h.members = [{ user_id: 'admin' }];
    await act(async () => h.resume?.());
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));

    h.members = [{ user_id: 'admin' }, { user_id: 'other' }];
    await act(async () => screen.getByText('open picker').click());
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
  });

  it('other notices do not reload the bands', async () => {
    render(<BandProvider><Roster /></BandProvider>);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    const calls = h.getBands.mock.calls.length;
    await act(async () => h.notice?.({ type: 'event_invite' }));
    expect(h.getBands.mock.calls.length).toBe(calls);
  });
});
