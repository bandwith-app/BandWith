// The central guard on chat_participants (main, #281/#289 round 4), checked on
// the whole release chain. 175 keeps an ex-member's participant row (archived,
// never deleted), so nothing may show or count it. Instead of hunting every
// reader, this test pins down every way in:
//
//   1. RLS: the policies on chat_participants after the chain, by name, are an
//      allowlist. A new one fails the test. Every read policy must apply the
//      rule, and one RESTRICTIVE guard (bw_chat_scope_ok_for) is ANDed with all
//      of them, so an ex-member's kept row is invisible to the others (roster,
//      counts) and to its owner, through every policy. Old builds (383f15b)
//      read only through these policies.
//   2. Server: every function in public whose source reads chat_participants
//      is an allowlist, each entry with the reason it is safe. A function not
//      on the list fails the test.
//   3. Cost: EXPLAIN ANALYZE of get_user_chats and the roster query, with and
//      without the guard, on 50 chats x 10 participants.
//
// Base = "prod today": migrations 001..174 replayed statement by statement
// (statements that can't run here, e.g. publications or data fixes, are
// skipped; 002 v2's DROP TYPE ... CASCADE is skipped so chats.type survives),
// which gives exactly prod's 7 chat_participants policies (073) and 9 of the
// 10 functions main lists on prod. get_user_chat_ids exists only on prod (no
// migration): a stand-in is added, see its allowlist entry.
//
// Then the chain, each file whole, in the release order (main's fn-rule.md):
//   175 (this repo) -> 178 (BW_178_REF, origin/feat/date-on-hold)
//   -> 180 (BW_180_REF, origin/fix/account-deletion) -> 194 (BW_194_REF, origin/fix/push-safety)
//   -> 192, 193 (BW_193_REF, 9a4f0548 = fix/chat-audit) -> 181 (this repo)
// A head that isn't available is SKIPPED with a warning. A file that fails
// whole is loaded statement by statement with a WARN; a skipped statement
// that touches chat_participants fails the test.
//
//   cd <dir with @electric-sql/pglite@0.5.15> && node chat_participants_guard.pglite.mjs <repo>
//   BW_LOCAL_REF=0437db39 node chat_participants_guard.pglite.mjs <repo>   # before round 4's guard: FAILs
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
// Prod-only (no migration defines it; main's prod list). Stand-in with the
// obvious body; see the allowlist entry.
await db.exec(`CREATE OR REPLACE FUNCTION public.get_user_chat_ids(p_user_id uuid) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT chat_id FROM chat_participants WHERE user_id = p_user_id $$;`);
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
  ['175', () => local('175_security_audit_access.sql'), 'this repo'],
  ['178', () => show(ref('BW_178_REF', 'origin/feat/date-on-hold'), 'supabase/migrations/178_date_on_hold.sql'), ref('BW_178_REF', 'origin/feat/date-on-hold')],
  ['180', () => show(ref('BW_180_REF', 'origin/fix/account-deletion'), 'supabase/migrations/180_account_deletion_safety.sql'), ref('BW_180_REF', 'origin/fix/account-deletion')],
  ['194', () => show(ref('BW_194_REF', 'origin/fix/push-safety'), 'supabase/migrations/194_chat_notifications_server_only.sql'), ref('BW_194_REF', 'origin/fix/push-safety')],
  ['192', () => show(ref('BW_193_REF', '9a4f0548'), 'supabase/migrations/192_chat_notification_purge.sql'), ref('BW_193_REF', '9a4f0548')],
  ['193', () => show(ref('BW_193_REF', '9a4f0548'), 'supabase/migrations/193_one_chat_per_gig.sql'), ref('BW_193_REF', '9a4f0548')],
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
// name:cmd:permissive -> why it is safe.
const POLICY_ALLOW = {
  'chat_participants_select_own:SELECT:PERMISSIVE': 'own rows, and only rows the rule still lets in (175; all roles, so it carries the rule itself)',
  'chat_participants_select_same_chat:SELECT:PERMISSIVE': 'rows of my chats (bw_my_chat_ids, once per query); authenticated only, so the guard applies the rule (175)',
  'chat_participants_scope_guard:SELECT:RESTRICTIVE': 'the central guard: ANDed with every read policy (175)',
  'chat_participants_insert:INSERT:PERMISSIVE': 'bw_can_add_chat_participant AND bw_chat_scope_ok_for (175)',
  'Users can update own chat participation:UPDATE:PERMISSIVE': 'own row only; rows are found through the read policies (kept rows: none), keys immutable (050 trigger)',
  'Users can delete own chat participation:DELETE:PERMISSIVE': 'own row only; rows are found through the read policies (kept rows: none)',
};
if (loaded.has('178')) POLICY_ALLOW['chat_participants_quote_admins_only:SELECT:RESTRICTIVE'] = "178: a private quote's chat for admins only (restricts further)";
const pols = await cpPolicies();
const polKeys = pols.map((x) => `${x.policyname}:${x.cmd}:${x.permissive}`);
const extra = polKeys.filter((k) => !(k in POLICY_ALLOW));
const missingPol = Object.keys(POLICY_ALLOW).filter((k) => !polKeys.includes(k));
ok(extra.length === 0, `no chat_participants policy outside the allowlist (${extra.join(', ') || 'none'})`);
ok(missingPol.length === 0, `every allowlisted policy is there (cp_update / cp_delete dropped as duplicates) (${missingPol.join(', ') || 'all'})`);
const guard = pols.find((x) => x.policyname === 'chat_participants_scope_guard');
ok(guard?.permissive === 'RESTRICTIVE' && /bw_chat_scope_ok_for\(chat_id, user_id\)/.test(guard.qual) && /authenticated/.test(guard.roles),
  `the RESTRICTIVE guard is bw_chat_scope_ok_for(chat_id, user_id) for authenticated (${guard?.qual})`);
ok(pols.filter((x) => x.cmd === 'SELECT' && x.permissive === 'PERMISSIVE').every((x) => /bw_chat_scope_ok_for/.test(x.qual) || x.roles === '{authenticated}'),
  'every permissive read policy applies the rule itself, or is for authenticated only (the guard applies it)');
const perRow = (await db.query(`SELECT tablename || '.' || policyname AS p FROM pg_policies WHERE schemaname = 'public'
  AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'bw_my_chat_ids\\(\\)'
  AND (coalesce(qual, '') || coalesce(with_check, '')) !~ '\\(\\s*SELECT\\s+bw_my_chat_ids\\(\\)'`)).rows.map((x) => x.p);
ok(perRow.length === 0, `after the chain no policy calls bw_my_chat_ids() once per row (${perRow.join(', ') || 'none'})`);
const secdef = (await db.query(`SELECT proname, bool_and(prosecdef) AS d FROM pg_proc WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('bw_chat_scope_ok_for', 'bw_chat_scope_ok', 'bw_my_chat_ids') GROUP BY 1`)).rows;
ok(secdef.length === 3 && secdef.every((x) => x.d), `the guard's functions are SECURITY DEFINER: they read as the owner, no RLS, no recursion (${JSON.stringify(secdef)})`);

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
// Every function in public whose source reads chat_participants, and why it is safe.
const FN_ALLOW = {
  bw_can_add_chat_participant: 'insert check (073/104): asks about the caller and the new row; the 175 policy ANDs bw_chat_scope_ok_for',
  bw_chat_participants_immutable_keys: 'trigger (050): compares OLD/NEW keys of the row being updated, reads nobody else',
  bw_delete_chat_history: "175: refuses unless bw_chat_scope_ok_for(chat, caller); clears only the caller's own row",
  bw_mark_chat_delivered_by_push: "122, server only (service role): moves the receipt of the push's own recipient, who came from bw_chat_recipient_ids",
  bw_mark_chat_read: "175: only the caller's own row, only when bw_chat_scope_ok_for passes",
  bw_mark_chats_delivered: "175: only the caller's own rows in chats bw_chat_scope_ok passes",
  bw_my_chat_ids: "175: the caller's own rows, filtered by bw_chat_scope_ok (drives the chats/messages/roster policies)",
  bw_shares_chat: '175: both rows must pass bw_chat_scope_ok_for',
  get_user_chats: '175: lists only chats in bw_my_chat_ids, roster filtered by bw_chat_scope_ok_for',
  bw_chat_recipient_ids: '175, server only (service role): people bw_chat_scope_ok still lets in, nobody when the sender is out',
  bw_trg_chat_participant_scope: '175, BEFORE INSERT trigger: skips a row bw_chat_scope_ok_for refuses; reads the archive, not other rows',
  bw_trg_band_member_left_chats: '175, trigger on band_members: archives (never deletes) the rows the rule now refuses',
  bw_open_group_chat: "193: inserts only the caller's own row (ON CONFLICT DO NOTHING) after 193's rule and 175's bw_chat_scope_ok_for; counts nobody",
  bw_trg_event_member_left_chat: '181, trigger on event_members: archives (never deletes) the row of who left the lineup',
  bw_hidden_quote_chat_ids: "178: the caller's own rows only to HIDE more chats (a restrictive policy); a kept row can only hide more",
  bw_account_deletion_dm_chats: "180, server only (revoked from authenticated): the deleted user's own direct chats, kept rows included on purpose",
  bw_account_deletion_messages: "180, server only: scrubs the deleted user's id from chats they were ever in, kept rows included on purpose",
  bw_account_deletion_chats: "180, server only (revoked from authenticated): every chat the deleted user was ever in, kept rows included on purpose",
};
// On the list (they don't show a kept row to anyone), but routed to their PR.
const FN_ROUTED = {
  bw_quote_chat_cutoffs: "#294 (178): returns a cutoff per chat for the caller's own rows without bw_chat_scope_ok_for, so a kept row still gets its quote chat's id and date: add AND public.bw_chat_scope_ok_for(c.id, auth.uid())",
  bw_quote_chat_prune: "#294 (178): DELETEs participant rows (archived in chat_participants_quote_178); 175/181 now keep rows and let the rule hide them",
  bw_quote_event_confirmed: "#294 (178): lineup compared raw (coalesce(em.status, 'invited') NOT IN ...): use lower(btrim()); its insert is still filtered by 175's scope trigger",
};
Object.assign(FN_ALLOW, Object.fromEntries(Object.entries(FN_ROUTED).map(([k, v]) => [k, `ROUTED ${v}`])));
// Prod-only, no migration: its real body must be checked on prod by main.
const FN_ALLOW_UNVERIFIED = {
  get_user_chat_ids: 'PROD-ONLY (no migration defines it; no app build or edge function calls it). Stand-in here; main to check prod\'s body: if it returns raw rows to authenticated, revoke it or add bw_chat_scope_ok_for',
};
const now = await readers();
const unknown = now.filter((f) => !(f in FN_ALLOW) && !(f in FN_ALLOW_UNVERIFIED));
ok(unknown.length === 0, `every function that reads chat_participants is on the allowlist (${unknown.join(', ') || 'all'})`);
for (const f of now) console.log(`     ${f}: ${FN_ALLOW[f] ?? FN_ALLOW_UNVERIFIED[f] ?? 'NOT ON THE LIST'}`);
for (const f of Object.keys(FN_ALLOW)) if (!now.includes(f)) warn(`allowlisted ${f} not defined here (its head skipped, or it no longer reads chat_participants)`);
for (const f of Object.keys(FN_ALLOW_UNVERIFIED)) if (now.includes(f)) warn(`${f}: ${FN_ALLOW_UNVERIFIED[f]}`);
for (const f of Object.keys(FN_ROUTED)) if (now.includes(f)) warn(`ROUTE ${f}: ${FN_ROUTED[f]}`);

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
const withGuard = await measure();
await db.exec(`ALTER POLICY chat_participants_scope_guard ON public.chat_participants USING (true)`);
const noGuard = await measure();
await db.exec(`ALTER POLICY chat_participants_scope_guard ON public.chat_participants USING (public.bw_chat_scope_ok_for(chat_id, user_id))`);
const errs = Object.values(withGuard).map((x) => x.error).filter(Boolean);
ok(errs.length === 0, `EXPLAIN ANALYZE runs (${errs.join('; ') || 'ok'})`);
console.log(`COST (PGlite/WASM, median of 5 runs, ms, 50 chats x 10 people, 1000 messages): `
  + Object.keys(withGuard).map((k) => `${k} ${withGuard[k].median?.toFixed(1)} with the guard / ${noGuard[k].median?.toFixed(1)} without`).join('; '));
// A budget, so a policy that goes back to once-per-row fails (once per row was 3.6 s here).
ok(withGuard.roster.median < 1000 && withGuard.chats.median < 200, `cost stays per query, not per row (roster ${withGuard.roster.median?.toFixed(0)} ms, chats ${withGuard.chats.median?.toFixed(0)} ms)`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
