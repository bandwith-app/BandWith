import { describe, expect, it } from 'vitest';
import sql183 from '../../../../supabase/migrations/183_quote_page_fixes.sql?raw';
import sql168 from '../../../../supabase/migrations/168_quote_balance.sql?raw';
import sql120 from '../../../../supabase/migrations/120_quote_decline_once.sql?raw';
import sql105 from '../../../../supabase/migrations/105_quote_link_outcome_rider_preview.sql?raw';

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
    const outside = sql.replace(/AS \$\$[\s\S]*?\$\$;/g, '');
    expect(outside).not.toMatch(/INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM/i);
    expect(outside).toMatch(/ADD COLUMN IF NOT EXISTS recipient_changed_at/);
    expect(outside).toMatch(/DROP TRIGGER IF EXISTS bw_quote_recipient_changed ON public\.quotes;/);
  });

  it('no new anon grant: the two page RPCs it recreates, as before', () => {
    const anon = [...sql.matchAll(/GRANT [^;]* TO ([^;]*);/g)].filter((m) => /\banon\b/.test(m[1]));
    expect(anon.map((m) => m[0])).toEqual([
      'GRANT EXECUTE ON FUNCTION public.bw_quote_link_respond(text, text, text, text, int) TO anon, authenticated;',
      'GRANT EXECUTE ON FUNCTION public.bw_quote_link_view(text) TO anon, authenticated;',
    ]);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_trg_quote_recipient_changed() FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_same_phone(text, text) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_quote_link_publish(uuid, jsonb, text, text) FROM PUBLIC, anon;');
  });

  it('publish is 105 with the key named (42702)', () => {
    const before = fnBody(sql105, 'bw_quote_link_publish');
    const after = fnBody(sql, 'bw_quote_link_publish');
    expect(after).not.toContain('ON CONFLICT (quote_id, version)');
    expect(after.replace('ON CONFLICT ON CONSTRAINT quote_link_versions_pkey', 'ON CONFLICT (quote_id, version)')).toBe(before);
  });

  it('respond is 120 plus the version check for accept', () => {
    const before = fnBody(sql120, 'bw_quote_link_respond');
    const after = fnBody(sql, 'bw_quote_link_respond');
    const check = " IF v_action = 'accept' AND p_version IS NULL THEN RAISE EXCEPTION 'The version shown is needed to accept' USING ERRCODE = '22023'; END IF;";
    expect(after).toContain(check);
    expect(after.replace(check, '')).toBe(before);
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
