import { describe, it, expect } from 'vitest';
import sql170 from '../../../../supabase/migrations/170_live_pack.sql?raw';
import sql133 from '../../../../supabase/migrations/133_rehearsal_summary_push.sql?raw';

/**
 * Static guards on 170 (behaviour: supabase/tests/live_pack.pglite.mjs
 * locally, supabase/tests/live_pack.sql on the database).
 */
const sql = sql170.replace(/--.*$/gm, '');

const pushTypes = (s: string) => {
  const fn = s.slice(s.indexOf('FUNCTION public.bw_trg_dispatch_push()'));
  const list = fn.slice(fn.indexOf('NEW.type IN ('), fn.indexOf(')', fn.indexOf('NEW.type IN (')));
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
};

describe('170 live pack (plan A2)', () => {
  it('live_pack_status: RLS on, own rows, admins read, anon nothing', () => {
    expect(sql).toMatch(/ALTER TABLE public\.live_pack_status ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.live_pack_status FROM PUBLIC, anon/);
    expect(sql).toMatch(/WITH CHECK \(user_id = auth\.uid\(\) AND public\.bw_live_pack_can_hold\(event_id\)\)/);
    expect(sql).toMatch(/bw_is_band_member\(e\.band_id, p_user_id\)[\s\S]*bw_is_event_participant\(e\.id, p_user_id\)/);
    expect(sql).toMatch(/public\.bw_is_band_admin\(e\.band_id\)/);
  });

  it('new profile columns get their explicit grants', () => {
    expect(sql).toMatch(/GRANT SELECT \(live_pack_auto, live_pack_asked_at\) ON public\.profiles TO authenticated/);
    expect(sql).toMatch(/GRANT UPDATE \(live_pack_auto, live_pack_asked_at\) ON public\.profiles TO authenticated/);
  });

  it('the refresh queue is server only', () => {
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.live_pack_refresh_queue FROM PUBLIC, anon, authenticated/);
  });

  it('invites in 6 languages, without the 089/090 server flag', () => {
    for (const lang of ['en', 'it', 'es', 'fr', 'de', 'pt']) expect(sql).toContain(`"${lang}":`);
    expect(sql).toMatch(/preferred_language/);
    expect(sql).not.toMatch(/'server'/);
  });

  it('the push dispatcher keeps every type of 133 and adds live_pack_ready', () => {
    const before = pushTypes(sql133);
    const after = pushTypes(sql);
    expect(after).toEqual([...before, 'live_pack_ready']);
    expect(sql).toMatch(/notification_preferences->>'push'/);
  });

  it('the silent refresh asks send-push for a silent push', () => {
    expect(sql).toMatch(/'silent', true/);
    expect(sql).toMatch(/'type', 'live_pack_refresh'/);
  });

  it('only Remind and the status check are callable by the app', () => {
    const granted = [...sql.matchAll(/GRANT EXECUTE ON FUNCTION public\.(\w+)/g)].map((m) => m[1]).sort();
    expect(granted).toEqual(['bw_live_pack_can_hold', 'bw_live_pack_remind']);
  });

  it('daily invites and the 5-minute flush are scheduled', () => {
    expect(sql).toMatch(/cron\.schedule\('bw-live-pack-invites', '0 14 \* \* \*'/);
    expect(sql).toMatch(/cron\.schedule\('bw-live-pack-refresh', '\*\/5 \* \* \* \*'/);
  });
});
