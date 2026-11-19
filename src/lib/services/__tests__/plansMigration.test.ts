import { describe, it, expect } from 'vitest';
import sql160 from '../../../../supabase/migrations/160_paid_plans.sql?raw';

/**
 * Static guards on the paid plans data layer (P1, migration 160). The
 * rollback-only dry run against the live database checks the behaviour;
 * these keep the files from drifting. The repository is public: prices and
 * limit values are written by hand with the service role, never in a
 * migration.
 */
const noComments = (sql: string) => sql.replace(/--.*$/gm, '');

const ALL = import.meta.glob<string>('../../../../supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const TABLES = ['plan_limits', 'plan_settings', 'billing_accounts', 'band_plans', 'billing_events', 'band_usage', 'plan_trials'];

// The one runtime write a migration may hold: bw_start_trial (164) inserts the
// caller's own trial row ('pro' / 'trial' / 'trialing', length from
// plan_settings). Exempted by its exact text, once, in that file only.
const TRIAL_START =
  /INSERT INTO public\.band_plans \(band_id, plan, source, status, trial_ends_at\)\s+VALUES \(p_band_id, 'pro', 'trial', 'trialing', now\(\) \+ make_interval\(days => v_days\)\);/;
const withoutTrialStart = (path: string, body: string) =>
  path.endsWith('/164_plan_grants.sql') ? body.replace(TRIAL_START, '') : body;

describe('160 paid plans', () => {
  const sql = noComments(sql160);

  it('no migration writes plan values, prices or plan rows', () => {
    expect(Object.keys(ALL).length).toBeGreaterThan(100);
    for (const [path, raw] of Object.entries(ALL)) {
      const body = withoutTrialStart(path, noComments(raw));
      for (const t of ['plan_limits', 'plan_settings', 'band_plans', 'billing_accounts']) {
        expect(body, `${path} writes ${t}`).not.toMatch(new RegExp(`INSERT\\s+INTO\\s+(public\\.)?${t}\\b`, 'i'));
        expect(body, `${path} writes ${t}`).not.toMatch(new RegExp(`UPDATE\\s+(public\\.)?${t}\\s+SET`, 'i'));
      }
      expect(body, `${path} turns a plans switch on`).not.toMatch(/'plans_(enforced|checkout|trial)'\s*,\s*true/i);
    }
  });

  it('the trial start in 164 is the only exempted write, and it is still there', () => {
    const path = Object.keys(ALL).find((k) => k.endsWith('/164_plan_grants.sql'))!;
    const body = noComments(ALL[path]);
    expect(body).toMatch(TRIAL_START);
    expect(body.match(/INSERT\s+INTO\s+(public\.)?band_plans\b/gi)).toHaveLength(1);
  });

  it('every table: RLS on, no direct access (read through the RPC only)', () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} \\(`));
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON public\\.${t} FROM PUBLIC, anon, authenticated`));
    }
    expect(sql).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*ON\s+(TABLE\s+)?public\./i);
  });

  it('no new column on the tables the app already reads (no grant changes)', () => {
    expect(sql).not.toMatch(/ALTER TABLE public\.(profiles|bands|band_members|events)\b/);
  });

  it('bw_band_entitlements: signed-in users only, never anon; members only', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.bw_band_entitlements\(uuid\) FROM PUBLIC, anon/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.bw_band_entitlements\(uuid\) TO authenticated/);
    expect(sql).toMatch(/bw_is_band_member\(p_band_id\)/);
    expect(sql).not.toMatch(/TO anon/);
  });

  it('the internal plan resolver is not callable from the app', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.bw_band_effective_plan\(uuid, timestamptz\) FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.bw_band_effective_plan/);
  });

  it('billing details only for the payer and admins', () => {
    expect(sql).toMatch(/'is_payer'/);
    expect(sql).toMatch(/bw_is_band_admin\(p_band_id\)/);
    expect(sql).not.toMatch(/provider_customer_id'|provider_subscription_id'/);
  });

  it('the switches are read from platform_switches and absent means off', () => {
    expect(sql).toMatch(/platform_switches/);
    expect(sql).toMatch(/'plans_enforced'/);
    expect(sql).toMatch(/'plans_checkout'/);
  });

  it('webhook events are unique per provider (retries are no-ops)', () => {
    expect(sql).toMatch(/PRIMARY KEY \(provider, event_id\)/);
  });
});
