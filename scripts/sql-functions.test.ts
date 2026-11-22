import { describe, expect, it } from 'vitest';
import { definedFunctions } from './sql-functions.mjs';

/**
 * Which functions a migration (re)defines, for the redefined-functions check
 * (supabase/checks/redefined_functions.sql). Not only plain CREATE FUNCTION:
 * also a definition built in EXECUTE / EXECUTE format, and a DO block that
 * rewrites a live body (pg_get_functiondef + EXECUTE).
 */
describe('definedFunctions (main, 11-22)', () => {
  const names = (sql: string) => [...definedFunctions(sql).keys()].sort();

  it('a plain CREATE [OR REPLACE] FUNCTION, public. or not; comments are not definitions', () => {
    expect(names(`CREATE OR REPLACE FUNCTION public.bw_a(x uuid) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION bw_b() RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;
-- CREATE OR REPLACE FUNCTION public.bw_only_in_a_comment()`)).toEqual(['bw_a', 'bw_b']);
  });

  it('a definition inside EXECUTE / EXECUTE format, and whether it can be skipped', () => {
    const d = definedFunctions(`DO $do$
DECLARE v_def text;
BEGIN
  IF to_regprocedure('public.bw_scope(text)') IS NOT NULL THEN
    v_def := pg_get_functiondef(to_regprocedure('public.bw_scope(text)'));
    IF v_def LIKE '%bw:175-r4%' THEN RETURN; END IF;
  END IF;
  EXECUTE $sql$
CREATE OR REPLACE FUNCTION public.bw_scope(p text) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
$sql$;
  EXECUTE format($q$CREATE OR REPLACE FUNCTION public.bw_fmt(p uuid) RETURNS int LANGUAGE sql AS $f$ SELECT %s $f$$q$, 1);
END
$do$;`);
    expect([...d.keys()].sort()).toEqual(['bw_fmt', 'bw_scope']);
    // A RETURN before it in the same DO block: the definition can be skipped (a live body kept).
    expect(d.get('bw_scope')).toEqual({ how: 'dynamic', conditional: true });
    expect(d.get('bw_fmt')).toEqual({ how: 'dynamic', conditional: true });
  });

  it('a DO block that rewrites a live body (pg_get_functiondef, replace, EXECUTE)', () => {
    const d = definedFunctions(`DO $$
DECLARE def text;
BEGIN
  IF to_regprocedure('public.bw_event_quote_hidden(uuid, uuid)') IS NULL THEN RETURN; END IF;
  def := pg_get_functiondef('public.bw_stage_verify_key(uuid)'::regprocedure);
  EXECUTE replace(def, 'a', 'b');
END $$;
DO $do$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef(to_regprocedure('public.bw_only_read(text)'));
  IF v_def NOT LIKE '%x%' THEN RAISE EXCEPTION 'apply 175 first'; END IF;
END
$do$;`);
    expect([...d.keys()]).toEqual(['bw_stage_verify_key']);
    expect(d.get('bw_stage_verify_key')).toEqual({ how: 'patched', conditional: true });
  });

  it('a name the SQL builds at run time (format %I / %s): the file must name it in a "-- defines:" line', () => {
    const dynamic = `DO $$ BEGIN
  EXECUTE format('CREATE OR REPLACE FUNCTION public.%I() RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$', 'bw_x_' || 'one');
END $$;`;
    expect(() => definedFunctions(dynamic)).toThrow(/defines:/);
    expect(names(`-- defines: bw_x_one, bw_x_two\n${dynamic}`)).toEqual(['bw_x_one', 'bw_x_two']);
  });

  it('EXECUTE format for anything else (ALTER TABLE, CREATE TRIGGER, UPDATE) defines no function', () => {
    expect(names(`DO $$ BEGIN
  EXECUTE format('ALTER TABLE public.messages DROP CONSTRAINT %I', 'x');
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.bw_trg(%L)', 't', 'c');
END $$;`)).toEqual([]);
  });

  // Codex triage of #278 (11-23): 195 redefines bw_band_free_slots only when the
  // live definition doesn't read skip_dates yet (after 178 it is left alone).
  it('a definition inside IF … THEN EXECUTE … END IF can be skipped: conditional', () => {
    const d = definedFunctions(`DO $do$
DECLARE
  v_fn regprocedure := to_regprocedure('public.bw_slots(uuid)');
BEGIN
  IF v_fn IS NULL OR position('skip_dates' IN pg_get_functiondef(v_fn)) = 0 THEN
    EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.bw_slots(p uuid) RETURNS int LANGUAGE sql AS $body$ SELECT 1 $body$;
    $ddl$;
  END IF;
  EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.bw_always(p uuid) RETURNS int LANGUAGE sql AS $body$ SELECT 1 $body$;
  $ddl$;
END
$do$;`);
    expect(d.get('bw_slots')).toEqual({ how: 'dynamic', conditional: true });
    // After the END IF: always runs.
    expect(d.get('bw_always')).toEqual({ how: 'dynamic', conditional: false });
  });
});
