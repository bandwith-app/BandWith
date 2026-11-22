// Local check of migrations 192 (deleted messages take their notification
// previews with them, audit 07 #4) and 193 (one chat per gig and per band,
// audit 07 #6), without Docker: PGlite (Postgres in WebAssembly) with
// stand-ins for Supabase's auth schema and the live chat tables, policies
// and functions (073 baseline, 050 immutable keys, 067 delete history, 104).
//
// Failing first: pass /dev/null as the migration and every defect shows up
// as FAIL; with 192 + 193 they all pass.
//
//   mkdir -p /tmp/pgchat && cd /tmp/pgchat && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/chat_audit.pglite.mjs . && node chat_audit.pglite.mjs <repo>
//   node chat_audit.pglite.mjs <repo> /dev/null     # before: FAILs expected
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const REPO = process.argv[2];
const MIGS = process.argv[3]
  ? [process.argv[3]]
  : ['192_chat_notification_purge.sql', '193_one_chat_per_gig.sql'].map((n) => `${REPO}/supabase/migrations/${n}`);
const migFile = (n) => readFileSync(`${REPO}/supabase/migrations/${n}`, 'utf8');
const lines = (n, a, b) => migFile(n).split('\n').slice(a - 1, b).join('\n');

const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
process.on('uncaughtException', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, OTHERBAND, ADMIN, LINE, MEM, OUT, FAN, EX] = [1, 2, 3, 4, 5, 6, 7, 8].map(id);
const [DM, BANDCHAT, EVCHAT, DUP_OLD, DUP_NEW, OTHERCHAT, TWINCHAT] = [20, 21, 22, 23, 24, 25, 26].map(id);
const [GIG, GIG2] = [30, 31].map(id);
const [M_SHORT, M_LONG, M_BAND_LINE, M_BAND_MEM, M_OTHER, M_GONE, M_DUP_OLD, M_DUP_NEW] = [40, 41, 42, 43, 44, 45, 46, 47].map(id);
const [M_OK1, M_OK2, M_EMOJI, M_SOFT, M_LIVE, M_YES1, M_YES2, M_EDIT] = [48, 49, 50, 51, 52, 53, 54, 55].map(id);

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
const count = async (sql) => db.query(sql).then((r) => r.rows[0].n, () => -1);

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE TYPE user_role AS ENUM ('admin', 'member');

CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text, preferred_language text);
CREATE TABLE public.bands (id uuid PRIMARY KEY, name text);
CREATE TABLE public.band_members (band_id uuid, user_id uuid, role user_role, is_active boolean DEFAULT true, UNIQUE (band_id, user_id));
CREATE TABLE public.events (id uuid PRIMARY KEY, band_id uuid, title text, created_by uuid);
CREATE TABLE public.event_members (event_id uuid, user_id uuid, status text);
CREATE TABLE public.chats (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type varchar(20) NOT NULL, name text, band_id uuid,
  event_id uuid, created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.chat_participants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE, user_id uuid NOT NULL,
  cleared_at timestamptz, last_read_at timestamptz, last_delivered_at timestamptz, joined_at timestamptz DEFAULT now(),
  UNIQUE (chat_id, user_id));
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id uuid, content text, band_id uuid, reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  deleted boolean DEFAULT false, deleted_at timestamptz, edited boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, band_id uuid, type text,
  title text, body text, data jsonb, read boolean DEFAULT false, action_url text, created_at timestamptz DEFAULT now());

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chats, public.chat_participants, public.messages, public.notifications TO authenticated;
GRANT SELECT ON public.band_members, public.events, public.event_members TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

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
CREATE FUNCTION public.bw_shares_band_with_admin(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
CREATE FUNCTION public.bw_shares_band(a uuid, b uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
CREATE FUNCTION public.bw_my_chat_ids() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT coalesce(array_agg(chat_id), '{}') FROM chat_participants WHERE user_id = auth.uid(); $f$;

-- Live policies (073 baseline / verify-db.json).
CREATE POLICY chat_participants_select_own ON public.chat_participants FOR SELECT USING (user_id = auth.uid());
CREATE POLICY chat_participants_select_same_chat ON public.chat_participants FOR SELECT TO authenticated USING (chat_id = ANY (bw_my_chat_ids()));
CREATE POLICY cp_update ON public.chat_participants FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY chats_insert ON public.chats FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid())
  AND ((band_id IS NULL) OR bw_is_band_member(band_id)) AND ((event_id IS NULL) OR bw_is_event_participant(event_id)));
CREATE POLICY chats_select_creator ON public.chats FOR SELECT TO authenticated USING (created_by = auth.uid());
CREATE POLICY chats_select_participant ON public.chats FOR SELECT USING (id IN (SELECT chat_participants.chat_id FROM chat_participants WHERE chat_participants.user_id = auth.uid()));
CREATE POLICY messages_insert_participant ON public.messages FOR INSERT TO authenticated WITH CHECK ((sender_id = auth.uid()) AND (chat_id = ANY (bw_my_chat_ids())));
CREATE POLICY messages_select_participant ON public.messages FOR SELECT TO authenticated USING (chat_id = ANY (bw_my_chat_ids()));
CREATE POLICY messages_delete_own ON public.messages FOR DELETE TO authenticated USING (sender_id = auth.uid());
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY notifications_delete_own ON public.notifications FOR DELETE USING (user_id = auth.uid());
`);
await db.exec(lines('050_chat_and_profile_privacy.sql', 62, 105)); // immutable keys on messages / chat_participants
await db.exec(migFile('067_delete_chat_history.sql'));
await db.exec(migFile('104_direct_chat_two_people.sql'));
await db.exec(`CREATE POLICY chat_participants_insert ON public.chat_participants FOR INSERT TO authenticated WITH CHECK (bw_can_add_chat_participant(chat_id, user_id));`);

const preview = (s) => s.slice(0, 120);
// 100 letters + 15 guitars = 130 UTF-16 units: the app's preview keeps 10 guitars.
const EMOJI = 'x'.repeat(100) + '🎸'.repeat(15);
const LONG = 'Load-in moved to 5:30 at the Brooklyn Bowl side door, bring the second amp and the long XLR cables, parking is on Wythe Ave, see you there';
await db.exec(`
INSERT INTO profiles (id, full_name) VALUES ('${ADMIN}','Ava Admin'),('${LINE}','Leo Line'),('${MEM}','Mia Member'),('${OUT}','Oscar Out'),('${FAN}','Fay Fan'),('${EX}','Eli Ex');
INSERT INTO bands VALUES ('${BAND}','Hudson Horns'),('${OTHERBAND}','Queens Quartet');
INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${ADMIN}','admin'),('${BAND}','${LINE}','member'),
  ('${BAND}','${MEM}','member'),('${OTHERBAND}','${MEM}','member'),('${OTHERBAND}','${LINE}','member');
-- Eli left both bands (inactive) but is still on the Rooftop lineup.
INSERT INTO band_members (band_id, user_id, role, is_active) VALUES ('${BAND}','${EX}','member',false),('${OTHERBAND}','${EX}','member',false);
INSERT INTO events (id, band_id, title, created_by) VALUES ('${GIG}','${BAND}','Rooftop Session','${ADMIN}'),('${GIG2}','${BAND}','Jazz Brunch','${ADMIN}');
INSERT INTO event_members VALUES ('${GIG}','${LINE}','confirmed'),('${GIG2}','${LINE}','confirmed'),('${GIG}','${EX}','confirmed');

INSERT INTO chats (id, type, name, band_id, event_id, created_by, created_at) VALUES
  ('${DM}','direct',NULL,NULL,NULL,'${ADMIN}', now() - interval '3 days'),
  ('${BANDCHAT}','band','Hudson Horns','${BAND}',NULL,'${ADMIN}', now() - interval '3 days'),
  ('${OTHERCHAT}','direct',NULL,NULL,NULL,'${MEM}', now() - interval '3 days'),
  -- Two band chats for the same band, from before this fix.
  ('${DUP_OLD}','band','Queens Quartet','${OTHERBAND}',NULL,'${MEM}', now() - interval '2 days'),
  ('${DUP_NEW}','band','Queens Quartet','${OTHERBAND}',NULL,'${LINE}', now() - interval '1 day'),
  ('${TWINCHAT}','direct',NULL,NULL,NULL,'${MEM}', now() - interval '3 days');
INSERT INTO chat_participants (chat_id, user_id, cleared_at) VALUES
  ('${DM}','${ADMIN}',NULL),('${DM}','${LINE}',NULL),
  ('${BANDCHAT}','${ADMIN}',NULL),('${BANDCHAT}','${LINE}',NULL),('${BANDCHAT}','${MEM}',NULL),
  ('${OTHERCHAT}','${MEM}',NULL),('${OTHERCHAT}','${ADMIN}',NULL),
  ('${DUP_OLD}','${MEM}',NULL),('${DUP_NEW}','${LINE}',NULL),('${DUP_NEW}','${MEM}', now() - interval '12 hours'),
  ('${DUP_NEW}','${EX}',NULL),('${TWINCHAT}','${MEM}',NULL),('${TWINCHAT}','${ADMIN}',NULL);
INSERT INTO messages (id, chat_id, sender_id, content, created_at) VALUES
  ('${M_SHORT}','${DM}','${ADMIN}','see you at 8', now() - interval '2 hours'),
  ('${M_LONG}','${DM}','${ADMIN}',$t$${LONG}$t$, now() - interval '90 minutes'),
  ('${M_BAND_LINE}','${BANDCHAT}','${LINE}','set list is up', now() - interval '80 minutes'),
  ('${M_BAND_MEM}','${BANDCHAT}','${MEM}','running late', now() - interval '70 minutes'),
  ('${M_OTHER}','${OTHERCHAT}','${MEM}','see you at 8', now() - interval '60 minutes'),
  ('${M_DUP_OLD}','${DUP_OLD}','${MEM}','first thread', now() - interval '40 hours'),
  ('${M_DUP_NEW}','${DUP_NEW}','${LINE}','second thread', now() - interval '20 hours'),
  ('${M_OK1}','${TWINCHAT}','${MEM}','OK', now() - interval '50 minutes'),
  ('${M_OK2}','${TWINCHAT}','${MEM}','OK', now() - interval '40 minutes'),
  ('${M_EMOJI}','${TWINCHAT}','${MEM}',$t$${EMOJI}$t$, now() - interval '30 minutes'),
  ('${M_SOFT}','${TWINCHAT}','${MEM}','delete me softly', now() - interval '20 minutes'),
  ('${M_LIVE}','${TWINCHAT}','${MEM}','still here', now() - interval '10 minutes'),
  -- Two "Yes"s three seconds apart.
  ('${M_YES1}','${TWINCHAT}','${MEM}','Yes', now() - interval '8 minutes'),
  ('${M_YES2}','${TWINCHAT}','${MEM}','Yes', now() - interval '8 minutes' + interval '3 seconds');
-- Edited after its notice went out ("9" → "nine").
INSERT INTO messages (id, chat_id, sender_id, content, edited, created_at) VALUES
  ('${M_EDIT}','${TWINCHAT}','${MEM}','see you at nine', true, now() - interval '5 minutes');
-- Notifications: with message_id (send-push from #284), and older ones without.
INSERT INTO notifications (user_id, type, title, body, data, action_url, created_at) VALUES
  ('${LINE}','chat_message','Ava Admin','see you at 8',
    jsonb_build_object('chat_id','${DM}','message_id','${M_SHORT}','content','see you at 8'), '/chat/${DM}', now() - interval '119 minutes'),
  ('${LINE}','chat_message','Ava Admin',$t$${preview(LONG)}$t$,
    jsonb_build_object('chat_id','${DM}','chatId','${DM}','content',$t$${preview(LONG)}$t$), '/chat/${DM}', now() - interval '89 minutes'),
  ('${ADMIN}','chat_message','Leo Line','set list is up',
    jsonb_build_object('chat_id','${BANDCHAT}','message_id','${M_BAND_LINE}','content','set list is up'), '/chat/${BANDCHAT}', now() - interval '79 minutes'),
  ('${ADMIN}','chat_mention','Mia Member mentioned you','running late',
    jsonb_build_object('chat_id','${BANDCHAT}','content','running late'), '/chat/${BANDCHAT}', now() - interval '69 minutes'),
  ('${ADMIN}','chat_message','Mia Member','see you at 8',
    jsonb_build_object('chat_id','${OTHERCHAT}','content','see you at 8'), '/chat/${OTHERCHAT}', now() - interval '59 minutes'),
  ('${ADMIN}','event_update','Gig updated','Rooftop Session moved', jsonb_build_object('event_id','${GIG}'), NULL, now()),
  -- Previews of messages deleted before the migration (orphans).
  ('${LINE}','chat_message','Ava Admin','old secret',
    jsonb_build_object('chat_id','${DM}','message_id','${M_GONE}','content','old secret'), '/chat/${DM}', now() - interval '5 days'),
  ('${LINE}','chat_message','Ava Admin','older secret',
    jsonb_build_object('chat_id','${DM}','content','older secret'), '/chat/${DM}', now() - interval '6 days'),
  ('${MEM}','chat_message','Leo Line','second thread',
    jsonb_build_object('chat_id','${DUP_NEW}','message_id','${M_DUP_NEW}','content','second thread'), '/chat/${DUP_NEW}', now() - interval '20 hours'),
  -- Older rows (no message_id) for two "OK"s ten minutes apart, and a long emoji message.
  ('${ADMIN}','chat_message','Mia Member','OK', jsonb_build_object('chat_id','${TWINCHAT}','content','OK','tag','ok-1'), '/chat/${TWINCHAT}', now() - interval '50 minutes' + interval '5 seconds'),
  ('${ADMIN}','chat_message','Mia Member','OK', jsonb_build_object('chat_id','${TWINCHAT}','content','OK','tag','ok-2'), '/chat/${TWINCHAT}', now() - interval '40 minutes' + interval '5 seconds'),
  ('${ADMIN}','chat_message','Mia Member',$t$${preview(EMOJI)}$t$, jsonb_build_object('chat_id','${TWINCHAT}','content',$t$${preview(EMOJI)}$t$), '/chat/${TWINCHAT}', now() - interval '30 minutes' + interval '5 seconds'),
  ('${ADMIN}','chat_message','Mia Member','delete me softly', jsonb_build_object('chat_id','${TWINCHAT}','message_id','${M_SOFT}','content','delete me softly'), '/chat/${TWINCHAT}', now() - interval '20 minutes'),
  ('${ADMIN}','chat_message','Mia Member','Yes', jsonb_build_object('chat_id','${TWINCHAT}','content','Yes','tag','yes-1'), '/chat/${TWINCHAT}', now() - interval '8 minutes' + interval '1 second'),
  ('${ADMIN}','chat_message','Mia Member','Yes', jsonb_build_object('chat_id','${TWINCHAT}','content','Yes','tag','yes-2'), '/chat/${TWINCHAT}', now() - interval '8 minutes' + interval '4 seconds'),
  ('${ADMIN}','chat_message','Mia Member','see you at 9', jsonb_build_object('chat_id','${TWINCHAT}','content','see you at 9'), '/chat/${TWINCHAT}', now() - interval '5 minutes' + interval '1 second');
`);

// ── 193 · main's decision (round 3): no merge. With duplicates it stops and
// lists them; prod has none (2 band chats, 5 event chats).
const mig193 = MIGS.find((m) => m.includes('193')) ?? MIGS[0];
let dupErr = null;
try {
  await db.exec(readFileSync(mig193, 'utf8'));
} catch (e) {
  dupErr = e.message;
  await db.exec('ROLLBACK');
}
ok(!!dupErr && dupErr.includes(DUP_NEW) && dupErr.includes(DUP_OLD) && dupErr.includes(OTHERBAND),
  `193 refuses to run with duplicates and lists them (${dupErr ?? 'ran'})`);
ok(await count(`SELECT count(*)::int AS n FROM chats WHERE id IN ('${DUP_OLD}','${DUP_NEW}')`) === 2, 'and changes nothing');
await db.exec(`DELETE FROM chats WHERE id = '${DUP_NEW}'`);

for (const m of MIGS) {
  await db.exec(readFileSync(m, 'utf8'));
  await db.exec(readFileSync(m, 'utf8')); // idempotent
}
ok(true, 'migrations run twice');
let r0;
let r;

// ── 192 · one copy per bubble (Claude review #291 r4): Try again after a
// timeout whose insert landed must not save the message twice.
const CID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const sendOnce = (content) => as(ADMIN, `INSERT INTO messages (chat_id, sender_id, content, client_id) VALUES ('${BANDCHAT}','${ADMIN}','${content}','${CID}')
  ON CONFLICT (sender_id, client_id) DO NOTHING RETURNING id`);
r0 = await sendOnce('client id test');
ok(!r0.error && r0.rows.length === 1, `first send saves it (${r0.error ?? r0.rows.length})`);
r0 = await sendOnce('client id test');
ok(!r0.error && r0.rows.length === 0, `Try again with the same client id saves nothing new (${r0.error ?? r0.rows.length})`);
ok(await count(`SELECT count(*)::int AS n FROM messages WHERE client_id = '${CID}'`) === 1, 'one copy');
r0 = await as(MEM, `INSERT INTO messages (chat_id, sender_id, content, client_id) VALUES ('${BANDCHAT}','${MEM}','same id, other sender','${CID}') ON CONFLICT (sender_id, client_id) DO NOTHING RETURNING id`);
ok(!r0.error && r0.rows.length === 1, `another sender's id never collides (${r0.error ?? r0.rows.length})`);
r0 = await as(ADMIN, `INSERT INTO messages (chat_id, sender_id, content) VALUES ('${BANDCHAT}','${ADMIN}','older build'), ('${BANDCHAT}','${ADMIN}','older build')`);
ok(!r0.error, `older builds (no client id) insert as before (${r0.error ?? 'ok'})`);
await db.exec(`DELETE FROM messages WHERE content IN ('client id test', 'same id, other sender', 'older build')`);

// ── 192 · orphans from before
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE body IN ('old secret','older secret')`) === 0,
  'previews of messages deleted earlier are gone');
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE data->>'chat_id' = '${OTHERCHAT}'`) === 1,
  'an older preview of a message that still exists stays');
// Codex #291 r3 (main's rule): an older notice stays only if it matches a live
// message as it reads now. "see you at 9" was edited to "nine": the notice
// shows text the chat no longer has, so it goes (losing an old notice is
// harmless; showing deleted text is not).
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE body = 'see you at 9'`) === 0,
  'the backfill drops an older notice that matches no live message as it reads now (edited)');

// ── 192 · Delete chat (direct): both people's history and the previews go
// Codex #291 r3: a DM notice whose text matches no message (edited since,
// another preview format) went unnoticed: deleting the DM takes every one.
await db.exec(`INSERT INTO notifications (user_id, type, title, body, data, action_url, created_at) VALUES
  ('${LINE}','chat_message','Ava Admin','see you at 7 instead', jsonb_build_object('chat_id','${DM}','content','see you at 7 instead'), '/chat/${DM}', now() - interval '100 minutes'),
  ('${LINE}','chat_mention','Ava Admin mentioned you','Leo, bring the cables', jsonb_build_object('chatId','${DM}','content','Leo, bring the cables'), '/chat/${DM}', now() - interval '3 days')`);
r = await as(LINE, `SELECT public.bw_delete_chat_history('${DM}') AS n`);
ok(!r.error && r.rows[0].n === 2, `delete chat removed the DM (${r.error ?? r.rows[0].n})`);
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE data->>'chat_id' = '${DM}' OR data->>'chatId' = '${DM}'`) === 0,
  'no notification keeps the deleted DM text (short by message_id, long by preview)');
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE body LIKE '%Brooklyn Bowl%' OR data::text LIKE '%see you at 8%' AND data->>'chat_id' = '${DM}'`) === 0,
  'the preview text is not stored anywhere for that chat');
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE data->>'chat_id' = '${OTHERCHAT}'`) === 1,
  'the same words in another chat keep their notification');

// ── 192 · Band chat: only the caller's messages, only their previews
r = await as(MEM, `SELECT public.bw_delete_chat_history('${BANDCHAT}') AS n`);
ok(!r.error && r.rows[0].n === 1, `band chat: own message deleted (${r.error ?? r.rows[0].n})`);
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE type = 'chat_mention' AND data->>'chat_id' = '${BANDCHAT}'`) === 0,
  "the deleted band message's mention preview is gone (older row, no message_id)");
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE data->>'message_id' = '${M_BAND_LINE}'`) === 1,
  "someone else's band message keeps its notification");
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE type = 'event_update'`) === 1, 'other notifications untouched');

// ── 192 round 2 (Codex + Claude review #291)
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE data->>'chat_id' = '${TWINCHAT}' AND body LIKE 'xxx%'`) === 1,
  'emoji: an older preview cut at 120 UTF-16 units is recognised (kept while the message exists)');
r = await db.query(`SELECT public.bw_chat_preview($1) AS p`, [EMOJI]);
ok(r.rows[0].p === preview(EMOJI), `bw_chat_preview cuts like the app (${[...r.rows[0].p].length} code points)`);
await db.exec(`DELETE FROM messages WHERE id = '${M_EMOJI}'`);
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE data->>'chat_id' = '${TWINCHAT}' AND body LIKE 'xxx%'`) === 0,
  'and goes with the message');
await db.exec(`DELETE FROM messages WHERE id = '${M_OK1}'`);
r = await db.query(`SELECT data->>'tag' AS tag FROM notifications WHERE data->>'chat_id' = '${TWINCHAT}' AND body = 'OK'`);
ok(r.rows.length === 1 && r.rows[0].tag === 'ok-2', `deleting the first "OK" keeps the second one's notice (${JSON.stringify(r.rows)})`);
await db.exec(`UPDATE messages SET deleted = true, deleted_at = now() WHERE id = '${M_SOFT}'`);
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE data->>'message_id' = '${M_SOFT}'`) === 0,
  'a message marked deleted takes its notice with it');
// Codex #291 r3: two "Yes"s seconds apart; deleting the second keeps the first one's notice.
await db.exec(`DELETE FROM messages WHERE id = '${M_YES2}'`);
r = await db.query(`SELECT data->>'tag' AS tag FROM notifications WHERE data->>'chat_id' = '${TWINCHAT}' AND body = 'Yes'`);
ok(r.rows.length === 1 && r.rows[0].tag === 'yes-1', `deleting the second "Yes" keeps the first one's notice (${JSON.stringify(r.rows)})`);
// Codex #291 r4 (192:159): a message edited after the migration, then
// deleted: its older notice still showed the first text (matched nothing).
// Every delete applies the backfill rule to the chat.
const M_EDIT2 = id(56);
await db.exec(`INSERT INTO messages (id, chat_id, sender_id, content, created_at) VALUES ('${M_EDIT2}','${TWINCHAT}','${MEM}','meet at 6', now() - interval '2 minutes');
  INSERT INTO notifications (user_id, type, title, body, data, action_url, created_at) VALUES
  ('${ADMIN}','chat_message','Mia Member','meet at 6', jsonb_build_object('chat_id','${TWINCHAT}','content','meet at 6'), '/chat/${TWINCHAT}', now() - interval '2 minutes' + interval '1 second');
  UPDATE messages SET content = 'meet at 7', edited = true WHERE id = '${M_EDIT2}';`);
const othersBefore = await count(`SELECT count(*)::int AS n FROM notifications WHERE data->>'chat_id' = '${TWINCHAT}' AND body <> 'meet at 6'`);
await db.exec(`DELETE FROM messages WHERE id = '${M_EDIT2}'`);
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE body = 'meet at 6'`) === 0,
  'edited, then deleted: the older notice with its first text goes too');
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE data->>'chat_id' = '${TWINCHAT}' AND body <> 'meet at 6'`) === othersBefore,
  `the chat's other notices (live messages) stay (${othersBefore})`);
r = await db.query(`SELECT data->>'tag' AS tag FROM notifications WHERE data->>'chat_id' = '${TWINCHAT}' AND body = 'Yes'`);
ok(r.rows.length === 1 && r.rows[0].tag === 'yes-1', `the other "Yes" keeps its notice (${JSON.stringify(r.rows)})`);
// (A notice for a message deleted before it is written: 194's bw_write_chat_notices, tested with 194.)

// ── 193 · a band admin outside the lineup finds the gig chat
r = await as(LINE, `INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${EVCHAT}','event','Rooftop Session','${BAND}','${GIG}','${LINE}')`);
ok(!r.error, `lineup member starts the gig chat (${r.error ?? 'ok'})`);
r = await as(LINE, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT}','${LINE}')`);
r = await as(ADMIN, `SELECT id FROM chats WHERE type = 'event' AND event_id = '${GIG}'`);
ok(r.rows.length === 1 && r.rows[0].id === EVCHAT, `older app build: the admin's lookup finds the existing gig chat (${r.rows.length})`);
r = await as(ADMIN, `SELECT public.bw_open_group_chat('event', '${BAND}', '${GIG}', 'Rooftop Session') AS c`);
ok(!r.error && r.rows[0].c.id === EVCHAT && r.rows[0].c.created === false, `get-or-join returns that chat (${r.error ?? JSON.stringify(r.rows[0]?.c?.id)})`);
r = await as(ADMIN, `SELECT content FROM messages WHERE chat_id = '${EVCHAT}'`);
ok(!r.error, 'and the admin is now in it');
ok(await count(`SELECT count(*)::int AS n FROM chat_participants WHERE chat_id = '${EVCHAT}' AND user_id = '${ADMIN}'`) === 1, 'admin joined once');
r = await as(ADMIN, `INSERT INTO chats (type, name, band_id, event_id, created_by) VALUES ('event','Rooftop Session','${BAND}','${GIG}','${ADMIN}')`);
ok(!!r.error, `a second chat for the same gig is refused (${r.error ? 'refused' : 'inserted'})`);
ok(await count(`SELECT count(*)::int AS n FROM chats WHERE type = 'event' AND event_id = '${GIG}'`) === 1, 'still one chat for the gig');

// Codex #291 r3 (193:52): Eli left the band but is still on the gig's lineup.
// Sending to the gig chat restores the lineup (older builds: every row in one
// upsert): Eli's row is skipped, the others go in, nothing errors.
r = await as(LINE, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT}','${LINE}'),('${EVCHAT}','${EX}') ON CONFLICT (chat_id, user_id) DO NOTHING`);
ok(!r.error, `lineup restore with a former member does not fail (${r.error ?? 'ok'})`);
ok(await count(`SELECT count(*)::int AS n FROM chat_participants WHERE chat_id = '${EVCHAT}' AND user_id = '${EX}'`) === 0,
  'a former member still on the lineup is not brought back into the gig chat');
r = await as(EX, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT}','${EX}') ON CONFLICT (chat_id, user_id) DO NOTHING`);
ok(await count(`SELECT count(*)::int AS n FROM chat_participants WHERE chat_id = '${EVCHAT}' AND user_id = '${EX}'`) === 0,
  'nor can they add themselves');
r = await as(EX, `SELECT content FROM messages WHERE chat_id = '${EVCHAT}'`);
ok(r.rows.length === 0, `so they read nothing in it (${r.rows.length})`);
r = await as(ADMIN, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${BANDCHAT}','${EX}') ON CONFLICT (chat_id, user_id) DO NOTHING`);
ok(await count(`SELECT count(*)::int AS n FROM chat_participants WHERE chat_id = '${BANDCHAT}' AND user_id = '${EX}'`) === 0,
  'band chat: a former member is not restored either');

// Claude review #291: an older build of someone who may not join (Eli left
// the band) finds nothing and inserts: a clear refusal, not a raw 23505.
r = await as(EX, `INSERT INTO chats (type, name, band_id, event_id, created_by) VALUES ('event','Rooftop Session',NULL,'${GIG}','${EX}')`);
ok(!!r.error && /already has a chat/.test(r.error), `older build, duplicate gig chat: clear message (${r.error})`);
await db.exec(`UPDATE profiles SET preferred_language = 'it' WHERE id = '${EX}'`);
r = await as(EX, `INSERT INTO chats (type, name, band_id, event_id, created_by) VALUES ('event','Rooftop Session',NULL,'${GIG}','${EX}')`);
ok(!!r.error && /ha già una chat/.test(r.error), `in their language (${r.error})`);

// Claude review #291 r4: bw_chat_joinable answers about others only for the
// band's admins (it must not tell a member who may join which gig chat).
r = await as(MEM, `SELECT public.bw_chat_joinable('event', '${BAND}', '${GIG}', '${LINE}') AS j`);
ok(!r.error && r.rows[0].j === false, `a member asking about someone else gets no answer (${r.error ?? r.rows[0].j})`);
r = await as(LINE, `SELECT public.bw_chat_joinable('event', '${BAND}', '${GIG}', '${LINE}') AS j`);
ok(!r.error && r.rows[0].j === true, `about themselves: yes (${r.error ?? r.rows[0].j})`);
r = await as(ADMIN, `SELECT public.bw_chat_joinable('event', '${BAND}', '${GIG}', '${LINE}') AS j`);
ok(!r.error && r.rows[0].j === true, `the band's admin may ask about a member (${r.error ?? r.rows[0].j})`);
r = await as(ADMIN, `SELECT public.bw_chat_joinable('event', '${BAND}', '${GIG}', '${EX}') AS j`);
ok(!r.error && r.rows[0].j === false, `and gets the real answer (${r.error ?? r.rows[0].j})`);

// Not on the lineup, not an admin: cannot see or open it.
r = await as(MEM, `SELECT id FROM chats WHERE type = 'event' AND event_id = '${GIG}'`);
ok(r.rows.length === 0, `a member outside the lineup cannot see the gig chat (${r.rows.length})`);
r = await as(MEM, `SELECT public.bw_open_group_chat('event', '${BAND}', '${GIG}', 'x') AS c`);
ok(!!r.error && /not allowed/i.test(r.error), `and cannot open it (${r.error ?? 'opened'})`);
r = await as(FAN, `SELECT public.bw_open_group_chat('band', '${BAND}', NULL, 'x') AS c`);
ok(!!r.error, 'someone outside the band cannot open its band chat');
r = await as(MEM, `SELECT public.bw_open_group_chat('direct', NULL, NULL, 'x') AS c`);
ok(!!r.error, 'direct chats are not opened this way');

// A new member who never joined the band chat gets the existing one.
await db.exec(`INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${OUT}','member')`);
r = await as(OUT, `SELECT public.bw_open_group_chat('band', '${BAND}', NULL, 'Hudson Horns') AS c`);
ok(!r.error && r.rows[0].c.id === BANDCHAT, `new member: band chat found, not duplicated (${r.error ?? r.rows[0]?.c?.id})`);
// Their deleted history stays deleted when they open it again.
await db.exec(`UPDATE chat_participants SET cleared_at = now() WHERE chat_id = '${BANDCHAT}' AND user_id = '${OUT}'`);
await as(OUT, `SELECT public.bw_open_group_chat('band', '${BAND}', NULL, 'Hudson Horns') AS c`);
ok(await count(`SELECT count(*)::int AS n FROM chat_participants WHERE chat_id = '${BANDCHAT}' AND user_id = '${OUT}' AND cleared_at IS NOT NULL`) === 1,
  'opening again keeps cleared_at');

// No chat yet: created once, then found.
r = await as(LINE, `SELECT public.bw_open_group_chat('event', NULL, '${GIG2}', 'Jazz Brunch') AS c`);
const created = r.rows[0]?.c;
ok(!r.error && created?.created === true && created?.band_id === BAND, `first open creates the gig chat with the gig's band (${r.error ?? JSON.stringify(created)})`);
r = await as(ADMIN, `SELECT public.bw_open_group_chat('event', '${BAND}', '${GIG2}', 'Jazz Brunch') AS c`);
ok(!r.error && r.rows[0].c.id === created?.id && r.rows[0].c.created === false, 'the next open joins it');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
