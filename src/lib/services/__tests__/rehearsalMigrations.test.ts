import { describe, it, expect, vi } from 'vitest';
import sql130 from '../../../../supabase/migrations/130_feature_flags.sql?raw';
import sql131 from '../../../../supabase/migrations/131_rehearsal_sessions.sql?raw';
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
import { SESSION_COLUMNS } from '../rehearsalSessions';

/**
 * Static guards on the A1b migrations (the rollback-only dry run against the
 * live database checks the behaviour; these keep the files from drifting).
 */
const noComments = (sql: string) => sql.replace(/--.*$/gm, '');

describe('130 feature flags', () => {
  const sql = noComments(sql130);

  it('both tables have RLS on and no direct access (read through the RPC only)', () => {
    for (const t of ['platform_switches', 'band_features']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON public\\.${t} FROM PUBLIC, anon, authenticated`));
      expect(sql).not.toMatch(new RegExp(`GRANT [A-Z, ]+ ON public\\.${t}`));
    }
  });

  it('bw_band_features: signed-in users only, never anon', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.bw_band_features\(uuid\) FROM PUBLIC, anon/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.bw_band_features\(uuid\) TO authenticated/);
    expect(sql).not.toMatch(/TO anon/);
  });

  it("a band's own settings only reach its active members", () => {
    expect(sql).toMatch(/bw_is_band_member\(p_band_id\)/);
  });
});

describe('131 rehearsal sessions', () => {
  const sql = noComments(sql131);

  it('one session per rehearsal occurrence', () => {
    expect(sql).toMatch(/UNIQUE \(event_id, occurrence_date\)/);
  });

  it('no arrivals table (check-ins dropped, plan 3.0)', () => {
    expect(sql).not.toMatch(/arrivals/);
  });

  it('RLS on; members read, admins write; nothing for anon', () => {
    expect(sql).toMatch(/ALTER TABLE public\.rehearsal_sessions ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON public\.rehearsal_sessions FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/TO anon/);
    expect(sql).toMatch(/FOR SELECT TO authenticated\s+USING \(public\.bw_is_band_member\(band_id\)\)/);
    for (const op of ['INSERT', 'UPDATE', 'DELETE']) {
      expect(sql).toMatch(new RegExp(`FOR ${op} TO authenticated[\\s\\S]*?bw_is_band_admin\\(band_id\\)`));
    }
    // The session's band is its rehearsal's band.
    expect(sql).toMatch(/bw_event_band_id\(event_id\) = band_id/);
  });

  it('the app reads only granted columns', () => {
    const m = sql.match(/GRANT SELECT \(([^)]+)\)\s+ON public\.rehearsal_sessions TO authenticated/);
    expect(m).not.toBeNull();
    const granted = m![1].split(',').map((c) => c.trim()).sort();
    expect(granted).toEqual(SESSION_COLUMNS.split(',').map((c) => c.trim()).sort());
  });
});
