import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// Band members → Invited: admins see who hasn't joined yet and can send the
// invite again, copy its link or cancel it (migration 166).

const list = vi.fn();
const cancel = vi.fn();
const invite = vi.fn();
vi.mock('@/lib/services/invitations', () => ({
  listBandInvitations: (...a: unknown[]) => list(...a),
  cancelInvitation: (...a: unknown[]) => cancel(...a),
  inviteToBand: (...a: unknown[]) => invite(...a),
  inviteLink: (token: string) => `https://app.bandwith.fun/?invite=${token}`,
}));

import { PendingInvitesSection } from '../PendingInvitesSection';

const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
const waiting = {
  id: 'i1', email: 'salvo@example.com', role: 'admin' as const, status: 'waiting' as const,
  sentAt: past, expiresAt: future, emailSent: true, token: 'tok-1', inviterName: 'Gianluca', hasAccount: false,
};
const expired = {
  id: 'i2', email: 'late@example.com', role: 'member' as const, status: 'expired' as const,
  sentAt: past, expiresAt: past, emailSent: true, token: 'tok-2', inviterName: null, hasAccount: false,
};

const openMenu = (email: string) => fireEvent.click(screen.getByRole('button', { name: `Actions for ${email}` }));

describe('PendingInvitesSection', () => {
  beforeEach(() => {
    list.mockReset();
    cancel.mockReset();
    invite.mockReset();
  });

  it('lists who is waiting and who expired', async () => {
    list.mockResolvedValue({ invites: [waiting, expired], unavailable: false });
    render(<PendingInvitesSection bandId="b1" />);
    const items = await screen.findAllByRole('listitem');
    expect(list).toHaveBeenCalledWith('b1');
    expect(screen.getByRole('heading', { name: 'Invited' })).toBeTruthy();
    expect(within(items[0]).getByText('salvo@example.com')).toBeTruthy();
    expect(within(items[0]).getByText('Not accepted yet')).toBeTruthy();
    expect(within(items[0]).getByText(/Admin/)).toBeTruthy();
    expect(within(items[1]).getByText('Expired')).toBeTruthy();
  });

  it('shows nothing when no one is waiting', async () => {
    list.mockResolvedValue({ invites: [], unavailable: false });
    const { container } = render(<PendingInvitesSection bandId="b1" />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('sends the invite again with the same email and role, then reloads', async () => {
    list.mockResolvedValue({ invites: [waiting], unavailable: false });
    invite.mockResolvedValue({ kind: 'invited', token: 'tok-1', inviteUrl: null, emailSent: true });
    render(<PendingInvitesSection bandId="b1" inviterName="Gianluca" />);
    await screen.findByText('salvo@example.com');
    openMenu('salvo@example.com');
    fireEvent.click(screen.getByRole('menuitem', { name: /Send again/ }));
    await waitFor(() =>
      expect(invite).toHaveBeenCalledWith({ bandId: 'b1', email: 'salvo@example.com', role: 'admin', inviterName: 'Gianluca' }),
    );
    await screen.findByText('Invite sent again to salvo@example.com.');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('copies the invite link', async () => {
    list.mockResolvedValue({ invites: [waiting], unavailable: false });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<PendingInvitesSection bandId="b1" />);
    await screen.findByText('salvo@example.com');
    openMenu('salvo@example.com');
    fireEvent.click(screen.getByRole('menuitem', { name: /Copy link/ }));
    expect(writeText).toHaveBeenCalledWith('https://app.bandwith.fun/?invite=tok-1');
    await screen.findByText('Link copied');
  });

  it('cancels only after confirming', async () => {
    list.mockResolvedValue({ invites: [waiting, expired], unavailable: false });
    cancel.mockResolvedValue(undefined);
    render(<PendingInvitesSection bandId="b1" />);
    await screen.findByText('salvo@example.com');
    openMenu('salvo@example.com');
    fireEvent.click(screen.getByRole('menuitem', { name: /Cancel invite/ }));
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('i1'));
    await waitFor(() => expect(screen.queryByText('salvo@example.com')).toBeNull());
    expect(screen.getByText('late@example.com')).toBeTruthy();
  });

  it('reloads when a new invite is sent from the screen', async () => {
    list.mockResolvedValue({ invites: [waiting], unavailable: false });
    const { rerender } = render(<PendingInvitesSection bandId="b1" reloadKey={0} />);
    await screen.findByText('salvo@example.com');
    rerender(<PendingInvitesSection bandId="b1" reloadKey={1} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});
