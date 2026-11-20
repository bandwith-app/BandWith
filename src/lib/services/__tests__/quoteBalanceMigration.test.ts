import { describe, expect, it } from 'vitest';
import sql168 from '../../../../supabase/migrations/168_quote_balance.sql?raw';
import sql163 from '../../../../supabase/migrations/163_quote_made_with.sql?raw';
import sql099 from '../../../../supabase/migrations/099_quote_client_link.sql?raw';

/**
 * 168: the final balance of an accepted quote. Admin RPCs only; the page
 * RPC keeps its anon grant and is 163 plus the balance keys. These keep the
 * file from drifting; the behaviour is checked in a rolled-back dry run.
 */
const noComments = (sql: string) => sql.replace(/--.*$/gm, '');
const sql = noComments(sql168);
const fnBody = (src: string, name: string) => {
  const i = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  return noComments(src.slice(i, src.indexOf('$$;', src.indexOf('AS $$', i)))).replace(/\s+/g, ' ');
};

describe('168_quote_balance', () => {
  it('one transaction, no data written outside the functions', () => {
    expect(sql.match(/^BEGIN;/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;/gm)).toHaveLength(1);
    const outside = sql.replace(/AS \$\$[\s\S]*?\$\$;/g, '');
    expect(outside).not.toMatch(/INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM/i);
  });

  it('no new anon grant: only the page RPC, as before', () => {
    const anon = [...sql.matchAll(/GRANT [^;]* TO ([^;]*);/g)].filter((m) => /\banon\b/.test(m[1]));
    expect(anon.map((m) => m[0])).toEqual(['GRANT EXECUTE ON FUNCTION public.bw_quote_link_view(text) TO anon, authenticated;']);
    for (const fn of [
      'bw_quote_balance_publish(uuid, jsonb)',
      'bw_quote_balance_mark_sent(uuid, text, text)',
      'bw_quote_balance_mark_paid(uuid, boolean)',
      'bw_quote_confirm_gig(uuid)',
      'bw_quote_deposit_received(uuid, text, numeric, boolean)',
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated;`);
    }
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_quote_gig_id(uuid) FROM PUBLIC, anon, authenticated;');
    expect(sql).not.toMatch(/GRANT [^;]*bw_quote_gig_id/);
  });

  it('every admin RPC starts with the admin check', () => {
    for (const fn of ['bw_quote_balance_publish', 'bw_quote_balance_mark_sent', 'bw_quote_balance_mark_paid', 'bw_quote_confirm_gig', 'bw_quote_deposit_received']) {
      expect(fnBody(sql168, fn)).toContain('v_band uuid := public.bw_quote_admin_band(p_quote_id);');
    }
  });

  it('publish refuses what must never reach the client', () => {
    const b = fnBody(sql168, 'bw_quote_balance_publish');
    expect(b).toContain("'Nothing left to pay'");
    expect(b).toContain("'The gig is cancelled'");
    expect(b).toContain("'The quote is not accepted'");
    expect(b).toContain("'Add a way to pay'");
    expect(b).toContain("'Invalid payment link'");
    expect(b).toMatch(/v_stripe !~ '\^https:\/\//);
    expect(b).toContain("'Invalid PDF link'");
  });

  it('the timeline knows the balance kinds and keeps the old ones', () => {
    const check = sql.match(/ADD CONSTRAINT quote_activity_kind_check CHECK \(kind IN \(([\s\S]*?)\)\);/)![1];
    const kinds = [...check.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    const old = [...noComments(sql099).match(/kind text NOT NULL CHECK \(kind IN \(([\s\S]*?)\)\)/)![1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(kinds).toEqual(expect.arrayContaining(old));
    expect(kinds).toEqual(expect.arrayContaining(['balance_requested', 'balance_updated', 'balance_reminded', 'balance_paid', 'balance_reopened']));
    expect(kinds).toEqual(expect.arrayContaining(['deposit_received', 'deposit_reopened']));
  });

  it('the page RPC is 163 plus the balance and the deposit, nothing else', () => {
    const before = fnBody(sql163, 'bw_quote_link_view');
    const after = fnBody(sql168, 'bw_quote_link_view')
      .replace(/ v_gig_status text; v_gig_paid text; v_gig_deposit boolean; v_show_balance boolean;/, '')
      .replace(/ IF v_link\.status = 'accepted' THEN SELECT .*? END IF; v_show_balance := .*?; RETURN/, ' RETURN')
      .replace(/'quote', CASE WHEN v_link\.status = 'accepted' AND coalesce\(v_gig_status, ''\) <> 'cancelled' THEN v_snap ELSE v_snap - 'pay' END/, "'quote', v_snap")
      .replace(/, 'balance', .*? 'deposit_paid', v_link\.status = 'accepted' AND coalesce\(v_gig_deposit, false\)/, '');
    expect(after).toBe(before);
  });

  it('how to pay the deposit reaches the client only once accepted', () => {
    const b = fnBody(sql168, 'bw_quote_link_view');
    expect(b).toContain("ELSE v_snap - 'pay' END");
    expect(b).toContain("'deposit_paid', v_link.status = 'accepted' AND coalesce(v_gig_deposit, false)");
  });

  it('the deposit received sets the gig paid in part and confirms it through the shared RPC', () => {
    const d = fnBody(sql168, 'bw_quote_deposit_received');
    expect(d).toContain("IF v_method NOT IN ('transfer', 'cash', 'other') THEN v_method := 'other'; END IF;");
    expect(d).toContain("'The quote is not accepted'");
    expect(d).toContain("'The gig is cancelled'");
    expect(d).toContain("WHEN v_received THEN 'partial'");
    expect(d).toContain('v_confirm := public.bw_quote_confirm_gig(p_quote_id);');
    expect(d).toContain("'needs_gig', true");
    expect(d).toContain('e.band_id = v_band');
    const c = fnBody(sql168, 'bw_quote_confirm_gig');
    expect(c).toContain("SET status = 'confirmed'");
    expect(c).toContain("= 'tentative'");
  });

  it('marking paid follows the existing payment states of the gig', () => {
    const b = fnBody(sql168, 'bw_quote_balance_mark_paid');
    expect(b).toContain("payment_status = CASE WHEN v_paid THEN 'paid' WHEN e.deposit_paid THEN 'partial' ELSE 'pending' END");
    expect(b).toContain('e.band_id = v_band');
  });
});
