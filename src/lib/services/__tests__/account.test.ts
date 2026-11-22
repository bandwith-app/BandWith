import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('../../supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { deleteMyAccount } from '../account';

const refused = (status: number, body: unknown) => ({
  data: null,
  error: { context: new Response(JSON.stringify(body), { status }) },
});

// Claude review #282, round 4: a co-admin deleting their account at the same
// time is a "wait", not "make someone else admin" and not a connection error.
describe('deleteMyAccount', () => {
  beforeEach(() => invoke.mockReset());

  it('says to wait while someone else in the band is deleting their account', async () => {
    invoke.mockResolvedValue(refused(409, { success: false, code: 'account_deletion_in_progress' }));
    const r = await deleteMyAccount();
    expect(r).toEqual({ ok: false, reason: 'error', message: 'A bandmate is deleting their account. Try again in a few minutes.' });
  });

  // Claude review round 4: a deletion that stopped half-way (files not
  // removed yet) is not a connection problem either.
  it('says to try again shortly when the deletion could not finish yet', async () => {
    invoke.mockResolvedValue(refused(503, { success: false, code: 'storage_not_ready' }));
    expect(await deleteMyAccount()).toEqual({ ok: false, reason: 'error', message: 'We couldn’t finish deleting your account. Try again shortly.' });
  });

  // Round 5: once committed the server job finishes it, retry or not.
  it('says the account will be gone in a few minutes once the deletion is committed', async () => {
    invoke.mockResolvedValue(refused(503, { success: false, code: 'storage_not_ready', committed: true }));
    expect(await deleteMyAccount()).toEqual({ ok: false, reason: 'committed', message: 'Your account is being deleted. It will be gone within a few minutes.' });
  });

  // Round 6 (Claude): committed is not a failure the user can fix: the
  // Settings screen signs out locally, as after a deletion that finished.
  it('Settings signs out on a committed deletion, as on success', async () => {
    const settings = (await import('../../../app/views/SettingsView.tsx?raw')).default as string;
    const handler = settings.slice(settings.indexOf('const handleDeleteAccount'), settings.indexOf('const getSectionTitle'));
    expect(handler).toMatch(/result\.ok \|\| result\.reason === 'committed'/);
    expect(handler.indexOf('signOut(')).toBeGreaterThan(handler.indexOf("result.reason === 'committed'"));
  });

  it('still lists the bands that need another admin', async () => {
    invoke.mockResolvedValue(refused(409, { success: false, code: 'account_has_bands', bands: ['Hudson Horns'] }));
    expect(await deleteMyAccount()).toEqual({ ok: false, reason: 'admin_of_bands', bands: ['Hudson Horns'] });
  });
});
