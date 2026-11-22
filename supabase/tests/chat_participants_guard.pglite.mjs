// The central guard on chat_participants (main, #281/#289 round 4), checked on
// the whole release chain. 175 keeps an ex-member's participant row (archived,
// never deleted), so nothing may show or count it. Instead of hunting every
// reader, this test pins down every way in:
//
//   1. RLS: the policies on chat_participants, messages and chats after the
//      chain, by name, are an allowlist. A new one fails the test. RESTRICTIVE
//      guards are ANDed with every other policy: on chat_participants for
//      SELECT, UPDATE and DELETE (own row or my chats, then the rule per row:
//      bw_chat_row_ok), on messages for SELECT (my chats). So an ex-member's
//      kept row is invisible to the others (roster, counts) and to its owner,
//      and can't be changed, through every policy. Old builds (383f15b) read
//      only through these policies.
//   2. Server: every function in public whose source reads chat_participants,
//      and every SECURITY DEFINER one that touches messages or chats, is an
//      allowlist: per entry who may run it (anon, authenticated, asserted
//      with has_function_privilege) and, for the ones users run, that it
//      applies the rule (bw_chat_scope_ok / bw_my_chat_ids / bw_chat_row_ok).
//      A function not on the list fails the test.
//      Both lists come from supabase/tests/chat_access_catalog.sql, the
//      read-only query main runs on prod at dry-run time; BW_PROD_CATALOG=
//      <its output as JSON> checks prod's catalog against the same lists.
//   3. Cost: EXPLAIN ANALYZE of get_user_chats and the roster query, with and
//      without the guard, on 50 chats x 10 participants.
//
// Base = "prod today": migrations 001..174 replayed statement by statement
// (statements that can't run here, e.g. publications or data fixes, are
// skipped; 002 v2's DROP TYPE ... CASCADE is skipped so chats.type survives),
// which gives exactly prod's 7 chat_participants policies (073) and 9 of the
// 10 functions main lists on prod. get_user_chat_ids exists only on prod (no
// migration): it is created as it is there (175 revokes it).
//
// Then the chain, each file whole, in main's release order (11-22, #278):
//   194 (BW_194_REF, origin/fix/push-safety) -> 184 (BW_184_REF, origin/fix/auth-signout)
//   -> 175, 176 (this repo) -> 178 (BW_178_REF, origin/feat/date-on-hold)
//   -> 180 (BW_180_REF, origin/fix/account-deletion)
//   -> 192, 193 (BW_193_REF, origin/fix/chat-audit) -> 181 (this repo)
// A head that isn't available is SKIPPED with a warning. A file that fails
// whole is loaded statement by statement with a WARN; a skipped statement
// that touches chat_participants fails the test.
//
//   cd <dir with @electric-sql/pglite@0.5.15> && node chat_participants_guard.pglite.mjs <repo>
//   BW_LOCAL_REF=0437db39 node chat_participants_guard.pglite.mjs <repo>   # before round 4's guard: FAILs
//   BW_LOCAL_REF=2ad914ad node chat_participants_guard.pglite.mjs <repo>   # before round 5: FAILs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO = process.argv[2];
const MIGS = `${REPO}/supabase/migrations`;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const warn = (msg) => console.log('WARN', msg);
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

// Split SQL into statements ('...', E'...', "...", $tag$...$tag$, comments).
function split(sql) {
  const out = []; let cur = ''; let i = 0; const n = sql.length;
  while (i < n) {
    const c = sql[i], d = sql[i + 1];
    if (c === '-' && d === '-') { const e = sql.indexOf('\n', i); const j = e < 0 ? n : e; cur += sql.slice(i, j); i = j; continue; }
    if (c === '/' && d === '*') { const e = sql.indexOf('*/', i + 2); const j = e < 0 ? n : e + 2; cur += sql.slice(i, j); i = j; continue; }
    if (c === "'") {
      const esc = /(^|[^A-Za-z0-9_])[eE]$/.test(cur);
      let j = i + 1;
      while (j < n) { if (esc && sql[j] === '\\') { j += 2; continue; } if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; } j++; }
      cur += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '"') { const e = sql.indexOf('"', i + 1); cur += sql.slice(i, e + 1); i = e + 1; continue; }
    if (c === '$') {
      const m = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (m && !/[A-Za-z0-9_]$/.test(cur)) { const tag = m[0]; const e = sql.indexOf(tag, i + tag.length); const j = e < 0 ? n : e + tag.length; cur += sql.slice(i, j); i = j; continue; }
    }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((s) => s.replace(/--[^\n]*/g, '').trim());
}
const bare = (s) => s.replace(/^(\s*--[^\n]*\n)+/, '').trim();
async function replay(sql) {
  const skipped = [];
  for (const s of split(sql)) {
    if (/^(begin|commit|rollback)\b/i.test(bare(s))) continue;
    if (/DROP TYPE IF EXISTS \w+ CASCADE/i.test(s)) continue;
    try { await db.exec(s); } catch (e) { skipped.push({ s, e: e.message }); try { await db.exec('ROLLBACK'); } catch { /* none open */ } }
  }
  return skipped;
}
const show = (ref, path) => {
  try { return execFileSync('git', ['-C', REPO, 'show', `${ref}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
};

const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions; CREATE SCHEMA realtime;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb, is_anonymous boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt() ->> 'role' $$;
CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array(name, '/') $$;
CREATE TABLE realtime.messages (id bigserial, topic text, extension text);
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql AS $$ SELECT '' $$;
GRANT USAGE ON SCHEMA public, auth, storage TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt(), auth.role() TO authenticated, anon;
SET check_function_bodies = off;`);

// ── Base: prod today ─────────────────────────────────────────────────────────
for (const f of readdirSync(MIGS).filter((f) => /^\d{3}_.*\.sql$/.test(f) && f < '175').sort()) {
  await replay(readFileSync(`${MIGS}/${f}`, 'utf8'));
}
// Prod-only (no migration defines it; main's prod list), as it is on prod:
// SECURITY DEFINER, any user's chat ids, EXECUTE for PUBLIC, anon, authenticated.
await db.exec(`CREATE OR REPLACE FUNCTION public.get_user_chat_ids(user_uuid uuid) RETURNS SETOF uuid
  LANGUAGE sql SECURITY DEFINER AS $$ SELECT chat_id FROM chat_participants WHERE user_id = user_uuid $$;
  GRANT EXECUTE ON FUNCTION public.get_user_chat_ids(uuid) TO PUBLIC, anon, authenticated, service_role;`);
const readers = async () => (await db.query(`SELECT DISTINCT p.proname FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ILIKE '%chat_participants%' ORDER BY 1`)).rows.map((x) => x.proname);
const PROD_TODAY = ['bw_can_add_chat_participant', 'bw_chat_participants_immutable_keys', 'bw_delete_chat_history',
  'bw_mark_chat_delivered_by_push', 'bw_mark_chat_read', 'bw_mark_chats_delivered', 'bw_my_chat_ids', 'bw_shares_chat',
  'get_user_chat_ids', 'get_user_chats'];
ok(JSON.stringify(await readers()) === JSON.stringify(PROD_TODAY), `base = prod today: the 10 functions that read chat_participants (${(await readers()).join(', ')})`);
const cpPolicies = async () => (await db.query(`SELECT policyname, cmd, permissive, roles::text AS roles, coalesce(qual, '') AS qual
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'chat_participants' ORDER BY policyname`)).rows;
ok((await cpPolicies()).length === 7, `base = prod today: 7 policies on chat_participants (${(await cpPolicies()).map((x) => x.policyname).join(', ')})`);

// ── The chain ────────────────────────────────────────────────────────────────
// BW_LOCAL_REF=<commit>: 175 and 181 from that commit (failing-first runs).
const local = (name) => (process.env.BW_LOCAL_REF ? show(process.env.BW_LOCAL_REF, `supabase/migrations/${name}`) : readFileSync(`${MIGS}/${name}`, 'utf8'));
const ref = (env, def) => process.env[env] ?? def;
const CHAIN = [
  ['194', () => show(ref('BW_194_REF', 'origin/fix/push-safety'), 'supabase/migrations/194_chat_notifications_server_only.sql'), ref('BW_194_REF', 'origin/fix/push-safety')],
  ['184', () => show(ref('BW_184_REF', 'origin/fix/auth-signout'), 'supabase/migrations/184_push_revoke_signed_out.sql'), ref('BW_184_REF', 'origin/fix/auth-signout')],
  ['175', () => local('175_security_audit_access.sql'), 'this repo'],
  ['176', () => local('176_quote_pdf_gate.sql'), 'this repo'],
  ['178', () => show(ref('BW_178_REF', 'origin/feat/date-on-hold'), 'supabase/migrations/178_date_on_hold.sql'), ref('BW_178_REF', 'origin/feat/date-on-hold')],
  ['180', () => show(ref('BW_180_REF', 'origin/fix/account-deletion'), 'supabase/migrations/180_account_deletion_safety.sql'), ref('BW_180_REF', 'origin/fix/account-deletion')],
  ['192', () => show(ref('BW_193_REF', 'origin/fix/chat-audit'), 'supabase/migrations/192_chat_notification_purge.sql'), ref('BW_193_REF', 'origin/fix/chat-audit')],
  ['193', () => show(ref('BW_193_REF', 'origin/fix/chat-audit'), 'supabase/migrations/193_one_chat_per_gig.sql'), ref('BW_193_REF', 'origin/fix/chat-audit')],
  ['181', () => local('181_event_chat_lineup.sql'), 'this repo'],
];
const loaded = new Set();
await db.exec('SET check_function_bodies = on');
for (const [n, get, from] of CHAIN) {
  const sql = get();
  if (!sql) { warn(`SKIP ${n}: ${from} not available`); continue; }
  try {
    try {
      await db.exec(sql);
    } catch (e0) {
      // Replayed from 002, events.status / event_type are enums here; 178
      // passes them to text parameters. Prod's column types decide whether
      // that applies there (main's dry run): here a cast overload lets it load.
      if (!(n === '178' && /bw_event_quote_private\(uuid, event_status, event_type, uuid\)/.test(e0.message))) throw e0;
      try { await db.exec('ROLLBACK'); } catch { /* none open */ }
      warn(`178 (${from}): ${e0.message} -- on an enum events.status (002) 178 doesn't apply; loaded with a cast overload. Check prod's column types (#294).`);
      await db.exec(`SET check_function_bodies = off;
        CREATE FUNCTION public.bw_event_quote_private(uuid, event_status, event_type, uuid) RETURNS boolean LANGUAGE sql STABLE
        AS $$ SELECT public.bw_event_quote_private($1, $2::text, $3::text, $4) $$;
        SET check_function_bodies = on;`);
      await db.exec(sql);
    }
    console.log(`     ${n} loaded whole (${from})`);
  } catch (e) {
    try { await db.exec('ROLLBACK'); } catch { /* none open */ }
    await db.exec('SET check_function_bodies = off');
    const skipped = await replay(sql);
    await db.exec('SET check_function_bodies = on');
    warn(`${n} (${from}) failed whole here (${e.message.slice(0, 120)}); loaded statement by statement, ${skipped.length} skipped`);
    const bad = skipped.filter((x) => /chat_participants|bw_chat_scope_ok|bw_my_chat_ids/.test(x.s));
    ok(bad.length === 0, `${n}: every statement about chat_participants ran (${bad.map((x) => `${bare(x.s).slice(0, 70)} -> ${x.e.slice(0, 80)}`).join(' | ')})`);
  }
  loaded.add(n);
}
ok(loaded.has('175') && loaded.has('181'), 'the chain has 175 and 181');

// ── 1. RLS allowlist ─────────────────────────────────────────────────────────
// The catalog main runs on prod (read-only), here on PGlite or, with
// BW_PROD_CATALOG, prod's own output.
const CATALOG_SQL = readFileSync(`${REPO}/supabase/tests/chat_access_catalog.sql`, 'utf8');
const prodCat = process.env.BW_PROD_CATALOG ? JSON.parse(readFileSync(process.env.BW_PROD_CATALOG, 'utf8')) : null;
const CAT = prodCat ?? (await db.query(CATALOG_SQL)).rows;
const where = prodCat ? `prod catalog ${process.env.BW_PROD_CATALOG}` : 'after the chain';
const det = (x) => (typeof x.detail === 'string' ? JSON.parse(x.detail) : x.detail);
ok(CAT.some((x) => x.kind === 'function') && CAT.some((x) => x.kind === 'policy'), `chat_access_catalog.sql runs and lists functions and policies (${CAT.length} rows)`);
const catPols = CAT.filter((x) => x.kind === 'policy').map((x) => ({ ...det(x), roles: `{${det(x).roles.join(',')}}`, qual: det(x).qual ?? '' }));
// table.name:cmd:permissive -> why it is safe; from = the head that adds it
// (an entry whose head isn't loaded may be missing; on prod any may be).
const POLICY_ALLOW = {
  'chat_participants.chat_participants_select_own:SELECT:PERMISSIVE': ['own rows only (user_id = auth.uid()); all roles as on prod, nothing without a user; for authenticated the guard applies the rule (175 r5)'],
  'chat_participants.chat_participants_select_same_chat:SELECT:PERMISSIVE': ['rows of my chats (bw_my_chat_ids, once per query); authenticated, so the guard applies the rule (175)'],
  'chat_participants.chat_participants_scope_guard:SELECT:RESTRICTIVE': ['the central guard: ANDed with every read policy (175)'],
  'chat_participants.chat_participants_update_guard:UPDATE:RESTRICTIVE': ['the guard for UPDATE, also one with no WHERE (175 r5)'],
  'chat_participants.chat_participants_delete_guard:DELETE:RESTRICTIVE': ['the guard for DELETE, also one with no WHERE (175 r5)'],
  'chat_participants.chat_participants_insert:INSERT:PERMISSIVE': ['bw_can_add_chat_participant AND bw_chat_scope_ok_for (175)'],
  'chat_participants.Users can update own chat participation:UPDATE:PERMISSIVE': ['own row only; ANDed with the update guard, keys immutable (050 trigger)'],
  'chat_participants.Users can delete own chat participation:DELETE:PERMISSIVE': ['own row only; ANDed with the delete guard'],
  'chat_participants.chat_participants_quote_admins_only:SELECT:RESTRICTIVE': ["a private quote's chat for admins only (restricts further)", '178'],
  'messages.messages_select_participant:SELECT:PERMISSIVE': ['messages of my chats (bw_my_chat_ids, once per query) (175)'],
  'messages.messages_scope_guard:SELECT:RESTRICTIVE': ['the messages guard: ANDed with every read policy (175 r5)'],
  'messages.messages_delete_guard:DELETE:RESTRICTIVE': ['the messages delete guard: own deletes only in chats the caller still uses (175 r5b)'],
  'messages.messages_insert_participant:INSERT:PERMISSIVE': ['sender = me, in my chats (175)'],
  'messages.messages_update_own:UPDATE:PERMISSIVE': ['own messages; WITH CHECK in my chats (175)'],
  'messages.messages_delete_own:DELETE:PERMISSIVE': ['own messages only (reads nobody else)'],
  'messages.messages_quote_admins_only:SELECT:RESTRICTIVE': ['quote chat: admins only (restricts further)', '178'],
  'messages.messages_quote_admins_only_insert:INSERT:RESTRICTIVE': ['quote chat: admins only (restricts further)', '178'],
  'messages.messages_quote_history_admins_only:SELECT:RESTRICTIVE': ['quote chat history: admins only (restricts further)', '178'],
  'chats.chats_insert:INSERT:PERMISSIVE': ['created_by = me, in my band (073)'],
  'chats.chats_select_participant:SELECT:PERMISSIVE': ['chats in bw_my_chat_ids (175)'],
  'chats.chats_select_creator:SELECT:PERMISSIVE': ['created_by = me and the rule (175)'],
  'chats.chats_upd:UPDATE:PERMISSIVE': ['the creator, only while the chat is in bw_my_chat_ids (175 r5); columns name, updated_at only'],
  'chats.chats_quote_admins_only:SELECT:RESTRICTIVE': ["a private quote's chat for admins only (restricts further)", '178'],
  'chats.chats_select_joinable:SELECT:PERMISSIVE': ['the band / gig chat a member may join, before they have a row (no roster, no messages)', '193'],
};
const polKeys = catPols.map((x) => `${x.table}.${x.policyname}:${x.cmd}:${x.permissive}`);
const extra = polKeys.filter((k) => !(k in POLICY_ALLOW));
const missingPol = Object.entries(POLICY_ALLOW).filter(([k, [, from]]) => !polKeys.includes(k) && !prodCat && (!from || loaded.has(from))).map(([k]) => k);
ok(extra.length === 0, `${where}: no policy on chat_participants / messages / chats outside the allowlist (${extra.join(', ') || 'none'})`);
ok(missingPol.length === 0, `${where}: every allowlisted policy is there (cp_update / cp_delete dropped as duplicates) (${missingPol.join(', ') || 'all'})`);
const pol = (t, n) => catPols.find((x) => x.table === t && x.policyname === n);
const guard = pol('chat_participants', 'chat_participants_scope_guard');
const guardOk = (q) => /bw_chat_row_ok\(chat_id, user_id\)/.test(q ?? '') && /SELECT bw_my_chat_ids\(\)/.test(q ?? '') && /user_id = auth\.uid\(\)/.test(q ?? '');
ok(guard?.permissive === 'RESTRICTIVE' && guardOk(guard.qual) && guard.roles === '{authenticated}',
  `${where}: the RESTRICTIVE guard is (own row or my chats) AND bw_chat_row_ok(chat_id, user_id), for authenticated (${guard?.qual})`);
const ug = pol('chat_participants', 'chat_participants_update_guard');
const dg = pol('chat_participants', 'chat_participants_delete_guard');
ok(ug?.permissive === 'RESTRICTIVE' && ug.qual === guard?.qual && ug.with_check === guard?.qual && dg?.permissive === 'RESTRICTIVE' && dg.qual === guard?.qual,
  `${where}: UPDATE and DELETE guards have the read guard's rule (USING and WITH CHECK)`);
ok(catPols.filter((x) => x.table === 'chat_participants' && x.cmd === 'SELECT' && x.permissive === 'PERMISSIVE')
  .every((x) => x.roles === '{authenticated}' || x.qual === '(user_id = auth.uid())'),
  `${where}: every permissive read policy on chat_participants is for authenticated (the guard applies the rule) or own rows only`);
const mg = pol('messages', 'messages_scope_guard');
ok(mg?.permissive === 'RESTRICTIVE' && mg.cmd === 'SELECT' && mg.roles === '{authenticated}' && /SELECT bw_my_chat_ids\(\)/.test(mg.qual),
  `${where}: messages_scope_guard is RESTRICTIVE SELECT for authenticated, my chats once per query (${mg?.qual})`);
ok(catPols.filter((x) => x.table === 'messages' && x.cmd === 'SELECT' && x.permissive === 'PERMISSIVE').every((x) => x.roles === '{authenticated}'),
  `${where}: every permissive read policy on messages is for authenticated (where the messages guard applies)`);
ok(/SELECT bw_my_chat_ids\(\)/.test(pol('chats', 'chats_upd')?.qual ?? '') && /created_by = auth\.uid\(\)/.test(pol('chats', 'chats_upd')?.qual ?? ''),
  `${where}: chats_upd is the creator AND a chat they can still use (${pol('chats', 'chats_upd')?.qual})`);
const perRow = catPols.filter((x) => /bw_my_chat_ids\(\)/.test(x.qual + (x.with_check ?? '')) && !/\(\s*SELECT\s+bw_my_chat_ids\(\)/.test(x.qual + (x.with_check ?? '')))
  .map((x) => `${x.table}.${x.policyname}`);
ok(perRow.length === 0, `${where}: no policy calls bw_my_chat_ids() once per row (${perRow.join(', ') || 'none'})`);
const secdef = (await db.query(`SELECT proname, bool_and(prosecdef) AS d FROM pg_proc WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('bw_chat_row_ok', 'bw_chat_rule_ungated', 'bw_chat_scope_ok_for', 'bw_chat_scope_ok', 'bw_my_chat_ids') GROUP BY 1`)).rows;
ok(secdef.length === 5 && secdef.every((x) => x.d), `the guard's functions are SECURITY DEFINER: they read as the owner, no RLS, no recursion (${JSON.stringify(secdef)})`);

// ── Fixture: a band, its chat and a gig chat, a member who left ──────────────
const [BAND, ADMIN, MEM, LEFT, OFFGIG] = [1, 2, 3, 4, 5].map(id);
const [BANDCHAT, GIG, EVCHAT] = [id(20), id(30), id(21)];
const users = [ADMIN, MEM, LEFT, OFFGIG];
// (auth.users triggers, e.g. the beta gate, are not what this test is about.)
// Columns later migrations add that the replay can't (their statement failed here).
await db.exec(`ALTER TABLE auth.users DISABLE TRIGGER USER;
  ALTER TABLE bands DISABLE TRIGGER USER;
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_mode text;`);
process.on('uncaughtException', (e) => { console.log('ERROR', e.message, e.where ?? ''); process.exit(2); });
await db.exec(`
  INSERT INTO auth.users (id, email) SELECT u, 'u' || right(u::text, 4) || '@example.invalid' FROM unnest(ARRAY['${users.join("','")}']::uuid[]) u ON CONFLICT DO NOTHING;
  INSERT INTO profiles (id, email, full_name) SELECT u, 'u' || right(u::text, 4) || '@example.invalid', 'Player ' || right(u::text, 2)
    FROM unnest(ARRAY['${users.join("','")}']::uuid[]) u ON CONFLICT (id) DO NOTHING;
  INSERT INTO bands (id, name, created_by) VALUES ('${BAND}', 'Hudson Horns', '${ADMIN}') ON CONFLICT DO NOTHING;
  INSERT INTO band_members (band_id, user_id, role, is_active) VALUES
    ('${BAND}','${ADMIN}','admin',true), ('${BAND}','${MEM}','member',true), ('${BAND}','${LEFT}','member',true), ('${BAND}','${OFFGIG}','member',true);
  INSERT INTO events (id, band_id, title, event_type, status, event_date, created_by) VALUES ('${GIG}','${BAND}','Rooftop','gig','confirmed', current_date + 10, '${ADMIN}');
  INSERT INTO event_members (event_id, user_id, status) VALUES ('${GIG}','${MEM}','confirmed'), ('${GIG}','${OFFGIG}','confirmed');
  INSERT INTO chats (id, type, name, band_id, created_by) VALUES ('${BANDCHAT}','band','Hudson Horns','${BAND}','${ADMIN}');
  INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${EVCHAT}','event','Rooftop','${BAND}','${GIG}','${ADMIN}');
  INSERT INTO chat_participants (chat_id, user_id) SELECT '${BANDCHAT}', u FROM unnest(ARRAY['${users.join("','")}']::uuid[]) u;
  INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT}','${ADMIN}'), ('${EVCHAT}','${MEM}'), ('${EVCHAT}','${OFFGIG}');
  INSERT INTO messages (chat_id, sender_id, content) VALUES ('${BANDCHAT}','${ADMIN}','rehearsal Thursday'), ('${EVCHAT}','${ADMIN}','load-in at 6');
  UPDATE band_members SET is_active = false WHERE band_id = '${BAND}' AND user_id = '${LEFT}';
  UPDATE event_members SET status = 'Dropped_Out ' WHERE event_id = '${GIG}' AND user_id = '${OFFGIG}';`);

async function as(uid, sql) {
  try {
    await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, role: 'authenticated' })}', true);`);
    const r = await db.query(sql);
    await db.exec('COMMIT');
    return { rows: r.rows, n: r.affectedRows ?? r.rows.length };
  } catch (e) {
    await db.exec('ROLLBACK');
    return { error: e.message, rows: [], n: 0 };
  }
}
const kept = (await db.query(`SELECT chat_id, user_id FROM chat_participants WHERE (chat_id, user_id) IN
  (('${BANDCHAT}'::uuid, '${LEFT}'::uuid), ('${EVCHAT}'::uuid, '${OFFGIG}'::uuid))`)).rows;
ok(kept.length === 2, `left the band / dropped out ('Dropped_Out '): both rows are kept (${kept.length})`);
// The kept rows: LEFT in the band chat (left the band), OFFGIG in the gig chat
// (dropped out). OFFGIG is still in the band, so still in the band chat.
const KEPT = [[BANDCHAT, LEFT], [EVCHAT, OFFGIG]];
const isKept = (c, u) => KEPT.some(([kc, ku]) => kc === c && ku === u);
async function invisible(label) {
  let r = await as(MEM, `SELECT chat_id, user_id FROM chat_participants WHERE chat_id IN ('${BANDCHAT}','${EVCHAT}')`);
  ok(!r.error && r.rows.length > 0 && !r.rows.some((x) => isKept(x.chat_id, x.user_id)) && r.rows.some((x) => x.chat_id === BANDCHAT && x.user_id === OFFGIG),
    `${label}: kept rows are not in the roster, a member still in the band is (${r.error ?? r.rows.length})`);
  r = await as(MEM, `SELECT count(*)::int AS n FROM chat_participants WHERE (chat_id, user_id) IN (('${BANDCHAT}'::uuid, '${LEFT}'::uuid), ('${EVCHAT}'::uuid, '${OFFGIG}'::uuid))`);
  ok(!r.error && r.rows[0].n === 0, `${label}: nor in any count (${r.error ?? r.rows[0].n})`);
  r = await as(LEFT, `SELECT chat_id FROM chat_participants WHERE user_id = '${LEFT}'`);
  const r2 = await as(OFFGIG, `SELECT chat_id FROM chat_participants WHERE user_id = '${OFFGIG}' AND chat_id = '${EVCHAT}'`);
  ok(!r.error && !r2.error && r.rows.length === 0 && r2.rows.length === 0, `${label}: nor visible to their owner (${r.error ?? r2.error ?? r.rows.length + r2.rows.length})`);
}
await invisible('after the chain');
// Through every policy: another permissive read policy (hand-made, later) changes nothing.
await db.exec(`CREATE POLICY zz_any_other_read ON public.chat_participants FOR SELECT USING (true)`);
await invisible('with another permissive read policy');
await db.exec(`DROP POLICY zz_any_other_read ON public.chat_participants`);
let r = await as(MEM, `SELECT public.get_user_chats('${MEM}') AS j`);
const rosterRpc = (r.rows[0]?.j ?? []).flatMap((c) => (c.participants ?? []).map((p) => [c.id, p.user_id]));
ok(!r.error && rosterRpc.length > 0 && !rosterRpc.some(([c, u]) => isKept(c, u)), `get_user_chats: no kept row in any roster (${r.error ?? rosterRpc.length})`);
r = await db.query(`SELECT public.bw_chat_recipient_ids('${BANDCHAT}', '${ADMIN}') AS a, public.bw_chat_recipient_ids('${EVCHAT}', '${ADMIN}') AS b`);
ok(!(r.rows[0].a ?? []).includes(LEFT) && !(r.rows[0].b ?? []).includes(OFFGIG) && (r.rows[0].a ?? []).includes(OFFGIG),
  `push recipients (bw_chat_recipient_ids): no kept row (${JSON.stringify(r.rows[0])})`);

// ── 2. Function allowlist ────────────────────────────────────────────────────
// Every function the catalog lists (reads chat_participants, or SECURITY
// DEFINER and touches messages / chats), who may run it, and why it is safe.
//   user:    authenticated may, anon may not; rule: it must apply 175's rule
//   server:  neither anon nor authenticated (service role, other functions)
//   public:  anon too, by design (the reason says what gates it)
//   trigger: a trigger function (nobody calls it directly)
//   nobody:  not even the service role
//   revoked: prod-only, unused, service role only
const U = (why, rule = true) => ({ call: 'user', rule, why });
const SRV = (why) => ({ call: 'server', why });
const TRG = (why) => ({ call: 'trigger', why });
const FN_ALLOW = {
  bw_can_add_chat_participant: U('insert check (073/104): asks about the caller and the new row; the insert policy ANDs bw_chat_scope_ok_for', false),
  bw_delete_chat_history: U("175: refuses unless bw_chat_scope_ok_for(chat, caller); clears only the caller's own row"),
  bw_mark_chat_read: U("175: only the caller's own row, only when bw_chat_scope_ok_for passes"),
  bw_mark_chats_delivered: U("175: only the caller's own rows in chats bw_chat_scope_ok passes"),
  bw_my_chat_ids: U("175: the caller's own rows, filtered by bw_chat_scope_ok (drives the chats/messages/roster policies)"),
  bw_shares_chat: U('175: only about the caller (r5), both rows must pass bw_chat_scope_ok_for'),
  bw_chat_scope_ok_for: U('175: the rule for a chat; about someone else only for a caller the rule lets in'),
  bw_chat_row_ok: U('175 r5: the guard row check; about someone else only for a caller with a row in that chat, still in its band'),
  get_user_chats: U('175: lists only chats in bw_my_chat_ids, roster filtered by bw_chat_scope_ok_for'),
  bw_open_group_chat: U("193: inserts only the caller's own row after 193's rule and 175's bw_chat_scope_ok_for; counts nobody"),
  bw_quote_chat_cutoffs: U("178 (4a60181a): for the caller's own rows only, each chat's private periods as multirange text; a kept row the rule refuses gets '{(,)}' (all time: hides everything, carries no date), and the history policy hides created_at <@ periods"),
  bw_group_chat_exists: U('175: "is there a band / gig chat", for active members of its band only; reads no participant row', false),
  bw_hidden_quote_chat_ids: U("178: the caller's own rows only to HIDE more chats (a restrictive policy); a kept row can only hide more", false),
  bw_chat_recipient_ids: SRV('175: people bw_chat_scope_ok still lets in, nobody when the sender is out'),
  bw_chat_recipients_shared: SRV('175 r5: which targets share a chat with the sender that both may use (send-push)'),
  bw_mark_chat_delivered_by_push: SRV("122: moves the receipt of the push's own recipient, who came from bw_chat_recipient_ids"),
  bw_chat_push_readers: SRV('194: push bookkeeping'),
  bw_claim_chat_push_only: SRV('194: push bookkeeping'),
  bw_write_chat_notices: SRV('192/194: chat notices written by the server'),
  bw_purge_chat_notices: SRV('192: purges chat notices'),
  bw_notification_event_id: SRV('192/194: maps a notice to its gig'),
  bw_quote_chat_prune: SRV("178: archives the rows a quote hides (keeps them; the rule hides them)"),
  bw_quote_event_confirmed: SRV('178: on confirm, adds the lineup (lower(btrim()) statuses); its insert goes through 175\'s scope trigger'),
  bw_account_deletion_dm_chats: SRV("180: the deleted user's own direct chats, kept rows included on purpose"),
  bw_account_deletion_messages: SRV("180: scrubs the deleted user's id from chats they were ever in, kept rows included on purpose"),
  bw_account_deletion_chats: SRV('180: every chat the deleted user was ever in, kept rows included on purpose'),
  bw_account_deletion_finish: SRV('180: account deletion'),
  bw_account_deletion_notifications: SRV('180: account deletion'),
  bw_prepare_account_deletion: SRV('045/059/180: account deletion'),
  bw_quote_link_message: { call: 'public', why: "099: the client quote page; the 64-character link token is the credential. Its 'messages' are the quote link's own (quote_link_messages), not chat messages" },
  bw_quote_link_view: { call: 'public', why: '099/163/168: the client quote page; the link token is the credential; no chat table' },
  bw_chat_participants_immutable_keys: TRG('050: compares OLD/NEW keys of the row being updated'),
  bw_chats_immutable_keys: TRG('175: chat keys never change (the service role may)'),
  bw_messages_immutable_keys: TRG('050: message keys never change'),
  bw_trg_chat_participant_scope: TRG('175, BEFORE INSERT: skips a row bw_chat_scope_ok_for refuses; reads the archive'),
  bw_trg_band_member_left_chats: TRG('175, band_members: archives (never deletes) the rows the rule now refuses'),
  bw_trg_event_member_left_chat: TRG('181, event_members: archives the row of who left the lineup (status, person or gig changed)'),
  bw_trg_event_band_fixed: TRG('181 r5, events: a gig with a chat or a lineup keeps its band'),
  bw_trg_chat_participant_joinable: TRG('193: joins only through 193\'s rule'),
  bw_trg_chat_participant_quote_guard: TRG('178: no member row in a private quote\'s chat'),
  bw_trg_chats_one_group_chat: TRG('193: one chat per band / gig'),
  bw_trg_messages_deleting_sender: TRG('180: account deletion'),
  bw_trg_messages_edit_notices: TRG('192: edit notices on messages, server-only trigger'),
  handle_band_name_update: TRG('041: renames the band chat with the band'),
  bw_chat_rule_ungated: { call: 'nobody', why: "175 r5: the rule without the caller check; only bw_chat_row_ok (owner) calls it" },
  get_user_chat_ids: { call: 'revoked', why: 'prod-only (no migration), unused: 175 revokes EXECUTE from PUBLIC, anon and authenticated; service_role only' },
};
const RULE_RE = /bw_chat_scope_ok|bw_my_chat_ids|bw_chat_row_ok|bw_chat_rule_ungated/;
const catFns = CAT.filter((x) => x.kind === 'function').map((x) => ({ sig: x.name, ...det(x) }));
const unknown = [...new Set(catFns.filter((f) => !(f.proname in FN_ALLOW)).map((f) => f.sig))];
ok(unknown.length === 0, `${where}: every function that reads chat_participants (or SECURITY DEFINER on messages / chats) is on the allowlist (${unknown.join(', ') || 'all'})`);
for (const f of catFns) {
  const e = FN_ALLOW[f.proname];
  if (!e) continue;
  const got = `anon ${f.anon}, authenticated ${f.authenticated}, service_role ${f.service_role}, PUBLIC ${f.public}, rule ${f.applies_rule}, trigger ${f.is_trigger}`;
  const want = {
    user: f.anon === false && f.public === false && f.authenticated === true && (!e.rule || f.applies_rule === true),
    server: f.anon === false && f.public === false && f.authenticated === false,
    public: f.anon === true && f.authenticated === true,
    trigger: f.is_trigger === true,
    nobody: f.anon === false && f.public === false && f.authenticated === false && f.service_role === false,
    revoked: f.anon === false && f.public === false && f.authenticated === false && f.service_role === true,
  }[e.call];
  ok(want, `${f.sig}: ${e.call}${e.rule ? ' + rule' : ''} (${got}) -- ${e.why}`);
}
for (const f of Object.keys(FN_ALLOW)) if (!catFns.some((x) => x.proname === f)) warn(`allowlisted ${f} not defined here (its head skipped, or it no longer touches the chat tables)`);
// get_user_chat_ids exists on prod and here: FAIL (never a warning) unless every overload is revoked.
const guci = catFns.filter((x) => x.proname === 'get_user_chat_ids');
ok(prodCat ? guci.every((x) => !x.anon && !x.authenticated) : guci.length > 0 && guci.every((x) => !x.anon && !x.authenticated && !x.public),
  `get_user_chat_ids: no EXECUTE for anon or authenticated on any overload (${guci.map((x) => `${x.sig} anon ${x.anon} auth ${x.authenticated}`).join('; ') || 'not defined'})`);
if (!prodCat) {
  r = await as(MEM, `SELECT count(*) FROM public.get_user_chat_ids('${LEFT}')`);
  ok(/permission denied/.test(r.error ?? ''), `get_user_chat_ids: a member can't list another user's chats (${r.error ?? 'ran'})`);
  r = await as(MEM, `SELECT public.bw_chat_rule_ungated('band', '${BAND}', NULL, '${LEFT}') AS a`);
  ok(/permission denied/.test(r.error ?? ''), `bw_chat_rule_ungated: a member can't call it (${r.error ?? 'ran'})`);
}

// ── 3. Cost: 50 chats x 10 participants ──────────────────────────────────────
const PEOPLE = Array.from({ length: 10 }, (_, i) => id(100 + i));
await db.exec(`
  INSERT INTO auth.users (id, email) SELECT u, 'p' || right(u::text, 4) || '@example.invalid' FROM unnest(ARRAY['${PEOPLE.join("','")}']::uuid[]) u ON CONFLICT DO NOTHING;
  INSERT INTO profiles (id, email, full_name) SELECT u, 'p' || right(u::text, 4) || '@example.invalid', 'Player' FROM unnest(ARRAY['${PEOPLE.join("','")}']::uuid[]) u ON CONFLICT (id) DO NOTHING;
  INSERT INTO band_members (band_id, user_id, role, is_active) SELECT '${BAND}', u, 'member', true FROM unnest(ARRAY['${PEOPLE.join("','")}']::uuid[]) u;
  INSERT INTO events (id, band_id, title, event_type, status, event_date, created_by)
    SELECT ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, '${BAND}', 'Gig ' || g, 'gig', 'confirmed', current_date + g, '${ADMIN}' FROM generate_series(1, 50) g;
  INSERT INTO event_members (event_id, user_id, status)
    SELECT ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, u, 'confirmed' FROM generate_series(1, 50) g, unnest(ARRAY['${PEOPLE.join("','")}']::uuid[]) u;
  INSERT INTO chats (id, type, name, band_id, event_id, created_by)
    SELECT ('00000000-0000-0000-0002-' || lpad(g::text, 12, '0'))::uuid, 'event', 'Gig ' || g, '${BAND}', ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, '${ADMIN}' FROM generate_series(1, 50) g;
  INSERT INTO chat_participants (chat_id, user_id)
    SELECT ('00000000-0000-0000-0002-' || lpad(g::text, 12, '0'))::uuid, u FROM generate_series(1, 50) g, unnest(ARRAY['${PEOPLE.join("','")}']::uuid[]) u;
  INSERT INTO messages (chat_id, sender_id, content)
    SELECT ('00000000-0000-0000-0002-' || lpad(g::text, 12, '0'))::uuid, '${PEOPLE[1]}', 'set times' FROM generate_series(1, 50) g;
  ANALYZE;`);
const ME = PEOPLE[0];
async function timing(sql, runs = 5) {
  const ms = [];
  for (let i = 0; i < runs; i++) {
    const r = await as(ME, `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`);
    if (r.error) return { error: r.error };
    ms.push(r.rows[0]['QUERY PLAN'][0]['Execution Time']);
  }
  ms.sort((a, b) => a - b);
  return { median: ms[Math.floor(ms.length / 2)] };
}
// The app's shapes: the roster of my chats by id (getChats), the chat list
// (get_user_chats), all my chats (chats policy), and one chat's messages.
const ALLCHATS = Array.from({ length: 50 }, (_, g) => `'00000000-0000-0000-0002-${String(g + 1).padStart(12, '0')}'`).join(',');
const ROSTER = `SELECT chat_id, user_id FROM chat_participants WHERE chat_id IN (${ALLCHATS})`;
const CHATS = `SELECT id FROM chats`;
const MSGS = `SELECT id FROM messages WHERE chat_id = '00000000-0000-0000-0002-000000000007'`;
const LIST = `SELECT public.get_user_chats('${ME}')`;
r = await as(ME, `SELECT count(*)::int AS n FROM chat_participants WHERE chat_id IN (${ALLCHATS})`);
ok(!r.error && r.rows[0].n >= 500, `fixture: the roster query sees 50 chats x 10 participants (${r.error ?? r.rows[0].n})`);
await db.exec(`INSERT INTO messages (chat_id, sender_id, content)
  SELECT ('00000000-0000-0000-0002-' || lpad(g::text, 12, '0'))::uuid, '${PEOPLE[1]}', 'note ' || k FROM generate_series(1, 50) g, generate_series(1, 20) k; ANALYZE;`);
const measure = async () => Object.fromEntries(await Promise.all([['roster', ROSTER], ['get_user_chats', LIST], ['chats', CHATS], ['messages', MSGS]]
  .map(async ([k, q]) => [k, await timing(q)])));
// One PGlite session ran everything above on tiny tables: plpgsql's plan
// cache then keeps re-planning per call (its custom-vs-generic choice
// remembers those cheap early plans). A server connection sees stable data;
// generic plans, as it would settle on.
await db.exec('SET plan_cache_mode = force_generic_plan');
await measure(); // warm-up (the first run pays for planning and WASM warm-up)
const withGuard = await measure();
const guardQual = (await db.query(`SELECT qual FROM pg_policies WHERE schemaname = 'public' AND policyname = 'chat_participants_scope_guard'`)).rows[0].qual;
await db.exec(`ALTER POLICY chat_participants_scope_guard ON public.chat_participants USING (true)`);
const noGuard = await measure();
// Round 4's guard (the rule checked for the row's user and the caller, per
// row), for comparison: interleaved with round 5's, the fastest run of each
// (a busy machine only ever makes a run slower).
const fastest = async (qual) => {
  await db.exec(`ALTER POLICY chat_participants_scope_guard ON public.chat_participants USING (${qual})`);
  const ms = [];
  for (let i = 0; i < 5; i++) {
    const x = await as(ME, `EXPLAIN (ANALYZE, FORMAT JSON) ${ROSTER}`);
    if (!x.error) ms.push(x.rows[0]['QUERY PLAN'][0]['Execution Time']);
  }
  return Math.min(...ms);
};
const r4Runs = [], r5Runs = [];
for (let k = 0; k < 3; k++) {
  r4Runs.push(await fastest('public.bw_chat_scope_ok_for(chat_id, user_id)'));
  r5Runs.push(await fastest(guardQual));
}
// Fastest of 15 runs each (3 interleaved rounds of 5).
const r4Fastest = Math.min(...r4Runs);
const r5Fastest = Math.min(...r5Runs);
const errs = Object.values(withGuard).map((x) => x.error).filter(Boolean);
ok(errs.length === 0, `EXPLAIN ANALYZE runs (${errs.join('; ') || 'ok'})`);
console.log(`COST (PGlite/WASM, ms, 50 chats x 10 people, 1000 messages; median of 5 runs): `
  + Object.keys(withGuard).map((k) => `${k} ${withGuard[k].median?.toFixed(1)} with the guard / ${noGuard[k].median?.toFixed(1)} without`).join('; ')
  + `; roster, fastest of 15 interleaved runs: round 4's guard ${r4Fastest.toFixed(1)}, round 5's ${r5Fastest.toFixed(1)}`);
// A 2x margin: on a busy machine either can lose a run (1 in 4 flaked
// with a plain "<"); a policy that goes back to the rule per row is far
// beyond it.
ok(r5Fastest < 2 * r4Fastest, `round 5's guard costs no more than 2x round 4's on the roster, fastest runs (${r5Fastest.toFixed(1)} < 2 x ${r4Fastest.toFixed(1)} ms)`);
// A budget, so a policy that goes back to once-per-row fails (once per row was 3.6 s here).
ok(withGuard.roster.median < 1000 && withGuard.chats.median < 200, `cost stays per query, not per row (roster ${withGuard.roster.median?.toFixed(0)} ms, chats ${withGuard.chats.median?.toFixed(0)} ms)`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
