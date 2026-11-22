// Local check of migration 178 (date on hold) without Docker: PGlite
// (Postgres in WebAssembly) with stand-ins for Supabase's auth / vault / cron /
// net, the live tables, and the live functions and policies loaded from the
// migrations that define them (046, 071, 073, 085, 087, 088, 092, 093, 094,
// 111, 170).
//
// Failing first: with /dev/null as the migration every defect shows up as
// FAIL; with 178 they all pass.
//
//   mkdir -p /tmp/pgB && cd /tmp/pgB && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/date_on_hold.pglite.mjs . && node date_on_hold.pglite.mjs <repo>
//   node date_on_hold.pglite.mjs <repo> /dev/null     # before: FAILs expected
//   MIG_175=<175> MIG_181=<181> MIG_193=<193> node date_on_hold.pglite.mjs <repo>   # + the real 175/181/193, all orders
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const REPO = process.argv[2];
const MIG = process.argv[3] ?? `${REPO}/supabase/migrations/178_date_on_hold.sql`;
const migFile = (n) => readFileSync(`${REPO}/supabase/migrations/${n}`, 'utf8');
const lines = (n, a, b) => migFile(n).split('\n').slice(a - 1, b).join('\n');

let db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
let passes = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else { passes++; console.log('ok  ', msg); } };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, ADMIN, ADMIN2, MEM, MEM2, OUT] = [1, 2, 3, 4, 5, 6].map(id);
const [GIG, QE0, QE, QE2, QE3, QE4, QE5] = [30, 31, 32, 33, 34, 35, 36].map(id);
const [Q, Q4, Q5] = [40, 44, 45].map(id);
const [EVCHAT, SL, SONG, QCHAT0, SL2, SL3, SL4] = [50, 60, 61, 53, 62, 63, 64].map(id);
const SECRETS = ['Smith', 'Jane', '4200', 'secret', 'Q-2026'];
const leaks = (v) => SECRETS.filter((s) => JSON.stringify(v).includes(s));

const claims = (uid) => JSON.stringify({ sub: uid, role: 'authenticated' });
// Run `sql` as `uid` (authenticated role) in a transaction; rows or the error.
async function as(uid, sql, params) {
  try {
    await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '${claims(uid)}', true);`);
    const r = await db.query(sql, params);
    await db.exec('COMMIT');
    return { rows: r.rows, n: r.affectedRows ?? r.rows.length };
  } catch (e) {
    await db.exec('ROLLBACK');
    return { error: e.message, rows: [], n: 0 };
  }
}
// The same, as the server would (RLS off) but with auth.uid() = uid: an
// admin's write going through the triggers.
async function asServer(uid, sql) {
  await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '${uid ? claims(uid) : ''}', true); ${sql}; COMMIT;`);
}
// A query as the database owner; { rows } or { error } (a missing function is a FAIL, not a crash).
const tryq = async (sql) => { try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { rows: [], error: e.message }; } };
const fnDef = async (name) => (await tryq(`SELECT string_agg(pg_get_functiondef(p.oid), ' ') d FROM pg_proc p WHERE p.proname = '${name}'`)).rows[0]?.d || '';
const notes = async (where = 'true') =>
  (await db.query(`SELECT user_id, type, title, body, data FROM notifications WHERE ${where} ORDER BY created_at, type`)).rows;

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
  "time" time, duration_hours numeric, recurrence_rule jsonb);
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

// ── Seed: a band, a confirmed gig, a quote event made before 178 ───────────
await db.exec(`
INSERT INTO auth.users (id) SELECT unnest(ARRAY['${ADMIN}','${ADMIN2}','${MEM}','${MEM2}','${OUT}']::uuid[]);
INSERT INTO profiles (id, full_name, preferred_language) VALUES
  ('${ADMIN}','Leo Admin','en'), ('${ADMIN2}','Ada Admin','en'), ('${MEM}','Marta Drums','it'),
  ('${MEM2}','Sam Guitar','en'), ('${OUT}','Out Sider','en');
INSERT INTO bands VALUES ('${BAND}', 'Velvet Static');
INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${ADMIN}','admin'), ('${BAND}','${ADMIN2}','admin'),
  ('${BAND}','${MEM}','member'), ('${BAND}','${MEM2}','member');
INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, start_time, venue_name, venue_city, fee)
VALUES ('${GIG}','${BAND}','Rooftop Session','confirmed','gig','${ADMIN}', current_date + 3, '21:00','The Loft','Brooklyn', 1800),
       ('${QE0}','${BAND}','Smith Wedding (old)','tentative','gig','${ADMIN}', current_date + 20, '18:00','Hotel Park','Jersey City', 4200);
INSERT INTO event_members (event_id, user_id, status, fee) VALUES ('${GIG}','${MEM}','confirmed', 250), ('${QE0}','${MEM}','pending', 300),
  ('${QE0}','${MEM2}','confirmed', 300);
-- A quote chat from before 178, with a member in it.
INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${QCHAT0}','event','Smith Wedding (old)','${BAND}','${QE0}','${ADMIN}');
INSERT INTO chat_participants (chat_id, user_id) VALUES ('${QCHAT0}','${ADMIN}'), ('${QCHAT0}','${MEM}');
INSERT INTO messages (chat_id, sender_id, content) VALUES ('${QCHAT0}','${ADMIN}','Jane Smith pays 4200');
-- An "Availability check" an older build wrote before 178.
INSERT INTO notifications (user_id, band_id, type, title, body, data, reference_id, reference_type) VALUES
  ('${MEM}','${BAND}','event_invite','Availability check: Smith Wedding (old)','Jane is quoting. Your fee: $300',
   jsonb_build_object('event_id','${QE0}','tentative',true), NULL, NULL),
  ('${MEM}','${BAND}','event_update','Gig updated','Rooftop Session moved', jsonb_build_object('event_id','${GIG}'), '${GIG}', 'event');
`);

// The case on prod (main, 11-22): a wedding converted from a draft quote,
// still tentative (111: a quote), quote_id NULL, a lineup of one admin and
// two members, all "confirmed". Its own band, so the rest of the file's
// counts don't move.
const [B2, B2ADM, W1, W2, WED, WQ] = [2210, 2211, 2212, 2213, 2215, 2216].map(id);
await db.exec(`
INSERT INTO auth.users (id) SELECT unnest(ARRAY['${B2ADM}','${W1}','${W2}']::uuid[]);
INSERT INTO profiles (id, full_name, preferred_language) VALUES ('${B2ADM}','Rita Lead','en'), ('${W1}','Dan Keys','en'),
  ('${W2}','Eve Bass','en');
INSERT INTO bands VALUES ('${B2}', 'Hudson Strings');
INSERT INTO band_members (band_id, user_id, role) VALUES ('${B2}','${B2ADM}','admin'), ('${B2}','${W1}','member'),
  ('${B2}','${W2}','member');
INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, start_time, venue_name, venue_city, fee, quote_id)
VALUES ('${WED}','${B2}','Lee Wedding','tentative','gig','${B2ADM}', current_date + 9, '17:00','Hoboken Pier','Hoboken', 5200, NULL);
INSERT INTO quotes (id, band_id, created_by, client_name, total, status, converted_to_event_id, created_at)
VALUES ('${WQ}','${B2}','${B2ADM}','Lee', 5200, 'draft', '${WED}', now() - interval '3 days');
INSERT INTO event_members (event_id, user_id, status, fee) VALUES ('${WED}','${B2ADM}','confirmed', 400),
  ('${WED}','${W1}','confirmed', 400), ('${WED}','${W2}','confirmed', 400);
INSERT INTO notifications (user_id, band_id, type, title, body, data, reference_id, reference_type) VALUES
  ('${W1}','${B2}','event_invite','Availability check: Lee Wedding','Your fee: $400', jsonb_build_object('event_id','${WED}'), '${WED}', 'event'),
  ('${W2}','${B2}','event_confirmed','You are on Lee Wedding','Your fee: $400', jsonb_build_object('event_id','${WED}'), '${WED}', 'event'),
  ('${W2}','${B2}','event_invite','Availability check: Lee Wedding','Your fee: $400', jsonb_build_object('event_id','${WED}'), NULL, NULL),
  ('${B2ADM}','${B2}','event_confirmed','You are on Lee Wedding','Your fee: $400', jsonb_build_object('event_id','${WED}'), '${WED}', 'event');
`);

// ── The migration, twice (idempotent) ──────────────────────────────────────
const mig = readFileSync(MIG, 'utf8');
try {
  await db.exec(mig);
  await db.exec(mig);
  ok(true, 'migration runs twice');
} catch (e) {
  await db.exec('ROLLBACK').catch(() => {});
  ok(false, `migration runs twice: ${e.message}`);
}

ok((await notes(`user_id = '${MEM}' AND data->>'event_id' = '${QE0}'`)).length === 0,
  'old "Availability check" in a member\'s inbox removed');
ok((await notes(`user_id = '${MEM}' AND data->>'event_id' = '${GIG}'`)).length === 1, 'notices about real gigs stay');
const seeded = await db.query(`SELECT 1 FROM event_date_holds WHERE event_id = '${QE0}'`).catch(() => ({ rows: [] }));
ok(seeded.rows.length === 1 && (await notes(`type = 'date_hold'`)).length === 0, 'a hold live today is known, not announced again');

// Round 2 (Claude B2): 178 is self-sufficient for chats, without 175 / send-push.
ok((await tryq(`SELECT 1 FROM chat_participants WHERE chat_id = '${QCHAT0}' AND user_id = '${MEM}'`)).rows.length === 0,
  'pre-178 quote chat: the member\'s participant row is removed');
ok((await tryq(`SELECT 1 FROM chat_participants_quote_178 WHERE chat_id = '${QCHAT0}' AND user_id = '${MEM}'`)).rows.length === 1,
  '... and archived');
ok((await tryq(`SELECT 1 FROM chat_participants WHERE chat_id = '${QCHAT0}' AND user_id = '${ADMIN}'`)).rows.length === 1, '... the admin stays');
{
  const gc = await as(MEM, `SELECT public.get_user_chats('${MEM}') j`);
  ok(!gc.error && !JSON.stringify(gc.rows[0]?.j ?? '').includes(QCHAT0), `get_user_chats: no quote chat for the member (${gc.error || ''})`);
  const ga = await as(ADMIN, `SELECT public.get_user_chats('${ADMIN}') j`);
  ok(JSON.stringify(ga.rows[0]?.j ?? '').includes(QCHAT0), 'get_user_chats: the admin still has it');
}
// Codex m1: old "Availability check" answers carried over.
const carried = await tryq(`SELECT answer FROM event_hold_answers WHERE event_id = '${QE0}' AND user_id = '${MEM2}'`);
ok(carried.rows[0]?.answer === 'free', `backfill: the member who said yes to the old check is "free" (${carried.error || carried.rows[0]?.answer})`);
ok((await tryq(`SELECT 1 FROM event_hold_answers WHERE event_id = '${QE0}' AND user_id = '${MEM}'`)).rows.length === 0,
  'backfill: a pending answer stays unanswered');

// The prod case: the hold exists, the two members' yeses carry over as
// "free" (admins aren't asked, so no answer row for the admin), nobody is
// asked again (not now, not by the sweep), and the members' old notices are
// archived for a rollback; the admin's stays.
{
  const W = [W1, W2].map((u) => `'${u}'`).join(',');
  const hold = await tryq(`SELECT announced_at IS NOT NULL a, released_at IS NULL live FROM event_date_holds WHERE event_id = '${WED}'`);
  const ans = await tryq(`SELECT string_agg(answer, ',' ORDER BY user_id) a, count(*)::int n, count(*) FILTER (WHERE user_id = '${B2ADM}')::int adm FROM event_hold_answers WHERE event_id = '${WED}'`);
  await db.exec(`SELECT public.bw_date_hold_sweep()`).catch(() => {});
  const asked = await tryq(`SELECT count(*)::int n FROM notifications WHERE user_id IN (${W}, '${B2ADM}') AND type LIKE 'date_hold%'`);
  const admNote = await tryq(`SELECT count(*)::int n FROM notifications WHERE user_id = '${B2ADM}' AND type = 'event_confirmed'`);
  const left = await tryq(`SELECT count(*)::int n FROM notifications WHERE user_id IN (${W}) AND type IN ('event_invite', 'event_confirmed')`);
  const archived = await tryq(`SELECT count(*)::int n FROM notifications_quote_178 WHERE user_id IN (${W}) AND row_data->>'type' IN ('event_invite', 'event_confirmed')`);
  ok(hold.rows[0]?.a === true && hold.rows[0]?.live === true, `prod case: the converted wedding has a live hold, known (${JSON.stringify(hold.rows[0] || hold.error)})`);
  ok(ans.rows[0]?.n === 2 && ans.rows[0]?.a === 'free,free' && ans.rows[0]?.adm === 0,
    `prod case: exactly the 2 members' yeses are "free", no answer row for the admin (${JSON.stringify(ans.rows[0] || ans.error)})`);
  ok(asked.rows[0]?.n === 0, `prod case: no hold notice to them, also after the sweep (${asked.rows[0]?.n})`);
  ok(left.rows[0]?.n === 0 && archived.rows[0]?.n === 3 && admNote.rows[0]?.n === 1,
    `prod case: the members' old invite/confirmed notices archived in notifications_quote_178, the admin's stays (left ${left.rows[0]?.n}, archived ${archived.rows[0]?.n}, admin ${admNote.rows[0]?.n})`);
}

// ── A new quote: the admin makes it, the band hears about a hold ───────────
await db.exec(`DELETE FROM notifications`);
// Codex m2 / Claude 6: the wizard saves the event first, then the quote.
const QEF = id(38);
await asServer(ADMIN, `INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, start_time, venue_name)
  VALUES ('${QEF}','${BAND}','Smith Failed','tentative','gig','${ADMIN}', current_date + 11, '20:00','Blue Note')`);
ok((await notes(`type LIKE 'date_hold%'`)).length === 0, 'event saved, quote not yet: no hold notice');
ok((await as(MEM, `SELECT * FROM public.bw_my_date_holds() WHERE event_id = '${QEF}'`)).rows.length === 0, '... and no hold card');
await asServer(ADMIN, `DELETE FROM events WHERE id = '${QEF}'`);
ok((await notes(`type LIKE 'date_hold%'`)).length === 0, 'the quote failed, the event is taken back: no hold, no "free again"');
await asServer(ADMIN, `
INSERT INTO setlists (id, band_id, name) VALUES ('${SL}','${BAND}','Smith Wedding set'), ('${SL2}','${BAND}','Rooftop set'),
  ('${SL3}','${BAND}','Standard set'), ('${SL4}','${BAND}','Wedding template');
UPDATE setlists SET is_template = true WHERE id = '${SL4}';
UPDATE events SET setlist_id = '${SL2}' WHERE id = '${GIG}';
INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, start_time, end_time, venue, venue_name,
  venue_address, venue_city, fee, client_name, notes, setlist_id)
VALUES ('${QE}','${BAND}','Smith Wedding','tentative','gig','${ADMIN}', current_date + 10, '20:00','23:00','Blue Note','Blue Note',
  '131 W 3rd St','New York', 4200, 'Jane Smith', 'secret notes', '${SL}');
INSERT INTO event_members (event_id, user_id, status, fee, notes) VALUES ('${QE}','${MEM}','pending', 300, 'secret notes');
`);
ok((await notes(`type = 'date_hold'`)).length === 0, 'quote event saved alone: still no hold notice');
await asServer(ADMIN, `
INSERT INTO quotes (id, band_id, created_by, client_name, total, status, valid_until, converted_to_event_id, quote_number)
VALUES ('${Q}','${BAND}','${ADMIN}','Jane Smith', 4200, 'sent', current_date + 30, '${QE}', 'Q-2026-0042');`);
// Codex round 3 (:1639): the app saves the quote, then its musicians (and
// deletes both if the second write fails): no hold until both are saved.
ok((await notes(`type = 'date_hold'`)).length === 0, 'quote saved, musicians not yet: still no hold notice');
await asServer(ADMIN, `
INSERT INTO quote_musicians (quote_id, user_id, fee) VALUES ('${Q}','${MEM}', 300);
INSERT INTO setlist_songs (setlist_id, song_id, position) VALUES ('${SL}','${SONG}',1);
INSERT INTO contracts (band_id, event_id, type, title, status) VALUES ('${BAND}','${QE}','rider','Smith Wedding rider','draft');
INSERT INTO event_stage VALUES ('${QE}','${BAND}','{"items":[]}');
INSERT INTO event_gear_kits VALUES ('${QE}', gen_random_uuid(), '${BAND}');
INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${EVCHAT}','event','Smith Wedding','${BAND}','${QE}','${ADMIN}');
INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EVCHAT}','${ADMIN}'), ('${EVCHAT}','${MEM}');
INSERT INTO messages (chat_id, sender_id, content) VALUES ('${EVCHAT}','${ADMIN}','Jane wants a longer set');
`);

const hold = await notes(`type = 'date_hold'`);
const holdTo = (u) => hold.find((n) => n.user_id === u);
ok(!!holdTo(MEM) && !!holdTo(MEM2), 'new quote: every member gets a hold notice');
ok(!holdTo(ADMIN) && !holdTo(ADMIN2), 'admins get no hold notice (the actor, and admins see the quote)');
ok(holdTo(MEM2)?.title === 'Possible gig – keep the date free', `English title: ${holdTo(MEM2)?.title}`);
ok(holdTo(MEM)?.title === 'Possibile gig – tieni libera la data', `Italian title: ${holdTo(MEM)?.title}`);
ok(/Blue Note, New York/.test(holdTo(MEM2)?.body || '') && /20:00–23:00/.test(holdTo(MEM2)?.body || ''),
  `body has day, time and place: ${holdTo(MEM2)?.body}`);
ok(leaks(hold).length === 0, `hold notice has no title, client, fee, notes or number (leaks: ${leaks(hold)})`);

// ── A member reads nothing of the quote ─────────────────────────────────────
for (const [who, name] of [[MEM, 'member on its lineup'], [MEM2, 'member not on it']]) {
  const r = await as(who, `SELECT * FROM events WHERE id = '${QE}'`);
  ok(!r.error && r.rows.length === 0, `${name}: no row of the quote in events`);
}
ok((await as(ADMIN, `SELECT title FROM events WHERE id = '${QE}'`)).rows[0]?.title === 'Smith Wedding', 'admin reads the quote');
ok((await as(MEM, `SELECT title FROM events WHERE id = '${GIG}'`)).rows.length === 1, 'member still reads the confirmed gig');
ok((await as(MEM, `SELECT * FROM event_members WHERE event_id = '${QE}'`)).rows.length === 0, 'member: not even their own lineup row of the quote');
ok((await as(MEM, `UPDATE event_members SET status = 'confirmed' WHERE event_id = '${QE}' AND user_id = '${MEM}'`)).n === 0,
  'member cannot answer the quote lineup row (old availability check)');
ok((await as(MEM, `SELECT * FROM public.bw_event_member_money(ARRAY['${QE}']::uuid[])`)).rows.length === 0, 'member: no fee of the quote');
ok((await as(MEM, `SELECT * FROM public.bw_event_member_money(NULL)`)).rows.every((r) => r.event_id !== QE), 'member: own money rows skip the quote');
ok((await as(MEM, `SELECT public.bw_can_view_event('${QE}') v`)).rows[0]?.v === false, 'bw_can_view_event: false for the member');
ok((await as(MEM, `SELECT * FROM public.bw_event_rider('${QE}')`)).rows.length === 0, 'member: no rider of the quote');
ok((await as(MEM, `SELECT * FROM event_stage WHERE event_id = '${QE}'`)).rows.length === 0, 'member: no stage plot of the quote');
ok((await as(MEM, `SELECT * FROM event_gear_kits WHERE event_id = '${QE}'`)).rows.length === 0, 'member: no gig kits of the quote');
ok((await as(MEM, `SELECT public.bw_stage_key('${QE}') k`)).rows[0]?.k == null, 'member: no live stage key for the quote');
ok((await as(MEM, `SELECT public.bw_stage_topic_allowed('stage:event:${QE}') a`)).rows[0]?.a === false, 'member: no live stage channel');
ok((await as(MEM, `SELECT public.bw_is_event_participant('${QE}') p`)).rows[0]?.p === false, 'member is not a participant of the quote');
ok((await as(MEM, `SELECT * FROM chats WHERE id = '${EVCHAT}'`)).rows.length === 0, 'member: the quote\'s event chat is hidden');
ok((await as(MEM, `SELECT * FROM messages WHERE chat_id = '${EVCHAT}'`)).rows.length === 0, 'member: no messages of the quote chat');
ok(!!(await as(MEM, `INSERT INTO messages (chat_id, sender_id, content) VALUES ('${EVCHAT}','${MEM}','hi')`)).error, 'member cannot write in the quote chat');
ok((await as(ADMIN, `SELECT * FROM messages WHERE chat_id = '${EVCHAT}'`)).rows.length === 1, 'admin still reads the quote chat');
ok((await db.query(`SELECT * FROM public.bw_live_pack_window_events('${QE}')`)).rows.length === 0, 'no offline live pack for a quote');

// ── The hold card ───────────────────────────────────────────────────────────
const mine = await as(MEM, `SELECT * FROM public.bw_my_date_holds()`);
const row = mine.rows.find((r) => r.event_id === QE);
ok(!mine.error && !!row, `member sees the hold (${mine.error || mine.rows.length})`);
ok(row && Object.keys(row).sort().join() === 'answered_at,band_id,band_name,end_time,event_date,event_id,my_answer,start_time,venue_city,venue_name',
  `hold has only day, time, place, band, answer: ${row && Object.keys(row).sort().join()}`);
ok(row && row.venue_name === 'Blue Note' && row.venue_city === 'New York' && String(row.start_time).startsWith('20:00'), 'hold values');
ok(leaks(mine.rows).length === 0, `hold rows leak nothing (${leaks(mine.rows)})`);
ok((await as(MEM2, `SELECT * FROM public.bw_my_date_holds()`)).rows.some((r) => r.event_id === QE), 'a member off the lineup sees it too');
ok((await as(ADMIN, `SELECT * FROM public.bw_my_date_holds()`)).rows.length === 0, 'admins get no hold card (they see the quote)');
ok((await as(OUT, `SELECT * FROM public.bw_my_date_holds()`)).rows.length === 0, 'outsiders get nothing');

// ── Answers ─────────────────────────────────────────────────────────────────
ok((await as(MEM, `SELECT public.bw_answer_date_hold('${QE}', 'free') a`)).rows[0]?.a === 'free', '"I\'m free" saved');
ok((await as(MEM2, `SELECT public.bw_answer_date_hold('${QE}', 'busy') a`)).rows[0]?.a === 'busy', '"I can\'t" saved');
ok(!!(await as(MEM, `SELECT public.bw_answer_date_hold('${QE}', 'maybe')`)).error, 'other answers refused');
ok(!!(await as(OUT, `SELECT public.bw_answer_date_hold('${QE}', 'free')`)).error, 'outsiders cannot answer');
ok((await as(MEM, `SELECT my_answer FROM public.bw_my_date_holds() WHERE event_id = '${QE}'`)).rows[0]?.my_answer === 'free', 'the card shows my answer');
const answers = await as(ADMIN, `SELECT * FROM public.bw_date_hold_answers('${QE}')`);
const ans = (u) => answers.rows.find((r) => r.user_id === u);
ok(!answers.error && ans(MEM)?.answer === 'free' && ans(MEM2)?.answer === 'busy', `admin sees who is free (${answers.error || answers.rows.length})`);
ok(ans(MEM)?.on_lineup === true && ans(MEM2)?.on_lineup === false && ans(MEM)?.name === 'Marta Drums', 'with names and the lineup');
ok(!ans(ADMIN), 'admins are not listed');
ok(!!(await as(MEM, `SELECT * FROM public.bw_date_hold_answers('${QE}')`)).error, 'a member cannot see the answers');
ok(!!(await as(MEM, `SELECT * FROM event_hold_answers`)).error, 'answers table: no direct reads');

// ── Changes: neutral notice to members, titled one to admins only ──────────
await db.exec(`DELETE FROM notifications`);
await asServer(ADMIN, `UPDATE events SET start_time = '19:30', venue_city = 'Hoboken' WHERE id = '${QE}'`);
const ch = await notes();
ok(ch.some((n) => n.user_id === MEM2 && n.type === 'date_hold_changed' && /19:30–23:00/.test(n.body) && /Hoboken/.test(n.body)),
  `members: "new details" with the new time and place (${ch.map((n) => `${n.type}:${n.body}`).join(' | ')})`);
ok(!ch.some((n) => [MEM, MEM2].includes(n.user_id) && n.type !== 'date_hold_changed'), 'members get no titled "Gig updated" about the quote');
ok(ch.some((n) => n.user_id === ADMIN2 && n.type === 'event_update'), 'the other admin still gets "Gig updated"');
ok(leaks(ch.filter((n) => [MEM, MEM2].includes(n.user_id))).length === 0, 'member notices leak nothing');
// Codex B4: "I'm free" was for 20:00, not 19:30.
ok((await as(MEM, `SELECT my_answer FROM public.bw_my_date_holds() WHERE event_id = '${QE}'`)).rows[0]?.my_answer == null,
  'new time: the old "I\'m free" is cleared');
ok((await as(ADMIN, `SELECT * FROM public.bw_date_hold_answers('${QE}')`)).rows.every((r) => r.answer == null), 'the admin sees no stale answers');
await as(MEM, `SELECT public.bw_answer_date_hold('${QE}', 'free')`);
await asServer(ADMIN, `UPDATE events SET venue_name = 'Village Vanguard', venue = 'Village Vanguard' WHERE id = '${QE}'`);
ok((await as(MEM, `SELECT my_answer FROM public.bw_my_date_holds() WHERE event_id = '${QE}'`)).rows[0]?.my_answer === 'free',
  'a new place only: the answer stays');
await db.exec(`DELETE FROM notifications`);
await asServer(ADMIN, `UPDATE events SET load_in_time = '17:00' WHERE id = '${QE}'`);
ok((await notes(`user_id IN ('${MEM}','${MEM2}')`)).length === 0, 'load-in change: nothing to members (not on the card)');

// ── Old builds writing "Availability check" for a quote ─────────────────────
const oldInsert = await as(ADMIN, `INSERT INTO notifications (user_id, band_id, type, title, body, data)
  VALUES ('${MEM}','${BAND}','event_invite','Availability check: Smith Wedding','Your fee: $300',
  jsonb_build_object('event_id','${QE}','tentative',true))`);
ok(!oldInsert.error, `an old build's insert does not fail (${oldInsert.error})`);
ok((await notes(`user_id = '${MEM}' AND type = 'event_invite'`)).length === 0, 'but nothing reaches the member');
await as(ADMIN, `INSERT INTO notifications (user_id, band_id, type, title, body, data)
  VALUES ('${ADMIN2}','${BAND}','event_update','Smith Wedding','for admins', jsonb_build_object('event_id','${QE}'))`);
ok((await notes(`user_id = '${ADMIN2}' AND body = 'for admins'`)).length === 1, 'notices about the quote to admins still go');

// ── Release: quote declined (once) ─────────────────────────────────────────
await db.exec(`DELETE FROM notifications`);
await asServer(ADMIN, `UPDATE quotes SET status = 'declined' WHERE id = '${Q}'`);
const rel = await notes(`type = 'date_hold_released'`);
ok(rel.length === 2 && rel.some((n) => n.user_id === MEM && n.title === 'La data è di nuovo libera')
  && rel.some((n) => n.user_id === MEM2 && n.title === 'The date is free again'), `quote declined: "free again" to both (${rel.length})`);
ok(leaks(rel).length === 0, 'release notice leaks nothing');
ok((await as(MEM, `SELECT * FROM public.bw_my_date_holds() WHERE event_id = '${QE}'`)).rows.length === 0, 'the card is gone');
ok(!!(await as(MEM, `SELECT public.bw_answer_date_hold('${QE}', 'free')`)).error, 'no answering a released hold');
await asServer(ADMIN, `UPDATE quotes SET client_name = 'x', status = 'declined' WHERE id = '${Q}'`);
await asServer(ADMIN, `UPDATE events SET start_time = '18:00' WHERE id = '${QE}'`);
await asServer(ADMIN, `DELETE FROM events WHERE id = '${QE}'`);
ok((await notes(`type = 'date_hold_released'`)).length === 2, 'released once: no second notice on later edits or delete');
ok((await notes(`user_id IN ('${MEM}','${MEM2}') AND type <> 'date_hold_released'`)).length === 0, 'members: nothing titled on its delete');

// ── Release: cancelled, deleted, link declined, expired ────────────────────
const mkQuote = async (ev, title, extra = '') => asServer(ADMIN, `
  INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, start_time, venue_name, venue_city, client_name, created_at)
  VALUES ('${ev}','${BAND}','${title}','tentative','gig','${ADMIN}', current_date + 12, '20:00','Blue Note','New York','Jane Smith',
    now() - interval '5 minutes'); ${extra}`);
await mkQuote(QE2, 'Smith Party');
await mkQuote(QE3, 'Smith Gala');
await db.exec(`DELETE FROM notifications`);
await asServer(ADMIN, `UPDATE events SET status = 'cancelled' WHERE id = '${QE2}'`);
const can = await notes();
ok(can.filter((n) => n.type === 'date_hold_released').length === 2, 'cancelled: "free again" to the members');
ok(!can.some((n) => [MEM, MEM2].includes(n.user_id) && n.type === 'event_cancelled'), 'cancelled: no titled "Gig cancelled" to members');
ok(can.some((n) => n.user_id === ADMIN2 && n.type === 'event_cancelled'), 'cancelled: the other admin is told');
await db.exec(`DELETE FROM notifications`);
await asServer(ADMIN, `DELETE FROM events WHERE id = '${QE3}'`);
const del = await notes();
ok(del.filter((n) => n.type === 'date_hold_released').length === 2 && !del.some((n) => [MEM, MEM2].includes(n.user_id) && n.type === 'event_cancelled'),
  `deleted: "free again", nothing titled (${del.map((n) => n.type).join()})`);

await mkQuote(QE4, 'Smith Brunch', `INSERT INTO quotes (id, band_id, status, valid_until, converted_to_event_id) VALUES ('${Q4}','${BAND}','sent', current_date + 5, '${QE4}');
  INSERT INTO quote_links (quote_id, band_id, status) VALUES ('${Q4}','${BAND}','sent')`);
await db.exec(`DELETE FROM notifications`);
await asServer(ADMIN, `UPDATE quote_links SET status = 'declined' WHERE quote_id = '${Q4}'`);
ok((await notes(`type = 'date_hold_released'`)).length === 2, 'client declined on the link: "free again"');
await asServer(ADMIN, `UPDATE quote_links SET status = 'sent' WHERE quote_id = '${Q4}'`);
ok((await notes(`type = 'date_hold'`)).length === 2, 'quote open again: the hold comes back');
// Expiry writes nothing: the sweep finds it (trigger off to stand for time passing).
await db.exec(`ALTER TABLE quotes DISABLE TRIGGER USER; UPDATE quotes SET valid_until = current_date - 3 WHERE id = '${Q4}'; ALTER TABLE quotes ENABLE TRIGGER USER; DELETE FROM notifications;`);
const swept = await db.query(`SELECT public.bw_date_hold_sweep() n`).catch((e) => ({ rows: [{ n: e.message }] }));
ok(swept.rows[0].n === 1 && (await notes(`type = 'date_hold_released'`)).length === 2, `expired quote: the sweep says "free again" (${swept.rows[0].n})`);
ok((await db.query(`SELECT public.bw_date_hold_sweep() n`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n === 0, 'second sweep: nothing');
ok((await db.query(`SELECT count(*)::int n FROM cron.job WHERE jobname = 'bw-date-hold-sweep'`)).rows[0].n === 1, 'sweep scheduled');

// ── Confirmed: the lineup gets the gig, the others the date back ───────────
await mkQuote(QE5, 'Smith Dinner', `INSERT INTO event_members (event_id, user_id, status, fee) VALUES ('${QE5}','${MEM}','pending', 350)`);
await db.exec(`DELETE FROM notifications`);
await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${QE5}'`);
const conf = await notes();
ok(conf.some((n) => n.user_id === MEM && n.type === 'event_confirmed'), 'confirmed: the lineup gets "Gig confirmed"');
ok(conf.some((n) => n.user_id === MEM2 && n.type === 'date_hold_released') && !conf.some((n) => n.user_id === MEM && n.type === 'date_hold_released'),
  'confirmed: members off the lineup get "free again", the lineup does not');
ok((await as(MEM, `SELECT title FROM events WHERE id = '${QE5}'`)).rows[0]?.title === 'Smith Dinner', 'confirmed: the member reads the gig');
ok(Number((await as(MEM, `SELECT fee FROM public.bw_event_member_money(ARRAY['${QE5}']::uuid[])`)).rows[0]?.fee) === 350, 'confirmed: and their own fee');
ok((await as(MEM, `SELECT * FROM public.bw_my_date_holds()`)).rows.every((r) => r.event_id !== QE5), 'confirmed: no more hold card');

// ══ Round 2 (review of 982d2a1f) ═══════════════════════════════════════════
const [QE7, Q7, QE8, Q8, QE9, Q9, CH9, BAND2, ADM2B] = [39, 47, 41, 48, 42, 49, 54, 7, 8].map(id);

// Codex B2: a wizard quote (linked only by quotes.converted_to_event_id) cancelled.
await asServer(ADMIN, `
  INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, start_time, venue_name, notes)
  VALUES ('${QE7}','${BAND}','Smith Anniversary','tentative','gig','${ADMIN}', current_date + 25, '20:00','Blue Note','secret notes');
  INSERT INTO quotes (id, band_id, created_by, client_name, status, converted_to_event_id) VALUES ('${Q7}','${BAND}','${ADMIN}','Jane Smith','sent','${QE7}');`);
await db.exec(`DELETE FROM notifications`);
await asServer(ADMIN, `UPDATE events SET status = 'cancelled' WHERE id = '${QE7}'`);
ok((await as(MEM, `SELECT title, notes FROM events WHERE id = '${QE7}'`)).rows.length === 0, 'cancelled wizard quote: members still read nothing');
ok((await as(MEM, `SELECT public.bw_can_view_event('${QE7}') v`)).rows[0]?.v === false, 'cancelled wizard quote: bw_can_view_event false');
ok((await as(ADMIN, `SELECT title FROM events WHERE id = '${QE7}'`)).rows.length === 1, 'cancelled wizard quote: the admin still reads it');
await asServer(ADMIN, `UPDATE events SET notes = 'more secret notes', start_time = '21:00' WHERE id = '${QE7}'`);
await asServer(ADMIN, `DELETE FROM events WHERE id = '${QE7}'`);
ok(leaks((await notes(`user_id IN ('${MEM}','${MEM2}')`))).length === 0, 'cancelled quote edited and deleted: nothing titled to members');
await asServer(ADMIN, `INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date)
  VALUES ('${id(43)}','${BAND}','Park Show','confirmed','gig','${ADMIN}', current_date + 30);
  UPDATE events SET status = 'cancelled' WHERE id = '${id(43)}'`);
ok((await as(MEM, `SELECT title FROM events WHERE id = '${id(43)}'`)).rows.length === 1, 'a cancelled real gig stays visible (only quotes are private)');

// Codex B3 / Claude 7: the hidden-chat list never lists other bands' chats.
await db.exec(`INSERT INTO bands VALUES ('${BAND2}', 'Other Band');
  INSERT INTO auth.users (id) VALUES ('${ADM2B}'); INSERT INTO profiles (id, full_name) VALUES ('${ADM2B}', 'Other Admin');
  INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND2}','${ADM2B}','admin'), ('${BAND2}','${OUT}','member');`);
{
  const r = await as(OUT, `SELECT public.bw_hidden_quote_chat_ids() ids`);
  ok(!r.error && !(r.rows[0]?.ids || []).some((x) => [EVCHAT, QCHAT0].includes(x)), `another band's member: no quote chat ids of this band (${r.error || r.rows[0]?.ids})`);
  const m = await as(MEM2, `SELECT public.bw_hidden_quote_chat_ids() ids`);
  ok((m.rows[0]?.ids || []).includes(QCHAT0), 'a member of the band: their band\'s quote chats are listed (to hide them)');
}

// Codex B1 / Claude B2: chat pushes and inbox rows carry only chat_id.
ok((await tryq(`SELECT 1 FROM chat_participants WHERE chat_id = '${EVCHAT}' AND user_id = '${MEM}'`)).rows.length === 0,
  'a member added to a quote chat is dropped (no participant row to push to)');
await db.exec(`DELETE FROM notifications`);
await asServer(null, `INSERT INTO notifications (user_id, band_id, type, title, body, data) VALUES
  ('${MEM}','${BAND}','chat_message','Leo Admin','Jane wants a longer set', jsonb_build_object('chat_id','${QCHAT0}','skip_push',true)),
  ('${ADMIN2}','${BAND}','chat_message','Leo Admin','Jane wants a longer set', jsonb_build_object('chat_id','${QCHAT0}','skip_push',true))`);
ok((await notes(`user_id = '${MEM}' AND type = 'chat_message'`)).length === 0, 'send-push inbox row (chat_id only) for a member: dropped');
ok((await notes(`user_id = '${ADMIN2}' AND type = 'chat_message'`)).length === 1, '... for an admin: kept');
{
  const r = await tryq(`SELECT public.bw_chat_push_readers('${QCHAT0}', ARRAY['${ADMIN2}','${MEM}','${MEM2}']::uuid[]) ids`);
  ok(!r.error && JSON.stringify(r.rows[0]?.ids) === JSON.stringify([ADMIN2]), `push readers of a quote chat: admins only (${r.error || r.rows[0]?.ids})`);
  const g = await tryq(`SELECT public.bw_chat_push_readers('${QCHAT0}', ARRAY['${MEM}']::uuid[]) a, has_function_privilege('authenticated', 'public.bw_chat_push_readers(uuid, uuid[])', 'EXECUTE') p`);
  ok(g.rows[0]?.p === false, 'push readers: server only');
}

// Claude 5c: an older admin build adds the whole lineup to the quote chat.
{
  const r = await as(ADMIN, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${QCHAT0}','${ADMIN2}'), ('${QCHAT0}','${MEM2}')`);
  ok(!r.error, `old admin build: the insert does not fail (${r.error})`);
  ok((await tryq(`SELECT user_id FROM chat_participants WHERE chat_id = '${QCHAT0}' AND user_id IN ('${ADMIN2}','${MEM2}')`)).rows.map((x) => x.user_id).join() === ADMIN2,
    'old admin build: the other admin is added, the member silently is not');
}

// Owner 1: setlists of a quote. Owner 2: song proposals of a quote.
await db.exec(`UPDATE events SET setlist_id = '${SL3}' WHERE id IN ('${QE0}', '${GIG}');
  UPDATE events SET setlist_id = '${SL}' WHERE id = '${QE0}';
  INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, setlist_id, created_at)
  VALUES ('${QE8}','${BAND}','Smith Gala 2','tentative','gig','${ADMIN}', current_date + 15, '${SL4}', now() - interval '5 minutes');
  UPDATE events SET setlist_id = '${SL3}' WHERE id = '${GIG}';
  INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, setlist_id, created_at)
  VALUES ('${QE9}','${BAND}','Smith Gala 3','tentative','gig','${ADMIN}', current_date + 16, '${SL3}', now() - interval '5 minutes');
  INSERT INTO setlist_songs (setlist_id, song_id, position) VALUES ('${SL}','${SONG}',2), ('${SL3}','${SONG}',1);`);
{
  const mine = (await as(MEM, `SELECT id FROM setlists`)).rows.map((r) => r.id);
  ok(!mine.includes(SL), 'member: the setlist only a quote uses is hidden');
  ok(mine.includes(SL3), 'member: a setlist a real gig also uses stays');
  ok(mine.includes(SL4), 'member: a template stays');
  ok(mine.includes(SL2), 'member: band setlists in general stay');
  ok((await as(MEM, `SELECT * FROM setlist_songs WHERE setlist_id = '${SL}'`)).rows.length === 0, 'member: no songs of the quote setlist');
  ok((await as(ADMIN, `SELECT id FROM setlists WHERE id = '${SL}'`)).rows.length === 1, 'admin: reads the quote setlist');
  await asServer(null, `INSERT INTO notifications (user_id, band_id, type, title, body, data) VALUES
    ('${MEM}','${BAND}','setlist_updated','Smith Wedding set','updated', jsonb_build_object('setlist_id','${SL}','skip_push',true))`);
  ok((await notes(`user_id = '${MEM}' AND type = 'setlist_updated'`)).length === 0, 'setlist notice about a quote setlist: dropped for members');
}
await db.exec(`INSERT INTO song_proposals (band_id, event_id, title, proposed_by) VALUES ('${BAND}','${QE0}','Smith first dance','${ADMIN}')`);
ok((await as(MEM, `SELECT * FROM song_proposals WHERE event_id = '${QE0}'`)).rows.length === 0, 'member: no song proposals of a quote');
ok(!!(await as(MEM, `INSERT INTO song_proposals (band_id, event_id, title, proposed_by) VALUES ('${BAND}','${QE0}','x','${MEM}')`)).error,
  'member: cannot propose a song for a quote');
ok((await as(ADMIN, `SELECT * FROM song_proposals WHERE event_id = '${QE0}'`)).rows.length === 1, 'admin: sees them');

// Claude B1: quote_musicians fee.
await db.exec(`INSERT INTO quote_musicians (quote_id, user_id, fee) VALUES ('${Q4}','${MEM}', 300)`);
ok((await as(MEM, `SELECT fee FROM quote_musicians WHERE quote_id = '${Q4}'`)).rows.length === 0, 'member: no own fee row of a pending quote');

// Owner 3 / Claude 8: "the day has passed" is not UTC.
{
  const r = await tryq(`SELECT public.bw_date_hold_today('2026-11-23 03:00+00')::text a, public.bw_date_hold_today('2026-11-23 11:59+00')::text b,
                               public.bw_date_hold_today('2026-11-23 12:01+00')::text c`);
  ok(r.rows[0]?.a === '2026-11-22' && r.rows[0]?.b === '2026-11-22' && r.rows[0]?.c === '2026-11-23',
    `10 pm Saturday in New York (03:00 UTC Sunday) is still Saturday (${r.error || JSON.stringify(r.rows[0])})`);
  let clean = true;
  for (const f of ['bw_date_hold_live', 'bw_date_hold_sync', 'bw_date_hold_gone', 'bw_date_hold_sweep']) {
    const d = (await fnDef(f)).toLowerCase();
    if (!d || /current_date/.test(d)) clean = false;
  }
  ok(clean, 'hold functions never compare with current_date (UTC)');
  await db.exec(`UPDATE events SET event_date = public.bw_date_hold_today() WHERE id = '${QE8}'`).catch(() => {});
  ok((await tryq(`SELECT public.bw_date_hold_live('${QE8}') l`)).rows[0]?.l === true, 'a hold dated "today" for the band is live');
  await db.exec(`UPDATE events SET event_date = current_date + 15 WHERE id = '${QE8}'`);
}

// Owner 5: stats skip quote lineup rows; free slots: a hold blocks the band.
{
  const st = await as(MEM, `SELECT pending, declined FROM public.bw_member_stats('${BAND}', current_date - 30, current_date + 60)`);
  // Only the confirmed Smith Dinner (QE5) waits for an answer; the quotes don't count.
  ok(st.rows[0]?.pending === 1, `member stats: quote lineup rows are not pending gigs (${st.error || st.rows[0]?.pending})`);
  await db.exec(`INSERT INTO event_members (event_id, user_id, status) VALUES ('${QE8}','${MEM}','pending');
    INSERT INTO quotes (id, band_id, status, valid_until, converted_to_event_id) VALUES ('${Q8}','${BAND}','sent', current_date + 30, '${QE8}')`);
  await db.exec(`SELECT public.bw_date_hold_sweep()`).catch(() => {});
  const fs = async () => (await as(ADMIN, `SELECT free_count, total_count FROM public.bw_band_free_slots('${BAND}', current_date + 15, current_date + 15)`)).rows[0];
  const live = await fs();
  ok(live?.free_count === 0 && live?.total_count === 4, `free slots: a live hold blocks its day for the band (${JSON.stringify(live)})`);
  await asServer(ADMIN, `UPDATE quotes SET status = 'declined' WHERE id = '${Q8}'`);
  const off = await fs();
  ok(off?.free_count === 4, `free slots: a quote's lineup row alone makes nobody busy (${JSON.stringify(off)})`);
}

// Owner 6: no new deputy for a quote.
await db.exec(`INSERT INTO band_deputies (id, band_id, name) VALUES ('${id(70)}','${BAND}','Dan Dep')`);
ok(!!(await tryq(`INSERT INTO deputy_requests (band_id, event_id, deputy_id, deputy_name) VALUES ('${BAND}','${QE0}','${id(70)}','Dan Dep')`)).error,
  'deputy request for a quote event: refused');
ok(!(await tryq(`INSERT INTO deputy_requests (band_id, event_id, deputy_id, deputy_name) VALUES ('${BAND}','${GIG}','${id(70)}','Dan Dep')`)).error,
  'deputy request for a confirmed gig: fine');

// Claude 9: one release at a time.
{
  const d = await fnDef('bw_date_hold_sync');
  ok(/FOR UPDATE/i.test(d) && /pg_advisory_xact_lock/.test(d), 'bw_date_hold_sync locks the hold before deciding');
}

// Claude 5a: hold pushes open something on older builds.
{
  const calls = (await tryq(`SELECT body FROM net.calls ORDER BY id DESC LIMIT 200`)).rows.map((r) => r.body);
  const holdPush = calls.find((b) => b?.data?.hold_type === 'date_hold' || b?.data?.type === 'date_hold');
  ok(!!holdPush && holdPush.data.type === 'event_date_hold' && !holdPush.data.event_id && !!holdPush.data.hold_event_id,
    `hold push: type event_date_hold (older builds open the calendar), no event_id (${JSON.stringify(holdPush?.data || null)})`);
}

// Claude 3 + 4: confirmed, the lineup is back in the chat, from now on.
await asServer(ADMIN, `
  INSERT INTO event_members (event_id, user_id, status, fee) VALUES ('${QE9}','${MEM}','pending', 200);
  INSERT INTO quotes (id, band_id, status, converted_to_event_id) VALUES ('${Q9}','${BAND}','sent','${QE9}');
  INSERT INTO quote_musicians (quote_id, user_id, fee) VALUES ('${Q9}','${MEM}', 200);
  INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${CH9}','event','Smith Gala 3','${BAND}','${QE9}','${ADMIN}');
  INSERT INTO chat_participants (chat_id, user_id) VALUES ('${CH9}','${ADMIN}'), ('${CH9}','${MEM}');
  INSERT INTO messages (chat_id, sender_id, content, created_at) VALUES ('${CH9}','${ADMIN}','Jane Smith wants 3 sets', clock_timestamp() - interval '1 minute');`);
await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${QE9}'`);
await asServer(ADMIN, `INSERT INTO messages (chat_id, sender_id, content) VALUES ('${CH9}','${ADMIN}','Load-in at 5')`);
{
  const p = (await tryq(`SELECT cleared_at FROM chat_participants WHERE chat_id = '${CH9}' AND user_id = '${MEM}'`)).rows[0];
  ok(!!p && !!p.cleared_at, `confirmed: the lineup member is back in the gig chat, history cleared (${JSON.stringify(p || null)})`);
  const seen = (await as(MEM, `SELECT content FROM messages WHERE chat_id = '${CH9}'`)).rows.map((r) => r.content);
  ok(seen.includes('Load-in at 5') && !seen.includes('Jane Smith wants 3 sets'), `member sees messages only from the confirmation on (${seen})`);
  ok((await as(ADMIN, `SELECT content FROM messages WHERE chat_id = '${CH9}'`)).rows.length === 2, 'the admin keeps the whole history');
  ok(Number((await as(MEM, `SELECT fee FROM quote_musicians WHERE quote_id = '${Q9}'`)).rows[0]?.fee) === 200, 'confirmed: the member reads their own quote fee row');
  // A member who joins later gets the same cut-off.
  await db.exec(`DELETE FROM chat_participants WHERE chat_id = '${CH9}' AND user_id = '${MEM}'`);
  await as(MEM, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${CH9}','${MEM}')`);
  const again = (await tryq(`SELECT cleared_at FROM chat_participants WHERE chat_id = '${CH9}' AND user_id = '${MEM}'`)).rows[0];
  ok(!!again?.cleared_at, 'joining the gig chat later: the quote-stage history stays cleared');
}

// Re-run: answers cleared by a change of day don't come back.
await db.exec(`UPDATE events SET event_date = current_date + 21 WHERE id = '${QE0}'`);
await db.exec(readFileSync(MIG, 'utf8')).catch(() => {});
ok((await tryq(`SELECT 1 FROM event_hold_answers WHERE event_id = '${QE0}'`)).rows.length === 0, 're-run: old availability answers are carried only once');

// ── Round 3 (Codex + Claude on 6312a8ea) ────────────────────────────────────
const [R3Q, R3E, R3G, R3C, R3CH, R3SL, R3SLG, R3DE, R3DEP, R3REQ, R3RV] = [2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011].map(id);
await mkQuote(R3E, 'Smith Anniversary', `INSERT INTO event_members (event_id, user_id, status, fee) VALUES ('${R3E}','${MEM}','pending', 250)`);
await db.exec(`SELECT public.bw_date_hold_sweep()`).catch(() => {});

// Codex B1: bw_is_on_event_lineup answers only about yourself, never for a quote.
{
  const on = async (uid, ev, who) => (await as(uid, `SELECT public.bw_is_on_event_lineup('${ev}', '${who}') v`)).rows[0]?.v;
  ok(await on(MEM2, GIG, MEM) === false, 'lineup check: a member can\'t ask about someone else');
  ok(await on(MEM, R3E, MEM) === false, 'lineup check: on a quote, false for a member (even about themselves)');
  ok(await on(MEM, GIG, MEM) === true && await on(ADMIN, GIG, MEM) === true, 'lineup check: yourself, or the admin asking, on a gig: true');
}

// Claude :199: bw_event_quote_hidden about someone else needs an admin caller.
{
  const hid = async (uid, who) => (await as(uid, `SELECT public.bw_event_quote_hidden('${R3E}', '${who}') v`)).rows[0]?.v;
  ok(await hid(MEM, ADMIN) === true, 'quote_hidden: a member asking about the admin learns nothing (hidden)');
  ok(await hid(ADMIN, ADMIN) === false && await hid(ADMIN2, ADMIN) === false && await hid(ADMIN, MEM) === true,
    'quote_hidden: the admin about themselves / another admin / a member: unchanged');
}

// Codex B4 + B5: the quote's day moves (Quotes screen); answers reset, and
// an answer for the old day is refused.
{
  await asServer(ADMIN, `INSERT INTO quotes (id, band_id, status, valid_until, converted_to_event_id, event_date, event_time_start)
    VALUES ('${R3Q}','${BAND}','sent', current_date + 30, '${R3E}', current_date + 12, '20:00')`);
  const before = (await tryq(`SELECT to_char(event_date, 'YYYY-MM-DD') d FROM events WHERE id = '${R3E}'`)).rows[0]?.d;
  const a1 = await as(MEM, `SELECT public.bw_answer_date_hold('${R3E}', 'free') v`);
  ok(!a1.error, `answer without the shown date (older calls): saved (${a1.error || 'ok'})`);
  await db.exec(`DELETE FROM notifications`);
  await asServer(ADMIN, `UPDATE quotes SET event_date = current_date + 13, event_time_start = '21:00' WHERE id = '${R3Q}'`);
  const ev = (await tryq(`SELECT to_char(event_date, 'YYYY-MM-DD') d, to_char(start_time, 'HH24:MI') t FROM events WHERE id = '${R3E}'`)).rows[0];
  ok(ev?.d !== before && ev?.t === '21:00', `quote moved on the Quotes screen: its held event moves too (${JSON.stringify(ev)})`);
  ok((await tryq(`SELECT 1 FROM event_hold_answers WHERE event_id = '${R3E}'`)).rows.length === 0, 'quote moved: the old answers are cleared');
  ok((await notes(`type = 'date_hold_changed' AND user_id = '${MEM}'`)).length === 1, 'quote moved: members are told the new day');
  const stale = await as(MEM, `SELECT public.bw_answer_date_hold('${R3E}', 'free', '${before}'::date, '20:00') v`);
  ok(/date changed/i.test(stale.error || ''), `answer for the old day: refused "the date changed" (${stale.error || 'saved'})`);
  ok((await tryq(`SELECT 1 FROM event_hold_answers WHERE event_id = '${R3E}'`)).rows.length === 0, '... and nothing saved');
  const fresh = await as(MEM, `SELECT public.bw_answer_date_hold('${R3E}', 'busy', '${ev.d}'::date, '21:00') v`);
  ok(!fresh.error && fresh.rows[0]?.v === 'busy', `answer for the day shown now: saved (${fresh.error || fresh.rows[0]?.v})`);
}

// Codex B2: setlist notices (setlist_id only) about a quote's setlist.
{
  await asServer(ADMIN, `INSERT INTO setlists (id, band_id, name) VALUES ('${R3SL}','${BAND}','Smith Anniversary set'), ('${R3SLG}','${BAND}','Club set');
    UPDATE events SET setlist_id = '${R3SL}' WHERE id IN ('${R3E}', '${GIG}')`);
  await db.exec(`INSERT INTO notifications (user_id, band_id, type, title, data, reference_id, reference_type) VALUES
    ('${MEM}','${BAND}','setlist_updated','Smith Anniversary set updated', '{"setlist_id":"${R3SL}"}', '${R3SL}', 'setlist'),
    ('${MEM}','${BAND}','setlist_updated','Smith Anniversary set saved', '{}', '${R3SL}', 'setlist'),
    ('${MEM}','${BAND}','setlist_updated','Club set updated', '{"setlist_id":"${R3SLG}"}', '${R3SLG}', 'setlist')`);
  const kept = (await notes(`user_id = '${MEM}' AND type = 'setlist_updated'`)).map((n) => n.title);
  ok(kept.length === 1 && kept[0] === 'Club set updated', `setlist notices about a quote's setlist never reach members (${kept})`);
  await db.exec(`ALTER TABLE notifications DISABLE TRIGGER USER`);
  await db.exec(`INSERT INTO notifications (user_id, band_id, type, title, data, reference_id, reference_type) VALUES
    ('${MEM}','${BAND}','setlist_updated','Smith Anniversary set (old)', '{}', '${R3SL}', 'setlist')`);
  await db.exec(`ALTER TABLE notifications ENABLE TRIGGER USER`);
  await db.exec(readFileSync(MIG, 'utf8')).catch((e) => console.log('re-run:', e.message));
  ok((await notes(`user_id = '${MEM}' AND title LIKE 'Smith Anniversary%'`)).length === 0, 'cleanup: old setlist notices (setlist only) about a quote are removed');
  ok((await notes(`user_id = '${MEM}' AND title = 'Club set updated'`)).length === 1, 'cleanup: other setlist notices stay');
  await db.exec(`UPDATE events SET setlist_id = NULL WHERE id = '${GIG}'`);
}

// Codex :1639 is above (quote saved, musicians not yet: no hold).

// Claude :163: a gig made with "Create gig from quote" (confirmed, quote_id) and then cancelled is a gig.
{
  await asServer(ADMIN, `INSERT INTO quotes (id, band_id, status, valid_until) VALUES ('${R3C}','${BAND}','sent', current_date + 30);
    INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, quote_id, created_at)
    VALUES ('${R3G}','${BAND}','Rooftop Wedding','confirmed','gig','${ADMIN}', current_date + 20, '${R3C}', now() - interval '1 day');
    INSERT INTO event_members (event_id, user_id, status) VALUES ('${R3G}','${MEM}','confirmed');
    INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${R3CH}','event','Rooftop Wedding','${BAND}','${R3G}','${ADMIN}');
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${R3CH}','${ADMIN}'), ('${R3CH}','${MEM}')`);
  await db.exec(`DELETE FROM notifications`);
  await asServer(ADMIN, `UPDATE events SET status = 'cancelled' WHERE id = '${R3G}'`);
  ok((await notes(`type = 'event_cancelled' AND user_id = '${MEM}'`)).length === 1, 'converted gig cancelled: the member is told');
  ok((await tryq(`SELECT 1 FROM chat_participants WHERE chat_id = '${R3CH}' AND user_id = '${MEM}'`)).rows.length === 1, 'converted gig cancelled: the member stays in its chat');
  ok((await as(MEM, `SELECT id FROM events WHERE id = '${R3G}'`)).rows.length === 1, 'converted gig cancelled: the member still sees it');
  // Cancelled before 178: the one-off cleanup leaves it alone.
  await db.exec(readFileSync(MIG, 'utf8')).catch((e) => console.log('re-run:', e.message));
  ok((await notes(`type = 'event_cancelled' AND user_id = '${MEM}'`)).length === 1
     && (await tryq(`SELECT 1 FROM chat_participants WHERE chat_id = '${R3CH}' AND user_id = '${MEM}'`)).rows.length === 1,
    'cleanup: a converted gig cancelled earlier keeps its notice and chat member');
}

// Claude :714: back to a quote with a hold that isn't live: the old cut-off goes.
{
  await asServer(ADMIN, `INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, created_at)
    VALUES ('${R3RV}','${BAND}','Smith Reunion','tentative','gig','${ADMIN}', current_date + 25, now() - interval '1 day');
    INSERT INTO quotes (id, band_id, status, valid_until, converted_to_event_id) VALUES ('${id(2012)}','${BAND}','sent', current_date + 30, '${R3RV}')`);
  await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${R3RV}'`);
  const first = (await tryq(`SELECT released_at FROM event_date_holds WHERE event_id = '${R3RV}'`)).rows[0]?.released_at;
  // The quote expired meanwhile: back to a quote, the hold is not live.
  await db.exec(`UPDATE quotes SET valid_until = current_date - 1 WHERE id = '${id(2012)}'`);
  await asServer(ADMIN, `UPDATE events SET status = 'tentative' WHERE id = '${R3RV}'`);
  const mid = (await tryq(`SELECT release_reason r FROM event_date_holds WHERE event_id = '${R3RV}'`)).rows[0]?.r;
  ok(mid !== 'confirmed', `revert to quote (hold not live): the 'confirmed' row is reset (${mid})`);
  await new Promise((r) => setTimeout(r, 20));
  await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${R3RV}'`);
  const second = (await tryq(`SELECT released_at FROM event_date_holds WHERE event_id = '${R3RV}'`)).rows[0]?.released_at;
  ok(!!first && !!second && new Date(second) > new Date(first), 'confirmed again: a new chat cut-off');
}

// Claude :1061: dropped out is not busy.
{
  await asServer(ADMIN, `INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, start_time, end_time)
    VALUES ('${id(2013)}','${BAND}','Harbor Gig','confirmed','gig','${ADMIN}', current_date + 40, '20:00', '23:00');
    INSERT INTO event_members (event_id, user_id, status) VALUES ('${id(2013)}','${MEM}','dropped_out')`);
  const fs = (await as(ADMIN, `SELECT free_count, total_count FROM public.bw_band_free_slots('${BAND}', current_date + 40, current_date + 40)`)).rows[0];
  ok(fs?.free_count === fs?.total_count, `free slots: dropped out of a gig is free (${JSON.stringify(fs)})`);
}

// Main (#297): a repeating rehearsal's first date deleted on its own
// (recurrence_rule.skip_dates, YYYY-MM-DD strings) doesn't make that day busy;
// a series that skipped another date, and a one-off gig, still do.
{
  const [RS1, RS2, ONE] = [2301, 2302, 2303].map(id);
  await asServer(ADMIN, `INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, start_time, end_time, recurrence_rule) VALUES
    ('${RS1}','${BAND}','Weekly rehearsal','confirmed','rehearsal','${ADMIN}', current_date + 50, '19:00', '21:00',
      jsonb_build_object('frequency','weekly','interval',1,'skip_dates', jsonb_build_array(to_char(current_date + 50, 'YYYY-MM-DD')))),
    ('${RS2}','${BAND}','Weekly sectional','confirmed','rehearsal','${ADMIN}', current_date + 51, '19:00', '21:00',
      jsonb_build_object('frequency','weekly','interval',1,'skip_dates', jsonb_build_array(to_char(current_date + 58, 'YYYY-MM-DD')))),
    ('${ONE}','${BAND}','Pier Gig','confirmed','gig','${ADMIN}', current_date + 52, '19:00', '21:00', NULL);
    INSERT INTO event_members (event_id, user_id, status) VALUES ('${RS1}','${MEM}','confirmed'), ('${RS2}','${MEM}','confirmed'), ('${ONE}','${MEM}','confirmed')`);
  const r = (await as(ADMIN, `SELECT day - current_date AS d, free_count, total_count FROM public.bw_band_free_slots('${BAND}', current_date + 50, current_date + 52) ORDER BY day`)).rows;
  const at = (d) => r.find((x) => x.d === d) || {};
  ok(at(50).free_count === at(50).total_count, `free slots: a repeating rehearsal's deleted first date is free (${JSON.stringify(at(50))})`);
  ok(at(51).free_count === at(51).total_count - 1, `free slots: a series that skipped another date is still busy on its date (${JSON.stringify(at(51))})`);
  ok(at(52).free_count === at(52).total_count - 1, `free slots: a one-off gig is still busy (${JSON.stringify(at(52))})`);
}

// #291's integrated test: lineup answers in another case ('Declined',
// 'Dropped_Out ', as older builds and imports wrote them) are off the gig
// too; 'confirmed' still on it.
{
  const MIXED = id(2310);
  await asServer(ADMIN, `INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, start_time, end_time)
    VALUES ('${MIXED}','${BAND}','Dock Party','confirmed','gig','${ADMIN}', current_date + 54, '19:00', '21:00');
    INSERT INTO event_members (event_id, user_id, status) VALUES ('${MIXED}','${MEM}','Declined'), ('${MIXED}','${MEM2}','Dropped_Out ')`);
  const part = async (ev, u) => (await tryq(`SELECT public.bw_is_event_participant('${ev}', '${u}') p`)).rows[0]?.p;
  const [dec, drop, conf] = [await part(MIXED, MEM), await part(MIXED, MEM2), await part(GIG, MEM)];
  ok(dec === false && drop === false && conf === true,
    `bw_is_event_participant: 'Declined' and 'Dropped_Out ' are off the gig, 'confirmed' on it (${dec}, ${drop}, ${conf})`);
  const fs = (await as(ADMIN, `SELECT free_count, total_count FROM public.bw_band_free_slots('${BAND}', current_date + 54, current_date + 54)`)).rows[0];
  ok(fs?.free_count === fs?.total_count, `free slots: mixed-case declined / dropped out are free (${JSON.stringify(fs)})`);
}

// Claude: deputies of a gig that went back to a quote.
{
  await db.exec(`ALTER TABLE band_deputies ADD COLUMN IF NOT EXISTS user_id uuid;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS currency text;
    ALTER TABLE deputy_requests ADD COLUMN IF NOT EXISTS token text DEFAULT md5(random()::text) || md5(random()::text),
      ADD COLUMN IF NOT EXISTS replaces_user_id uuid, ADD COLUMN IF NOT EXISTS role text, ADD COLUMN IF NOT EXISTS fee_offered numeric,
      ADD COLUMN IF NOT EXISTS currency text, ADD COLUMN IF NOT EXISTS created_by uuid, ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
      ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now()`);
  await asServer(ADMIN, `INSERT INTO band_deputies (id, band_id, name) VALUES ('${R3DEP}','${BAND}','Ava Dep');
    INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, created_at)
    VALUES ('${R3DE}','${BAND}','Smith Gala 4','confirmed','gig','${ADMIN}', current_date + 30, now() - interval '1 day');
    INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, status) VALUES ('${R3REQ}','${BAND}','${R3DE}','${R3DEP}','Ava Dep','available')`);
  await asServer(ADMIN, `UPDATE events SET status = 'tentative' WHERE id = '${R3DE}'`);
  const open = await as(ADMIN, `SELECT * FROM public.bw_deputy_request_open('${R3DE}', '${R3DEP}')`);
  ok(/still a quote/.test(open.error || ''), `back to a quote: re-opening a deputy's request is refused (${open.error || JSON.stringify(open.rows)})`);
  const ping = await as(ADMIN, `SELECT public.bw_deputy_request_ping('${R3REQ}') v`);
  ok(ping.rows[0]?.v === 'closed', `back to a quote: "Ask in the app" is closed (${ping.error || ping.rows[0]?.v})`);
  await db.exec(`DELETE FROM notifications`);
  await db.exec(`INSERT INTO notifications (user_id, type, title, body, data, reference_id, reference_type)
    VALUES ('${OUT}','deputy_gig_changed','Smith Gala 4 has changed','Smith Gala 4 · new time', '{}', '${R3REQ}', 'deputy_request')`);
  ok((await notes(`type = 'deputy_gig_changed'`)).length === 0, 'back to a quote: deputy pushes about it are dropped');
}

// ── Re-run after 181 (event chat = lineup): 178 must not undo it ───────────
// 181 redefines bw_chat_scope_ok to also need bw_is_event_participant (which
// carries the quote rule since 178). Re-running 178 later (its header says to
// if 175 lands after it) must keep that definition.
const [GIGCHAT, QCHAT, QE6] = [51, 52, 37].map(id);
await mkQuote(QE6, 'Smith Brunch', `INSERT INTO event_members (event_id, user_id, status, fee) VALUES ('${QE6}','${MEM}','pending', 200)`);
await db.exec(`INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES
  ('${GIGCHAT}','event','Rooftop Session','${BAND}','${GIG}','${ADMIN}'), ('${QCHAT}','event','Smith Brunch','${BAND}','${QE6}','${ADMIN}')`);
await db.exec(`
CREATE OR REPLACE FUNCTION public.bw_chat_scope_ok(p_type text, p_band_id uuid, p_event_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT CASE
    WHEN p_type = 'band' THEN p_band_id IS NULL OR public.bw_is_band_member(p_band_id, p_user_id)
    WHEN p_type = 'event' THEN
      (p_band_id IS NULL OR public.bw_is_band_member(p_band_id, p_user_id))
      AND coalesce((
        SELECT (e.band_id IS NULL OR public.bw_is_band_member(e.band_id, p_user_id))
               AND public.bw_is_event_participant(e.id, p_user_id)
          FROM events e WHERE e.id = p_event_id
      ), true)
    ELSE true
  END;
$f$;`);
const scope = async (chat, uid) => (await db.query(
  `SELECT public.bw_chat_scope_ok(c.type, c.band_id, c.event_id, '${uid}') ok FROM chats c WHERE c.id = '${chat}'`)).rows[0]?.ok;
await db.exec(readFileSync(MIG, 'utf8'));
ok(await scope(GIGCHAT, MEM2) === false, 're-run after 181: a member off the lineup stays out of the gig chat');
ok(await scope(GIGCHAT, MEM) === true, 're-run after 181: the lineup keeps the gig chat');
ok(await scope(QCHAT, MEM) === false, 're-run after 181: the quote chat stays hidden from members');
// #281 round 3: that stand-in is a pre-round-3 shape (no status rule, "yes"
// for a chat whose gig is gone). 178 must not keep it: it writes 175's
// round-3 body with the quote rule.
{
  const def = await fnDef('bw_chat_scope_ok');
  const gone = (await db.query(`SELECT public.bw_chat_scope_ok('event', '${BAND}', '${id(2199)}', '${MEM}') ok`)).rows[0]?.ok;
  const noUser = (await db.query(`SELECT public.bw_chat_scope_ok('direct', NULL, NULL, NULL) ok`)).rows[0]?.ok;
  ok(def.includes('dropped_out') && def.includes('bw_is_event_participant') && gone === false && noUser === false,
    `re-run over a pre-round-3 bw_chat_scope_ok: 178 writes the round-3 shape (status rule ${def.includes('dropped_out')}, gone gig ${gone}, no user ${noUser})`);
}
// #281 round 4: 178 keeps only 175's final definition (marker bw:175-r4 in
// its body). A round-3 shape (status rule, no marker) is replaced by 178's
// own, which also checks the caller when asked about someone else.
{
  const r3 = `CREATE OR REPLACE FUNCTION public.bw_chat_scope_ok(p_type text, p_band_id uuid, p_event_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT p_user_id IS NOT NULL AND coalesce(CASE
    WHEN p_type = 'band' THEN p_band_id IS NOT NULL AND public.bw_is_band_member(p_band_id, p_user_id)
    WHEN p_type = 'event' THEN EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id
      AND public.bw_is_event_participant(e.id, p_user_id)
      AND NOT EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = e.id AND em.user_id = p_user_id
        AND em.status IN ('declined', 'dropped_out', 'removed')))
    ELSE true END, false);
$f$;`;
  const callerAsks = async () => (await as(OUT, `SELECT public.bw_chat_scope_ok('band', '${BAND}', NULL, '${MEM}') ok`)).rows[0]?.ok;
  await db.exec(r3);
  await db.exec(readFileSync(MIG, 'utf8'));
  const after = await fnDef('bw_chat_scope_ok');
  const outsider = await callerAsks();
  ok(outsider === false && !after.includes('bw:175-r4'),
    `re-run over a round-3 bw_chat_scope_ok (no marker): replaced, an outsider asking about a member gets false (${outsider})`);
  const marked = r3.replace("SELECT p_user_id IS NOT NULL", "-- bw:175-r4\n  SELECT p_user_id IS NOT NULL");
  await db.exec(marked);
  await db.exec(readFileSync(MIG, 'utf8'));
  ok((await fnDef('bw_chat_scope_ok')).includes('bw:175-r4'), "re-run over 175's final bw_chat_scope_ok (marker bw:175-r4): kept");
  // Back to 178's own definition for the rest of the file (the guard off once).
  await db.exec(readFileSync(MIG, 'utf8').replace(/LIKE '%bw:175-r4%'/, "LIKE '%no such marker%'"));
}

// Claude 3, order 175 → 178 → 181: 181's sweep runs on top; confirmed, the lineup is back.
await db.exec(`CREATE TABLE IF NOT EXISTS public.chat_participants_removed_175 (chat_id uuid, user_id uuid, row_data jsonb, removed_at timestamptz DEFAULT now())`);
const sweep181 = `WITH stale AS (SELECT cp.chat_id, cp.user_id, to_jsonb(cp) AS row_data FROM chat_participants cp JOIN chats c ON c.id = cp.chat_id
    WHERE c.type = 'event' AND NOT public.bw_chat_scope_ok(c.type, c.band_id, c.event_id, cp.user_id)),
  saved AS (INSERT INTO public.chat_participants_removed_175 (chat_id, user_id, row_data) SELECT chat_id, user_id, row_data FROM stale RETURNING chat_id, user_id)
  DELETE FROM chat_participants cp USING saved s WHERE cp.chat_id = s.chat_id AND cp.user_id = s.user_id`;
await db.exec(`INSERT INTO chat_participants (chat_id, user_id) VALUES ('${QCHAT}','${ADMIN}'), ('${QCHAT}','${MEM}')`);
await db.exec(sweep181);
await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${QE6}'`);
const orderA = (await tryq(`SELECT cleared_at IS NOT NULL c FROM chat_participants WHERE chat_id = '${QCHAT}' AND user_id = '${MEM}'`)).rows[0];
ok(orderA?.c === true, `order 178 → 181: confirmed, the lineup member is back in the chat, history cleared (${JSON.stringify(orderA || null)})`);

// Claude 3, order 175 → 181 → 178, on a fresh database: the same end state.
{
  const db1 = db;
  db = new PGlite();
  await boot(db);
  await db.exec(`
    INSERT INTO auth.users (id) SELECT unnest(ARRAY['${ADMIN}','${MEM}']::uuid[]);
    INSERT INTO profiles (id, full_name) VALUES ('${ADMIN}','Leo Admin'), ('${MEM}','Marta Drums');
    INSERT INTO bands VALUES ('${BAND}', 'Velvet Static');
    INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${ADMIN}','admin'), ('${BAND}','${MEM}','member');
    INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date) VALUES ('${QE6}','${BAND}','Smith Brunch','tentative','gig','${ADMIN}', current_date + 9);
    INSERT INTO event_members (event_id, user_id, status) VALUES ('${QE6}','${MEM}','pending');
    INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${QCHAT}','event','Smith Brunch','${BAND}','${QE6}','${ADMIN}');
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${QCHAT}','${ADMIN}'), ('${QCHAT}','${MEM}');
    CREATE TABLE public.chat_participants_removed_175 (chat_id uuid, user_id uuid, row_data jsonb, removed_at timestamptz DEFAULT now());
    CREATE OR REPLACE FUNCTION public.bw_chat_scope_ok(p_type text, p_band_id uuid, p_event_id uuid, p_user_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
      SELECT CASE WHEN p_type = 'event' THEN coalesce((SELECT public.bw_is_event_participant(e.id, p_user_id) FROM events e WHERE e.id = p_event_id), true) ELSE true END;
    $f$;`);
  await db.exec(sweep181);
  await db.exec(readFileSync(MIG, 'utf8')).catch((e) => console.log('order B migration:', e.message));
  const during = (await tryq(`SELECT 1 FROM chat_participants WHERE chat_id = '${QCHAT}' AND user_id = '${MEM}'`)).rows.length;
  await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${QE6}'`);
  const orderB = (await tryq(`SELECT cleared_at IS NOT NULL c FROM chat_participants WHERE chat_id = '${QCHAT}' AND user_id = '${MEM}'`)).rows[0];
  ok(during === 0 && orderB?.c === true, `order 181 → 178: out while a quote, back once confirmed, history cleared (${during}, ${JSON.stringify(orderB || null)})`);
  db = db1;
}

// ── Cross-PR: the real 175 (chat scope, section 3) and 181, both orders ────
// MIG_175 / MIG_181 / MIG_193: paths to those branches' files (git show
// origin/fix/security-audit:supabase/migrations/175_security_audit_access.sql,
// origin/fix/event-chat-lineup:…/181_event_chat_lineup.sql,
// origin/fix/chat-audit:…/193_one_chat_per_gig.sql). Orders: 175 → 178
// (no 181), both orders of 178 and 181, and main's 175 → 178 → 193 → 181.
// chats.type is the chat_type enum here, as on databases built from 002.
const M175 = process.env.MIG_175;
const M181 = process.env.MIG_181;
const M193 = process.env.MIG_193;
if (M175 && M181) {
  const db1 = db;
  const sec175 = (() => {
    // The whole real file (main's rule: the prerequisites as they ship).
    return readFileSync(M175, 'utf8');
  })();
  const [GC, GRP, QC, QE8, GIG8, RMV, NOLINE] = [70, 71, 72, 38, 39, 2150, 2151].map(id);
  const cross = async (order) => {
    db = new PGlite();
    await boot(db);
    await db.exec(`
      CREATE TYPE chat_type AS ENUM ('direct', 'group', 'band', 'event', 'rider');
      ALTER TABLE chats ALTER COLUMN type TYPE chat_type USING type::chat_type;
      INSERT INTO auth.users (id) SELECT unnest(ARRAY['${ADMIN}','${MEM}','${MEM2}','${OUT}','${RMV}','${NOLINE}']::uuid[]);
      INSERT INTO profiles (id, full_name) VALUES ('${RMV}','Kim Keys'), ('${NOLINE}','Ari Sax');
      INSERT INTO profiles (id, full_name) VALUES ('${ADMIN}','Leo Admin'), ('${MEM}','Marta Drums'), ('${MEM2}','Sam Bass'), ('${OUT}','Ex Member');
      INSERT INTO bands VALUES ('${BAND}', 'Velvet Static');
      INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${ADMIN}','admin'), ('${BAND}','${MEM}','member'), ('${BAND}','${MEM2}','member'), ('${BAND}','${RMV}','member'), ('${BAND}','${NOLINE}','member');
      INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, created_at) VALUES
        ('${GIG8}','${BAND}','Rooftop Session','confirmed','gig','${ADMIN}', current_date + 5, now() - interval '1 day'),
        ('${QE8}','${BAND}','Smith Brunch','tentative','gig','${ADMIN}', current_date + 9, now() - interval '1 day');
      INSERT INTO event_members (event_id, user_id, status) VALUES ('${GIG8}','${MEM}','confirmed'), ('${GIG8}','${MEM2}','dropped_out'), ('${GIG8}','${RMV}','removed'), ('${QE8}','${MEM}','confirmed');
      INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES
        ('${GC}','event','Rooftop Session','${BAND}','${GIG8}','${ADMIN}'), ('${GRP}','group','Velvet crew','${BAND}',NULL,'${ADMIN}'),
        ('${QC}','event','Smith Brunch','${BAND}','${QE8}','${ADMIN}');
      INSERT INTO chat_participants (chat_id, user_id) VALUES ('${GC}','${ADMIN}'), ('${GC}','${MEM}'), ('${GC}','${MEM2}'),
        ('${GRP}','${ADMIN}'), ('${GRP}','${MEM}'), ('${GRP}','${OUT}'), ('${QC}','${ADMIN}'), ('${QC}','${MEM}');
      INSERT INTO messages (chat_id, sender_id, content, created_at) VALUES ('${QC}','${ADMIN}','Client budget 4200', now() - interval '1 hour');`);
    const sc = async (chat, uid) => (await tryq(
      `SELECT public.bw_chat_scope_ok(c.type::text, c.band_id, c.event_id, '${uid}') ok FROM chats c WHERE c.id = '${chat}'`)).rows[0]?.ok;
    const steps = order.split(' → ');
    const has181 = steps.includes('181');
    const mid = {};
    for (const st of steps) {
      const sql = st === '175' ? sec175 : st === '181' ? readFileSync(M181, 'utf8') : st === '193' ? readFileSync(M193, 'utf8') : readFileSync(MIG, 'utf8');
      const err = await db.exec(sql).then(() => null, (e) => e.message);
      if (err) console.log(`order ${order}, ${st}:`, err);
      if (st === '178') mid.grpOut = await sc(GRP, OUT);
    }
    const tag = order;
    const inChat = async (chat, uid) => (await tryq(`SELECT 1 FROM chat_participants WHERE chat_id = '${chat}' AND user_id = '${uid}'`)).rows.length;
    if (steps.indexOf('178') < steps.indexOf('181') || !has181) ok(mid.grpOut === false, `${tag}: 178's chat rule keeps 175's legacy 'group' = band rule (former member out: ${mid.grpOut})`);
    ok(await sc(GRP, MEM) === true && await sc(GRP, OUT) === false, `${tag}: legacy group chat follows the band`);
    ok((await tryq(`SELECT public.bw_is_event_participant('${GIG8}', '${MEM2}') p`)).rows[0]?.p === false,
      `${tag}: dropped out is off the gig (bw_is_event_participant keeps 181's status list)`);
    if (has181) ok(await inChat(GC, MEM2) === 0 && await inChat(GC, MEM) === 1, `${tag}: gig chat = lineup (dropped out gone, lineup kept)`);
    // The lineup rule and the off-the-gig statuses, through the live rule.
    ok(await sc(GC, MEM) === true && await sc(GC, MEM2) === false && await sc(GC, RMV) === false && await sc(GC, NOLINE) === false,
      `${tag}: gig chat rule = lineup (on ${await sc(GC, MEM)}, dropped out ${await sc(GC, MEM2)}, removed ${await sc(GC, RMV)}, not on it ${await sc(GC, NOLINE)})`);
    ok(await inChat(QC, MEM) === 0, `${tag}: a member is out of the quote chat`);
    // The rule itself, not only the cleanup: a stale row (written past the
    // triggers) still gives the member nothing.
    await db.exec(`ALTER TABLE chat_participants DISABLE TRIGGER USER;
      INSERT INTO chat_participants (chat_id, user_id) VALUES ('${QC}','${MEM}');
      ALTER TABLE chat_participants ENABLE TRIGGER USER;`);
    const listedStale = JSON.stringify((await as(MEM, `SELECT public.get_user_chats('${MEM}') j`)).rows[0]?.j || []).includes(QC);
    ok(await sc(QC, MEM) === false && !listedStale && await sc(QC, ADMIN) === true,
      `${tag}: bw_chat_scope_ok and get_user_chats keep a member out of a quote chat (scope ${await sc(QC, MEM)}, listed ${listedStale})`);
    await db.exec(`DELETE FROM chat_participants WHERE chat_id = '${QC}' AND user_id = '${MEM}'`);
    // 175 round 3's roster filter: the chat list leaves out participant rows
    // the rule refuses (dropped out of the gig, left the band), stale or not.
    await db.exec(`ALTER TABLE chat_participants DISABLE TRIGGER USER;
      DELETE FROM chat_participants WHERE (chat_id, user_id) IN (('${GC}','${MEM2}'), ('${GRP}','${OUT}'));
      INSERT INTO chat_participants (chat_id, user_id) VALUES ('${GC}','${MEM2}'), ('${GRP}','${OUT}');
      ALTER TABLE chat_participants ENABLE TRIGGER USER;`);
    const roster = (await as(ADMIN, `SELECT public.get_user_chats('${ADMIN}') j`)).rows[0]?.j || [];
    const people = (chat) => (roster.find((c) => c.id === chat)?.participants || []).map((p) => p.user_id);
    ok(people(GC).includes(MEM) && !people(GC).includes(MEM2) && people(GRP).includes(MEM) && !people(GRP).includes(OUT),
      `${tag}: get_user_chats keeps 175's roster filter (gig ${people(GC).length}, group ${people(GRP).length})`);
    await db.exec(`DELETE FROM chat_participants WHERE (chat_id, user_id) IN (('${GC}','${MEM2}'), ('${GRP}','${OUT}'))`);
    const seen = await as(MEM, `SELECT id FROM chats WHERE id = '${QC}'`);
    ok(!seen.error && seen.rows.length === 0, `${tag}: a member can't see the quote chat row (${seen.error || seen.rows.length})`);
    if (steps.includes('193')) {
      const open = await as(MEM, `SELECT public.bw_open_group_chat('event', NULL, '${QE8}', NULL) j`);
      ok(!!open.error && await inChat(QC, MEM) === 0, `${tag}: bw_open_group_chat refuses a member on a quote (${open.error || 'opened'})`);
      const join = await as(ADMIN, `SELECT public.bw_chat_joinable('event', '${BAND}', '${QE8}', '${MEM}') j`);
      ok(join.rows[0]?.j === false, `${tag}: a quote's chat is not joinable for a member`);
    }
    // An older admin build adds the whole lineup to the quote chat in one insert.
    await db.exec(`DELETE FROM chat_participants WHERE chat_id = '${QC}' AND user_id = '${ADMIN}'`);
    const ins = await as(ADMIN, `INSERT INTO chat_participants (chat_id, user_id) VALUES ('${QC}','${ADMIN}'), ('${QC}','${MEM}')`);
    ok(!ins.error && await inChat(QC, ADMIN) === 1 && await inChat(QC, MEM) === 0,
      `${tag}: old build's whole-lineup insert saves the admin, skips the member (${ins.error || 'no error'})`);
    const trig = (await tryq(`SELECT string_agg(tgname, ',' ORDER BY tgname) t FROM pg_trigger WHERE tgrelid = 'public.chat_participants'::regclass AND NOT tgisinternal`)).rows[0]?.t || '';
    await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${QE8}'`);
    const back = (await tryq(`SELECT cleared_at IS NOT NULL c FROM chat_participants WHERE chat_id = '${QC}' AND user_id = '${MEM}'`)).rows[0];
    const list = await as(MEM, `SELECT public.get_user_chats('${MEM}') j`);
    const listed = JSON.stringify(list.rows[0]?.j || []).includes(QC);
    const old = await as(MEM, `SELECT content FROM messages WHERE chat_id = '${QC}'`);
    ok(back?.c === true && listed && old.rows.length === 0 && !old.error,
      `${tag}: confirmed, the member is back (listed, history before the confirmation hidden) [${trig}]`);
    // Re-running 175 afterwards keeps the stronger rule.
    await db.exec(sec175).catch((e) => console.log(`order ${order}, re-run 175:`, e.message));
    const def = await fnDef('bw_chat_scope_ok');
    // The quote rule is in the live bw_chat_scope_ok itself, or in the
    // bw_is_event_participant it calls (178 carries it there).
    const viaParticipant = def.includes('bw_is_event_participant') && (await fnDef('bw_is_event_participant')).includes('bw_event_quote_private');
    ok((def.includes('bw_event_quote_hidden') || viaParticipant) && (!has181 || def.includes('dropped_out')) && def.includes("'group'"),
      `${tag}, then 175 again: the ${has181 ? 'lineup + quote' : 'quote'} rule stays live`);
    const still = await as(MEM, `SELECT id FROM chats WHERE id = '${QC}'`);
    ok(still.rows.length === 1, `${tag}, then 175 again: the confirmed gig's chat stays open to the lineup`);
  };
  await cross('175 → 178');
  await cross('175 → 178 → 181');
  await cross('175 → 181 → 178');
  if (M193) await cross('175 → 178 → 193 → 181');
  else console.log('skip: 175 → 178 → 193 → 181 (set MIG_193)');
  db = db1;
} else {
  console.log('skip: cross-PR 175 + 181 (+ 193) (set MIG_175, MIG_181, MIG_193)');
}

// ── 178's bw_chat_scope_ok has not drifted from 175's ───────────────────────
// Main's rule: 178's own definition is 175's body plus the quote rule. Text
// check, no database: 175's body from origin/fix/security-audit (or the repo
// file once merged; SCOPE_175=<file> to point at another copy), 178's from
// MIG; comments, whitespace, 175's quote placeholder (%s) and 178's quote
// line removed, the rest must be identical. Fails as soon as #281 changes the
// function and 178 hasn't followed.
{
  const { execFileSync } = await import('node:child_process');
  let src175 = null;
  let from = '';
  if (process.env.SCOPE_175) {
    src175 = readFileSync(process.env.SCOPE_175, 'utf8');
    from = process.env.SCOPE_175;
  } else {
    try {
      src175 = execFileSync('git', ['-C', REPO, 'show', 'origin/fix/security-audit:supabase/migrations/175_security_audit_access.sql'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      from = 'origin/fix/security-audit';
    } catch { /* branch gone (merged) or no git */ }
    if (!src175) {
      try { src175 = migFile('175_security_audit_access.sql'); from = 'repo file'; } catch { /* not merged yet */ }
    }
  }
  const body = (sql) => {
    const a = sql ? sql.indexOf('CREATE OR REPLACE FUNCTION public.bw_chat_scope_ok(') : -1;
    const b = a < 0 ? -1 : sql.indexOf('$f$;', a);
    return b < 0 ? null : sql.slice(a, b);
  };
  const norm = (t) => t.replace(/--[^\n]*/g, '')
    .replace('AND NOT public.bw_event_quote_hidden(e.id, w.u)', '')
    .replace('%s', '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),])\s*/g, '$1')
    .trim();
  const b175 = body(src175);
  if (!b175) {
    console.log(`WARN skip: 178 vs 175 bw_chat_scope_ok (no 175 found: origin/fix/security-audit or the repo file)`);
  } else {
    const b178 = body(readFileSync(MIG, 'utf8'));
    const [x, y] = [norm(b175), b178 ? norm(b178) : ''];
    let at = 0;
    while (at < x.length && x[at] === y[at]) at++;
    ok(!!b178 && x === y, `178's bw_chat_scope_ok = 175's (${from}) + the quote rule${x === y ? '' : `; first difference at ${at}: 175 "${x.slice(at, at + 60)}" vs 178 "${y.slice(at, at + 60)}"`}`);
  }
}

console.log(fails ? `\n${passes} passed, ${fails} FAILED` : `\n${passes} passed, ALL OK`);
process.exit(fails ? 1 : 0);
