import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import planCases from '../__fixtures__/planCases.json';
import {
  LIMIT_KEYS,
  canUse,
  computeEntitlements,
  isOverLimit,
  limitFor,
  parseEntitlements,
  planLimitKey,
  plansEnforced,
  resolvePlan,
  type BandPlanRow,
  type Entitlements,
} from '../plans';

const now = new Date(planCases.now);

describe('plans: the effective plan of a band (shared with the SQL)', () => {
  for (const c of planCases.cases) {
    it(c.name, () => {
      expect(resolvePlan(c.row as BandPlanRow | null, now, c.graceDays)).toBe(c.expect);
    });
  }
});

const ent = (over: Partial<Entitlements> = {}): Entitlements => ({
  enforced: true,
  plan: 'free',
  source: null,
  status: null,
  trialEndsAt: null,
  grantUntil: null,
  isPayer: false,
  isAdmin: false,
  limits: { quotes_sent_month: 2, deputies: 3 },
  usage: {},
  checkout: false,
  notice: null,
  ...over,
});

describe('plans: limits', () => {
  it('switched off (the beta): every limit is unlimited', () => {
    const off = ent({ enforced: false });
    expect(plansEnforced(off)).toBe(false);
    expect(limitFor(off, 'quotes_sent_month')).toBeNull();
    expect(canUse(off, 'quotes_sent_month', 999)).toBe(true);
    expect(isOverLimit(off, 'deputies', 999)).toBe(false);
  });

  it('nothing known yet (offline, first launch): never blocks in the app (the server decides)', () => {
    expect(plansEnforced(null)).toBe(false);
    expect(limitFor(null, 'deputies')).toBeNull();
    expect(canUse(undefined, 'deputies', 50)).toBe(true);
  });

  it('a key with no value written is unlimited', () => {
    expect(limitFor(ent(), 'gear_items')).toBeNull();
    expect(canUse(ent(), 'gear_items', 10_000)).toBe(true);
  });

  it('null is unlimited', () => {
    expect(limitFor(ent({ limits: { deputies: null } }), 'deputies')).toBeNull();
  });

  it('up to the limit is allowed, one more is not', () => {
    const e = ent();
    expect(limitFor(e, 'quotes_sent_month')).toBe(2);
    expect(canUse(e, 'quotes_sent_month', 1)).toBe(true);
    expect(canUse(e, 'quotes_sent_month', 2)).toBe(false);
    expect(canUse(e, 'deputies', 1, 2)).toBe(true);
    expect(canUse(e, 'deputies', 2, 2)).toBe(false);
  });

  it('over the limit (after a downgrade) only when above it', () => {
    expect(isOverLimit(ent(), 'deputies', 3)).toBe(false);
    expect(isOverLimit(ent(), 'deputies', 4)).toBe(true);
  });

  it('the limit keys are the ones in the plan (§3.4)', () => {
    expect([...LIMIT_KEYS].sort()).toEqual(
      [
        'admins',
        'analytics_days',
        'bands_as_admin',
        'branding',
        'contracts_sent_month',
        'custom_templates',
        'deputies',
        'gear_items',
        'quotes_sent_month',
        'storage_mb',
      ].sort(),
    );
  });

  it('reads the key out of a server refusal (BW_PLAN_LIMIT:<key>)', () => {
    expect(planLimitKey({ message: 'BW_PLAN_LIMIT:deputies' })).toBe('deputies');
    expect(planLimitKey({ message: 'x', hint: 'y', details: 'BW_PLAN_LIMIT:storage_mb' })).toBe('storage_mb');
    expect(planLimitKey({ message: 'BW_PLAN_LIMIT:nope' })).toBeNull();
    expect(planLimitKey({ message: 'duplicate key' })).toBeNull();
    expect(planLimitKey(null)).toBeNull();
  });
});

describe('plans: what the server sends (bw_band_entitlements)', () => {
  it('parses a full answer', () => {
    const e = parseEntitlements({
      enforced: true,
      plan: 'pro',
      source: 'grant',
      status: 'active',
      trial_ends_at: null,
      grant_until: '2027-03-31T22:00:00Z',
      is_payer: false,
      is_admin: true,
      limits: { deputies: null, storage_mb: 10240, bad: 'x' },
      usage: { storage_mb: 12, bad: 'y' },
      checkout: false,
      notice: { date: '2027-01-01' },
    });
    expect(e).toEqual({
      enforced: true,
      plan: 'pro',
      source: 'grant',
      status: 'active',
      trialEndsAt: null,
      grantUntil: '2027-03-31T22:00:00Z',
      isPayer: false,
      isAdmin: true,
      limits: { deputies: null, storage_mb: 10240 },
      usage: { storage_mb: 12 },
      checkout: false,
      notice: { date: '2027-01-01' },
    });
  });

  it('an unknown plan reads as Free; missing switches read as off', () => {
    const e = parseEntitlements({ plan: 'gold' });
    expect(e?.plan).toBe('free');
    expect(e?.enforced).toBe(false);
    expect(e?.checkout).toBe(false);
  });

  it('anything else: null', () => {
    expect(parseEntitlements(null)).toBeNull();
    expect(parseEntitlements('x')).toBeNull();
    expect(parseEntitlements([])).toBeNull();
  });
});

describe('plans: computed locally (demo), same shape as the server', () => {
  const base = {
    switches: [] as { key: string; enabled: boolean }[],
    planLimits: [
      { plan: 'free', key: 'deputies', value: 3 },
      { plan: 'pro', key: 'deputies', value: null },
    ],
    settings: [] as { key: string; value: unknown }[],
    bandPlan: null as BandPlanRow | null,
    payerUserId: null as string | null,
    userId: 'u1',
    isMember: true,
    isAdmin: true,
    now,
  };

  it('switched off by default (no row)', () => {
    const e = computeEntitlements(base)!;
    expect(e.enforced).toBe(false);
    expect(e.plan).toBe('free');
    expect(e.limits).toEqual({ deputies: 3 });
  });

  it('switched on, Pro band: Pro limits', () => {
    const e = computeEntitlements({
      ...base,
      switches: [{ key: 'plans_enforced', enabled: true }],
      bandPlan: { plan: 'pro', source: 'paddle', status: 'active' },
      payerUserId: 'u1',
    })!;
    expect(e.enforced).toBe(true);
    expect(e.plan).toBe('pro');
    expect(e.limits).toEqual({ deputies: null });
    expect(e.isPayer).toBe(true);
  });

  it('members see the plan and the limits, not how it is paid', () => {
    const e = computeEntitlements({
      ...base,
      isAdmin: false,
      bandPlan: { plan: 'pro', source: 'grant', status: 'active', grant_until: '2027-03-31T22:00:00Z' },
      payerUserId: 'someone',
      settings: [{ key: 'launch_notice', value: { date: '2027-01-01' } }],
    })!;
    expect(e.plan).toBe('pro');
    expect(e.source).toBeNull();
    expect(e.grantUntil).toBeNull();
    expect(e.isPayer).toBe(false);
    expect(e.notice).toBeNull();
  });

  it('admins get the launch notice while the plans are off', () => {
    const notice = { date: '2027-01-01' };
    expect(computeEntitlements({ ...base, settings: [{ key: 'launch_notice', value: notice }] })!.notice).toEqual(notice);
    expect(
      computeEntitlements({
        ...base,
        switches: [{ key: 'plans_enforced', enabled: true }],
        settings: [{ key: 'launch_notice', value: notice }],
      })!.notice,
    ).toBeNull();
  });

  it('not a member: nothing', () => {
    expect(computeEntitlements({ ...base, isMember: false, isAdmin: false })).toBeNull();
  });
});
