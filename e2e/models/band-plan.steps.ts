import { expect } from '../fixtures';
import { daysFromNow, openPlan, planSection, setBandPlan, switchPlansOn, type Db } from '../support/plans';
import { bandPlan } from './band-plan.model.ts';
import { stepsFor, type Ctx } from './steps.ts';

const shows = async (c: Ctx, plan: string, line: string, where: string) => {
  await openPlan(c.app);
  await expect(planSection(c.app)).toContainText(plan);
  await expect(planSection(c.app)).toContainText(line);
  await c.app.check(where);
};
const write = (c: Ctx, row: Record<string, unknown> | null) =>
  c.app.editDb((db, { me }) => {
    setBandPlan(db as Db, me, row);
    (db as Db).plan_settings = [{ key: 'grace_days', value: 14 }];
  });

export const bandPlanSteps = stepsFor(bandPlan, {
  states: {
    start: async (c) => {
      await openPlan(c.app);
      await expect(planSection(c.app)).toContainText(c.app.t('Free during the beta: every tool, as your role allows.'));
    },
    free: async (c) => {
      await shows(c, 'Free', c.app.t('Every tool, with limits on how many.'), 'Plan: Free');
      await expect(planSection(c.app).getByRole('list', { name: c.app.t('What your band uses') })).toBeVisible();
    },
    trial: (c) => shows(c, 'Pro', c.app.t('Trial: {count} days left.', { count: 9 }), 'Plan: trial'),
    pro: (c) => shows(c, 'Pro', c.app.t('Paid by you.'), 'Plan: Pro paid'),
    pastDue: (c) => shows(c, 'Pro', c.app.t('The last payment didn’t go through. Update the card to keep {plan}.', { plan: 'Pro' }), 'Plan: past due'),
    granted: (c) => shows(c, 'Pro', c.app.t('Offered by BandWith.'), 'Plan: offered by BandWith'),
  },
  events: {
    SWITCH_ON: (c) => c.app.editDb((db) => switchPlansOn(db as Db)),
    START_TRIAL: (c) => write(c, { plan: 'pro', source: 'trial', status: 'trialing', trial_ends_at: daysFromNow(9 - 1 / 24) }),
    TRIAL_ENDS: (c) => write(c, { plan: 'pro', source: 'trial', status: 'trialing', trial_ends_at: daysFromNow(-1) }),
    SUBSCRIBE: (c) => write(c, { plan: 'pro', source: 'paddle', status: 'active' }),
    PAYMENT_FAILS: (c) => write(c, { plan: 'pro', source: 'paddle', status: 'past_due', past_due_since: daysFromNow(0) }),
    PAYMENT_RECOVERS: (c) => write(c, { plan: 'pro', source: 'paddle', status: 'active' }),
    CANCELLED: (c) => write(c, { plan: 'pro', source: 'paddle', status: 'canceled' }),
    GRANT: (c) => write(c, { plan: 'pro', source: 'grant', status: 'active', grant_until: null }),
    GRANT_ENDS: (c) => write(c, { plan: 'pro', source: 'grant', status: 'active', grant_until: daysFromNow(-1) }),
  },
});
