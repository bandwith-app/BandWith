// Codex #291 round 4 (B1, 193:187): someone already in a band or gig chat
// who is then removed from the band keeps their chat_participants row unless
// 175 takes it away. This loads the real migrations in apply order, from
// their branch heads, and checks the whole chain:
//
//   175 (fix/security-audit) → 178 (feat/date-on-hold) → 194 (#284) → 192 → 193 (this PR) → 181 (fix/event-chat-lineup)
// (the release apply order, main's fn-rule.md)
//
// 175 and 178 are large: only the chat functions, policies and triggers are
// taken, by name (never by line). 194, 192, 193 and 181 are loaded whole.
//
// After removal (deactivated, or the band_members row deleted), a new message:
// the former member reads nothing, is no push recipient
// (bw_chat_recipient_ids, which #281's send-push chatRecipients calls), is
// not in get_user_chats, and cannot join again. A row left behind anyway
// (written with triggers off) still gives no access.
//
//   cd <dir with @electric-sql/pglite@0.5.15> && node chat_member_left_integrated.pglite.mjs <repo> [193-file]
//   Refs: BW_175_REF (default 44cf49fc), BW_178_REF (origin/feat/date-on-hold), BW_181_REF (7713af1a).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO = process.argv[2];
const MIG193 = process.argv[3] ?? `${REPO}/supabase/migrations/193_one_chat_per_gig.sql`;
const MIG192 = `${REPO}/supabase/migrations/192_chat_notification_purge.sql`;
const MIG194 = `${REPO}/supabase/migrations/194_chat_notifications_server_only.sql`;
const show = (ref, path) => execFileSync('git', ['-C', REPO, 'show', `${ref}:${path}`], { encoding: 'utf8' });
const M175 = show(process.env.BW_175_REF ?? '44cf49fc', 'supabase/migrations/175_security_audit_access.sql');
const M178 = show(process.env.BW_178_REF ?? 'origin/feat/date-on-hold', 'supabase/migrations/178_date_on_hold.sql');
const M181 = show(process.env.BW_181_REF ?? '7713af1a', 'supabase/migrations/181_event_chat_lineup.sql');

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

const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, ADMIN, LINE, LEFT, GONE, STALE] = [1, 2, 3, 4, 5, 6].map(id);
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
CREATE TABLE public.event_date_holds (event_id uuid, release_reason text, confirmed_once_at timestamptz, released_at timestamptz);
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
INSERT INTO profiles (id, full_name) VALUES ('${ADMIN}','Ava Admin'),('${LINE}','Leo Line'),('${LEFT}','Lia Left'),('${GONE}','Gus Gone'),('${STALE}','Sam Stale');
INSERT INTO bands VALUES ('${BAND}','Hudson Horns');
INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${ADMIN}','admin'),('${BAND}','${LINE}','member'),
  ('${BAND}','${LEFT}','member'),('${BAND}','${GONE}','member'),('${BAND}','${STALE}','member');
INSERT INTO events (id, band_id, title, created_by, status, event_type) VALUES ('${GIG}','${BAND}','Rooftop Session','${ADMIN}','confirmed','gig');
INSERT INTO event_members VALUES ('${GIG}','${LINE}','confirmed'),('${GIG}','${LEFT}','confirmed'),('${GIG}','${GONE}','confirmed'),('${GIG}','${STALE}','confirmed');
INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES
  ('${BANDCHAT}','band','Hudson Horns','${BAND}',NULL,'${ADMIN}'),
  ('${EVCHAT}','event','Rooftop Session','${BAND}','${GIG}','${ADMIN}');
INSERT INTO chat_participants (chat_id, user_id) SELECT c, u FROM unnest(ARRAY['${BANDCHAT}','${EVCHAT}']::uuid[]) c,
  unnest(ARRAY['${ADMIN}','${LINE}','${LEFT}','${GONE}','${STALE}']::uuid[]) u;
INSERT INTO messages (chat_id, sender_id, content, created_at) VALUES ('${EVCHAT}','${ADMIN}','before: load-in at 5', now() - interval '1 hour');
`);

// ── 175 (by name), 178 (by name), 193 (whole), 181 (whole) ─────────────────
const parts175 = [
  fn(M175, 'bw_chat_scope_ok'),
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
await db.exec(readFileSync(MIG194, 'utf8'));
await db.exec(readFileSync(MIG192, 'utf8'));
ok(true, '194 and 192 run after 178');
await db.exec(readFileSync(MIG193, 'utf8'));
ok(true, '193 runs after 192');
await db.exec(M181);
ok(true, '181 runs after 193');

// ── Removed from the band, already in the chats ────────────────────────────
await db.exec(`UPDATE band_members SET is_active = false WHERE user_id = '${LEFT}'`);
await db.exec(`DELETE FROM band_members WHERE user_id = '${GONE}'`);
for (const [who, label] of [[LEFT, 'deactivated'], [GONE, 'row deleted']]) {
  ok(await count(`SELECT count(*)::int AS n FROM chat_participants WHERE user_id = '${who}'`) === 0,
    `${label}: out of the band chat and the gig chat`);
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
ok(await count(`SELECT count(*)::int AS n FROM chat_participants WHERE user_id = '${LEFT}'`) === 0, 'nobody puts them back');
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

// Still in the band: nothing changed for them.
r = await as(LINE, `SELECT content FROM messages WHERE chat_id = '${EVCHAT}' ORDER BY created_at`);
ok(r.rows.length === 2, `a lineup member still reads the gig chat (${r.rows.length})`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
