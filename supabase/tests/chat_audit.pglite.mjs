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
const [BAND, OTHERBAND, ADMIN, LINE, MEM, OUT, FAN] = [1, 2, 3, 4, 5, 6, 7].map(id);
const [DM, BANDCHAT, EVCHAT, DUP_OLD, DUP_NEW, OTHERCHAT] = [20, 21, 22, 23, 24, 25].map(id);
const [GIG, GIG2] = [30, 31].map(id);
const [M_SHORT, M_LONG, M_BAND_LINE, M_BAND_MEM, M_OTHER, M_GONE, M_DUP_OLD, M_DUP_NEW] = [40, 41, 42, 43, 44, 45, 46, 47].map(id);

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

CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text);
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
  created_at timestamptz DEFAULT now());
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
const LONG = 'Load-in moved to 5:30 at the Brooklyn Bowl side door, bring the second amp and the long XLR cables, parking is on Wythe Ave, see you there';
await db.exec(`
INSERT INTO profiles (id, full_name) VALUES ('${ADMIN}','Ava Admin'),('${LINE}','Leo Line'),('${MEM}','Mia Member'),('${OUT}','Oscar Out'),('${FAN}','Fay Fan');
INSERT INTO bands VALUES ('${BAND}','Hudson Horns'),('${OTHERBAND}','Queens Quartet');
INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${ADMIN}','admin'),('${BAND}','${LINE}','member'),
  ('${BAND}','${MEM}','member'),('${OTHERBAND}','${MEM}','member'),('${OTHERBAND}','${LINE}','member');
INSERT INTO events (id, band_id, title, created_by) VALUES ('${GIG}','${BAND}','Rooftop Session','${ADMIN}'),('${GIG2}','${BAND}','Jazz Brunch','${ADMIN}');
INSERT INTO event_members VALUES ('${GIG}','${LINE}','confirmed'),('${GIG2}','${LINE}','confirmed');

INSERT INTO chats (id, type, name, band_id, event_id, created_by, created_at) VALUES
  ('${DM}','direct',NULL,NULL,NULL,'${ADMIN}', now() - interval '3 days'),
  ('${BANDCHAT}','band','Hudson Horns','${BAND}',NULL,'${ADMIN}', now() - interval '3 days'),
  ('${OTHERCHAT}','direct',NULL,NULL,NULL,'${MEM}', now() - interval '3 days'),
  -- Two band chats for the same band, from before this fix.
  ('${DUP_OLD}','band','Queens Quartet','${OTHERBAND}',NULL,'${MEM}', now() - interval '2 days'),
  ('${DUP_NEW}','band','Queens Quartet','${OTHERBAND}',NULL,'${LINE}', now() - interval '1 day');
INSERT INTO chat_participants (chat_id, user_id, cleared_at) VALUES
  ('${DM}','${ADMIN}',NULL),('${DM}','${LINE}',NULL),
  ('${BANDCHAT}','${ADMIN}',NULL),('${BANDCHAT}','${LINE}',NULL),('${BANDCHAT}','${MEM}',NULL),
  ('${OTHERCHAT}','${MEM}',NULL),('${OTHERCHAT}','${ADMIN}',NULL),
  ('${DUP_OLD}','${MEM}',NULL),('${DUP_NEW}','${LINE}',NULL),('${DUP_NEW}','${MEM}', now() - interval '12 hours');
INSERT INTO messages (id, chat_id, sender_id, content, created_at) VALUES
  ('${M_SHORT}','${DM}','${ADMIN}','see you at 8', now() - interval '2 hours'),
  ('${M_LONG}','${DM}','${ADMIN}',$t$${LONG}$t$, now() - interval '90 minutes'),
  ('${M_BAND_LINE}','${BANDCHAT}','${LINE}','set list is up', now() - interval '80 minutes'),
  ('${M_BAND_MEM}','${BANDCHAT}','${MEM}','running late', now() - interval '70 minutes'),
  ('${M_OTHER}','${OTHERCHAT}','${MEM}','see you at 8', now() - interval '60 minutes'),
  ('${M_DUP_OLD}','${DUP_OLD}','${MEM}','first thread', now() - interval '40 hours'),
  ('${M_DUP_NEW}','${DUP_NEW}','${LINE}','second thread', now() - interval '20 hours');
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
    jsonb_build_object('chat_id','${DUP_NEW}','message_id','${M_DUP_NEW}','content','second thread'), '/chat/${DUP_NEW}', now() - interval '20 hours');
`);

for (const m of MIGS) {
  await db.exec(readFileSync(m, 'utf8'));
  await db.exec(readFileSync(m, 'utf8')); // idempotent
}
ok(true, 'migrations run twice');

// ── 192 · orphans from before
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE body IN ('old secret','older secret')`) === 0,
  'previews of messages deleted earlier are gone');
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE data->>'chat_id' = '${OTHERCHAT}'`) === 1,
  'an older preview of a message that still exists stays');

// ── 192 · Delete chat (direct): both people's history and the previews go
let r = await as(LINE, `SELECT public.bw_delete_chat_history('${DM}') AS n`);
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

// ── 193 · duplicates from before are merged into the oldest chat
ok(await count(`SELECT count(*)::int AS n FROM chats WHERE type = 'band' AND band_id = '${OTHERBAND}'`) === 1,
  'one band chat left for the band that had two');
ok(await count(`SELECT count(*)::int AS n FROM messages WHERE chat_id = '${DUP_OLD}'`) === 2,
  'messages of the newer chat moved into the oldest one');
r = await db.query(`SELECT user_id, cleared_at FROM chat_participants WHERE chat_id = '${DUP_OLD}' ORDER BY user_id`);
ok(r.rows.length === 2 && r.rows.find((x) => x.user_id === MEM)?.cleared_at, `participants merged, deleted history stays deleted (${JSON.stringify(r.rows.map((x) => x.user_id))})`);
ok(await count(`SELECT count(*)::int AS n FROM notifications WHERE data->>'chat_id' = '${DUP_OLD}' AND action_url = '/chat/${DUP_OLD}'`) === 1,
  'its notifications open the merged chat');
ok(await count(`SELECT count(*)::int AS n FROM chat_merges_193 WHERE dup_chat_id = '${DUP_NEW}' AND '${M_DUP_NEW}' = ANY (message_ids)`) === 1,
  'merged chat archived (admin only) for a rollback');
r = await as(MEM, `SELECT count(*)::int AS n FROM chat_merges_193`);
ok(!!r.error, 'archive not readable by app users');
r = await db.query(`UPDATE messages SET chat_id = '${BANDCHAT}' WHERE id = '${M_DUP_OLD}'`).catch((e) => ({ error: e.message }));
ok(!!r.error, 'messages still cannot move chat after the merge (trigger back on)');

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
