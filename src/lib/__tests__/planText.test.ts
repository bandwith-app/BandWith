import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import type { Entitlements } from '../plans';
import { planLine, planName, planUsageRows, planNotice, PLAN_SITE_URL } from '../planText';

const now = new Date('2026-12-01T12:00:00Z');
const ent = (over: Partial<Entitlements> = {}): Entitlements => ({
  enforced: true,
  plan: 'free',
  source: null,
  status: null,
  trialEndsAt: null,
  grantUntil: null,
  isPayer: false,
  isAdmin: true,
  limits: {},
  usage: {},
  checkout: false,
  notice: null,
  ...over,
});

describe('plan text: the name', () => {
  it('product names stay English; the beta reads as Free', () => {
    expect(planName(ent({ plan: 'pro' }))).toBe('Pro');
    expect(planName(ent({ plan: 'maestro' }))).toBe('Maestro');
    expect(planName(ent({ plan: 'pro', enforced: false }))).toBe('Free');
    expect(planName(null)).toBe('Free');
  });
});

describe('plan text: the line under the name', () => {
  it('not known yet', () => {
    expect(planLine(null, now)).toBe('Checking your band’s plan…');
  });

  it('switched off: the beta, for everyone', () => {
    expect(planLine(ent({ enforced: false }), now)).toBe('Free during the beta: every tool, as your role allows.');
    expect(planLine(ent({ enforced: false, isAdmin: false }), now)).toBe('Free during the beta: every tool, as your role allows.');
  });

  it('members: the plan only, never how it is paid', () => {
    expect(planLine(ent({ isAdmin: false, plan: 'pro' }), now)).toBe('Your band is on Pro. Your band admin looks after the plan.');
  });

  it('admins: Free', () => {
    expect(planLine(ent(), now)).toBe('Every tool, with limits on how many.');
  });

  it('admins: a trial counts the days left', () => {
    expect(planLine(ent({ plan: 'pro', source: 'trial', status: 'trialing', trialEndsAt: '2026-12-10T12:00:00Z' }), now)).toBe('Trial: 9 days left.');
    expect(planLine(ent({ plan: 'pro', source: 'trial', status: 'trialing', trialEndsAt: '2026-12-02T10:00:00Z' }), now)).toBe('Trial: 1 day left.');
  });

  it('admins: offered by BandWith, forever or until a date', () => {
    expect(planLine(ent({ plan: 'pro', source: 'grant', status: 'active' }), now)).toBe('Offered by BandWith.');
    expect(planLine(ent({ plan: 'pro', source: 'grant', status: 'active', grantUntil: '2027-03-31T22:00:00Z' }), now)).toMatch(
      /^Offered by BandWith until .*2027/,
    );
  });

  it('admins: paid by you or by another admin; a failed payment says so', () => {
    expect(planLine(ent({ plan: 'pro', source: 'paddle', status: 'active', isPayer: true }), now)).toBe('Paid by you.');
    expect(planLine(ent({ plan: 'pro', source: 'paddle', status: 'active' }), now)).toBe('Paid by another admin of the band.');
    expect(planLine(ent({ plan: 'pro', source: 'paddle', status: 'past_due', isPayer: true }), now)).toBe(
      'The last payment didn’t go through. Update the card to keep Pro.',
    );
  });
});

describe('plan text: usage meters', () => {
  it('none while switched off, none for members', () => {
    const limits = { deputies: 3 };
    const usage = { deputies: 1 };
    expect(planUsageRows(ent({ enforced: false, limits, usage }))).toEqual([]);
    expect(planUsageRows(ent({ isAdmin: false, limits, usage }))).toEqual([]);
  });

  it('only limits with a number, in a fixed order, with what is used', () => {
    const rows = planUsageRows(
      ent({
        limits: { storage_mb: 250, deputies: 3, admins: null, branding: 0, analytics_days: 30 },
        usage: { storage_mb: 12, deputies: 4, admins: 2 },
      }),
    );
    expect(rows).toEqual([
      { key: 'deputies', label: 'Deputies', value: '4 of 3', fill: 1, over: true },
      { key: 'storage_mb', label: 'Storage', value: '12 of 250 MB', fill: 12 / 250, over: false },
    ]);
  });
});

describe('plan text: the launch notice', () => {
  it('admins, while switched off, with a date', () => {
    expect(planNotice(ent({ enforced: false, notice: { date: '2027-01-01' } }))).toMatchObject({ date: '2027-01-01' });
    expect(planNotice(ent({ enforced: false, notice: {} }))).toBeNull();
    expect(planNotice(ent({ enforced: true, notice: { date: '2027-01-01' } }))).toBeNull();
    expect(planNotice(ent({ enforced: false, isAdmin: false, notice: { date: '2027-01-01' } }))).toBeNull();
  });

  it('the plans page lives on the web app', () => {
    expect(PLAN_SITE_URL).toBe('https://app.bandwith.fun/plans');
  });
});
