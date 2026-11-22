import { describe, expect, it } from 'vitest';
import sql183 from '../../../../supabase/migrations/183_quote_page_fixes.sql?raw';
import sql168 from '../../../../supabase/migrations/168_quote_balance.sql?raw';
import sql120 from '../../../../supabase/migrations/120_quote_decline_once.sql?raw';
import sql105 from '../../../../supabase/migrations/105_quote_link_outcome_rider_preview.sql?raw';
import sql099raw from '../../../../supabase/migrations/099_quote_client_link.sql?raw';
import sql161raw from '../../../../supabase/migrations/161_plan_guards.sql?raw';

/**
 * 183: new recipient → new link, accept needs the version, the deposit
 * amount received. These keep the file from drifting; the behaviour is
 * checked by supabase/tests/quote_page_fixes.pglite.mjs.
 */
const noComments = (sql: string) => sql.replace(/--.*$/gm, '');
const sql = noComments(sql183);
const fnBody = (src: string, name: string) => {
  const i = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  return noComments(src.slice(i, src.indexOf('$$;', src.indexOf('AS $$', i)))).replace(/\s+/g, ' ');
};

describe('183_quote_page_fixes', () => {
  it('one transaction, no data written outside the functions', () => {
    expect(sql.match(/^BEGIN;/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;/gm)).toHaveLength(1);
    // One write outside the functions: the accepted client name of links accepted before 183.
    const backfill = /UPDATE public\.quote_links l\s+SET accepted_client_name = q\.client_name\s+FROM public\.quotes q\s+WHERE q\.id = l\.quote_id AND l\.status = 'accepted' AND l\.accepted_client_name IS NULL;/;
    expect(sql).toMatch(backfill);
    const outside = sql.replace(/AS \$\$[\s\S]*?\$\$;/g, '').replace(/AS \$function\$[\s\S]*?\$function\$;/g, '').replace(backfill, '');
    expect(outside).not.toMatch(/INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM/i);
    expect(outside).toMatch(/ADD COLUMN IF NOT EXISTS recipient_changed_at/);
    expect(outside).toMatch(/DROP TRIGGER IF EXISTS bw_quote_recipient_changed ON public\.quotes;/);
  });

  it('no new anon grant: the four page RPCs it recreates, as 099 granted them', () => {
    const anon = [...sql.matchAll(/GRANT [^;]* TO ([^;]*);/g)].filter((m) => /\banon\b/.test(m[1]));
    expect(anon.map((m) => m[0])).toEqual([
      'GRANT EXECUTE ON FUNCTION public.bw_quote_link_respond(text, text, text, text, int) TO anon, authenticated;',
      'GRANT EXECUTE ON FUNCTION public.bw_quote_link_view(text) TO anon, authenticated;',
      'GRANT EXECUTE ON FUNCTION public.bw_quote_link_seen(text) TO anon, authenticated;',
      'GRANT EXECUTE ON FUNCTION public.bw_quote_link_message(text, text) TO anon, authenticated;',
    ]);
    for (const g of anon.slice(2)) expect(sql099raw).toContain(g[0]);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_trg_quote_recipient_changed() FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_trg_quote_link_accepted_name() FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_quote_deposit_received(uuid, text, numeric, boolean) FROM PUBLIC, anon;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_same_phone(text, text) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_quote_link_publish(uuid, jsonb, text, text, text) FROM PUBLIC, anon;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.bw_quote_link_publish(uuid, jsonb, text, text, text) TO authenticated;');
    // The four-argument publish is replaced (one function: older builds' named arguments find the new one).
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.bw_quote_link_publish(uuid, jsonb, text, text);');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_quote_lock_for_token(text) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_trg_quote_field_listed() FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.bw_quote_link_mark_sent(uuid, text, text) TO authenticated;');
  });

  it('publish is 105 with the key named (42702) and a new version for a new recipient', () => {
    const before = fnBody(sql105, 'bw_quote_link_publish');
    const after = fnBody(sql, 'bw_quote_link_publish');
    expect(after).not.toContain('ON CONFLICT (quote_id, version)');
    const fresh =
      " v_fresh := v_link.status = 'draft' AND v_link.recipient_changed_at IS NOT NULL AND (v_link.version_at IS NULL OR v_link.version_at <= v_link.recipient_changed_at);";
    expect(after).toContain(fresh);
    const token =
      " IF p_token IS NOT NULL AND v_link.token IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'BW_LINK_CHANGED: the quote link was replaced, open the quote again' USING ERRCODE = 'P0001'; END IF;";
    expect(after).toContain(token);
    const back = after
      .replace(token, '')
      .replace(', p_token text DEFAULT NULL )', ' )')
      .replace('ON CONFLICT ON CONSTRAINT quote_link_versions_pkey', 'ON CONFLICT (quote_id, version)')
      .replace(' v_fresh boolean;', '')
      .replace(fresh, '')
      .replace('IS DISTINCT FROM p_snapshot OR v_fresh;', 'IS DISTINCT FROM p_snapshot;')
      .replace('AND v_link.version >= 1 AND NOT v_fresh THEN', 'AND v_link.version >= 1 THEN');
    expect(back).toBe(before);
  });

  it('deposit received is 168 plus the amount and currency kept on the link', () => {
    const after = fnBody(sql, 'bw_quote_deposit_received');
    expect(after).toContain('SET deposit_received_amount = CASE WHEN v_received AND p_amount > 0 THEN p_amount END');
    expect(after).toContain('upper(coalesce(nullif(btrim(e.currency), \'\'),');
    expect(after).toMatch(/REVOKE|v_currency/);
    expect(fnBody(sql168, 'bw_quote_deposit_received').length).toBeLessThan(after.length);
  });

  it('respond is 120 plus the version check for accept', () => {
    const before = fnBody(sql120, 'bw_quote_link_respond');
    const after = fnBody(sql, 'bw_quote_link_respond');
    const check = " IF v_action = 'accept' AND p_version IS NULL THEN RAISE EXCEPTION 'The version shown is needed to accept' USING ERRCODE = '22023'; END IF;";
    expect(after).toContain(check);
    const lock = ' PERFORM public.bw_quote_lock_for_token(p_token);';
    expect(after).toContain(lock);
    expect(after.replace(check, '').replace(lock, '')).toBe(before);
  });

  it('seen, message and mark sent are 099 / 161 with the quote locked first', () => {
    const sql099 = sql099raw;
    const sql161 = sql161raw;
    const lock = ' PERFORM public.bw_quote_lock_for_token(p_token);';
    expect(fnBody(sql, 'bw_quote_link_seen').replace(lock, '')).toBe(fnBody(sql099, 'bw_quote_link_seen'));
    expect(fnBody(sql, 'bw_quote_link_message').replace(lock, '')).toBe(fnBody(sql099, 'bw_quote_link_message'));
    const quoteLock = ' PERFORM 1 FROM public.quotes q WHERE q.id = p_quote_id FOR UPDATE;';
    const ms = (src: string) => {
      const i = src.indexOf('CREATE OR REPLACE FUNCTION public.bw_quote_link_mark_sent');
      return noComments(src.slice(i, src.indexOf('$function$;', src.indexOf('AS $function$', i)))).replace(/\s+/g, ' ');
    };
    expect(ms(sql)).toContain(quoteLock);
    expect(ms(sql).replace(quoteLock, '')).toBe(ms(sql161));
  });

  it('the page view keeps every key of 168 and adds the deposit amount', () => {
    const keys = (body: string) => [...body.matchAll(/'([a-z_]+)', /g)].map((m) => m[1]).filter((k) => !['client_message', 'band_reply', 'from', 'body', 'at', 'stale'].includes(k));
    const before = keys(fnBody(sql168, 'bw_quote_link_view'));
    const after = keys(fnBody(sql, 'bw_quote_link_view'));
    for (const k of before) expect(after).toContain(k);
    expect(after).toContain('deposit_paid_amount');
    expect(fnBody(sql, 'bw_quote_link_view')).toContain('a.created_at >= v_link.recipient_changed_at');
  });
});
