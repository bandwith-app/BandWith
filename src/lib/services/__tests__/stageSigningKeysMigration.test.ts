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
});
