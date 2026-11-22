import { describe, it, expect } from 'vitest';
import sql170 from '../../../../supabase/migrations/170_live_pack.sql?raw';
import sql198 from '../../../../supabase/migrations/198_live_pack_flags.sql?raw';
import sql133 from '../../../../supabase/migrations/133_rehearsal_summary_push.sql?raw';

/**
 * Static guards on 170 and 198 (behaviour: supabase/tests/live_pack.pglite.mjs
 * locally, supabase/tests/live_pack.sql on the database). 170 is on main and
 * frozen; this round's changes (kill switch, partial) are in 198.
 */
const sql = sql170.replace(/--.*$/gm, '');
const s198 = sql198.replace(/--.*$/gm, '');

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

  it('kill switch live_pack (173) stops invites and Remind at the server, whatever the apply order', () => {
    const on = s198.slice(s198.indexOf('FUNCTION public.bw_live_pack_on()'));
    expect(on).toMatch(/to_regclass\('public\.app_flags'\)/);
    expect(on).toMatch(/EXECUTE 'SELECT enabled FROM public\.app_flags WHERE key = \$1'/);
    const body = (name: string) => {
      const from = s198.indexOf(`FUNCTION public.${name}(`);
      return s198.slice(from, s198.indexOf('$$;', s198.indexOf('AS $$', from)));
    };
    for (const fn of ['bw_live_pack_invite_sweep', 'bw_live_pack_invite_row', 'bw_live_pack_remind']) {
      expect(body(fn)).toMatch(/NOT public\.bw_live_pack_on\(\)/);
    }
    expect(s198).toMatch(/REVOKE ALL ON FUNCTION public\.bw_live_pack_on\(\) FROM PUBLIC, anon, authenticated/);
  });

  // Codex round (11-22): the flag is read before every push, not once per run
  // (it can be switched off while a job is running).
  const body = (name: string) => {
    const from = s198.indexOf(`FUNCTION public.${name}(`);
    return s198.slice(from, s198.indexOf('$$;', s198.indexOf('AS $$', from)));
  };
  it('the invite sweep checks the flag on every row, before a question or a queued download', () => {
    const loop = body('bw_live_pack_invite_sweep').split(/\bLOOP\b/)[1];
    const check = loop.search(/NOT public\.bw_live_pack_on\(\)/);
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(loop.indexOf('live_pack_refresh_queue'));
    expect(check).toBeLessThan(loop.indexOf('bw_live_pack_invite_row'));
  });

  it('the silent refresh checks the flag before every push and keeps the queue while off', () => {
    const flush = body('bw_live_pack_refresh_flush');
    // Before the queue is emptied: off, the rows stay for when it is back on.
    expect(flush.search(/NOT public\.bw_live_pack_on\(\)/)).toBeLessThan(flush.indexOf('DELETE FROM public.live_pack_refresh_queue'));
    const loop = flush.slice(flush.indexOf('LOOP'));
    expect(loop.search(/NOT public\.bw_live_pack_on\(\)/)).toBeGreaterThan(-1);
    expect(loop.search(/NOT public\.bw_live_pack_on\(\)/)).toBeLessThan(loop.indexOf('net.http_post'));
    // Switched off mid-run: the event goes back in the queue.
    expect(loop).toMatch(/INSERT INTO public\.live_pack_refresh_queue[\s\S]*ON CONFLICT \(event_id\) DO NOTHING/);
  });

  it('safe to run again: every object of 170 and 198 is created or replaced', () => {
    for (const [name, src] of [['170', sql], ['198', s198]] as const) {
      expect(src, name).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/);
      expect(src, name).not.toMatch(/CREATE (?!OR REPLACE )FUNCTION/);
      expect(src, name).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
      expect(src, name).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/);
      for (const [, kind, obj] of src.matchAll(/CREATE (TRIGGER|POLICY) (\w+)/g)) {
        const at = src.indexOf(`CREATE ${kind} ${obj}`);
        expect(src.slice(0, at), `${name} ${kind} ${obj}`).toContain(`DROP ${kind} IF EXISTS ${obj} ON public.`);
      }
    }
    expect(s198).toMatch(/ALTER TABLE public\.live_pack_status ADD COLUMN IF NOT EXISTS partial boolean NOT NULL DEFAULT false/);
  });
});

// Codex round 2 (11-22): a migration already on main stays frozen.
describe('170 frozen, this round in 198', () => {
  const body = (name: string) => {
    const from = s198.indexOf(`FUNCTION public.${name}(`);
    return s198.slice(from, s198.indexOf('$$;', s198.indexOf('AS $$', from)));
  };
  it('170 is the file on main, byte for byte', async () => {
    // src/test/setup.ts replaces globalThis.crypto; a non-literal specifier
    // keeps tsc (no @types/node in the app) out of node:crypto.
    const nodeCrypto = 'node:crypto';
    const { createHash } = await import(/* @vite-ignore */ nodeCrypto);
    expect(createHash('sha256').update(sql170).digest('hex')).toBe('5c1ad237d412ddb42c887a93c160a358a800a6e85e2128e8d4be9aead4cc3914');
  });

  it('198 needs 170 first and says so', () => {
    expect(s198).toMatch(/to_regclass\('public\.live_pack_status'\) IS NULL/);
    expect(s198).toMatch(/RAISE EXCEPTION '198 needs 170 first/);
  });

  it('198 redefines none of the functions a later release migration redefines (178: window events, dispatch)', () => {
    expect(s198).not.toMatch(/FUNCTION public\.bw_live_pack_window_events\(/);
    expect(s198).not.toMatch(/FUNCTION public\.bw_trg_dispatch_push\(/);
  });

  it('the switch fails open but leaves a warning in the logs', () => {
    const on = body('bw_live_pack_on');
    expect(on).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/);
  });

  it('back on: the flush skips events no longer in the window', () => {
    const loop = body('bw_live_pack_refresh_flush').split(/\bLOOP\b/)[1];
    const skip = loop.search(/CONTINUE WHEN NOT EXISTS \(SELECT 1 FROM public\.bw_live_pack_window_events\(q\.event_id\)\)/);
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(loop.indexOf('net.http_post'));
  });

  it('bw_live_pack_keep: only the caller, not cancelled, readable, still in the lineup', () => {
    const keep = body('bw_live_pack_keep');
    expect(keep).toMatch(/auth\.uid\(\) IS NOT NULL/);
    expect(keep).toMatch(/NOT IN \('cancelled', 'canceled'\)/);
    expect(keep).toMatch(/bw_can_view_event\(e\.id, auth\.uid\(\)\)/);
    expect(keep).toMatch(/bw_live_pack_can_hold\(e\.id, auth\.uid\(\)\)/);
    const granted = [...s198.matchAll(/GRANT EXECUTE ON FUNCTION public\.(\w+)/g)].map((m) => m[1]).sort();
    expect(granted).toEqual(['bw_live_pack_can_hold', 'bw_live_pack_keep', 'bw_live_pack_remind']);
  });
});
