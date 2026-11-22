import { describe, it, expect } from 'vitest';
import sql190 from '../../../../supabase/migrations/190_stage_signing_keys.sql?raw';

/** Static guards on 190 (audit #1); the dry run checks the behaviour. */
const sql = sql190.replace(/--.*$/gm, '');
const fn = (name: string) => {
  const m = sql.match(new RegExp(`FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`));
  return m?.[0] ?? '';
};

describe('190 the stage signing keys', () => {
  it('only admins get the private key', () => {
    expect(fn('bw_stage_admin_band')).toMatch(/bw_is_band_admin\(band\)/);
    expect(fn('bw_stage_signer')).toMatch(/bw_stage_admin_band\(p_event_id\) IS NULL THEN\s+RETURN NULL/);
    expect(fn('bw_stage_set_signer')).toMatch(/band := public\.bw_stage_admin_band\(p_event_id\);\s+IF band IS NULL THEN\s+RETURN NULL/);
    // The members' function never reads the private column.
    expect(fn('bw_stage_verify_key')).toMatch(/bw_is_band_member\(band\)/);
    expect(fn('bw_stage_verify_key')).not.toMatch(/sign_private/);
  });

  it('the first stored pair wins, and keys are checked; a broken pair is replaced only by naming it, with a new version', () => {
    const f = fn('bw_stage_set_signer');
    expect(f).toMatch(/AND \(sign_public IS NULL OR \(p_replace_public IS NOT NULL AND sign_public = p_replace_public\)\)/);
    expect(f).toMatch(/sign_version = sign_version \+ CASE WHEN sign_public IS NULL THEN 0 ELSE 1 END/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.bw_stage_set_signer\(uuid, text, text\);/);
    expect(fn('bw_stage_set_signer')).toMatch(/length\(pub_bytes\) <> 65 OR get_byte\(pub_bytes, 0\) <> 4/);
  });

  it('nothing for anon, the helper for no client, the table stays behind RLS', () => {
    expect(sql).not.toMatch(/GRANT [^;]*TO anon/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.bw_stage_admin_band\(uuid\) FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/GRANT [^;]*ON (TABLE )?public\.stage_keys/);
    expect(sql).not.toMatch(/CREATE POLICY/);
    for (const f of ['bw_stage_verify_key(uuid)', 'bw_stage_signer(uuid)', 'bw_stage_set_signer(uuid, text, text, text)']) {
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${f} TO authenticated;`);
    }
  });

  it("storing a pair serialises with a demotion: the caller's admin row is locked and re-checked before the update", () => {
    const f = fn('bw_stage_set_signer');
    // A demotion that commits first makes the locked re-check find no row;
    // one that comes later waits, and its rotation clears the stored pair.
    const lock = f.search(/PERFORM 1 FROM public\.band_members bm\s+WHERE bm\.band_id = band AND bm\.user_id = auth\.uid\(\)\s+AND bm\.role = 'admin' AND COALESCE\(bm\.is_active, true\)\s+FOR SHARE;\s+IF NOT FOUND THEN\s+RETURN NULL;/);
    const update = f.search(/UPDATE public\.stage_keys/);
    expect(lock).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(lock);
  });

  it('keys can never be NULL (decode(NULL) would pass every length check)', () => {
    expect(fn('bw_stage_set_signer')).toMatch(/IF p_public IS NULL OR p_private IS NULL THEN\s+RAISE EXCEPTION 'bad stage key'/);
  });

  it("members get the public key only for gigs they can see, with the key's version", () => {
    expect(fn('bw_stage_verify_key')).toMatch(/bw_can_view_event\(p_event_id\)/);
    expect(fn('bw_stage_verify_key')).toMatch(/RETURNS jsonb/);
    expect(fn('bw_stage_verify_key')).toMatch(/'version', s\.sign_version|'version', ver/);
    expect(fn('bw_stage_signer')).toMatch(/'version'/);
    expect(fn('bw_stage_set_signer')).toMatch(/'version'/);
    // A dry run that leaked the text version can't block the jsonb one.
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.bw_stage_verify_key\(uuid\);/);
  });

  it('after a rotation members are told "pending" (the version, no public key), never "no pair" (rule C)', () => {
    const f = fn('bw_stage_verify_key');
    expect(f).toMatch(/IF ver IS NULL OR \(k IS NULL AND ver <= 1\) THEN\s+RETURN NULL;/);
    expect(f).toMatch(/RETURN jsonb_build_object\('public', k, 'version', ver\);/);
  });

  it("178's rule (a tentative quote hidden from every member) is spelled out in the public-key function when 178 is in", () => {
    expect(sql).toMatch(/to_regprocedure\('public\.bw_event_quote_hidden\(uuid, uuid\)'\) IS NULL THEN\s+RETURN;/);
    expect(sql).toMatch(/OR NOT public\.bw_can_view_event\(p_event_id\) OR public\.bw_event_quote_hidden\(p_event_id\) THEN/);
    expect(sql).toMatch(/RAISE EXCEPTION 'bw_stage_verify_key is not the expected body'/);
  });

  it('an admin who stops being one (demoted, inactive, removed) takes no working key along: the pair is rotated', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS sign_version integer NOT NULL DEFAULT 1/);
    const trig = fn('bw_stage_rotate_signer');
    expect(trig).toMatch(/RETURNS trigger/);
    expect(trig).toMatch(/OLD\.role = 'admin' AND COALESCE\(OLD\.is_active, true\)/);
    expect(trig).toMatch(/TG_OP = 'DELETE'/);
    expect(trig).toMatch(/NEW\.role IS DISTINCT FROM 'admin'/);
    expect(trig).toMatch(/NOT COALESCE\(NEW\.is_active, true\)/);
    expect(trig).toMatch(/SET sign_public = NULL, sign_private = NULL, sign_version = s\.sign_version \+ 1/);
    expect(trig).toMatch(/e\.band_id = OLD\.band_id/);
    // Also where the pair is still empty (Codex on #288, B1).
    expect(trig).not.toMatch(/sign_public IS NOT NULL/);
    expect(sql).toMatch(/CREATE TRIGGER bw_stage_rotate_signer\s+AFTER UPDATE OF role, is_active, band_id, user_id OR DELETE ON public\.band_members/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.bw_stage_rotate_signer\(\) FROM PUBLIC, anon, authenticated/);
  });

  it('a gig moved to another band loses its pair and its version goes up (Codex on #288; behaviour: stage_signer_quote.pglite.mjs)', () => {
    expect(sql).toMatch(/CREATE TRIGGER bw_stage_event_moved\s+AFTER UPDATE OF band_id ON public\.events/);
    expect(sql).toMatch(/IF NEW\.band_id IS DISTINCT FROM OLD\.band_id THEN/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.bw_stage_event_moved\(\) FROM PUBLIC, anon, authenticated/);
  });
});
