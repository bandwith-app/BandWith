import { describe, it, expect } from 'vitest';
import sql162 from '../../../../supabase/migrations/162_app_versions.sql?raw';

/** Static guards on the minimum version (paid plans P4, migration 162). */
const sql = sql162.replace(/--.*$/gm, '');

describe('162 app versions', () => {
  it('the table starts empty, RLS on, no direct access', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.app_versions \(/);
    expect(sql).toMatch(/ALTER TABLE public\.app_versions ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON public\.app_versions FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+(public\.)?app_versions/i);
    expect(sql).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*ON\s+(TABLE\s+)?public\./i);
  });

  it('read before sign-in: the RPC is open to anon and signed-in users, nothing else', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.bw_app_version\(text\) FROM PUBLIC/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.bw_app_version\(text\) TO anon, authenticated/);
  });

  it('three platforms', () => {
    expect(sql).toMatch(/platform IN \('ios', 'android', 'web'\)/);
  });
});
