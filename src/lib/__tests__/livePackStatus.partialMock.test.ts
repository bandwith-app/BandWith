import { describe, it, expect, vi } from 'vitest';

// A test elsewhere mocks the client without `isDemoMode` (EventDetail.setlist):
// the pack status calls must never throw for that, at import or later.
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ delete: () => ({ eq: () => ({ eq: () => ({ in: async () => ({ error: null }) }) }) }) }) },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));

import { forgetPackStatus, readProfileAuto, reportPackStatus, saveProfileChoice } from '../livePackStatus';

describe('pack status with a client mock that has no isDemoMode', () => {
  it('skips quietly instead of throwing', async () => {
    await expect(forgetPackStatus('u-1', ['e-1'])).resolves.toBeUndefined();
    await expect(reportPackStatus({ eventId: 'e-1', userId: 'u-1', version: 'v1', savedAt: '2026-11-21T20:00:00Z' })).resolves.toBeUndefined();
    await expect(saveProfileChoice('u-1', { auto: true })).resolves.toBeUndefined();
    await expect(readProfileAuto('u-1')).resolves.toBeNull();
  });
});
