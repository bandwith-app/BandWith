// Local check of migration 191 (stage clock topic) on top of 178 (date on
// hold, #294) without Docker: PGlite (Postgres in WebAssembly) with the same
// stand-ins and live functions as supabase/tests/date_on_hold.pglite.mjs
// (#294), whose boot is copied here. 178 hides a tentative quote from every
// member (lineup included) for the stage key and the stage topic; 191 must
// keep that, with or without 178 applied before it.
//
//   mkdir -p /tmp/pg191 && cd /tmp/pg191 && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/stage_topic_quote.pglite.mjs . && node stage_topic_quote.pglite.mjs <repo> <178 file>
//   node stage_topic_quote.pglite.mjs <repo> /dev/null    # 191 without 178 (111's rules)
//
// <178 file>: supabase/migrations/178_date_on_hold.sql from #294 (feat/date-on-hold).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const REPO = process.argv[2];
const MIG178 = process.argv[3];
const MIG191 = process.argv[4] ?? `${REPO}/supabase/migrations/191_stage_clock_topic.sql`;
const with178 = MIG178 && MIG178 !== '/dev/null';
const migFile = (n) => readFileSync(`${REPO}/supabase/migrations/${n}`, 'utf8');
const lines = (n, a, b) => migFile(n).split('\n').slice(a - 1, b).join('\n');

const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, ADMIN, LINEUP, OFF, EX] = [1, 2, 3, 4, 5].map(id);
const [GIG, QUOTE] = [30, 31].map(id);
const claims = (uid) => JSON.stringify({ sub: uid, role: 'authenticated' });
/** One value of `sql`, run as `uid` (authenticated); { v } or { error }. */
async function as(uid, sql) {
  try {
    await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '${claims(uid)}', true);`);
    const r = await db.query(sql);
    await db.exec('COMMIT');
    return { v: Object.values(r.rows[0] ?? {})[0] };
  } catch (e) {
    await db.exec('ROLLBACK');
    return { error: e.message };
  }
}

async function boot(d) {
await d.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA vault; CREATE SCHEMA cron; CREATE SCHEMA net; CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt() TO authenticated, anon;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('bw_project_url', 'https://x.supabase.co'), ('bw_push_dispatch_secret', 's3cret');
CREATE TABLE net.calls (id serial, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) RETURNS bigint
  LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id $$;
CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job VALUES (n, s, c) RETURNING 1::bigint $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
CREATE TYPE user_role AS ENUM ('admin', 'member');

CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, full_name text, preferred_language text, notification_preferences jsonb);
CREATE TABLE public.bands (id uuid PRIMARY KEY, name text);
CREATE TABLE public.band_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, user_id uuid, role user_role,
  is_active boolean DEFAULT true, left_at timestamptz);
CREATE TABLE public.quotes (id uuid PRIMARY KEY, band_id uuid, created_by uuid, client_name text, total numeric,
  status text DEFAULT 'draft', valid_until date, converted_to_event_id uuid, quote_number text,
  event_date date, event_time_start time, event_time_end time, created_at timestamptz DEFAULT now());
CREATE TABLE public.quote_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid, band_id uuid, status text DEFAULT 'draft');
CREATE TABLE public.events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, title text, status text, event_type text,
  quote_id uuid, created_by uuid, event_date date, "date" date, start_time time, end_time time, load_in_time time,
  soundcheck_time time, venue text, venue_name text, venue_address text, venue_city text, setlist_id uuid,
  fee numeric, client_name text, notes text, updated_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(),
  "time" time, duration_hours numeric);
CREATE TABLE public.event_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid, status text, fee numeric, paid_at timestamptz, role text, notes text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, band_id uuid, type text,
  title text, body text, data jsonb, read boolean DEFAULT false, reference_id uuid, reference_type text, created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE public.chats (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text, name text, band_id uuid, event_id uuid,
  created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.chat_participants (id uuid DEFAULT gen_random_uuid(), chat_id uuid, user_id uuid, last_read_at timestamptz,
  muted boolean DEFAULT false, joined_at timestamptz DEFAULT now(), cleared_at timestamptz, UNIQUE (chat_id, user_id));
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chat_id uuid, sender_id uuid, content text,
  created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE public.setlists (id uuid PRIMARY KEY, band_id uuid, name text, is_template boolean DEFAULT false);
CREATE TABLE public.song_proposals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, event_id uuid, title text, proposed_by uuid);
CREATE TABLE public.quote_musicians (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid, user_id uuid, fee numeric);
CREATE TABLE public.band_deputies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, name text);
CREATE TABLE public.deputy_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, event_id uuid, deputy_id uuid,
  deputy_name text, status text DEFAULT 'pending');
CREATE TABLE public.contracts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, event_id uuid, type text, title text,
  version int DEFAULT 1, status text, sent_at timestamptz, viewed_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.event_stage (event_id uuid PRIMARY KEY, band_id uuid, plot jsonb);
CREATE TABLE public.event_gear_kits (event_id uuid, kit_id uuid, band_id uuid);
CREATE TABLE public.stage_keys (event_id uuid PRIMARY KEY, key text);
CREATE TABLE public.setlist_songs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), setlist_id uuid, song_id uuid, position int);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_stage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_gear_kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.setlist_songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.song_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_musicians ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.setlists, public.setlist_songs, public.quote_musicians TO authenticated;
GRANT SELECT, INSERT ON public.song_proposals TO authenticated;
GRANT SELECT ON public.events, public.band_members, public.bands, public.profiles TO authenticated;
GRANT SELECT (id, event_id, user_id, status, role, notes), UPDATE (status) ON public.event_members TO authenticated;
GRANT SELECT, INSERT ON public.notifications, public.chats, public.chat_participants, public.messages TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO service_role;
GRANT SELECT ON public.event_stage, public.event_gear_kits TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

CREATE FUNCTION public.bw_is_band_admin(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND role = 'admin' AND COALESCE(is_active, true)); $f$;
CREATE FUNCTION public.bw_is_band_member(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND COALESCE(is_active, true)); $f$;
CREATE FUNCTION public.bw_my_chat_ids() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT coalesce(array_agg(chat_id), '{}') FROM chat_participants WHERE user_id = auth.uid(); $f$;
CREATE FUNCTION public.bw_trg_dispatch_push() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;
CREATE TRIGGER bw_notifications_dispatch_push AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.bw_trg_dispatch_push();
`);

// Live helpers and functions, from the migrations that define them.
await d.exec(lines('046_server_notifications_and_push.sql', 47, 101)); // bw_notify, bw_active_band_member_ids
await d.exec(lines('046_server_notifications_and_push.sql', 128, 138)); // bw_display_name
await d.exec(lines('088_deputy_push_i18n.sql', 18, 44)); // bw_i18n_short_date
await d.exec(lines('073_baseline_live_policies.sql', 71, 85)); // bw_can_manage_event
await d.exec(lines('073_baseline_live_policies.sql', 197, 216)); // bw_is_event_participant
await d.exec(lines('071_member_permissions.sql', 221, 238)); // bw_event_member_money
await d.exec(lines('093_rider_seen_member_paid.sql', 142, 160)); // bw_event_rider
await d.exec(lines('087_stage_keys.sql', 22, 58)); // bw_stage_key
await d.exec(lines('085_stage_live_channel.sql', 13, 39)); // bw_stage_topic_allowed
await d.exec(lines('170_live_pack.sql', 157, 175)); // bw_live_pack_window_events
await d.exec(migFile('111_quote_events_private.sql')); // events read, bw_can_view_event, bw_trg_event_changed
await d.exec(lines('042_security_hardening.sql', 103, 146)); // bw_can_add_chat_participant
await d.exec(lines('042_security_hardening.sql', 225, 272)); // get_user_chats
await d.exec(lines('083_member_stats_rpc.sql', 15, 86)); // bw_member_stats
await d.exec(lines('095_band_free_slots.sql', 23, 145)); // bw_band_free_slots
await d.exec(lines('086_deputy_in_app.sql', 42, 103)); // bw_deputy_notify
await d.exec(lines('086_deputy_in_app.sql', 109, 202)); // bw_deputy_request_open, bw_deputy_request_ping
await d.exec(`
CREATE TRIGGER bw_event_changed_notify AFTER UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.bw_trg_event_changed();
CREATE TRIGGER bw_event_deleted_notify AFTER DELETE ON public.events FOR EACH ROW EXECUTE FUNCTION public.bw_trg_event_changed();
-- Live policies (073, 092, 094).
CREATE POLICY event_members_select ON public.event_members FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR bw_can_view_event(event_id));
CREATE POLICY event_members_update_own ON public.event_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY event_stage_select ON public.event_stage FOR SELECT TO authenticated USING (public.bw_is_band_member(band_id));
CREATE POLICY "Band members can view gig kits" ON public.event_gear_kits FOR SELECT TO authenticated USING (public.bw_is_band_member(band_id));
CREATE POLICY chats_select_participant ON public.chats FOR SELECT TO authenticated USING (id = ANY (bw_my_chat_ids()));
CREATE POLICY chats_select_creator ON public.chats FOR SELECT TO authenticated USING (created_by = auth.uid());
CREATE POLICY chat_participants_select_own ON public.chat_participants FOR SELECT USING (user_id = auth.uid());
CREATE POLICY messages_select_participant ON public.messages FOR SELECT TO authenticated USING (chat_id = ANY (bw_my_chat_ids()));
CREATE POLICY messages_insert_participant ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND chat_id = ANY (bw_my_chat_ids()));
CREATE POLICY chat_participants_insert ON public.chat_participants FOR INSERT TO authenticated
  WITH CHECK (public.bw_can_add_chat_participant(chat_id, user_id));
-- 074 setlists read, 118 song proposals, 073 quote_musicians.
CREATE POLICY setlists_select ON public.setlists FOR SELECT TO authenticated USING (public.bw_is_band_member(band_id));
CREATE POLICY setlist_songs_select ON public.setlist_songs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.setlists s WHERE s.id = setlist_songs.setlist_id AND public.bw_is_band_member(s.band_id)));
CREATE POLICY "Band members can manage proposals" ON public.song_proposals FOR ALL TO authenticated
  USING (public.bw_is_band_member(band_id)) WITH CHECK (public.bw_is_band_member(band_id));
CREATE POLICY "Band members can view quote musicians" ON public.quote_musicians FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
-- The app writes notices for other members (bw_can_notify in prod: an admin may write to any member).
CREATE POLICY notifications_insert_admin ON public.notifications FOR INSERT TO authenticated WITH CHECK (public.bw_is_band_admin(band_id));
`);

}

await boot(db);
// Realtime, as far as 191's policies need it.
await db.exec(`
CREATE SCHEMA realtime;
CREATE TABLE realtime.messages (topic text, extension text, event text, payload jsonb);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic', true) $$;
`);

// A band: an admin, a member on the quote's lineup, one off it, an ex-member.
// A confirmed gig everyone plays, and a tentative quote gig (111: a quote).
await db.exec(`
INSERT INTO auth.users (id) SELECT unnest(ARRAY['${ADMIN}','${LINEUP}','${OFF}','${EX}']::uuid[]);
INSERT INTO bands VALUES ('${BAND}', 'Hudson Strings');
INSERT INTO band_members (band_id, user_id, role, is_active) VALUES ('${BAND}','${ADMIN}','admin',true),
  ('${BAND}','${LINEUP}','member',true), ('${BAND}','${OFF}','member',true), ('${BAND}','${EX}','member',false);
INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date)
VALUES ('${GIG}','${BAND}','Rooftop Session','confirmed','gig','${ADMIN}', current_date + 3),
       ('${QUOTE}','${BAND}','Lee Wedding','tentative','gig','${ADMIN}', current_date + 9);
INSERT INTO event_members (event_id, user_id, status) VALUES ('${GIG}','${LINEUP}','confirmed'), ('${GIG}','${OFF}','confirmed'),
  ('${QUOTE}','${LINEUP}','confirmed');
`);

// Keys handed out before 191 (kept on phones).
await db.exec(`INSERT INTO stage_keys (event_id, key) VALUES ('${GIG}', 'old-gig'), ('${QUOTE}', 'old-quote')`);
const keyOf = async (ev) => (await db.query(`SELECT key FROM stage_keys WHERE event_id = '${ev}'`)).rows[0]?.key;

if (with178) {
  try {
    await db.exec(readFileSync(MIG178, 'utf8'));
    ok(true, '178 applies');
  } catch (e) {
    ok(false, `178 applies: ${e.message}`);
  }
}
try {
  const mig = readFileSync(MIG191, 'utf8');
  await db.exec(mig);
  await db.exec(mig);
  ok(true, '191 runs twice');
} catch (e) {
  ok(false, `191 runs twice: ${e.message}`);
}

const key = (ev) => `SELECT public.bw_stage_key('${ev}') IS NOT NULL`;
const topic = (ev, lead = false) => `SELECT public.bw_stage_topic_allowed('stage:event:${ev}', ${lead})`;
const clock = (ev) => `SELECT public.bw_stage_clock_topic_allowed('stage-clock:event:${ev}')`;
const is = async (uid, sql, want, msg) => {
  const r = await as(uid, sql);
  ok(!r.error && r.v === want, `${msg}${r.error ? ` (error: ${r.error})` : r.v !== want ? ` (got ${r.v})` : ''}`);
};

// A normal gig stays open to the band, and closed to ex-members.
for (const [uid, who] of [[ADMIN, 'admin'], [LINEUP, 'lineup member'], [OFF, 'member']]) {
  await is(uid, key(GIG), true, `gig: ${who} gets the band key`);
  await is(uid, topic(GIG), true, `gig: ${who} may join the stage topic`);
  await is(uid, clock(GIG), true, `gig: ${who} may join the clock topic`);
}
await is(ADMIN, topic(GIG, true), true, 'gig: the admin may lead');
await is(LINEUP, topic(GIG, true), false, 'gig: a member may not lead');
for (const sql of [key(GIG), topic(GIG), clock(GIG)]) await is(EX, sql, false, `gig: the ex-member is refused (${sql.slice(14, 50)})`);

// The quote: admins only once 178 is in (lineup included); 111's rule without it.
await is(ADMIN, key(QUOTE), true, 'quote: the admin gets the band key');
await is(ADMIN, topic(QUOTE, true), true, 'quote: the admin may lead');
for (const sql of [key(QUOTE), topic(QUOTE), clock(QUOTE)]) {
  await is(LINEUP, sql, !with178, `quote: the lineup member is ${with178 ? 'refused (178)' : 'let in (111, no 178)'} (${sql.slice(14, 50)})`);
  await is(OFF, sql, false, `quote: a member off the lineup is refused (${sql.slice(14, 50)})`);
}

// Not a UUID: a plain no, not an error.
await is(ADMIN, `SELECT public.bw_stage_topic_allowed('stage:event:${'-'.repeat(36)}', false)`, false, '36 dashes: a plain no');

// A kept key stops working for whoever may no longer see the gig (Codex):
// 191 changed the quote's key once, and changes it again on the triggers.
ok((await keyOf(QUOTE)) !== 'old-quote', "191: a quote gig's key handed out before is changed");
ok((await keyOf(GIG)) === 'old-gig', "191: a normal gig's key is kept (released apps keep working)");
let before = await keyOf(QUOTE);
await db.exec(`DELETE FROM event_members WHERE event_id = '${QUOTE}' AND user_id = '${LINEUP}'`);
ok((await keyOf(QUOTE)) !== before, "quote: a member taken off the lineup: a new key");
before = await keyOf(GIG);
await db.exec(`DELETE FROM event_members WHERE event_id = '${GIG}' AND user_id = '${OFF}'`);
ok((await keyOf(GIG)) === before, 'gig: a lineup change on a normal gig keeps the key');
await db.exec(`UPDATE events SET notes = 'load in 6pm' WHERE id = '${GIG}'`);
ok((await keyOf(GIG)) === before, 'gig: any other edit keeps the key');
await db.exec(`UPDATE events SET status = 'tentative' WHERE id = '${GIG}'`);
ok((await keyOf(GIG)) !== before, 'gig turned back into a quote: a new key');
before = await keyOf(GIG);
await db.exec(`UPDATE events SET status = 'confirmed' WHERE id = '${GIG}'`);
ok((await keyOf(GIG)) === before, 'quote confirmed: the key is kept');
await db.exec(`INSERT INTO bands VALUES ('${id(9)}', 'Other band')`);
await db.exec(`UPDATE events SET band_id = '${id(9)}' WHERE id = '${GIG}'`);
ok((await keyOf(GIG)) !== before, 'gig moved to another band: a new key');
await is(ADMIN, `SELECT has_function_privilege('public.bw_stage_new_band_key(uuid)', 'EXECUTE')`, false, 'clients cannot change a key themselves');

// 178's own rule is spelled out in 191's functions, not only inherited through bw_can_view_event.
if (with178) {
  const defs = (await db.query(`SELECT string_agg(pg_get_functiondef(p.oid), ' ') d FROM pg_proc p
    WHERE p.proname IN ('bw_stage_key', 'bw_stage_topic_allowed', 'bw_stage_clock_topic_allowed')`)).rows[0].d;
  ok((defs.match(/bw_event_quote_hidden/g) ?? []).length >= 3, "the stage key, stage topic and clock topic each check bw_event_quote_hidden (178's rule)");
}

console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
