import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { fetchTrialOffer, parseTrialOffer, startTrial, trialRefusal, planEnding } from '../trial';
import type { Entitlements } from '../plans';

const ent = (over: Partial<Entitlements> = {}): Entitlements => ({
  enforced: true, plan: 'pro', source: 'trial', status: 'trialing', trialEndsAt: null, grantUntil: null,
  isPayer: false, isAdmin: true, limits: {}, usage: {}, checkout: false, notice: null, ...over,
});

beforeEach(() => rpc.mockReset());

describe('trial offer', () => {
  it('parses the server answer', () => {
    expect(parseTrialOffer({ plan: 'pro', days: 14 })).toEqual({ plan: 'pro', days: 14 });
    expect(parseTrialOffer(null)).toBeNull();
    expect(parseTrialOffer({ plan: 'pro', days: 0 })).toBeNull();
    expect(parseTrialOffer({ plan: 'gold', days: 14 })).toBeNull();
  });
  it('asks the server, and never offers on an error', async () => {
    rpc.mockResolvedValueOnce({ data: { plan: 'pro', days: 14 }, error: null });
    expect(await fetchTrialOffer('b1')).toEqual({ plan: 'pro', days: 14 });
    expect(rpc).toHaveBeenCalledWith('bw_trial_offer', { p_band_id: 'b1' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(await fetchTrialOffer('b1')).toBeNull();
    expect(await fetchTrialOffer(null)).toBeNull();
  });
});

describe('starting the trial', () => {
  it('returns the new entitlements', async () => {
    rpc.mockResolvedValueOnce({ data: { enforced: false, plan: 'pro', status: 'trialing', source: 'trial', is_admin: true }, error: null });
    const res = await startTrial('b1');
    expect(res.error).toBeNull();
    expect(res.ent?.plan).toBe('pro');
  });
  it('a refusal says why, in words', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'BW_TRIAL:used', code: 'P0001' } });
    const res = await startTrial('b1');
    expect(res.ent).toBeNull();
    expect(res.error).toBe('Your account already used its trial.');
    expect(trialRefusal({ message: 'BW_TRIAL:band_had_plan' })).toBe('This band already had a plan, so it has no trial.');
    expect(trialRefusal({ message: 'BW_TRIAL:off' })).toBe('Trials are not open yet.');
    expect(trialRefusal({ message: 'nope' })).toBe('Could not start the trial. Try again.');
  });
});

describe('planEnding', () => {
  const now = new Date('2026-12-01T12:00:00Z');
  it('a trial or grant ending within 7 days, for admins', () => {
    expect(planEnding(ent({ trialEndsAt: '2026-12-05T12:00:00Z' }), now)).toEqual({ kind: 'trial', date: '2026-12-05T12:00:00Z' });
    expect(planEnding(ent({ source: 'grant', status: 'active', grantUntil: '2026-12-08T00:00:00Z' }), now)).toEqual({ kind: 'grant', date: '2026-12-08T00:00:00Z' });
  });
  it('not further out, not forever, not for members, not with the plans off, not on a paid plan', () => {
    expect(planEnding(ent({ trialEndsAt: '2026-12-20T12:00:00Z' }), now)).toBeNull();
    expect(planEnding(ent({ source: 'grant', status: 'active', grantUntil: null }), now)).toBeNull();
    expect(planEnding(ent({ trialEndsAt: '2026-12-05T12:00:00Z', isAdmin: false }), now)).toBeNull();
    expect(planEnding(ent({ trialEndsAt: '2026-12-05T12:00:00Z', enforced: false }), now)).toBeNull();
    expect(planEnding(ent({ source: 'paddle', status: 'active' }), now)).toBeNull();
    expect(planEnding(ent({ trialEndsAt: '2026-11-30T12:00:00Z' }), now)).toBeNull();
  });
});
