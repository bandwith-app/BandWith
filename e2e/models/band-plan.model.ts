import { defineLifecycle } from './lifecycle.ts';

/**
 * The band's plan (paid plans P3a), as Settings → Plan shows it to an admin
 * once the plans are switched on.
 *
 * From the code:
 * - The plan is the band's: a `band_plans` row (160), no row = Free.
 * - What it is now comes from the same rules on the server
 *   (bw_band_effective_plan) and in the app (src/lib/plans.ts resolvePlan):
 *   a trial until it ends, a grant until grant_until (none = forever), a
 *   paid plan while active, and while past due until the grace days end.
 * - Settings → Plan (PlanSection.tsx, planText.ts planLine) says it in
 *   words: "Trial: N days left.", "Paid by you.", "Offered by BandWith.",
 *   "The last payment didn’t go through…", and on Free the meters.
 * - The demo answers bw_band_entitlements from its own rows, so each event
 *   writes what the server (webhook, trial RPC, grant SQL) would write.
 */
export const bandPlan = defineLifecycle({
  id: 'band-plan',
  title: 'Band plan (trial, paid, past due, grant)',
  summary: 'With the plans on, the admin sees the band move between Free, a trial, a paid plan, a failed payment and a plan offered by BandWith.',
  role: 'admin',
  initial: 'start',
  states: {
    start: {
      see: 'The app as in the beta: plans switched off.',
      on: { SWITCH_ON: 'free' },
    },
    free: {
      see: 'Settings → Plan: Free, "Every tool, with limits on how many." and the meters.',
      source: 'PlanSection.tsx; planText.ts planLine, planUsageRows',
      on: { START_TRIAL: 'trial', SUBSCRIBE: 'pro', GRANT: 'granted' },
    },
    trial: {
      see: 'Pro, "Trial: 9 days left."; no meters for the counted limits left (Pro has none written).',
      source: 'resolvePlan (trial); planLine',
      on: { TRIAL_ENDS: 'free' },
    },
    pro: {
      see: 'Pro, "Paid by you."',
      source: 'resolvePlan (paid, active); planLine (is_payer)',
      on: { PAYMENT_FAILS: 'pastDue' },
    },
    pastDue: {
      see: 'Still Pro (inside the grace days), "The last payment didn’t go through. Update the card to keep Pro."',
      source: 'resolvePlan (past_due, grace_days); planLine',
      on: { PAYMENT_RECOVERS: 'pro', CANCELLED: 'free' },
    },
    granted: {
      see: 'Pro, "Offered by BandWith." (no end date).',
      source: 'resolvePlan (grant, grant_until NULL); planLine',
      on: { GRANT_ENDS: 'free' },
    },
  },
  events: {
    SWITCH_ON: { do: 'The server turns plans_enforced on (demo: platform_switches row), with test limits.' },
    START_TRIAL: { do: 'A trial starts (demo: band_plans trial, trialing, ends in 9 days).' },
    TRIAL_ENDS: { do: 'The trial end date passes (demo: trial_ends_at yesterday).' },
    SUBSCRIBE: { do: 'The webhook records a paid Pro (demo: band_plans paddle active, the demo user pays).' },
    PAYMENT_FAILS: { do: 'The webhook records past_due (demo: status past_due, since today; grace 14 days).' },
    PAYMENT_RECOVERS: { do: 'The webhook records the payment (demo: status active).' },
    CANCELLED: { do: 'The subscription ends (demo: status canceled).' },
    GRANT: { do: 'BandWith offers Pro forever, e.g. the partner band (demo: band_plans grant, no end).' },
    GRANT_ENDS: { do: 'The grant ends (demo: grant_until yesterday).' },
  },
  wide: [],
  knownBugs: [],
  manual: [
    'Members see the plan only: e2e/specs/plans.spec.ts ("member: the plan only").',
    'The same rules on the server: 19 cases in src/lib/__fixtures__/planCases.json, checked in SQL by the rollback dry run of 160.',
    'Real payments (Paddle) arrive in P6; the webhook writes the same rows these events write.',
  ],
});
