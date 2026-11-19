import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('@/lib/appResume', () => ({ onAppResume: () => () => {} }));

import { __resetPlanCache, fetchBandPlan, invalidatePlan, knownPlan } from '../usePlan';

describe('usePlan: fetching the band plan', () => {
  beforeEach(() => {
    __resetPlanCache();
    localStorage.clear();
    rpc.mockReset();
  });

  it('asks bw_band_entitlements once, then serves it from memory', async () => {
    rpc.mockResolvedValue({ data: { enforced: false, plan: 'free', limits: {} }, error: null });
    const a = await fetchBandPlan('b1');
    const b = await fetchBandPlan('b1');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('bw_band_entitlements', { p_band_id: 'b1' });
    expect(a?.plan).toBe('free');
    expect(b).toBe(a);
  });

  it('keeps the last answer on the device (offline next launch)', async () => {
    rpc.mockResolvedValue({ data: { enforced: true, plan: 'pro', limits: { deputies: null } }, error: null });
    await fetchBandPlan('b1');
    __resetPlanCache();
    expect(knownPlan('b1')?.plan).toBe('pro');
    rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    expect((await fetchBandPlan('b1'))?.plan).toBe('pro');
  });

  it('after a limit refusal it asks again at once', async () => {
    rpc.mockResolvedValue({ data: { enforced: true, plan: 'free', limits: {} }, error: null });
    await fetchBandPlan('b1');
    rpc.mockResolvedValue({ data: { enforced: true, plan: 'pro', limits: {} }, error: null });
    expect((await invalidatePlan('b1'))?.plan).toBe('pro');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('not a member (NULL): nothing known', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchBandPlan('b2')).toBeNull();
  });
});
