import { describe, expect, it } from 'vitest';
import { analyticsWindowStart, inAnalyticsWindow, monthBeforeWindow, windowCutsInto } from '../analyticsWindow';
import type { Entitlements } from '../plans';

const ent = (over: Partial<Entitlements> = {}): Entitlements => ({
  enforced: true,
  plan: 'free',
  source: null,
  status: null,
  trialEndsAt: null,
  grantUntil: null,
  isPayer: false,
  isAdmin: true,
  limits: { analytics_days: 90 },
  usage: {},
  checkout: false,
  notice: null,
  ...over,
});

const NOW = new Date(2026, 11, 1, 12); // 1 Dec 2026, local

describe('analyticsWindowStart', () => {
  it('that many days back, as a local date', () => {
    expect(analyticsWindowStart(ent(), NOW)).toBe('2026-09-02');
  });
  it('no window: plans off, no number, a paid plan without it', () => {
    expect(analyticsWindowStart(ent({ enforced: false }), NOW)).toBeNull();
    expect(analyticsWindowStart(ent({ limits: {} }), NOW)).toBeNull();
    expect(analyticsWindowStart(ent({ limits: { analytics_days: null } }), NOW)).toBeNull();
    expect(analyticsWindowStart(null, NOW)).toBeNull();
  });
});

describe('window helpers', () => {
  it('inAnalyticsWindow', () => {
    expect(inAnalyticsWindow('2026-09-02', '2026-09-02')).toBe(true);
    expect(inAnalyticsWindow('2026-09-01', '2026-09-02')).toBe(false);
    expect(inAnalyticsWindow('2020-01-01', null)).toBe(true);
    expect(inAnalyticsWindow(null, '2026-09-02')).toBe(false);
  });
  it('monthBeforeWindow: only months that end before the start', () => {
    expect(monthBeforeWindow('2026-08', '2026-09-02')).toBe(true);
    expect(monthBeforeWindow('2026-09', '2026-09-02')).toBe(false);
    expect(monthBeforeWindow('2026-07', null)).toBe(false);
  });
  it('windowCutsInto', () => {
    expect(windowCutsInto('2026-06-01', '2026-09-02')).toBe(true);
    expect(windowCutsInto('2026-10-01', '2026-09-02')).toBe(false);
    expect(windowCutsInto('2026-06-01', null)).toBe(false);
  });
});
