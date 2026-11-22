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
  const i = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const dollar = src.indexOf('$function$', i) !== -1 && src.indexOf('$function$', i) < src.indexOf('$$', i) ? '$function$' : '$$';
  return noComments(src.slice(i, src.indexOf(`${dollar};`, src.indexOf(`AS ${dollar}`, i)))).replace(/\s+/g, ' ');
};

describe('183_quote_page_fixes', () => {
  it('one transaction, no data written outside the functions', () => {
    expect(sql.match(/^BEGIN;/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;/gm)).toHaveLength(1);
    // Two writes outside the functions: the accepted client name of links
    // accepted before 183, and the link of the timeline rows before 183.
    const backfill = /UPDATE public\.quote_links l\s+SET accepted_client_name = q\.client_name\s+FROM public\.quotes q\s+WHERE q\.id = l\.quote_id AND l\.status = 'accepted' AND l\.accepted_client_name IS NULL\s+AND l\.recipient_changed_at IS NULL;/;
    const linkBackfill = /UPDATE public\.quote_activity a\s+SET link_id = l\.id\s+FROM public\.quote_links l\s+WHERE a\.link_id IS NULL AND l\.quote_id = a\.quote_id;/;
    // Round 4: who each published link was for, and the currency of deposits recorded before.
    const recipientBackfill = /UPDATE public\.quote_links l\s+SET recipient_email = nullif\(lower\(btrim\(q\.client_email\)\), ''\), recipient_name = nullif\(btrim\(q\.client_name\), ''\)\s+FROM public\.quotes q\s+WHERE q\.id = l\.quote_id AND l\.snapshot IS NOT NULL AND l\.recipient_email IS NULL AND l\.recipient_name IS NULL\s+AND l\.recipient_changed_at IS NULL;/;
    const currencyBackfill = /UPDATE public\.quote_links l\s+SET deposit_received_currency = upper\(btrim\(q\.currency\)\)\s+FROM public\.quotes q\s+WHERE q\.id = l\.quote_id AND l\.deposit_received_amount > 0 AND l\.deposit_received_currency IS NULL\s+AND upper\(btrim\(coalesce\(q\.currency, ''\)\)\) ~ '\^\[A-Z\]\{3\}\$';/;
    expect(sql).toMatch(backfill);
    expect(sql).toMatch(linkBackfill);
    expect(sql).toMatch(recipientBackfill);
    expect(sql).toMatch(currencyBackfill);
    const outside = sql.replace(/AS \$\$[\s\S]*?\$\$;/g, '').replace(/AS \$function\$[\s\S]*?\$function\$;/g, '')
      .replace(backfill, '').replace(linkBackfill, '').replace(recipientBackfill, '').replace(currencyBackfill, '');
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
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_quote_link_publish(uuid, jsonb, text, text, text, int) FROM PUBLIC, anon;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.bw_quote_link_publish(uuid, jsonb, text, text, text, int) TO authenticated;');
    // The four- and five-argument publish are replaced (one function: older builds' named arguments find the new one).
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.bw_quote_link_publish(uuid, jsonb, text, text);');
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.bw_quote_link_publish(uuid, jsonb, text, text, text);');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_quote_accepted_message() FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_quote_currency_message(text) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_trg_quote_currency_locked() FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_quote_lock_for_token(text) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_trg_quote_field_listed() FROM PUBLIC, anon, authenticated;');
    // Round 3: mark sent and reply take the link (and the version) that went out.
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.bw_quote_link_mark_sent(uuid, text, text);');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.bw_quote_link_mark_sent(uuid, text, text, text, int) TO authenticated;');
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.bw_quote_reply(uuid, text);');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.bw_quote_reply(uuid, text, text) TO authenticated;');
    expect(sql).toContain('REVOKE ALL ON public.quote_link_retired FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_trg_quote_activity_link() FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.bw_quote_stale_message() FROM PUBLIC, anon, authenticated;');
  });

  it('publish is 105 with the key named (42702) and a new version for a new recipient', () => {
    const before = fnBody(sql105, 'bw_quote_link_publish');
    const after = fnBody(sql, 'bw_quote_link_publish');
    expect(after).not.toContain('ON CONFLICT (quote_id, version)');
    const fresh = ' v_fresh := v_link.recipient_changed_at IS NOT NULL AND v_link.version_at IS NULL;';
    expect(after).toContain(fresh);
    // Round 5: another token is stale (40001); an older build without one is
    // judged by its summary's client, never refused for good.
    const token =
      " IF p_token IS NOT NULL AND v_link.token IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'BW_LINK_CHANGED: the quote link was replaced, open the quote again' USING ERRCODE = '40001'; END IF;";
    expect(after).toContain(token);
    expect(after).toContain("IF p_token IS NULL AND p_version IS NULL AND v_link.recipient_changed_at IS NOT NULL AND NOT public.bw_quote_snapshot_for_client(p_quote_id, p_snapshot, v_pdf) THEN");
    expect(after).not.toContain('(p_token IS NULL AND v_link.recipient_changed_at IS NOT NULL)');
    // Round 4: the quote locked, and who it is for read under that lock.
    const quoteLock =
      " SELECT nullif(lower(btrim(q.client_email)), ''), nullif(btrim(q.client_name), '') INTO v_email, v_name FROM public.quotes q WHERE q.id = p_quote_id FOR UPDATE;";
    expect(after).toContain(quoteLock);
    // Round 4: the version the admin sees, and a language-only change is no new version.
    const versionCheck =
      " IF p_version IS NOT NULL AND p_version <> 0 AND v_link.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'BW_VERSION_CHANGED: another version was published meanwhile, open the quote again' USING ERRCODE = '40001'; END IF;";
    expect(after).toContain(versionCheck);
    // Round 5: coalesce, so the first publish (no summary yet) is a change.
    const sameContent =
      " AND NOT coalesce(v_link.snapshot ? 'contentKey' AND p_snapshot ? 'contentKey' AND v_link.snapshot ->> 'contentKey' = p_snapshot ->> 'contentKey', false)";
    expect(after).toContain(sameContent);
    // Round 5: a screen that saw no link (p_version 0), and an older build's summary for the previous client.
    const sawNone =
      " IF p_version = 0 AND v_made IS NULL THEN RAISE EXCEPTION 'BW_LINK_CHANGED: the quote link was made meanwhile, open the quote again' USING ERRCODE = '40001'; END IF;";
    expect(after).toContain(sawNone);
    const olderBuild =
      " IF p_token IS NULL AND p_version IS NULL AND v_link.recipient_changed_at IS NOT NULL AND NOT public.bw_quote_snapshot_for_client(p_quote_id, p_snapshot, v_pdf) THEN RAISE EXCEPTION '%', public.bw_quote_update_app_message() USING ERRCODE = '40001', HINT = 'BW_UPDATE_APP'; END IF;";
    expect(after).toContain(olderBuild);
    // Round 6: a new build's summary names its client, checked and never
    // stored; a 383f15b publish without a PDF is refused once the client
    // changed since the link was last published.
    const identity =
      " IF jsonb_typeof(p_snapshot -> 'client') = 'object' THEN IF regexp_replace(lower(regexp_replace(btrim(coalesce(p_snapshot -> 'client' ->> 'name', '')), '\\s+', ' ', 'g')), '^client$', '') IS DISTINCT FROM regexp_replace(lower(regexp_replace(coalesce(v_name, ''), '\\s+', ' ', 'g')), '^client$', '') OR lower(btrim(coalesce(p_snapshot -> 'client' ->> 'email', ''))) IS DISTINCT FROM coalesce(v_email, '') THEN RAISE EXCEPTION 'BW_LINK_CHANGED: the quote now goes to another client, open the quote again' USING ERRCODE = '40001'; END IF; p_snapshot := p_snapshot - 'client'; ELSIF v_pdf IS NULL AND p_token IS NULL AND p_version IS NULL THEN v_last := CASE WHEN v_link.recipient_email IS NOT NULL OR v_link.recipient_name IS NOT NULL THEN jsonb_build_object('name', v_link.recipient_name, 'email', v_link.recipient_email) ELSE v_link.reassign_guard -> 'published' END; IF jsonb_typeof(v_last) = 'object' AND ((v_last ->> 'email') IS DISTINCT FROM v_email OR lower(v_last ->> 'name') IS DISTINCT FROM lower(v_name)) THEN RAISE EXCEPTION '%', public.bw_quote_update_app_message() USING ERRCODE = '40001', HINT = 'BW_UPDATE_APP'; END IF; END IF;";
    expect(after).toContain(identity);
    const back = after
      .replace(sawNone, '')
      .replace(identity, '')
      .replace(' v_last jsonb;', '')
      .replace(olderBuild, '')
      .replace(' RETURNING id INTO v_made;', ';')
      .replace(' v_made uuid;', '')
      .replace(token, '')
      .replace(quoteLock, '')
      .replace(versionCheck, '')
      .replace(sameContent, '')
      .replace('v_changed := (v_link.snapshot IS DISTINCT FROM p_snapshot) OR v_fresh;', 'v_changed := v_link.snapshot IS DISTINCT FROM p_snapshot OR v_fresh;')
      .replace(' recipient_email = v_email, recipient_name = v_name,', '')
      .replace(' v_email text; v_name text;', '')
      .replace(', p_version int DEFAULT NULL )', ' )')
      .replace("v_link.version > 1 AND NOT v_fresh THEN", 'v_link.version > 1 THEN')
      .replace(', p_token text DEFAULT NULL )', ' )')
      .replace('ON CONFLICT ON CONSTRAINT quote_link_versions_pkey', 'ON CONFLICT (quote_id, version)')
      .replace(' v_fresh boolean;', '')
      .replace(fresh, '')
      .replace('IS DISTINCT FROM p_snapshot OR v_fresh;', 'IS DISTINCT FROM p_snapshot;')
      .replace('AND v_link.version >= 1 AND NOT v_fresh THEN', 'AND v_link.version >= 1 THEN');
    expect(back).toBe(before);
  });

  it('deposit received is 168 plus the amount kept on the link, in the quote\'s currency', () => {
    const after = fnBody(sql, 'bw_quote_deposit_received');
    expect(after).toContain('SET deposit_received_amount = CASE WHEN v_received AND v_amount > 0 THEN v_amount END');
    // Round 4: in cents, capped where the gig's numeric(10,2) holds it.
    expect(after).toContain('v_amount numeric := round(p_amount, 2);');
    expect(after).toContain('IF v_amount IS NOT NULL AND (v_amount < 0 OR v_amount > 99999999.99) THEN');
    // The quote's currency; the gig's only when the quote has none (events.currency defaults to EUR).
    expect(after).toContain("SELECT lower(coalesce(q.status, '')), upper(nullif(btrim(q.currency), '')) INTO v_quote_status, v_currency");
    expect(after).toContain("coalesce(v_currency, upper(nullif(btrim(e.currency), '')))");
    expect(after).not.toContain("upper(coalesce(nullif(btrim(e.currency), ''),");
    // Round 4: the currency recorded with the payment first, then the quote's.
    expect(fnBody(sql, 'bw_quote_link_view')).toContain("coalesce(v_link.deposit_received_currency, v_currency)");
    expect(fnBody(sql168, 'bw_quote_deposit_received').length).toBeLessThan(after.length);
  });

  // Statically, as PGlite runs one connection (two sessions can't wait on
  // each other there; the pglite test checks the locks each call holds).
  it('one lock order everywhere: the quote, then the link, then the gig', () => {
    const quoteLock = /FROM public\.quotes q WHERE q\.id = [^;]*FOR UPDATE|bw_quote_lock_for_token\(p_token\)/;
    const linkLock = /FROM public\.quote_links l WHERE l\.(quote_id|token) = [a-z_]+ FOR UPDATE|UPDATE public\.quote_links/;
    const gigLock = /FROM public\.events e WHERE e\.id = v_gig FOR UPDATE|UPDATE public\.events/;
    const at = (body: string, re: RegExp) => body.search(re);
    for (const name of ['bw_quote_link_publish', 'bw_quote_link_respond', 'bw_quote_link_seen', 'bw_quote_link_message',
      'bw_quote_link_mark_sent', 'bw_quote_reply', 'bw_quote_deposit_received']) {
      const body = fnBody(sql, name);
      expect(at(body, quoteLock), `${name} locks the quote`).toBeGreaterThan(0);
      expect(at(body, quoteLock), `${name}: the quote before the link`).toBeLessThan(at(body, linkLock));
      if (at(body, gigLock) >= 0) expect(at(body, linkLock), `${name}: the link before the gig`).toBeLessThan(at(body, gigLock));
    }
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
    // The message also names its link (round 3).
    expect(
      fnBody(sql, 'bw_quote_link_message')
        .replace(lock, '')
        .replace('(quote_id, band_id, kind, body, version, link_id)', '(quote_id, band_id, kind, body, version)')
        .replace("v_body, v_link.version, v_link.id);", 'v_body, v_link.version);'),
    ).toBe(fnBody(sql099, 'bw_quote_link_message'));
    const quoteLock = ' PERFORM 1 FROM public.quotes q WHERE q.id = p_quote_id FOR UPDATE;';
    const ms = (src: string) => {
      const i = src.indexOf('CREATE OR REPLACE FUNCTION public.bw_quote_link_mark_sent');
      return noComments(src.slice(i, src.indexOf('$function$;', src.indexOf('AS $function$', i)))).replace(/\s+/g, ' ');
    };
    expect(ms(sql)).toContain(quoteLock);
    // Round 3: nothing recorded on an unpublished link, another link or another version.
    const r3 = ms(sql);
    expect(r3).toContain("IF v_link.id IS NULL OR v_link.snapshot IS NULL THEN RAISE EXCEPTION 'Publish the quote first'");
    expect(r3).toContain("RAISE EXCEPTION 'BW_VERSION_CHANGED: the quote was updated after this was sent'");
    // Round 5: an older build (no token) once the link is published for its current recipient.
    expect(r3).toContain('IF p_token IS NULL AND NOT public.bw_quote_link_current(v_link) THEN');
    expect(r3).not.toContain('(p_token IS NULL AND v_link.recipient_changed_at IS NOT NULL)');
    // The rest of 161's body is there as it was.
    for (const line of [
      "IF v_link.status = 'draft' AND COALESCE(p_kind, 'sent') <> 'reminded' THEN PERFORM public.bw_plan_guard(v_band, 'quotes_sent_month', 1); END IF;",
      "UPDATE public.quotes q SET status = 'sent', sent_at = coalesce(q.sent_at, now()), updated_at = now() WHERE q.id = p_quote_id AND coalesce(q.status, 'draft') = 'draft';",
    ]) {
      expect(ms(sql161)).toContain(line);
      expect(r3).toContain(line);
    }
  });

  it('the page view keeps every key of 168 and adds the deposit amount', () => {
    const keys = (body: string) => [...body.matchAll(/'([a-z_]+)', /g)].map((m) => m[1]).filter((k) => !['client_message', 'band_reply', 'from', 'body', 'at', 'stale'].includes(k));
    const before = keys(fnBody(sql168, 'bw_quote_link_view'));
    const after = keys(fnBody(sql, 'bw_quote_link_view'));
    for (const k of before) expect(after).toContain(k);
    expect(after).toContain('deposit_paid_amount');
    // Round 3: the conversation of this link only (not "since the change").
    expect(fnBody(sql, 'bw_quote_link_view')).toContain("a.kind IN ('client_message', 'band_reply') AND a.link_id = v_link.id");
  });
});
