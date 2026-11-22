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
    expect(fn('bw_stage_set_signer')).toMatch(/bw_stage_admin_band\(p_event_id\) IS NULL THEN\s+RETURN NULL/);
    // The members' function never reads the private column.
    expect(fn('bw_stage_verify_key')).toMatch(/bw_is_band_member\(band\)/);
    expect(fn('bw_stage_verify_key')).not.toMatch(/sign_private/);
  });

  it('the first stored pair wins, and keys are checked', () => {
    expect(fn('bw_stage_set_signer')).toMatch(/WHERE event_id = p_event_id AND sign_public IS NULL/);
    expect(fn('bw_stage_set_signer')).toMatch(/length\(pub_bytes\) <> 65 OR get_byte\(pub_bytes, 0\) <> 4/);
  });

  it('nothing for anon, the helper for no client, the table stays behind RLS', () => {
    expect(sql).not.toMatch(/GRANT [^;]*TO anon/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.bw_stage_admin_band\(uuid\) FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/GRANT [^;]*ON (TABLE )?public\.stage_keys/);
    expect(sql).not.toMatch(/CREATE POLICY/);
    for (const f of ['bw_stage_verify_key(uuid)', 'bw_stage_signer(uuid)', 'bw_stage_set_signer(uuid, text, text)']) {
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${f} TO authenticated;`);
    }
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
    expect(sql).toMatch(/CREATE TRIGGER bw_stage_rotate_signer\s+AFTER UPDATE OF role, is_active, band_id, user_id OR DELETE ON public\.band_members/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.bw_stage_rotate_signer\(\) FROM PUBLIC, anon, authenticated/);
  });
});
