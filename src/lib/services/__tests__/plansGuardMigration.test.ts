import { describe, it, expect } from 'vitest';
import sql161 from '../../../../supabase/migrations/161_plan_guards.sql?raw';
import { LIMIT_KEYS } from '@/lib/plans';

/**
 * Static guards on the paid plans server checks (P2, migration 161). The
 * rollback-only dry run against the live database checks the behaviour
 * (switched off: nothing changes; switched on inside the transaction: each
 * limit refuses at limit + 1). These keep the file from drifting.
 */
const noComments = (sql: string) => sql.replace(/--.*$/gm, '');
const sql = noComments(sql161);

const fnBody = (name: string): string => {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const end = sql.indexOf('$function$;', start);
  return sql.slice(start, end);
};

describe('161 plan guards', () => {
  it('the guard does nothing while plans_enforced is off', () => {
    const body = fnBody('bw_plan_guard');
    const off = body.indexOf("'plans_enforced'");
    const raise = body.indexOf('RAISE EXCEPTION');
    expect(off).toBeGreaterThan(-1);
    expect(off).toBeLessThan(raise);
    expect(body).toMatch(/IF NOT v_enforced THEN\s+RETURN;/);
  });

  it('only signed-in people are limited (service role, SQL scripts and imports pass)', () => {
    expect(fnBody('bw_plan_guard')).toMatch(/auth\.role\(\)[^;]*<> 'authenticated'/);
  });

  it('a refusal is BW_PLAN_LIMIT:<key>, P0001, with a plain-English hint', () => {
    const body = fnBody('bw_plan_guard');
    expect(body).toMatch(/RAISE EXCEPTION 'BW_PLAN_LIMIT:%', p_key/);
    expect(body).toMatch(/ERRCODE = 'P0001'/);
    expect(body).toMatch(/HINT = '.*Update BandWith/);
  });

  it('a key with no value written, or NULL, is unlimited', () => {
    expect(fnBody('bw_plan_guard')).toMatch(/IF v_limit IS NULL THEN\s+RETURN;/);
  });

  it('every limit trigger calls the guard', () => {
    const triggers = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(bw_trg_plan_[a-z_]+)\(\)/g)].map((m) => m[1]);
    expect(triggers.sort()).toEqual(
      ['bw_trg_plan_admins', 'bw_trg_plan_bands', 'bw_trg_plan_contracts', 'bw_trg_plan_deputies', 'bw_trg_plan_gear', 'bw_trg_plan_templates'].sort(),
    );
    for (const t of triggers) expect(fnBody(t), t).toMatch(/bw_plan_guard\(|bw_plan_guard_new_band\(/);
    for (const [table, fn] of [
      ['band_members', 'bw_trg_plan_admins'],
      ['bands', 'bw_trg_plan_bands'],
      ['contracts', 'bw_trg_plan_contracts'],
      ['band_deputies', 'bw_trg_plan_deputies'],
      ['inventory', 'bw_trg_plan_gear'],
      ['task_templates', 'bw_trg_plan_templates'],
    ]) {
      expect(sql).toMatch(new RegExp(`BEFORE INSERT[^;]*ON public\\.${table}[^;]*EXECUTE FUNCTION public\\.${fn}\\(\\)`));
    }
  });

  it('only the first send of a quote is limited (resends and reminders are free)', () => {
    const body = fnBody('bw_quote_link_mark_sent');
    expect(body).toMatch(/v_link\.status = 'draft' AND COALESCE\(p_kind, 'sent'\) <> 'reminded'[\s\S]*bw_plan_guard\(v_band, 'quotes_sent_month'/);
  });

  it('bw_quote_link_mark_sent keeps everything else it did (099)', () => {
    const body = fnBody('bw_quote_link_mark_sent');
    for (const s of ["'Publish the quote first'", "'The link is turned off'", 'INSERT INTO public.quote_activity', "UPDATE public.quotes q SET status = 'sent'"]) {
      expect(body).toContain(s);
    }
  });

  it('contracts: the first send only, riders never count', () => {
    const body = fnBody('bw_trg_plan_contracts');
    expect(body).toMatch(/OLD\.sent_at IS NULL/);
    expect(body).toMatch(/'rider'/);
  });

  it('gear: personal gear never counts; templates: built-ins never count', () => {
    expect(fnBody('bw_trg_plan_gear')).toMatch(/owner_id IS NULL/);
    expect(fnBody('bw_trg_plan_templates')).toMatch(/is_default/);
  });

  it('storage: a restrictive insert policy on the band buckets, fail-open on errors', () => {
    expect(sql).toMatch(/CREATE POLICY bw_plan_storage_insert ON storage\.objects AS RESTRICTIVE FOR INSERT/);
    const body = fnBody('bw_plan_storage_ok');
    expect(body).toMatch(/'song-files'/);
    expect(body).toMatch(/'band-branding'/);
    expect(body).toMatch(/'quotes'/);
    expect(body).not.toMatch(/'avatars'|'personal-files'/);
    expect(body).toMatch(/EXCEPTION\s+WHEN OTHERS THEN/);
  });

  it('usage covers every counted key and only the plan keys', () => {
    const body = fnBody('bw_plan_count');
    for (const k of ['quotes_sent_month', 'contracts_sent_month', 'deputies', 'admins', 'custom_templates', 'gear_items', 'storage_mb']) {
      expect(body).toContain(`'${k}'`);
      expect(LIMIT_KEYS as readonly string[]).toContain(k);
    }
  });

  it('internal functions are not callable from the app; nothing is granted to anon', () => {
    for (const f of ['bw_plan_count(uuid, text)', 'bw_plan_guard(uuid, text, integer)', 'bw_plan_guard_new_band(uuid)']) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated`);
    }
    expect(sql).not.toMatch(/TO anon/);
    expect(sql).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*ON\s+(TABLE\s+)?public\./i);
  });
});
