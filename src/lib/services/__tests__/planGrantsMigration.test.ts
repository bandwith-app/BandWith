import { describe, expect, it } from 'vitest';
import sql164 from '../../../../supabase/migrations/164_plan_grants.sql?raw';

/**
 * 164: grants (paid plans P5). The rollback dry run on production checks the
 * behaviour (off: no offer, no candidates, no notes; on: one trial per
 * account, never on a band that had a plan). These keep the file from drifting.
 */
const sql = sql164.replace(/--.*$/gm, '');

describe('164_plan_grants', () => {
  it('one transaction; no values, no data, no switch', () => {
    expect(sql.match(/^BEGIN;/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;/gm)).toHaveLength(1);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.(plan_settings|plan_limits|platform_switches)/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.|DELETE\s+FROM/i);
    // The trial length and the founding rules come from plan_settings only.
    expect(sql).toMatch(/s\.key = 'trial_days'/);
    expect(sql).toMatch(/s\.key = 'founding_rules'/);
  });
  it('the trial: admins only, switch plans_trial, once per account, never on a band that had a plan', () => {
    expect(sql).toMatch(/m\.role = 'admin'/);
    expect(sql).toMatch(/s\.key = 'plans_trial' AND s\.enabled IS TRUE/);
    expect(sql).toMatch(/FROM public\.plan_trials t WHERE t\.user_id = p_user_id\) THEN RETURN 'used'/);
    expect(sql).toMatch(/FROM public\.band_plans p WHERE p\.band_id = p_band_id\) THEN RETURN 'band_had_plan'/);
    expect(sql).toMatch(/'BW_TRIAL:%'/);
    expect(sql).toMatch(/VALUES \(p_band_id, 'pro', 'trial', 'trialing'/);
  });
  it('grants: offer and start for signed-in people; the report, notes and helpers are internal', () => {
    for (const fn of ['bw_trial_offer(uuid)', 'bw_start_trial(uuid)']) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated;`);
    }
    for (const fn of ['bw_trial_days()', 'bw_trial_refusal(uuid, uuid)', 'bw_founding_candidates()', 'bw_plan_ending_text(text, text, text, date)', 'bw_plan_ending_notices()']) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`);
      expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION public.${fn}`);
    }
  });
  it('ending notes: only with the plans on, 7 and 1 days before, once each', () => {
    expect(sql).toMatch(/s\.key = 'plans_enforced' AND s\.enabled IS TRUE\) THEN\s+RETURN 0/);
    expect(sql).toMatch(/IN \(7, 1\)/);
    expect(sql).toMatch(/n\.data ->> 'kind' = 'plan_ending'/);
    expect(sql).toMatch(/cron\.schedule\('bw-plan-ending-notices'/);
  });
});
