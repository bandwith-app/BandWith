/**
 * One count for the onboarding: the wizard header ("STEP 2 OF 6"), the brand
 * page's list and the completion screen's pills all read the same lists, on
 * the band path and on the solo path.
 */
import { describe, it, expect } from 'vitest';
import {
  WIZARD_ORDER,
  brandPlan,
  brandRowNumber,
  flowScreen,
  wizardStep,
  wizardTotal,
  type FlowScreen,
} from '../onboardingSteps';

/** Every screen a path walks through, as OnboardingFlow reaches them. */
const WALK: Record<'creator' | 'solo', { isAuthenticated: boolean; currentStep: number; screen: FlowScreen }[]> = {
  creator: [
    { isAuthenticated: false, currentStep: 0, screen: 'account' },
    { isAuthenticated: true, currentStep: 0, screen: 'intent' },
    { isAuthenticated: true, currentStep: 1, screen: 'intent' },
    { isAuthenticated: true, currentStep: 2, screen: 'band' },
    { isAuthenticated: true, currentStep: 3, screen: 'profile' },
    { isAuthenticated: true, currentStep: 4, screen: 'invite' },
    { isAuthenticated: true, currentStep: 5, screen: 'songs' },
    { isAuthenticated: true, currentStep: 6, screen: 'done' },
  ],
  solo: [
    { isAuthenticated: false, currentStep: 1, screen: 'account' },
    { isAuthenticated: true, currentStep: 1, screen: 'profile' },
    { isAuthenticated: true, currentStep: 2, screen: 'done' },
  ],
};

describe('wizardStep', () => {
  it('counts the band path in six steps and the solo path in three', () => {
    expect(wizardTotal('creator')).toBe(6);
    expect(wizardTotal('solo')).toBe(3);
    expect(wizardTotal('joiner')).toBe(2);
    expect(wizardStep('creator', 'songs')).toEqual({ step: 6, total: 6 });
    expect(wizardStep('solo', 'profile')).toEqual({ step: 3, total: 3 });
    expect(wizardStep('joiner', 'profile')).toEqual({ step: 2, total: 2 });
  });

  it('starts on the band path’s count before a path is chosen', () => {
    expect(wizardStep(null, 'account')).toEqual({ step: 1, total: 6 });
    expect(wizardStep(undefined, 'intent')).toEqual({ step: 2, total: 6 });
  });

  it('numbers every step of a path once, in order', () => {
    for (const path of ['creator', 'solo', 'joiner'] as const) {
      const steps = WIZARD_ORDER[path].map((screen) => wizardStep(path, screen).step);
      expect(steps).toEqual(WIZARD_ORDER[path].map((_, i) => i + 1));
    }
  });
});

describe('flowScreen', () => {
  for (const path of ['creator', 'solo'] as const) {
    it(`follows the ${path} path’s routing`, () => {
      for (const at of WALK[path]) expect(flowScreen(path, at.isAuthenticated, at.currentStep)).toBe(at.screen);
    });
  }
});

describe('brandPlan', () => {
  for (const path of ['creator', 'solo'] as const) {
    it(`${path}: the list and the header say the same step, of the same total, on every screen`, () => {
      for (const { screen } of WALK[path]) {
        const plan = brandPlan(path, screen);
        // The header's own count for this screen.
        const header = screen === 'done' ? null : wizardStep(path, screen);
        expect(plan.total).toBe(wizardTotal(path));
        // The rows cover 1…total with no gap and no repeat.
        expect(plan.rows[0].from).toBe(1);
        expect(plan.rows[plan.rows.length - 1].to).toBe(plan.total);
        plan.rows.slice(1).forEach((row, i) => expect(row.from).toBe(plan.rows[i].to + 1));

        const current = plan.rows.filter((row) => row.state === 'current');
        if (header) {
          expect(plan.step).toBe(header.step);
          expect(header.total).toBe(plan.total);
          expect(current).toHaveLength(1);
          expect(current[0].from).toBeLessThanOrEqual(header.step);
          expect(current[0].to).toBeGreaterThanOrEqual(header.step);
          expect(plan.finish).toBe('upcoming');
        } else {
          // The finish: every step done, "Ready to rock" lit.
          expect(current).toHaveLength(0);
          expect(plan.rows.every((row) => row.state === 'done')).toBe(true);
          expect(plan.finish).toBe('current');
        }
      }
    });
  }

  it('names no band step before the path is chosen', () => {
    for (const screen of ['account', 'intent'] as const) {
      const plan = brandPlan('creator', screen);
      expect(plan.subject).toBe('account');
      expect(plan.rows.map((row) => row.id)).toEqual(['account', 'intent', 'rest']);
      expect(plan.rows.map(brandRowNumber)).toEqual(['1', '2', '3–6']);
    }
  });

  it('names the band’s steps once the band path is chosen', () => {
    const plan = brandPlan('creator', 'band');
    expect(plan.subject).toBe('band');
    expect(plan.rows.map((row) => row.id)).toEqual([...WIZARD_ORDER.creator]);
    expect(plan.rows.map(brandRowNumber)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(plan.rows.map((row) => row.state)).toEqual(['done', 'done', 'current', 'upcoming', 'upcoming', 'upcoming']);
  });

  it('solo: three steps, no band in the headline or the list', () => {
    for (const { screen } of WALK.solo) {
      const plan = brandPlan('solo', screen);
      expect(plan.subject).toBe('solo');
      expect(plan.rows.map((row) => row.id)).toEqual(['account', 'intent', 'profile']);
      expect(plan.total).toBe(3);
    }
    expect(brandPlan('solo', 'profile').rows.map((row) => row.state)).toEqual(['done', 'done', 'current']);
  });

  it('never counts "Ready to rock" as a step', () => {
    expect(brandPlan('creator', 'done').step).toBe(7);
    expect(brandPlan('creator', 'done').total).toBe(6);
    expect(brandPlan('solo', 'done').step).toBe(4);
    expect(brandPlan('solo', 'done').total).toBe(3);
  });
});
