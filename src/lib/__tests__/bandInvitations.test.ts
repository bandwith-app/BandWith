import { describe, it, expect, vi, beforeEach } from 'vitest';

// Band members → Invited (migration 166): the admin's list of invites that
// haven't turned into members yet.

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/services/email', () => ({ sendOnboardingInviteEmail: vi.fn() }));

import { cancelInvitation, inviteLink, listBandInvitations } from '../services/invitations';

describe('band invitations for admins', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('lists the band invites with their state', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: 'i1', email: 'salvo@example.com', role: 'admin', status: 'pending',
          created_at: '2026-11-18T19:02:00Z', expires_at: '2026-11-25T19:02:00Z', email_sent_at: '2026-11-18T19:02:04Z',
          token: '1bd24b4e-07f5-499d-bdb7-2092a2c157e7', inviter_name: 'Gianluca', has_account: false,
        },
        { id: 'i2', email: 'late@example.com', role: 'member', status: 'expired', created_at: '2026-11-01T10:00:00Z', expires_at: '2026-11-08T10:00:00Z', email_sent_at: null, token: 't2', inviter_name: null, has_account: true },
      ],
      error: null,
    });
    const res = await listBandInvitations('band-1');
    expect(rpc).toHaveBeenCalledWith('bw_band_invitations', { p_band_id: 'band-1' });
    expect(res.unavailable).toBe(false);
    expect(res.invites).toEqual([
      {
        id: 'i1', email: 'salvo@example.com', role: 'admin', status: 'waiting',
        sentAt: '2026-11-18T19:02:00Z', expiresAt: '2026-11-25T19:02:00Z', emailSent: true,
        token: '1bd24b4e-07f5-499d-bdb7-2092a2c157e7', inviterName: 'Gianluca', hasAccount: false,
      },
      {
        id: 'i2', email: 'late@example.com', role: 'member', status: 'expired',
        sentAt: '2026-11-01T10:00:00Z', expiresAt: '2026-11-08T10:00:00Z', emailSent: false,
        token: 't2', inviterName: null, hasAccount: true,
      },
    ]);
  });

  it('says "not available yet" when the server has no list (before 166)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const res = await listBandInvitations('band-1');
    expect(res).toEqual({ invites: [], unavailable: true });
  });

  it('throws on other errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not_band_admin' } });
    await expect(listBandInvitations('band-1')).rejects.toBeTruthy();
  });

  it('cancels an invite', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await cancelInvitation('i1');
    expect(rpc).toHaveBeenCalledWith('bw_cancel_invitation', { p_invitation_id: 'i1' });
  });

  it('builds the invite link from the token', () => {
    expect(inviteLink('1bd24b4e-07f5-499d-bdb7-2092a2c157e7')).toBe(
      'https://app.bandwith.fun/?invite=1bd24b4e-07f5-499d-bdb7-2092a2c157e7',
    );
  });
});
