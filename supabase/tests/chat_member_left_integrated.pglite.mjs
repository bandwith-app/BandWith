// Codex #291 round 4 (B1, 193:187): someone already in a band or gig chat
// who is then removed from the band keeps their chat_participants row unless
// 175 takes it away. This loads the real migrations in apply order, from
// their branch heads, and checks the whole chain:
//
//   194 (#284) → 175 (fix/security-audit) → 178 (feat/date-on-hold) → 192 → 193 (this PR) → 181 (fix/event-chat-lineup)
// (the release apply order of the safety net, #278: …, 194, 184, 175, 176, 178, 180, 192, 193, 181, …)
//
// 175 and 178 are large: only the chat functions, policies and triggers are
// taken, by name (never by line). 194, 192, 193 and 181 are loaded whole.
//
// After removal (deactivated, or the band_members row deleted), a new message.
// 175 round 4 KEEPS their chat_participants row (archived in
// chat_participants_removed_175) and refuses it everywhere, so: the former
// member reads nothing, is no push recipient (bw_chat_recipient_ids, which
// #281's send-push chatRecipients calls), is not in get_user_chats, is hidden
// from the other members' roster (chat_participants read policy), and cannot
// open or rejoin the chat. A row left behind anyway (written with triggers
// off) still gives no access. Round 4: someone off the gig in another case
// ('Dropped_Out': 175 compares lower(), 178 does not) cannot open it either.
//
//   cd <dir with @electric-sql/pglite@0.5.15> && node chat_member_left_integrated.pglite.mjs <repo> [193-file]
//   Refs (first one found): BW_175_REF, origin/fix/security-audit, d9971705;
//   BW_178_REF, origin/feat/date-on-hold; BW_181_REF, origin/fix/event-chat-lineup,
//   0437db39. None found for one of them: SKIP (exit 0, with a warning).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO = process.argv[2];
const MIG193 = process.argv[3] ?? `${REPO}/supabase/migrations/193_one_chat_per_gig.sql`;
const MIG192 = `${REPO}/supabase/migrations/192_chat_notification_purge.sql`;
const MIG194 = `${REPO}/supabase/migrations/194_chat_notifications_server_only.sql`;
const show = (ref, path) => execFileSync('git', ['-C', REPO, 'show', `${ref}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
// The first ref that has the file; none: SKIP with a warning (a clone
// without those branches can't run the chain).
function load(label, path, refs) {
  for (const ref of refs.filter(Boolean)) {
    try {
      const sql = show(ref, path);
      console.log(`using ${label} from ${ref}`);
      return sql;
    } catch { /* next */ }
  }
  console.log(`SKIP: ${label} not found at ${refs.filter(Boolean).join(', ')} (fetch the branch or set the env ref)`);
  process.exit(0);
}
const M175 = load('175', 'supabase/migrations/175_security_audit_access.sql', [process.env.BW_175_REF, 'origin/fix/security-audit', 'd9971705']);
const M178 = load('178', 'supabase/migrations/178_date_on_hold.sql', [process.env.BW_178_REF, 'origin/feat/date-on-hold']);
const M181 = load('181', 'supabase/migrations/181_event_chat_lineup.sql', [process.env.BW_181_REF, 'origin/fix/event-chat-lineup', '0437db39']);

// ── Extract by name ─────────────────────────────────────────────────────────
// A function: its CREATE statement (or the DO block that writes it) and the
// REVOKE / GRANT lines right after it.
function fn(sql, name) {
  const head = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const p = sql.indexOf(head);
  if (p < 0) throw new Error(`function ${name} not found`);
  let start = p;
  let end;
  const doStart = sql.lastIndexOf('\nDO $', p);
  if (doStart >= 0) {
    const tag = sql.slice(doStart + 4).match(/^\$[A-Za-z_]*\$/)[0];
    const close = sql.indexOf(`${tag};`, doStart + 4 + tag.length);
    if (close > p) { start = doStart + 1; end = close + tag.length + 1; }
  }
  if (end === undefined) {
    const as = sql.slice(p).match(/\bAS\s+(\$[A-Za-z_]*\$)/);
    const bodyStart = p + as.index + as[0].length;
    const bodyEnd = sql.indexOf(as[1], bodyStart);
    end = sql.indexOf(';', bodyEnd) + 1;
  }
  let out = sql.slice(start, end);
  // Following REVOKE / GRANT lines for it.
  const rest = sql.slice(end).split('\n');
  for (const line of rest.slice(1)) {
    if (/^(REVOKE|GRANT)\b/.test(line) && line.includes(`public.${name}(`)) out += '\n' + line;
    else if (line.trim() === '' || /^--/.test(line)) continue;
    else break;
  }
  return out;
}
// A statement starting with `head` (CREATE POLICY x / CREATE TRIGGER x /
// CREATE TABLE …), up to its final semicolon, with its DROP … IF EXISTS.
function stmt(sql, head, drop) {
  const p = sql.indexOf(head);
  if (p < 0) throw new Error(`${head} not found`);
  const end = sql.indexOf(';\n', p) + 1;
  const d = drop ? sql.indexOf(drop) : -1;
  return (d >= 0 ? sql.slice(d, sql.indexOf(';', d) + 1) + '\n' : '') + sql.slice(p, end);
}

// The same, when the head has it: [] otherwise.
function optStmt(sql, head, drop) {
  return sql.indexOf(head) < 0 ? [] : [stmt(sql, head, drop)];
}
function optFn(sql, name) {
  return sql.includes(`CREATE OR REPLACE FUNCTION public.${name}(`) ? [fn(sql, name)] : [];
}

const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, ADMIN, LINE, LEFT, GONE, STALE, DROP, DEC] = [1, 2, 3, 4, 5, 6, 7, 8].map(id);
const [BANDCHAT, EVCHAT] = [20, 21].map(id);
const GIG = id(30);

async function as(uid, sql) {
  try {
    await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, role: 'authenticated' })}', true);`);
    const r = await db.query(sql);
    await db.exec('COMMIT');
    return { rows: r.rows };
  } catch (e) {
    await db.exec('ROLLBACK');
    return { error: e.message, rows: [] };
  }
}
const count = async (sql) => db.query(sql).then((r) => r.rows[0].n, () => -1);

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text, preferred_language text);
CREATE TABLE public.bands (id uuid PRIMARY KEY, name text);
CREATE TABLE public.band_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, user_id uuid, role text, is_active boolean DEFAULT true, UNIQUE (band_id, user_id));
CREATE TABLE public.events (id uuid PRIMARY KEY, band_id uuid, title text, created_by uuid, status text, event_type text, quote_id uuid);
CREATE TABLE public.event_members (event_id uuid, user_id uuid, status text);
CREATE TABLE public.event_date_holds (event_id uuid, release_reason text, confirmed_once_at timestamptz, released_at timestamptz, history_cutoff_at timestamptz);
CREATE TABLE public.quotes (id uuid PRIMARY KEY, converted_to_event_id uuid, status text);
CREATE TABLE public.chats (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type varchar(20) NOT NULL, name text, band_id uuid,
  event_id uuid, created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.chat_participants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE, user_id uuid NOT NULL,
  cleared_at timestamptz, last_read_at timestamptz, last_delivered_at timestamptz, muted boolean DEFAULT false,
  joined_at timestamptz DEFAULT now(), UNIQUE (chat_id, user_id));
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id uuid, content text, band_id uuid, reply_to_id uuid, deleted boolean DEFAULT false, created_at timestamptz DEFAULT now());

CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, band_id uuid, type text,
  title text, body text, data jsonb, read boolean DEFAULT false, action_url text, created_at timestamptz DEFAULT now());

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chats, public.chat_participants, public.messages TO authenticated;
GRANT SELECT ON public.band_members, public.events, public.event_members, public.profiles TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- 073 baseline helpers; 111's bw_event_is_quote (no quotes in this test).
CREATE FUNCTION public.bw_is_band_admin(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND role = 'admin' AND COALESCE(is_active, true)); $f$;
CREATE FUNCTION public.bw_is_band_member(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND COALESCE(is_active, true)); $f$;
CREATE FUNCTION public.bw_is_event_participant(p_event_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND (e.created_by = p_user_id
    OR (e.band_id IS NOT NULL AND public.bw_is_band_admin(e.band_id, p_user_id))
    OR EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = e.id AND em.user_id = p_user_id AND COALESCE(em.status, '') <> 'declined'))); $f$;
CREATE FUNCTION public.bw_event_is_quote(p_status text, p_event_type text, p_quote_id uuid) RETURNS boolean
 LANGUAGE sql IMMUTABLE AS $f$ SELECT lower(coalesce(p_status, '')) = 'quote' $f$;
CREATE FUNCTION public.bw_shares_band_with_admin(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
CREATE FUNCTION public.bw_shares_band(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
CREATE FUNCTION public.bw_my_chat_ids() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT coalesce(array_agg(chat_id), '{}') FROM chat_participants WHERE user_id = auth.uid(); $f$;

-- Live read policies (073); 175 replaces the chats ones.
CREATE POLICY chat_participants_select_own ON public.chat_participants FOR SELECT USING (user_id = auth.uid());
CREATE POLICY chat_participants_select_same_chat ON public.chat_participants FOR SELECT TO authenticated USING (chat_id = ANY (bw_my_chat_ids()));
CREATE POLICY chats_select_participant ON public.chats FOR SELECT USING (id IN (SELECT chat_id FROM chat_participants WHERE user_id = auth.uid()));
CREATE POLICY chats_insert ON public.chats FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY messages_insert_participant ON public.messages FOR INSERT TO authenticated WITH CHECK ((sender_id = auth.uid()) AND (chat_id = ANY (bw_my_chat_ids())));
CREATE POLICY messages_select_participant ON public.messages FOR SELECT TO authenticated USING (chat_id = ANY (bw_my_chat_ids()));
`);
await db.exec(readFileSync(`${REPO}/supabase/migrations/104_direct_chat_two_people.sql`, 'utf8'));
await db.exec(`CREATE POLICY chat_participants_insert ON public.chat_participants FOR INSERT TO authenticated WITH CHECK (bw_can_add_chat_participant(chat_id, user_id));`);

// Data: Lia (LEFT) and Gus (GONE) are in the band chat and on the gig's
// lineup; Sam (STALE) too.
await db.exec(`
INSERT INTO profiles (id, full_name) VALUES ('${ADMIN}','Ava Admin'),('${LINE}','Leo Line'),('${LEFT}','Lia Left'),('${GONE}','Gus Gone'),('${STALE}','Sam Stale'),('${DROP}','Dee Dropped'),('${DEC}','Dan Declined');
INSERT INTO bands VALUES ('${BAND}','Hudson Horns');
INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${ADMIN}','admin'),('${BAND}','${LINE}','member'),
  ('${BAND}','${LEFT}','member'),('${BAND}','${GONE}','member'),('${BAND}','${STALE}','member'),('${BAND}','${DROP}','member'),('${BAND}','${DEC}','member');
INSERT INTO events (id, band_id, title, created_by, status, event_type) VALUES ('${GIG}','${BAND}','Rooftop Session','${ADMIN}','confirmed','gig');
INSERT INTO event_members VALUES ('${GIG}','${LINE}','confirmed'),('${GIG}','${LEFT}','confirmed'),('${GIG}','${GONE}','confirmed'),('${GIG}','${STALE}','confirmed'),
  ('${GIG}','${DROP}','Dropped_Out'),('${GIG}','${DEC}',' Declined');
INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES
  ('${BANDCHAT}','band','Hudson Horns','${BAND}',NULL,'${ADMIN}'),
  ('${EVCHAT}','event','Rooftop Session','${BAND}','${GIG}','${ADMIN}');
INSERT INTO chat_participants (chat_id, user_id) SELECT c, u FROM unnest(ARRAY['${BANDCHAT}','${EVCHAT}']::uuid[]) c,
  unnest(ARRAY['${ADMIN}','${LINE}','${LEFT}','${GONE}','${STALE}']::uuid[]) u;
INSERT INTO messages (chat_id, sender_id, content, created_at) VALUES ('${EVCHAT}','${ADMIN}','before: load-in at 5', now() - interval '1 hour');
`);

const loads = async (label, sql) => {
  try { await db.exec(sql); ok(true, label); } catch (e) { await db.exec('ROLLBACK').catch(() => {}); ok(false, `${label} (${e.message})`); }
};
// ── 194 (whole), 175 (by name), 178 (by name), 192, 193, 181 (whole) ───────
// Apply order (#278): 194 runs before 175.
await loads('194 runs first', readFileSync(MIG194, 'utf8'));
const parts175 = [
  fn(M175, 'bw_chats_immutable_keys'),
  stmt(M175, 'CREATE TRIGGER bw_chats_immutable_keys', 'DROP TRIGGER IF EXISTS bw_chats_immutable_keys'),
  fn(M175, 'bw_chat_scope_ok'),
  // 175 r5 (#281 bc002cbd): the roster guard's row check. The internal rule
  // is written from bw_chat_scope_ok's body, so it comes right after it.
  ...optFn(M175, 'bw_chat_rule_ungated'),
  ...optFn(M175, 'bw_chat_row_ok'),
  fn(M175, 'bw_my_chat_ids'),
  fn(M175, 'bw_chat_recipient_ids'),
  fn(M175, 'bw_chat_scope_ok_for'),
  stmt(M175, 'CREATE POLICY chat_participants_insert', 'DROP POLICY IF EXISTS chat_participants_insert'),
  stmt(M175, 'CREATE TABLE IF NOT EXISTS public.chat_participants_removed_175', null),
  fn(M175, 'bw_trg_chat_participant_scope'),
  stmt(M175, 'CREATE TRIGGER bw_chat_participant_scope', 'DROP TRIGGER IF EXISTS bw_chat_participant_scope'),
  fn(M175, 'get_user_chats'),
  stmt(M175, 'CREATE POLICY chats_select_participant', 'DROP POLICY IF EXISTS chats_select_participant'),
  stmt(M175, 'CREATE POLICY chats_select_creator', 'DROP POLICY IF EXISTS chats_select_creator'),
  stmt(M175, 'CREATE POLICY chat_participants_select_same_chat', 'DROP POLICY IF EXISTS chat_participants_select_same_chat'),
  // 175 r4 final (#281 cc542575): the roster rule moved into a RESTRICTIVE
  // guard plus the own-row policy; older heads (d9971705) have neither.
  ...optStmt(M175, 'CREATE POLICY chat_participants_select_own', 'DROP POLICY IF EXISTS chat_participants_select_own'),
  ...optStmt(M175, 'CREATE POLICY chat_participants_scope_guard', 'DROP POLICY IF EXISTS chat_participants_scope_guard'),
  // 175 r5: the same guard for UPDATE / DELETE, one on messages, and chats_upd.
  ...optStmt(M175, 'CREATE POLICY chat_participants_update_guard', 'DROP POLICY IF EXISTS chat_participants_update_guard'),
  ...optStmt(M175, 'CREATE POLICY chat_participants_delete_guard', 'DROP POLICY IF EXISTS chat_participants_delete_guard'),
  ...optStmt(M175, 'CREATE POLICY messages_scope_guard', 'DROP POLICY IF EXISTS messages_scope_guard'),
  ...optStmt(M175, 'CREATE POLICY chats_upd', 'DROP POLICY IF EXISTS chats_upd'),
  ...(process.env.BW_TEST_DROP_GUARD ? ['DROP POLICY IF EXISTS chat_participants_scope_guard ON public.chat_participants;'] : []),
  fn(M175, 'bw_trg_band_member_left_chats'),
  stmt(M175, 'CREATE TRIGGER bw_band_member_left_chats', 'DROP TRIGGER IF EXISTS bw_band_member_left_chats'),
];
const parts178 = [
  fn(M178, 'bw_event_quote_private'),
  fn(M178, 'bw_event_quote_hidden'),
  fn(M178, 'bw_hidden_quote_chat_ids'),
  fn(M178, 'bw_is_event_participant'),
  stmt(M178, 'CREATE POLICY chats_quote_admins_only', 'DROP POLICY IF EXISTS chats_quote_admins_only'),
  stmt(M178, 'CREATE POLICY messages_quote_admins_only ', 'DROP POLICY IF EXISTS messages_quote_admins_only;'),
  fn(M178, 'bw_trg_chat_participant_quote_guard'),
  stmt(M178, 'CREATE TRIGGER bw_chat_participants_00_quote_guard', 'DROP TRIGGER IF EXISTS bw_chat_participants_00_quote_guard'),
  fn(M178, 'bw_chat_scope_ok'),
  fn(M178, 'get_user_chats'),
];
for (const [label, list] of [['175', parts175], ['178', parts178]]) {
  for (const sql of list) {
    try { await db.exec(sql); } catch (e) { console.log(`ERROR loading ${label}:`, e.message, '\n', sql.slice(0, 160)); process.exit(2); }
  }
}
ok(true, '175 and 178 chat rules loaded from their branch heads');
// 175's final roster rule is the RESTRICTIVE chat_participants_scope_guard:
// with a head that has it, it must be in (else ex-members show in the roster).
if (M175.includes('CREATE POLICY chat_participants_scope_guard')) {
  const g = await db.query(`SELECT permissive FROM pg_policies WHERE tablename = 'chat_participants' AND policyname = 'chat_participants_scope_guard'`);
  ok(g.rows[0]?.permissive === 'RESTRICTIVE' || !!process.env.BW_TEST_DROP_GUARD, `175's RESTRICTIVE chat_participants_scope_guard is loaded (${g.rows[0]?.permissive ?? 'missing'})`);
}
await loads('192 runs after 178', readFileSync(MIG192, 'utf8'));
await loads('193 runs after 192', readFileSync(MIG193, 'utf8'));
await loads('181 runs after 193', M181);

// ── Removed from the band, already in the chats ────────────────────────────
await db.exec(`UPDATE band_members SET is_active = false WHERE user_id = '${LEFT}'`);
await db.exec(`DELETE FROM band_members WHERE user_id = '${GONE}'`);
// 175 r4: the rows stay (same chat when they come back), with a record in
// the archive; the rule refuses them everywhere.
const roster = async (viewer) => (await as(viewer, `SELECT user_id FROM chat_participants WHERE chat_id IN ('${BANDCHAT}','${EVCHAT}')`)).rows.map((x) => x.user_id);
for (const [who, label] of [[LEFT, 'deactivated'], [GONE, 'row deleted']]) {
  ok(await count(`SELECT count(DISTINCT chat_id)::int AS n FROM chat_participants_removed_175 WHERE user_id = '${who}'`) === 2,
    `${label}: archived from the band chat and the gig chat (chat_participants_removed_175)`);
  const seen = await roster(LINE);
  ok(!seen.includes(who) && seen.includes(ADMIN), `${label}: hidden from the other members' roster (${seen.length} visible)`);
}
let r = await as(ADMIN, `INSERT INTO messages (chat_id, sender_id, content) VALUES ('${EVCHAT}','${ADMIN}','after: set list changed'), ('${BANDCHAT}','${ADMIN}','after: new rehearsal')`);
ok(!r.error, `the admin posts in both chats (${r.error ?? 'ok'})`);
for (const [who, label] of [[LEFT, 'deactivated'], [GONE, 'row deleted']]) {
  r = await as(who, `SELECT content FROM messages`);
  ok(r.rows.length === 0, `${label}: reads no message of either chat (${r.rows.map((x) => x.content)})`);
  r = await as(who, `SELECT public.get_user_chats('${who}') AS c`);
  ok(!r.error && JSON.stringify(r.rows[0].c) === '[]', `${label}: get_user_chats lists nothing (${r.error ?? JSON.stringify(r.rows[0]?.c)})`);
}
r = await db.query(`SELECT public.bw_chat_recipient_ids('${EVCHAT}', '${ADMIN}') AS e, public.bw_chat_recipient_ids('${BANDCHAT}', '${ADMIN}') AS b`);
const pushTo = [...r.rows[0].e, ...r.rows[0].b];
ok(!pushTo.includes(LEFT) && !pushTo.includes(GONE) && pushTo.includes(LINE),
  `push recipients (send-push chatRecipients → bw_chat_recipient_ids) leave them out (${pushTo})`);

// Coming back: still on the gig's lineup, the app's restore and their own
// join are skipped (175 + 193), and bw_open_group_chat refuses.
r = await as(LINE, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT}','${LINE}'),('${EVCHAT}','${LEFT}') ON CONFLICT (chat_id, user_id) DO NOTHING`);
ok(!r.error, `lineup restore with a former member does not fail (${r.error ?? 'ok'})`);
r = await as(LEFT, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT}','${LEFT}'),('${BANDCHAT}','${LEFT}') ON CONFLICT (chat_id, user_id) DO NOTHING`);
r = await as(LEFT, `SELECT content FROM messages`);
const pushAgain = (await db.query(`SELECT public.bw_chat_recipient_ids('${EVCHAT}', '${ADMIN}') AS e`)).rows[0].e;
ok(r.rows.length === 0 && !pushAgain.includes(LEFT) && !(await roster(LINE)).includes(LEFT),
  `nobody puts them back: still no read, no push, not in the roster (${r.rows.length} read)`);
r = await as(LEFT, `SELECT public.bw_open_group_chat('event', '${BAND}', '${GIG}', 'x') AS c`);
ok(!!r.error, `and they cannot open the gig chat (${r.error ? 'refused' : 'opened'})`);

// A row left behind anyway (written with every trigger off): no access.
await db.exec(`UPDATE band_members SET is_active = false WHERE user_id = '${STALE}'`);
await db.exec(`SET session_replication_role = replica;
  INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT}','${STALE}'),('${BANDCHAT}','${STALE}') ON CONFLICT DO NOTHING;
  SET session_replication_role = origin;`);
ok(await count(`SELECT count(*)::int AS n FROM chat_participants WHERE user_id = '${STALE}'`) === 2, 'a stale row exists (triggers bypassed)');
r = await as(STALE, `SELECT content FROM messages`);
ok(r.rows.length === 0, `stale row: reads nothing (${r.rows.length})`);
r = await as(STALE, `INSERT INTO messages (chat_id, sender_id, content) VALUES ('${EVCHAT}','${STALE}','still here?')`);
ok(!!r.error, 'stale row: cannot post');
r = await db.query(`SELECT public.bw_chat_recipient_ids('${EVCHAT}', '${ADMIN}') AS e`);
ok(!r.rows[0].e.includes(STALE), 'stale row: no push');
r = await as(STALE, `SELECT public.get_user_chats('${STALE}') AS c`);
ok(JSON.stringify(r.rows[0]?.c) === '[]', 'stale row: no chat listed');

// Off the gig in another case ('Dropped_Out'): 193's own rule (178's
// bw_is_event_participant, case-sensitive) said yes, 175's says no. Opening
// must not hand them a chat they can't read (round 4).
r = await as(DROP, `SELECT public.bw_open_group_chat('event', '${BAND}', '${GIG}', 'x') AS c`);
ok(!!r.error, `'Dropped_Out' on the lineup: bw_open_group_chat refuses (${r.error ? 'refused' : 'opened'})`);
r = await as(DROP, `SELECT content FROM messages`);
ok(r.rows.length === 0, `'Dropped_Out': reads nothing (${r.rows.length})`);
// Claude #291 r5: 193's own rule uses 175's off-the-gig set too (trimmed,
// any case), so joinable says no and nobody's composer flip-flops.
for (const [who, label] of [[DROP, "'dropped_out'"], [DEC, "' Declined'"]]) {
  r = await as(who, `SELECT public.bw_chat_joinable('event', '${BAND}', '${GIG}', '${who}') AS j`);
  ok(r.rows[0]?.j === false, `${label}: bw_chat_joinable is false (${r.error ?? r.rows[0]?.j})`);
  // (Without 193, /dev/null: a FAIL, not a crash.)
  r = await db.query(`SELECT public.bw_chat_joinable_rule('event', '${BAND}', '${GIG}', '${who}') AS j`).catch((e) => ({ rows: [], error: e.message }));
  ok(r.rows[0]?.j === false, `${label}: the rule itself is false (${r.error ?? r.rows[0]?.j})`);
  r = await as(who, `SELECT id FROM chats WHERE id = '${EVCHAT}'`);
  ok(r.rows.length === 0, `${label}: does not see the gig chat row (${r.rows.length})`);
}
r = await as(LINE, `SELECT public.bw_chat_joinable('event', '${BAND}', '${GIG}', '${LINE}') AS j`);
ok(r.rows[0]?.j === true, `a confirmed lineup member is joinable (${r.error ?? r.rows[0]?.j})`);
r = await as(LINE, `SELECT (public.bw_open_group_chat('event', '${BAND}', '${GIG}', 'x'))->>'id' AS c`);
ok(!r.error && r.rows[0]?.c === EVCHAT, `a lineup member still opens the gig chat (${r.error ?? r.rows[0]?.c})`);
r = await as(ADMIN, `SELECT (public.bw_open_group_chat('band', '${BAND}', NULL, 'x'))->>'id' AS c`);
ok(!r.error && r.rows[0]?.c === BANDCHAT, `the admin still opens the band chat (${r.error ?? r.rows[0]?.c})`);

// Codex #291 r4 (B2): a chat's creator moves it to another band: refused
// (175's bw_chats_immutable_keys, which 193 requires).
await db.exec(`INSERT INTO bands VALUES ('${id(9)}','Other Band')`);
r = await as(ADMIN, `UPDATE chats SET band_id = '${id(9)}' WHERE id = '${BANDCHAT}'`);
let moved = null;
try { await db.exec(`UPDATE chats SET band_id = '${id(9)}' WHERE id = '${BANDCHAT}'`); } catch (e) { moved = e.message; }
ok(!!moved && (await db.query(`SELECT band_id FROM chats WHERE id = '${BANDCHAT}'`)).rows[0].band_id === BAND,
  `changing a chat's band_id is refused (${moved ?? 'changed'})`);

// Codex #291 r4 (B1/B2), main: 193 never runs without 175.
{
  const bare = new PGlite();
  await bare.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE TABLE public.chats (id uuid PRIMARY KEY, type text, band_id uuid, event_id uuid, created_by uuid, created_at timestamptz, name text);
    CREATE TABLE public.chat_participants (chat_id uuid, user_id uuid, UNIQUE (chat_id, user_id));
    CREATE TABLE public.events (id uuid PRIMARY KEY, band_id uuid, created_by uuid);`);
  let guard = null;
  try { await bare.exec(readFileSync(MIG193, 'utf8')); } catch (e) { guard = e.message; await bare.exec('ROLLBACK'); }
  ok(!!guard && guard.includes('175'), `193 without 175 stops at once and names 175 (${guard ?? 'ran'})`);
  ok((await bare.query(`SELECT to_regprocedure('public.bw_open_group_chat(text, uuid, uuid, text)') AS f`)).rows[0].f === null,
    'and creates nothing');
}

// Still in the band: nothing changed for them.
r = await as(LINE, `SELECT content FROM messages WHERE chat_id = '${EVCHAT}' ORDER BY created_at`);
ok(r.rows.length === 2, `a lineup member still reads the gig chat (${r.rows.length})`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
