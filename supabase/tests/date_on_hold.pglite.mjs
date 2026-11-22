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
//   CHAT_TYPE=text ...   # chats.type text in the enum (002-shape) block; default enum
//   SCOPE_175=<175>  ...   # drift check against that 175 (default origin/fix/security-audit)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const REPO = process.argv[2];
const MIG = process.argv[3] ?? `${REPO}/supabase/migrations/178_date_on_hold.sql`;
const migFile = (n) => readFileSync(`${REPO}/supabase/migrations/${n}`, 'utf8');
const lines = (n, a, b) => migFile(n).split('\n').slice(a - 1, b).join('\n');
// One function from a migration, by name (line numbers move when a file
// grows): from its CREATE to the closing $$; / $f$;. MIG_170 overrides 170.
const fnByName = (n, name, src = migFile(n)) => {
  const at = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (at < 0) throw new Error(`${n}: ${name} not found`);
  const end = src.slice(at).search(/\n(\$\$|\$f\$|\$function\$);/);
  if (end < 0) throw new Error(`${n}: ${name} has no closing delimiter`);
  return src.slice(at, at + end).concat(src.slice(at + end).match(/^\n(\$\$|\$f\$|\$function\$);/)[0]);
};

let db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
let passes = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else { passes++; console.log('ok  ', msg); } };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, ADMIN, ADMIN2, MEM, MEM2, OUT] = [1, 2, 3, 4, 5, 6].map(id);
const EXM = id(2700); // a former member
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

async function boot(d, opts = {}) {
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
  event_date date, event_time_start time, event_time_end time, created_at timestamptz DEFAULT now(),
  venue_name text, venue_address text, venue_city text);
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
await d.exec(fnByName('170_live_pack.sql', 'bw_live_pack_window_events',
  process.env.MIG_170 ? readFileSync(process.env.MIG_170, 'utf8') : undefined));
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

// The 002 shape (#289's replay): events.status / event_type and
// quotes.status are enums, chats.type too unless CHAT_TYPE=text. Converted
// after the older live functions load (170's, for one, compares status
// with '' and wouldn't load on enums: prod's columns are text).
if (opts.enums) await d.exec(`
-- 111's events read policy names status / event_type: off while the type
-- changes, back with ::text (111 itself passes them bare: prod is text).
DROP POLICY IF EXISTS events_select_policy ON public.events;
CREATE TYPE event_status AS ENUM ('draft', 'tentative', 'confirmed', 'cancelled', 'completed');
CREATE TYPE event_type AS ENUM ('gig', 'rehearsal', 'wedding', 'corporate', 'private', 'festival', 'other');
CREATE TYPE quote_status AS ENUM ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'negotiating', 'archived');
ALTER TABLE public.events ALTER COLUMN status TYPE event_status USING status::event_status,
  ALTER COLUMN event_type TYPE event_type USING event_type::event_type;
ALTER TABLE public.quotes ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.quotes ALTER COLUMN status TYPE quote_status USING status::quote_status;
ALTER TABLE public.quotes ALTER COLUMN status SET DEFAULT 'draft';
CREATE POLICY events_select_policy ON public.events FOR SELECT TO authenticated
  USING (band_id IS NOT NULL AND public.bw_is_band_member(band_id)
    AND (NOT public.bw_event_is_quote(status::text, event_type::text, quote_id) OR public.bw_is_band_admin(band_id)
         OR created_by = auth.uid() OR public.bw_is_on_event_lineup(id)));
${process.env.CHAT_TYPE === 'text' ? '' : `CREATE TYPE chat_type AS ENUM ('direct', 'group', 'band', 'event', 'rider');
ALTER TABLE public.chats ALTER COLUMN type TYPE chat_type USING type::chat_type;`}
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
-- A former member still on the quote's lineup, with the same old notice.
INSERT INTO band_members (band_id, user_id, role, is_active, left_at) VALUES ('${BAND}','${EXM}','member', false, now() - interval '3 days');
INSERT INTO event_members (event_id, user_id, status, fee) VALUES ('${QE0}','${EXM}','pending', 300);
INSERT INTO notifications (user_id, band_id, type, title, body, data, reference_id, reference_type) VALUES
  ('${EXM}','${BAND}','event_invite','Availability check: Smith Wedding (old)','Jane is quoting. Your fee: $300',
   jsonb_build_object('event_id','${QE0}','tentative',true), NULL, NULL);
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
// #281 round 4: the member's row is KEPT (as 175 / 181 do) and the rule
// refuses it everywhere: no chat, no roster, no own row, no messages.
{
  const kept = (await tryq(`SELECT 1 FROM chat_participants WHERE chat_id = '${QCHAT0}' AND user_id = '${MEM}'`)).rows.length;
  const sees = [
    (await as(MEM, `SELECT 1 FROM chats WHERE id = '${QCHAT0}'`)).rows.length,
    (await as(MEM, `SELECT 1 FROM chat_participants WHERE chat_id = '${QCHAT0}'`)).rows.length,
    (await as(MEM, `SELECT 1 FROM messages WHERE chat_id = '${QCHAT0}'`)).rows.length,
  ];
  const scope = (await tryq(`SELECT public.bw_chat_scope_ok('event', '${BAND}', '${QE0}', '${MEM}') ok`)).rows[0]?.ok;
  ok(kept === 1 && sees.join() === '0,0,0' && scope === false,
    `pre-178 quote chat: the member's row is kept, nothing of the chat reaches them (kept ${kept}, sees ${sees.join('/')}, scope ${scope})`);
}
ok((await tryq(`SELECT 1 FROM chat_participants_quote_178 WHERE chat_id = '${QCHAT0}' AND user_id = '${MEM}'`)).rows.length === 1,
  '... and recorded in chat_participants_quote_178');
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
// Round 6, item 2: a former member's pre-178 "Availability check" is cleaned up too.
{
  const exm = (await notes(`user_id = '${EXM}'`)).length;
  const exmArch = (await tryq(`SELECT 1 FROM notifications_quote_178 WHERE user_id = '${EXM}'`)).rows.length;
  ok(exm === 0 && exmArch === 1, `R6 2: a former member's old quote notice is removed (and archived) like a member's (left ${exm}, archived ${exmArch})`);
}
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

// #281 → #294: a quote confirmed puts its lineup back in the chat, compared
// with lower(btrim()): ' Declined' is not put back. And a kept row the rule
// refuses (dropped out after the confirmation) gets no cut-off from
// bw_quote_chat_cutoffs (no chat id, no date).
{
  const [QC9, QCH9] = [2330, 2331].map(id);
  await mkQuote(QC9, 'Smith Garden', `INSERT INTO event_members (event_id, user_id, status) VALUES ('${QC9}','${MEM}','confirmed'), ('${QC9}','${MEM2}',' Declined');
    INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${QCH9}','event','Smith Garden','${BAND}','${QC9}','${ADMIN}');
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${QCH9}','${ADMIN}')`);
  await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${QC9}'`);
  const inChat = async (u) => (await tryq(`SELECT 1 FROM chat_participants WHERE chat_id = '${QCH9}' AND user_id = '${u}'`)).rows.length;
  ok(await inChat(MEM) === 1 && await inChat(MEM2) === 0, `confirmed: the lineup is back in the chat, ' Declined' is not (${await inChat(MEM)}, ${await inChat(MEM2)})`);
  // The cut-off for the lineup; 'infinity' (hide all, no date) once refused.
  const cut = async () => ((await as(MEM, `SELECT public.bw_quote_chat_cutoffs() j`)).rows[0]?.j || {})[QCH9];
  const before = await cut();
  await asServer(ADMIN, `UPDATE event_members SET status = 'dropped_out' WHERE event_id = '${QC9}' AND user_id = '${MEM}'`);
  await db.exec(`ALTER TABLE chat_participants DISABLE TRIGGER USER;
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${QCH9}','${MEM}') ON CONFLICT DO NOTHING;
    ALTER TABLE chat_participants ENABLE TRIGGER USER;`);
  const after = await cut();
  ok(/^\{\(,/.test(before || '') && before !== '{(,)}' && after === '{(,)}',
    `bw_quote_chat_cutoffs: the lineup gets the private period; a kept row the rule refuses gets all time '{(,)}' (hides everything) (on the lineup ${before}, dropped out ${after})`);
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
  // Kept row, refused by the rule (#281 round 4): the member can't reach the chat.
  const during = (await as(MEM, `SELECT 1 FROM chats WHERE id = '${QCHAT}'`)).rows.length
    + (await as(MEM, `SELECT 1 FROM messages WHERE chat_id = '${QCHAT}'`)).rows.length;
  await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${QE6}'`);
  const orderB = (await tryq(`SELECT cleared_at IS NOT NULL c FROM chat_participants WHERE chat_id = '${QCHAT}' AND user_id = '${MEM}'`)).rows[0];
  ok(during === 0 && orderB?.c === true, `order 181 → 178: out while a quote, back once confirmed, history cleared (${during}, ${JSON.stringify(orderB || null)})`);
  db = db1;
}

// ── Round 4 (Codex on f1da693a, main's decisions) ──────────────────────────
{
  const readsAs = async (uid, chat) => (await as(uid, `SELECT content FROM messages WHERE chat_id = '${chat}' ORDER BY created_at`)).rows.map((r) => r.content);
  const keptRow = async (chat, uid) => db.exec(`ALTER TABLE chat_participants DISABLE TRIGGER USER;
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${chat}','${uid}') ON CONFLICT DO NOTHING;
    ALTER TABLE chat_participants ENABLE TRIGGER USER;`);

  // B1: confirmed, then the musician drops out; their kept row must not open
  // the admins' talk from before the confirmation (the cut-off survives any
  // later lineup or status change).
  const [B1E, B1C] = [2401, 2402].map(id);
  await mkQuote(B1E, 'Smith Loft', `INSERT INTO event_members (event_id, user_id, status) VALUES ('${B1E}','${MEM}','confirmed');
    INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${B1C}','event','Smith Loft','${BAND}','${B1E}','${ADMIN}');
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${B1C}','${ADMIN}');
    INSERT INTO messages (chat_id, sender_id, content, created_at) VALUES ('${B1C}','${ADMIN}','Smith pays 3800', now() - interval '1 hour')`);
  await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${B1E}'`);
  await db.exec(`INSERT INTO messages (chat_id, sender_id, content) VALUES ('${B1C}','${ADMIN}','Load-in at 6')`);
  const b1on = await readsAs(MEM, B1C);
  await asServer(ADMIN, `UPDATE event_members SET status = 'dropped_out' WHERE event_id = '${B1E}' AND user_id = '${MEM}'`);
  await keptRow(B1C, MEM);
  const b1off = await readsAs(MEM, B1C);
  ok(!b1on.includes('Smith pays 3800') && !b1off.includes('Smith pays 3800'),
    `B1: dropped out after the confirmation, the pre-confirmation talk stays hidden (on the lineup ${JSON.stringify(b1on)}, dropped out ${JSON.stringify(b1off)})`);

  // B2: confirmed, back to a quote, then cancelled: what was written while it
  // was a quote again stays hidden (a status change never clears a cut-off).
  const [B2E, B2C] = [2403, 2404].map(id);
  await mkQuote(B2E, 'Smith Barn', `INSERT INTO event_members (event_id, user_id, status) VALUES ('${B2E}','${MEM}','confirmed');
    INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${B2C}','event','Smith Barn','${BAND}','${B2E}','${ADMIN}');
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${B2C}','${ADMIN}');
    INSERT INTO messages (chat_id, sender_id, content, created_at) VALUES ('${B2C}','${ADMIN}','First offer 2500', now() - interval '1 hour')`);
  await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${B2E}'`);
  await asServer(ADMIN, `UPDATE events SET status = 'tentative' WHERE id = '${B2E}'`);
  await db.exec(`INSERT INTO messages (chat_id, sender_id, content) VALUES ('${B2C}','${ADMIN}','They now offer 5200')`);
  await asServer(ADMIN, `UPDATE events SET status = 'cancelled' WHERE id = '${B2E}'`);
  await keptRow(B2C, MEM);
  const b2 = await readsAs(MEM, B2C);
  ok(!b2.includes('They now offer 5200') && !b2.includes('First offer 2500'),
    `B2: confirm, back to a quote, cancel: the quote-time talk stays hidden (${JSON.stringify(b2)})`);

  // B3: a standalone tentative event, cancelled before its hold was announced
  // (no hold row, no quote): still not for members.
  const [B3E, B3G] = [2405, 2406].map(id);
  await asServer(ADMIN, `INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, notes, created_at) VALUES
    ('${B3E}','${BAND}','Smith Rooftop','tentative','gig','${ADMIN}', current_date + 33, 'Client pays 6000', now()),
    ('${B3G}','${BAND}','Hudson Jam','confirmed','gig','${ADMIN}', current_date + 34, 'Bring stands', now())`);
  const b3before = (await tryq(`SELECT 1 FROM event_date_holds WHERE event_id = '${B3E}'`)).rows.length;
  await asServer(ADMIN, `UPDATE events SET status = 'cancelled' WHERE id IN ('${B3E}','${B3G}')`);
  const b3 = (await as(MEM, `SELECT id FROM events WHERE id = '${B3E}'`)).rows.length;
  const b3g = (await as(MEM, `SELECT id FROM events WHERE id = '${B3G}'`)).rows.length;
  ok(b3before === 0 && b3 === 0 && b3g === 1,
    `B3: a tentative event cancelled before its hold was announced stays hidden; a cancelled gig stays shown (hold rows ${b3before}, tentative ${b3}, gig ${b3g})`);

  // M1: "I'm free" checks the whole window the card showed (start and end).
  const M1E = id(2407);
  await mkQuote(M1E, 'Smith Dock');
  await asServer(ADMIN, `UPDATE events SET end_time = '23:00' WHERE id = '${M1E}'`);
  const d1 = (await tryq(`SELECT to_char(event_date, 'YYYY-MM-DD') d FROM events WHERE id = '${M1E}'`)).rows[0]?.d;
  const wrongEnd = await as(MEM, `SELECT public.bw_answer_date_hold('${M1E}', 'free', '${d1}'::date, '20:00', '22:00') a`);
  const rightEnd = await as(MEM, `SELECT public.bw_answer_date_hold('${M1E}', 'free', '${d1}'::date, '20:00', '23:00') a`);
  const old2 = await as(MEM, `SELECT public.bw_answer_date_hold('${M1E}', 'busy') a`);
  ok(/time changed/i.test(wrongEnd.error || '') && rightEnd.rows[0]?.a === 'free' && old2.rows[0]?.a === 'busy',
    `M1: a card with another end time is refused ("the time changed"), the right window saves, an old two-argument call still works (${wrongEnd.error || 'saved'}, ${rightEnd.error || rightEnd.rows[0]?.a}, ${old2.error || old2.rows[0]?.a})`);

  // M2: venue or city edited on Quotes moves to the linked event on hold, and
  // members get the change notice.
  const [M2E, M2Q] = [2408, 2409].map(id);
  await mkQuote(M2E, 'Smith Pier', `INSERT INTO quotes (id, band_id, status, valid_until, converted_to_event_id, created_at, venue_name, venue_city)
    VALUES ('${M2Q}','${BAND}','sent', current_date + 30, '${M2E}', now() - interval '1 day', 'Blue Note', 'New York')`);
  await db.exec(`SELECT public.bw_date_hold_sweep()`).catch(() => {});
  const live = (await tryq(`SELECT public.bw_date_hold_live('${M2E}') l`)).rows[0]?.l;
  await db.exec(`DELETE FROM notifications`);
  await asServer(ADMIN, `UPDATE quotes SET venue_name = 'Pier 17', venue_city = 'Manhattan' WHERE id = '${M2Q}'`);
  const ev = (await tryq(`SELECT venue_name, venue_city FROM events WHERE id = '${M2E}'`)).rows[0] || {};
  const told = (await notes(`type = 'date_hold_changed' AND user_id = '${MEM}'`)).length;
  ok(live === true && ev.venue_name === 'Pier 17' && ev.venue_city === 'Manhattan' && told === 1,
    `M2: venue and city from Quotes reach the event, members are told (live ${live}, ${JSON.stringify(ev)}, told ${told})`);
}

// ── Round 4b (Claude review of f1da693a, main's decisions) ─────────────────
{
  const readsAs = async (uid, chat) => (await as(uid, `SELECT content FROM messages WHERE chat_id = '${chat}' ORDER BY created_at`)).rows.map((r) => r.content);
  // A gig confirmed before 178: no hold row; the quote says 'sent' (accepted
  // on the client link only) or 'archived'.
  const preGig = async (ev, chat, q, title, qStatus, link) => {
    await asServer(ADMIN, `INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, start_time, created_at) VALUES
      ('${ev}','${BAND}','${title}','confirmed','gig','${ADMIN}', current_date + 40, '20:00', now() - interval '30 days');
      INSERT INTO quotes (id, band_id, created_by, client_name, total, status, converted_to_event_id, created_at)
        VALUES ('${q}','${BAND}','${ADMIN}','Hudson', 3000, '${qStatus}', '${ev}', now() - interval '31 days');
      ${link ? `INSERT INTO quote_links (quote_id, band_id, status) VALUES ('${q}','${BAND}','accepted');` : ''}
      INSERT INTO event_members (event_id, user_id, status) VALUES ('${ev}','${MEM}','confirmed');
      INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${chat}','event','${title}','${BAND}','${ev}','${ADMIN}');
      INSERT INTO chat_participants (chat_id, user_id) VALUES ('${chat}','${ADMIN}'), ('${chat}','${MEM}');
      INSERT INTO messages (chat_id, sender_id, content, created_at) VALUES ('${chat}','${ADMIN}','Soundcheck at 5', now() - interval '20 days');`);
    await db.exec(`DELETE FROM event_date_holds WHERE event_id = '${ev}'`).catch(() => {});
  };
  const cancelSeen = async (ev, chat, tag) => {
    await db.exec(`DELETE FROM notifications`);
    const r = await asServer(ADMIN, `UPDATE events SET status = 'cancelled' WHERE id = '${ev}'`).then(() => null, (e) => e.message);
    const told = (await notes(`type = 'event_cancelled' AND user_id = '${MEM}'`)).length;
    const sees = (await as(MEM, `SELECT id FROM events WHERE id = '${ev}'`)).rows.length;
    const chatSeen = (await as(MEM, `SELECT id FROM chats WHERE id = '${chat}'`)).rows.length;
    const msgs = await readsAs(MEM, chat);
    const cut = (await tryq(`SELECT history_cutoff_at c FROM event_date_holds WHERE event_id = '${ev}'`)).rows[0]?.c ?? null;
    ok(!r && told === 1 && sees === 1 && chatSeen === 1 && msgs.includes('Soundcheck at 5') && cut === null,
      `B1 ${tag}: a gig from before 178, cancelled: the lineup is told, the event and its chat stay, no history cut-off (${r || ''} told ${told}, event ${sees}, chat ${chatSeen}, ${JSON.stringify(msgs)}, cut ${cut})`);
  };
  const [P1E, P1C, P1Q, P2E, P2C, P2Q, P3E, P3C, P3Q, P4E, P4C, P4Q] = [2501, 2502, 2503, 2504, 2505, 2506, 2507, 2508, 2509, 2510, 2511, 2512].map(id);
  // Accepted only on the client link (quotes.status stays 'sent').
  await preGig(P1E, P1C, P1Q, 'Hudson Hall', 'sent', true);
  await cancelSeen(P1E, P1C, 'accepted on the client link');
  // The quote archived.
  await preGig(P2E, P2C, P2Q, 'Hudson Yard', 'archived', false);
  await cancelSeen(P2E, P2C, 'quote archived');
  // The link alone (no record yet, the trigger's upsert off): still a gig.
  await preGig(P4E, P4C, P4Q, 'Hudson Pier', 'sent', true);
  await db.exec(`ALTER TABLE events DISABLE TRIGGER USER; UPDATE events SET status = 'cancelled' WHERE id = '${P4E}';
    ALTER TABLE events ENABLE TRIGGER USER;`);
  await db.exec(`DELETE FROM event_date_holds WHERE event_id = '${P4E}'`).catch(() => {});
  const p4 = (await as(MEM, `SELECT id FROM events WHERE id = '${P4E}'`)).rows.length;
  ok(p4 === 1, `B1 link: cancelled with no record, an accepted client link still makes it a gig's cancel (${p4})`);
  // Section 12 backfill: re-applying 178 records gigs from quotes as once a
  // gig ('pre178', released, no cut-off); the sweep leaves the row alone.
  await preGig(P3E, P3C, P3Q, 'Hudson Barge', 'archived', false);
  const reapply = await db.exec(readFileSync(MIG, 'utf8')).then(() => null, async (e) => { await db.exec('ROLLBACK').catch(() => {}); return e.message; });
  await db.exec(`SELECT public.bw_date_hold_sweep()`).catch(() => {});
  const bf = (await tryq(`SELECT release_reason r, released_at IS NOT NULL rel, confirmed_once_at IS NOT NULL once, history_cutoff_at c FROM event_date_holds WHERE event_id = '${P3E}'`)).rows[0] || {};
  const live3 = (await tryq(`SELECT public.bw_date_hold_live('${P3E}') l`)).rows[0]?.l;
  ok(!reapply && bf.r === 'pre178' && bf.rel === true && bf.once === true && bf.c == null && live3 === false,
    `B1 backfill: 'pre178', released, once a gig, no cut-off, no live hold (${reapply || JSON.stringify(bf)}, live ${live3})`);
  await cancelSeen(P3E, P3C, 'backfilled');

  // M2: apps can't call bw_event_quote_private; _hidden says nothing to
  // non-members of the band.
  const Q5 = id(2513);
  await mkQuote(Q5, 'Smith Garden');
  const priv = await as(MEM, `SELECT public.bw_event_quote_private('${Q5}', 'tentative', 'gig', NULL) p`);
  const hidOut = await as(OUT, `SELECT public.bw_event_quote_hidden('${Q5}') h`);
  const hidOutMem = await as(OUT, `SELECT public.bw_event_quote_hidden('${Q5}', '${MEM}') h`);
  const hidMem = await as(MEM, `SELECT public.bw_event_quote_hidden('${Q5}') h`);
  const hidAdm = await as(ADMIN, `SELECT public.bw_event_quote_hidden('${Q5}', '${MEM}') h`);
  const admSees = (await as(ADMIN, `SELECT id FROM events WHERE id = '${Q5}'`)).rows.length;
  const memSees = (await as(MEM, `SELECT id FROM events WHERE id = '${Q5}'`)).rows.length;
  ok(/permission denied/i.test(priv.error || '') && hidOut.rows[0]?.h === false && hidOutMem.rows[0]?.h === false
     && hidMem.rows[0]?.h === true && hidAdm.rows[0]?.h === true && admSees === 1 && memSees === 0,
    `M2: _private refused to apps, _hidden false for a caller outside the band (also asking about a member), true for the member and the admin's question; the events rule still works (${priv.error || 'callable'}, ${hidOut.error || hidOut.rows[0]?.h}, ${hidOutMem.error || hidOutMem.rows[0]?.h}, ${hidMem.rows[0]?.h}, ${hidAdm.rows[0]?.h}, admin ${admSees}, member ${memSees})`);

  // M1: the hidden-chat list and the cut-offs start from the caller's rows.
  const defs = (await tryq(`SELECT pg_get_functiondef('public.bw_hidden_quote_chat_ids()'::regprocedure) h, pg_get_functiondef('public.bw_quote_chat_cutoffs()'::regprocedure) c`)).rows[0] || {};
  ok(/FROM band_members bm WHERE bm\.user_id = auth\.uid\(\)/.test(defs.h || '') && /cp\.user_id = auth\.uid\(\)/.test(defs.h || '') && !/bw_is_band_member\(e\.band_id/.test(defs.h || '')
     && /FROM chat_participants cp\s+JOIN chats c/.test(defs.c || '') && /cp\.user_id = auth\.uid\(\)/.test(defs.c || ''),
    'M1: hidden quote chats from own bands + own chat rows + own chats; cut-offs from own chat rows (no scan of every event chat)');
  const memHid = (await as(MEM, `SELECT public.bw_hidden_quote_chat_ids() ids`)).rows[0]?.ids || [];
  const outHid = (await as(OUT, `SELECT public.bw_hidden_quote_chat_ids() ids`)).rows[0]?.ids || [];
  const qChats = (await tryq(`SELECT c.id FROM chats c JOIN events e ON e.id = c.event_id WHERE e.band_id = '${BAND}' AND e.status = 'tentative'`)).rows.map((r) => r.id);
  ok(qChats.length > 0 && qChats.every((c) => memHid.includes(c)) && outHid.length === 0,
    `M1: a member's list still holds every quote chat of their band; another account's holds none (${qChats.length}, member ${memHid.length}, other ${outHid.length})`);

  // M3/M4: an event with only "date" (event_date NULL) counts in free slots;
  // the answer check reads the same day.
  const [D1, D2] = [2514, 2515].map(id);
  await asServer(ADMIN, `INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, "date", start_time, created_at) VALUES
    ('${D1}','${BAND}','Hudson Brunch','confirmed','gig','${ADMIN}', NULL, current_date + 50, '12:00', now());
    INSERT INTO event_members (event_id, user_id, status) VALUES ('${D1}','${MEM}','confirmed');`);
  const fsD = await as(ADMIN, `SELECT free_count, total_count FROM public.bw_band_free_slots('${BAND}', current_date + 50, current_date + 50)`);
  ok(!fsD.error && fsD.rows[0] && fsD.rows[0].free_count === fsD.rows[0].total_count - 1,
    `M3: a gig with only "date" makes its musician busy that day (${fsD.error || JSON.stringify(fsD.rows[0])})`);
  await mkQuote(D2, 'Smith Lawn');
  await asServer(ADMIN, `UPDATE events SET "date" = event_date WHERE id = '${D2}'`);
  await db.exec(`ALTER TABLE events DISABLE TRIGGER USER; UPDATE events SET event_date = NULL WHERE id = '${D2}'; ALTER TABLE events ENABLE TRIGGER USER;`);
  const dd = (await tryq(`SELECT to_char("date", 'YYYY-MM-DD') d FROM events WHERE id = '${D2}'`)).rows[0]?.d;
  const liveD = (await tryq(`SELECT public.bw_date_hold_live('${D2}') l`)).rows[0]?.l;
  const ansD = await as(MEM, `SELECT public.bw_answer_date_hold('${D2}', 'free', '${dd}'::date, '20:00', NULL) a`);
  const fsH = await as(ADMIN, `SELECT free_count FROM public.bw_band_free_slots('${BAND}', '${dd}'::date, '${dd}'::date)`);
  ok(liveD === true && ansD.rows[0]?.a === 'free' && !fsH.error && fsH.rows[0]?.free_count === 0,
    `M4: a hold with only "date": the answer for that day saves, and the hold blocks the day (live ${liveD}, ${ansD.error || ansD.rows[0]?.a}, ${fsH.error || JSON.stringify(fsH.rows[0])})`);
}

// ── Round 5 (Codex + Claude r4 on 7cb38d0b, main's decisions) ───────────────
{
  const readsAs = async (uid, chat) => (await as(uid, `SELECT content FROM messages WHERE chat_id = '${chat}' ORDER BY created_at`)).rows.map((r) => r.content);
  const say = (chat, text) => db.exec(`INSERT INTO messages (chat_id, sender_id, content) VALUES ('${chat}','${ADMIN}','${text}')`);
  const myHold = async (uid, ev) => (await as(uid, `SELECT * FROM public.bw_my_date_holds() WHERE event_id = '${ev}'`)).rows[0];

  // B1: confirm, back to a quote, confirm again: the second negotiation stays
  // with the admins (the cut-off is the latest confirmation).
  const [C1E, C1C] = [2601, 2602].map(id);
  await mkQuote(C1E, 'Smith Terrace', `INSERT INTO event_members (event_id, user_id, status) VALUES ('${C1E}','${MEM}','confirmed');
    INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${C1C}','event','Smith Terrace','${BAND}','${C1E}','${ADMIN}');
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${C1C}','${ADMIN}');`);
  await say(C1C, 'First offer 3000');
  await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${C1E}'`);
  await asServer(ADMIN, `UPDATE events SET status = 'tentative' WHERE id = '${C1E}'`);
  await say(C1C, 'Second offer 6100');
  await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${C1E}'`);
  await say(C1C, 'See you at 6');
  const c1 = await readsAs(MEM, C1C);
  ok(c1.includes('See you at 6') && !c1.includes('Second offer 6100') && !c1.includes('First offer 3000'),
    `R5 B1: confirm, revert, confirm again: the second negotiation stays hidden (${JSON.stringify(c1)})`);

  // B2: a deputy's reply link, the deputy feed and the member calendar feed
  // after the gig went back to a quote.
  await db.exec(`ALTER TABLE deputy_requests ADD COLUMN IF NOT EXISTS answer_snapshot jsonb, ADD COLUMN IF NOT EXISTS reply_note text,
      ADD COLUMN IF NOT EXISTS responded_at timestamptz;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS is_recurring boolean DEFAULT false, ADD COLUMN IF NOT EXISTS address text;
    CREATE TABLE IF NOT EXISTS public.calendar_feeds (user_id uuid PRIMARY KEY, token text);`);
  await db.exec(fnByName('084_deputy_requests.sql', 'bw_deputy_event_snapshot'));
  // Without 178's versions (an older 178), main's: 084 and 165.
  for (const [n, f] of [['084_deputy_requests.sql', 'bw_deputy_request_view'], ['084_deputy_requests.sql', 'bw_deputy_feed'], ['165_member_calendar.sql', 'bw_member_calendar_feed']]) {
    if (!(await tryq(`SELECT to_regprocedure('public.${f}(text)') p`)).rows[0]?.p) await db.exec(fnByName(n, f));
  }
  const [DGE, DGR, DGD] = [2603, 2604, 2605].map(id);
  const TOK = 'a'.repeat(64);
  const FEED = 'b'.repeat(64);
  await asServer(ADMIN, `INSERT INTO band_deputies (id, band_id, name) VALUES ('${DGD}','${BAND}','Ray Dep');
    INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, start_time, venue_name, venue_city, created_at)
    VALUES ('${DGE}','${BAND}','Smith Ballroom','confirmed','gig','${ADMIN}', current_date + 21, '19:00','Webster Hall','New York', now() - interval '1 day');
    INSERT INTO event_members (event_id, user_id, status) VALUES ('${DGE}','${MEM}','confirmed');
    INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, status, token)
      VALUES ('${DGR}','${BAND}','${DGE}','${DGD}','Ray Dep','available','${TOK}');
    INSERT INTO calendar_feeds (user_id, token) VALUES ('${MEM}','${FEED}') ON CONFLICT DO NOTHING`);
  const dv = async () => (await tryq(`SELECT public.bw_deputy_request_view('${TOK}') v`)).rows[0]?.v || {};
  const df = async () => ((await tryq(`SELECT public.bw_deputy_feed('${TOK}') v`)).rows[0]?.v?.gigs || []).map((g) => g.event_title);
  const mf = async () => ((await tryq(`SELECT public.bw_member_calendar_feed('${FEED}') v`)).rows[0]?.v?.events || []).map((e) => e.id);
  const v0 = await dv(); const f0 = await df(); const m0 = await mf();
  await asServer(ADMIN, `UPDATE events SET status = 'tentative' WHERE id = '${DGE}'`);
  const v1 = await dv(); const f1 = await df(); const m1 = await mf();
  ok(v0.event_title === 'Smith Ballroom' && f0.includes('Smith Ballroom') && m0.includes(DGE)
     && v1.closed === true && v1.event_title == null && v1.venue_name == null && v1.event_date == null && v1.start_time == null
     && !f1.includes('Smith Ballroom') && !m1.includes(DGE),
    `R5 B2: back to a quote: the reply link is closed with no title, day, time or place; the deputy and member feeds drop it (before ${v0.event_title}/${f0.length}/${m0.length}, after ${JSON.stringify({ t: v1.event_title, v: v1.venue_name, closed: v1.closed })}, ${JSON.stringify(f1)}, ${m1.includes(DGE)})`);
  if (!(await tryq(`SELECT to_regprocedure('public.bw_deputy_request_reply(text, text, text)') p`)).rows[0]?.p) {
    await db.exec(fnByName('084_deputy_requests.sql', 'bw_deputy_request_reply'));
  }
  const rep = await tryq(`SELECT public.bw_deputy_request_reply('${TOK}', 'maybe') v`);
  const st = (await tryq(`SELECT status FROM deputy_requests WHERE id = '${DGR}'`)).rows[0]?.status;
  ok(!rep.error && rep.rows[0]?.v?.closed === true && rep.rows[0]?.v?.event_title == null && st === 'available',
    `R5 B2: a reply on the closed link changes nothing and shows nothing (${rep.error || JSON.stringify({ closed: rep.rows[0]?.v?.closed, t: rep.rows[0]?.v?.event_title })}, ${st})`);

  // B3: the admin moves the event, then edits only the venue on the quote:
  // the event keeps its new day.
  const [MVE, MVQ] = [2606, 2607].map(id);
  await mkQuote(MVE, 'Smith Atrium', `INSERT INTO quotes (id, band_id, status, valid_until, converted_to_event_id, created_at, event_date, venue_name, venue_city)
    VALUES ('${MVQ}','${BAND}','sent', current_date + 30, '${MVE}', now() - interval '1 day', current_date + 12, 'Blue Note', 'New York')`);
  await asServer(ADMIN, `UPDATE events SET event_date = current_date + 19 WHERE id = '${MVE}'`);
  await asServer(ADMIN, `UPDATE quotes SET venue_name = 'Pier 40' WHERE id = '${MVQ}'`);
  const mv = (await tryq(`SELECT event_date - current_date AS d, venue_name FROM events WHERE id = '${MVE}'`)).rows[0] || {};
  ok(mv.d === 19 && mv.venue_name === 'Pier 40', `R5 B3: a venue edit on the quote keeps the event's own new day (${JSON.stringify(mv)})`);

  // M1: rescheduling takes the hold's lock before it clears the answers.
  const trg = await fnDef('bw_trg_event_changed');
  const iLock = trg.indexOf('pg_advisory_xact_lock(178');
  const iDel = trg.indexOf('DELETE FROM event_hold_answers');
  ok(iLock > 0 && iDel > 0 && iLock < iDel, `R5 M1: the event trigger locks the hold before deleting its answers (lock at ${iLock}, delete at ${iDel})`);

  // M2: declined, then reopened on the same date: it asks again.
  const [RPE, RPQ] = [2608, 2609].map(id);
  await mkQuote(RPE, 'Smith Pavilion', `INSERT INTO quotes (id, band_id, status, valid_until, converted_to_event_id, created_at)
    VALUES ('${RPQ}','${BAND}','sent', current_date + 30, '${RPE}', now() - interval '1 day')`);
  await db.exec(`SELECT public.bw_date_hold_sweep()`).catch(() => {});
  const a1 = await as(MEM, `SELECT public.bw_answer_date_hold('${RPE}', 'free') a`);
  await asServer(ADMIN, `UPDATE quotes SET status = 'declined' WHERE id = '${RPQ}'`);
  const gone = await myHold(MEM, RPE);
  await asServer(ADMIN, `UPDATE quotes SET status = 'sent' WHERE id = '${RPQ}'`);
  await db.exec(`SELECT public.bw_date_hold_sweep()`).catch(() => {});
  const back = await myHold(MEM, RPE);
  ok(a1.rows[0]?.a === 'free' && !gone && back && back.my_answer == null,
    `R5 M2: reopened after a decline, the hold asks again (answered ${a1.error || a1.rows[0]?.a}, while declined ${!!gone}, reopened ${back ? back.my_answer : 'no hold'})`);

  // M3: an older event with only "time": the card shows it, and the answer
  // for that time saves.
  const TME = id(2610);
  await mkQuote(TME, 'Smith Cellar');
  await asServer(ADMIN, `UPDATE events SET start_time = NULL, "time" = '19:30' WHERE id = '${TME}'`);
  const th = await myHold(MEM, TME);
  const td = (await tryq(`SELECT to_char(coalesce(event_date, date), 'YYYY-MM-DD') d FROM events WHERE id = '${TME}'`)).rows[0]?.d;
  const ta = await as(MEM, `SELECT public.bw_answer_date_hold('${TME}', 'free', '${td}'::date, '19:30', NULL) a`);
  ok(String(th?.start_time || '').startsWith('19:30') && ta.rows[0]?.a === 'free',
    `R5 M3: a hold with only "time" shows 19:30 and takes the answer (${th ? th.start_time : 'no hold'}, ${ta.error || ta.rows[0]?.a})`);

  // Claude 1: quotes are found by their event through an index.
  const ix = (await tryq(`SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_quotes_converted_to_event_id'`)).rows.length;
  ok(ix === 1, `R5 C1: idx_quotes_converted_to_event_id exists (${ix})`);

  // Claude 2: an old admin build's "Availability check" to someone outside
  // the band who is on a quote's lineup is dropped too.
  const AVE = id(2611);
  await mkQuote(AVE, 'Smith Garden Party', `INSERT INTO event_members (event_id, user_id, status, fee) VALUES ('${AVE}','${OUT}','pending', 300)`);
  await db.exec(`DELETE FROM notifications`);
  await asServer(ADMIN, `INSERT INTO notifications (user_id, band_id, type, title, body, data, reference_id, reference_type) VALUES
    ('${OUT}','${BAND}','event_invite','Availability check: Smith','Your fee: $300', jsonb_build_object('event_id','${AVE}'), '${AVE}', 'event'),
    ('${ADMIN2}','${BAND}','event_invite','Availability check: Smith','Your fee: $300', jsonb_build_object('event_id','${AVE}'), '${AVE}', 'event')`);
  const nOut = (await notes(`user_id = '${OUT}'`)).length;
  const nAdm = (await notes(`user_id = '${ADMIN2}'`)).length;
  ok(nOut === 0 && nAdm === 1, `R5 C2: a quote notice reaches only the band's admins, not someone outside the band on its lineup (outside ${nOut}, admin ${nAdm})`);

  // Claude 3: the events rule checks the row first, with the same answers.
  const qual = (await tryq(`SELECT qual FROM pg_policies WHERE tablename = 'events' AND policyname = 'events_select_policy'`)).rows[0]?.qual || '';
  const both = async (uid) => {
    await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '${claims(uid)}', true);`);
    try {
      return (await db.query(`SELECT id,
        (band_id IS NOT NULL AND public.bw_is_band_member(band_id) AND NOT public.bw_event_quote_hidden(id)) AS a,
        (band_id IS NOT NULL AND public.bw_is_band_member(band_id)
          AND ((NOT public.bw_event_is_quote(status::text, event_type::text, quote_id)
                AND lower(coalesce(status::text, '')) NOT IN ('cancelled', 'canceled'))
               OR NOT public.bw_event_quote_hidden(id))) AS b FROM events`)).rows;
    } catch { return [{ id: 'error', a: true, b: false }]; } finally { await db.exec('COMMIT').catch(() => {}); }
  };
  let rows = 0; const diff = [];
  for (const u of [ADMIN, ADMIN2, MEM, MEM2, OUT]) for (const r of await both(u)) { rows++; if (r.a !== r.b) diff.push(`${u.slice(-2)}:${r.id.slice(-4)}`); }
  ok(/bw_event_is_quote/.test(qual) && diff.length === 0 && rows > 50,
    `R5 C3: the events rule checks the row's own columns first, same answer on every event for every account (${rows} pairs, ${diff.length} differ ${diff.slice(0, 5).join(' ')})`);
}

// ── Round 6 (Claude r5 on 979641c3, main's decisions) ──────────────────────
{
  const readsAs = async (uid, chat) => (await as(uid, `SELECT content FROM messages WHERE chat_id = '${chat}' ORDER BY created_at`)).rows.map((r) => r.content);
  const tick = () => new Promise((r) => setTimeout(r, 15));
  const say = async (chat, text) => { await tick(); await db.exec(`INSERT INTO messages (chat_id, sender_id, content, created_at) VALUES ('${chat}','${ADMIN}','${text}', clock_timestamp())`); await tick(); };
  const keptRow = async (chat, uid) => db.exec(`ALTER TABLE chat_participants DISABLE TRIGGER USER;
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${chat}','${uid}') ON CONFLICT DO NOTHING;
    ALTER TABLE chat_participants ENABLE TRIGGER USER;`);

  // 1a: the event trigger takes the hold's lock before any write to event_date_holds.
  const trg = await fnDef('bw_trg_event_changed');
  const iLock = trg.indexOf('pg_advisory_xact_lock(178');
  const iWrite = Math.min(...['INSERT INTO event_date_holds', 'UPDATE event_date_holds'].map((k) => { const i = trg.indexOf(k); return i < 0 ? Infinity : i; }));
  const iPeriod = trg.indexOf('bw_quote_private_period');
  ok(iLock > 0 && iLock < iWrite && (iPeriod < 0 || iLock < iPeriod) && /SQLSTATE IN \('40P01', '40001'\) THEN RAISE/.test(trg),
    `R6 1a: bw_trg_event_changed locks the hold first (lock ${iLock}, first hold write ${iWrite}) and re-raises deadlocks / serialization failures`);

  // 1b: an edit of a confirmed gig from a quote doesn't rewrite its record.
  const [UPE, UPQ] = [2701, 2702].map(id);
  await asServer(ADMIN, `INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, created_at)
      VALUES ('${UPE}','${BAND}','Hudson Patio','confirmed','gig','${ADMIN}', current_date + 44, now() - interval '9 days');
    INSERT INTO quotes (id, band_id, created_by, client_name, total, status, converted_to_event_id, created_at)
      VALUES ('${UPQ}','${BAND}','${ADMIN}','Hudson', 2000, 'archived', '${UPE}', now() - interval '10 days')`);
  await asServer(ADMIN, `UPDATE events SET title = 'Hudson Patio 2' WHERE id = '${UPE}'`);
  const x1 = (await tryq(`SELECT xmin::text x FROM event_date_holds WHERE event_id = '${UPE}'`)).rows[0]?.x;
  await asServer(ADMIN, `UPDATE events SET title = 'Hudson Patio 3' WHERE id = '${UPE}'`);
  const x2 = (await tryq(`SELECT xmin::text x FROM event_date_holds WHERE event_id = '${UPE}'`)).rows[0]?.x;
  ok(!!x1 && x1 === x2, `R6 1b: the gig's record is written once, not on every edit (xmin ${x1} -> ${x2})`);

  // 1c: a deadlock inside the trigger fails the revert instead of landing half done.
  const [DLE, DLC] = [2703, 2704].map(id);
  await mkQuote(DLE, 'Smith Courtyard', `INSERT INTO event_members (event_id, user_id, status) VALUES ('${DLE}','${MEM}','confirmed');
    INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${DLC}','event','Smith Courtyard','${BAND}','${DLE}','${ADMIN}');
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${DLC}','${ADMIN}');`);
  await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${DLE}'`);
  const prune = (await tryq(`SELECT pg_get_functiondef('public.bw_quote_chat_prune(uuid)'::regprocedure) d`)).rows[0]?.d;
  await db.exec(`CREATE OR REPLACE FUNCTION public.bw_quote_chat_prune(p_event_id uuid DEFAULT NULL) RETURNS integer LANGUAGE plpgsql AS $f$
    BEGIN RAISE EXCEPTION 'deadlock detected' USING ERRCODE = '40P01'; END $f$;`);
  const dl = await asServer(ADMIN, `UPDATE events SET status = 'tentative' WHERE id = '${DLE}'`).then(() => null, async (e) => { await db.exec('ROLLBACK').catch(() => {}); return e.message; });
  if (prune) await db.exec(prune);
  const dlStatus = (await tryq(`SELECT status FROM events WHERE id = '${DLE}'`)).rows[0]?.status;
  ok(/deadlock/.test(dl || '') && dlStatus === 'confirmed', `R6 1c: a deadlock in the revert fails it visibly; the gig stays confirmed (${dl || 'no error'}, ${dlStatus})`);

  // 1d: a revert in the same transaction as a change of the client's link: whole state.
  const [LKE, LKQ, LKC] = [2705, 2706, 2707].map(id);
  await mkQuote(LKE, 'Smith Boathouse', `INSERT INTO quotes (id, band_id, status, valid_until, converted_to_event_id, created_at)
      VALUES ('${LKQ}','${BAND}','sent', current_date + 30, '${LKE}', now() - interval '1 day');
    INSERT INTO quote_links (quote_id, band_id, status) VALUES ('${LKQ}','${BAND}','sent');
    INSERT INTO event_members (event_id, user_id, status) VALUES ('${LKE}','${MEM}','confirmed');
    INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${LKC}','event','Smith Boathouse','${BAND}','${LKE}','${ADMIN}');
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${LKC}','${ADMIN}');`);
  await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${LKE}'`);
  const lk = await asServer(ADMIN, `UPDATE quote_links SET status = 'discussing' WHERE quote_id = '${LKQ}';
    UPDATE events SET status = 'tentative' WHERE id = '${LKE}'`).then(() => null, async (e) => { await db.exec('ROLLBACK').catch(() => {}); return e.message; });
  const lkh = (await tryq(`SELECT release_reason r, upper_inf(private_periods) open FROM event_date_holds WHERE event_id = '${LKE}'`)).rows[0] || {};
  const lkSees = (await as(MEM, `SELECT id FROM chats WHERE id = '${LKC}'`)).rows.length;
  ok(!lk && lkh.open === true && lkSees === 0, `R6 1d: revert with a link change in the same transaction: a private period is open and the chat is the admins' (${lk || JSON.stringify(lkh)}, member sees ${lkSees})`);

  // 3: confirm, revert, confirm: the first gig period stays readable for the
  // lineup, both negotiations stay with the admins.
  const [PPE, PPC] = [2708, 2709].map(id);
  await mkQuote(PPE, 'Smith Conservatory', `INSERT INTO event_members (event_id, user_id, status) VALUES ('${PPE}','${MEM}','confirmed');
    INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${PPC}','event','Smith Conservatory','${BAND}','${PPE}','${ADMIN}');
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${PPC}','${ADMIN}');`);
  await say(PPC, 'Offer one 3000');
  await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${PPE}'`);
  await say(PPC, 'Gig talk: load-in at 5');
  await asServer(ADMIN, `UPDATE events SET status = 'tentative' WHERE id = '${PPE}'`);
  await say(PPC, 'Offer two 6100');
  await asServer(ADMIN, `UPDATE events SET status = 'confirmed' WHERE id = '${PPE}'`);
  await say(PPC, 'Gig talk: see you at 6');
  const pp = await readsAs(MEM, PPC);
  const ppAdm = await readsAs(ADMIN, PPC);
  ok(pp.includes('Gig talk: load-in at 5') && pp.includes('Gig talk: see you at 6') && !pp.includes('Offer one 3000') && !pp.includes('Offer two 6100') && ppAdm.length === 4,
    `R6 3: confirm, revert, confirm: both gig periods readable, both negotiations hidden; admins read all (${JSON.stringify(pp)}, admin ${ppAdm.length})`);

  // 4: a gig back to a quote: the deputy link reads "Request withdrawn".
  const [W4E, W4R, W4D] = [2710, 2711, 2712].map(id);
  const TOK4 = 'c'.repeat(64);
  await asServer(ADMIN, `INSERT INTO band_deputies (id, band_id, name) VALUES ('${W4D}','${BAND}','Kim Dep');
    INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, created_at)
      VALUES ('${W4E}','${BAND}','Smith Loft Party','confirmed','gig','${ADMIN}', current_date + 26, now() - interval '1 day');
    INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, status, token)
      VALUES ('${W4R}','${BAND}','${W4E}','${W4D}','Kim Dep','available','${TOK4}')`);
  await asServer(ADMIN, `UPDATE events SET status = 'tentative' WHERE id = '${W4E}'`);
  const w4 = (await tryq(`SELECT public.bw_deputy_request_view('${TOK4}') v`)).rows[0]?.v || {};
  ok(w4.closed === true && w4.status === 'cancelled' && w4.event_cancelled === false && w4.event_title == null,
    `R6 4: the hidden gig's link is closed as "withdrawn" (status ${w4.status}, event_cancelled ${w4.event_cancelled}, closed ${w4.closed})`);

  // 5: every way out of privacy closes a private period (draft, rehearsal).
  for (const [n, set, tag] of [[2713, `status = 'draft'`, 'draft'], [2715, `event_type = 'rehearsal'`, 'rehearsal']]) {
    const [XE, XC] = [n, n + 1].map(id);
    await mkQuote(XE, `Smith Exit ${tag}`, `INSERT INTO event_members (event_id, user_id, status) VALUES ('${XE}','${MEM}','confirmed');
      INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${XC}','event','Smith Exit','${BAND}','${XE}','${ADMIN}');
      INSERT INTO chat_participants (chat_id, user_id) VALUES ('${XC}','${ADMIN}');`);
    await keptRow(XC, MEM);
    await say(XC, `Client pays 7000 (${tag})`);
    await asServer(ADMIN, `UPDATE events SET ${set} WHERE id = '${XE}'`);
    await say(XC, `After (${tag})`);
    const xs = await readsAs(MEM, XC);
    ok(!xs.includes(`Client pays 7000 (${tag})`) && xs.includes(`After (${tag})`),
      `R6 5: out of privacy as a ${tag}: the negotiation stays with the admins, later messages readable (${JSON.stringify(xs)})`);
  }

  // 5b: legacy "time" in the gig notices: the time shows, a change counts.
  const TGE = id(2717);
  await asServer(ADMIN, `INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, "time", created_at)
      VALUES ('${TGE}','${BAND}','Rooftop Matinee','confirmed','gig','${ADMIN}', current_date + 8, '15:00', now() - interval '1 day');
    INSERT INTO event_members (event_id, user_id, status) VALUES ('${TGE}','${MEM}','confirmed');`);
  await db.exec(`DELETE FROM notifications`);
  await asServer(ADMIN, `UPDATE events SET "time" = '16:30' WHERE id = '${TGE}'`);
  const tg = (await notes(`type = 'event_update' AND user_id = '${MEM}'`))[0];
  ok(!!tg && /16:30/.test(tg.body || '') && JSON.stringify(tg.data?.changes || []).includes('time'),
    `R6 5b: a gig with only "time": the notice shows 16:30 and lists the time change (${tg ? `${tg.body} ${JSON.stringify(tg.data?.changes)}` : 'no notice'})`);
}

// ── Round 7 (Claude review of 4a60181a, main's decisions) ──────────────────
{
  const readsAs = async (uid, chat) => (await as(uid, `SELECT content FROM messages WHERE chat_id = '${chat}' ORDER BY created_at`)).rows.map((r) => r.content);
  const tick = () => new Promise((r) => setTimeout(r, 15));
  const say = async (chat, text) => { await tick(); await db.exec(`INSERT INTO messages (chat_id, sender_id, content, created_at) VALUES ('${chat}','${ADMIN}','${text}', clock_timestamp())`); await tick(); };
  const keptRow = async (chat, uid) => db.exec(`ALTER TABLE chat_participants DISABLE TRIGGER USER;
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${chat}','${uid}') ON CONFLICT DO NOTHING;
    ALTER TABLE chat_participants ENABLE TRIGGER USER;`);
  const hold = async (e) => (await tryq(`SELECT private_periods::text pp, upper_inf(private_periods) open, release_reason r, released_at IS NULL live
    FROM event_date_holds WHERE event_id = '${e}'`)).rows[0] || {};

  // 1: a cancelled quote (never a gig) whose client link is accepted later:
  // privacy ends with no events write; the negotiation stays the admins'.
  const [C1E, C1Q, C1C] = [2801, 2802, 2803].map(id);
  await mkQuote(C1E, 'Smith Garden', `INSERT INTO quotes (id, band_id, status, valid_until, converted_to_event_id, created_at)
      VALUES ('${C1Q}','${BAND}','sent', current_date + 30, '${C1E}', now() - interval '1 day');
    INSERT INTO quote_links (quote_id, band_id, status) VALUES ('${C1Q}','${BAND}','sent');
    INSERT INTO event_members (event_id, user_id, status) VALUES ('${C1E}','${MEM}','confirmed');
    INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${C1C}','event','Smith Garden','${BAND}','${C1E}','${ADMIN}');
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${C1C}','${ADMIN}');`);
  await keptRow(C1C, MEM);
  await say(C1C, 'P1 negotiation 9999');
  await asServer(ADMIN, `UPDATE events SET status = 'cancelled' WHERE id = '${C1E}'`);
  // The client accepts the still-live link (bw_quote_link_respond, 187).
  await db.exec(`UPDATE quote_links SET status = 'accepted' WHERE quote_id = '${C1Q}'`);
  await say(C1C, 'P1 after the accept');
  const c1 = await readsAs(MEM, C1C);
  const c1h = await hold(C1E);
  ok(!c1.includes('P1 negotiation 9999') && c1h.open === false && !!c1h.pp && c1h.pp !== '{}',
    `R7 1: a link accepted on a cancelled quote closes the private period; the negotiation stays hidden (${JSON.stringify(c1)}, periods ${c1h.pp})`);
  // Back from accepted: private again, a new period opens.
  await db.exec(`UPDATE quote_links SET status = 'discussing' WHERE quote_id = '${C1Q}'`);
  const c1b = await hold(C1E);
  ok(c1b.open === true, `R7 1b: the link back from accepted: the cancelled quote is private again, a period is open (${c1b.pp})`);
  // An accepted link inserted on a cancelled quote: the same.
  const [C2E, C2Q, C2C] = [2804, 2805, 2806].map(id);
  await mkQuote(C2E, 'Smith Terrace', `INSERT INTO quotes (id, band_id, status, valid_until, converted_to_event_id, created_at)
      VALUES ('${C2Q}','${BAND}','sent', current_date + 30, '${C2E}', now() - interval '1 day');
    INSERT INTO event_members (event_id, user_id, status) VALUES ('${C2E}','${MEM}','confirmed');
    INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${C2C}','event','Smith Terrace','${BAND}','${C2E}','${ADMIN}');
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${C2C}','${ADMIN}');`);
  await keptRow(C2C, MEM);
  await say(C2C, 'P1b offer 8800');
  await asServer(ADMIN, `UPDATE events SET status = 'cancelled' WHERE id = '${C2E}'`);
  await db.exec(`INSERT INTO quote_links (quote_id, band_id, status) VALUES ('${C2Q}','${BAND}','accepted')`);
  const c2 = await readsAs(MEM, C2C);
  ok(!c2.includes('P1b offer 8800') && (await hold(C2E)).open === false,
    `R7 1c: an accepted link inserted on a cancelled quote: the negotiation stays hidden (${JSON.stringify(c2)})`);

  // 2: the row a privacy change leaves doesn't stop the sweep's announcement.
  const holdsFor = async (e) => (await notes(`type = 'date_hold' AND reference_id = '${e}'`)).length;
  const backdate = (e) => db.exec(`ALTER TABLE events DISABLE TRIGGER USER;
    UPDATE events SET created_at = now() - interval '10 minutes' WHERE id = '${e}';
    ALTER TABLE events ENABLE TRIGGER USER;`);
  const [P7, P9] = [2807, 2808].map(id);
  await asServer(ADMIN, `INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, created_at)
      VALUES ('${P7}','${BAND}','Hudson Brunch','confirmed','gig','${ADMIN}', current_date + 33, now());
    INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, created_at)
      VALUES ('${P9}','${BAND}','Hudson Supper','tentative','gig','${ADMIN}', current_date + 34, now());`);
  await asServer(ADMIN, `UPDATE events SET status = 'tentative' WHERE id = '${P7}'`);
  await asServer(ADMIN, `UPDATE events SET status = 'draft' WHERE id = '${P9}'`);
  await asServer(ADMIN, `UPDATE events SET status = 'tentative' WHERE id = '${P9}'`);
  await db.exec(`DELETE FROM notifications`);
  await backdate(P7); await backdate(P9);
  await db.exec(`SELECT public.bw_date_hold_sweep()`).catch(() => {});
  const [n7, n9] = [await holdsFor(P7), await holdsFor(P9)];
  ok(n7 === 2 && n9 === 2, `R7 2: a fresh gig back to tentative, and tentative -> draft -> tentative: the sweep announces both (${n7}, ${n9} hold notices)`);

  // 3: the quote triggers lock the events row before the hold's lock.
  const order = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b); return i > 0 && j > 0 && i < j; };
  const qc = await fnDef('bw_trg_date_hold_quote_changed');
  const qm = await fnDef('bw_trg_date_hold_quote_musicians');
  const qp = await fnDef('bw_trg_quote_privacy');
  const evt = await fnDef('bw_trg_event_changed');
  ok(order(qc, 'FOR NO KEY UPDATE', 'bw_date_hold_sync(') && order(qm, 'FOR NO KEY UPDATE', 'bw_date_hold_sync(')
     && order(qp || '', 'FOR NO KEY UPDATE', 'bw_quote_private_period(') && !/same\s+--\s+order as the quote triggers and the sweep \(lock, then the row\)/.test(evt),
    'R7 3: quote_changed, quote_musicians and the privacy trigger lock the events row, then the hold; the event trigger comment states that order');

  // 4: a period never ends before it started; no "range lower bound" error.
  const [G1, G2] = [2809, 2810].map(id);
  await asServer(ADMIN, `INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, created_at)
      VALUES ('${G1}','${BAND}','Clock One','confirmed','gig','${ADMIN}', current_date + 40, now() - interval '1 day'),
             ('${G2}','${BAND}','Clock Two','confirmed','gig','${ADMIN}', current_date + 41, now() - interval '1 day');
    INSERT INTO event_date_holds (event_id, band_id, released_at, release_reason, private_periods) VALUES
      ('${G1}','${BAND}', now(), 'reverted', tstzmultirange(tstzrange(now() + interval '1 hour', NULL, '[)'))),
      ('${G2}','${BAND}', now(), 'reverted', tstzmultirange(tstzrange(now() + interval '1 hour', now() + interval '2 hours', '[]')));`)
    .catch(async () => { await db.exec('ROLLBACK').catch(() => {}); });
  const g1e = await db.query(`SELECT public.bw_quote_private_period('${G1}','${BAND}', false)`).then(() => null, (e) => e.message);
  const g2e = await db.query(`SELECT public.bw_quote_private_period('${G2}','${BAND}', false)`).then(() => null, (e) => e.message);
  const g1 = (await tryq(`SELECT isempty(private_periods) e FROM event_date_holds WHERE event_id = '${G1}'`)).rows[0]?.e;
  ok(!g1e && g1 === false && !g2e, `R7 4a: an exit "before" the open period keeps it, and after a later end raises nothing (${g1e || g1}, ${g2e || 'ok'})`);

  // 4b: a personal event (no band) takes no hold lock.
  const PE = id(2811);
  await db.exec(`INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date) VALUES ('${PE}', NULL, 'Dentist', 'confirmed', 'personal', '${MEM}', current_date + 3)`);
  let locks = -1;
  try {
    await db.exec('BEGIN');
    await db.exec(`UPDATE events SET title = 'Dentist 2' WHERE id = '${PE}'`);
    locks = (await db.query(`SELECT count(*)::int n FROM pg_locks WHERE locktype = 'advisory'`)).rows[0].n;
  } finally { await db.exec('ROLLBACK').catch(() => {}); }
  ok(locks === 0, `R7 4b: editing a personal event takes no hold lock (${locks} advisory locks)`);
}

// ── Round 8 (Claude review of 029c2293, main's decisions) ──────────────────
{
  const readsAs = async (uid, chat) => (await as(uid, `SELECT content FROM messages WHERE chat_id = '${chat}' ORDER BY created_at`)).rows.map((r) => r.content);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const say = async (chat, text) => { await sleep(15); await db.exec(`INSERT INTO messages (chat_id, sender_id, content, created_at) VALUES ('${chat}','${ADMIN}','${text}', clock_timestamp())`); await sleep(15); };
  const keptRow = async (chat, uid) => db.exec(`ALTER TABLE chat_participants DISABLE TRIGGER USER;
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${chat}','${uid}') ON CONFLICT DO NOTHING;
    ALTER TABLE chat_participants ENABLE TRIGGER USER;`);
  const hold = async (e) => (await tryq(`SELECT private_periods::text pp, release_reason r, released_at IS NULL live
    FROM event_date_holds WHERE event_id = '${e}'`)).rows[0] || {};
  // A transaction that writes 300 ms after it began (in production it waited
  // on a lock: the hold's, or the events row): its now() is 300 ms old.
  // Returns its now(), or { error }.
  const slowTx = async (uid, sql) => {
    await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '${claims(uid)}', true);`);
    try {
      const t = (await db.query(`SELECT now()::text t`)).rows[0].t;
      await sleep(300);
      await db.exec(sql);
      await db.exec('COMMIT');
      return { t };
    } catch (e) { await db.exec('ROLLBACK').catch(() => {}); return { error: e.message }; }
  };
  // What another session wrote while that transaction waited: stamped 100 ms
  // after the transaction's start, long before its write.
  const during = (chat, text) => `INSERT INTO messages (chat_id, sender_id, content, created_at)
    VALUES ('${chat}','${ADMIN}','${text}', now() + interval '100 milliseconds')`;

  // 1a: the first way out of privacy (a quote confirmed): the reviewer's probe.
  const [T1E, T1C] = [2901, 2902].map(id);
  await mkQuote(T1E, 'Smith Pier', `INSERT INTO event_members (event_id, user_id, status) VALUES ('${T1E}','${MEM}','confirmed');
    INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${T1C}','event','Smith Pier','${BAND}','${T1E}','${ADMIN}');
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${T1C}','${ADMIN}');`);
  await keptRow(T1C, MEM);
  await say(T1C, 'Offer 5200');
  const t1 = await slowTx(ADMIN, `${during(T1C, 'Late counter-offer 7300')}; UPDATE events SET status = 'confirmed' WHERE id = '${T1E}'`);
  await say(T1C, 'After the confirm');
  const r1 = await readsAs(MEM, T1C);
  const c1 = (await tryq(`SELECT upper(private_periods) = history_cutoff_at AS same,
      (SELECT cp.cleared_at FROM chat_participants cp WHERE cp.chat_id = '${T1C}' AND cp.user_id = '${MEM}') = history_cutoff_at AS cleared,
      history_cutoff_at > '${t1.t || 'epoch'}'::timestamptz + interval '200 milliseconds' AS late
    FROM event_date_holds WHERE event_id = '${T1E}'`)).rows[0] || {};
  ok(!t1.error && !r1.includes('Offer 5200') && !r1.includes('Late counter-offer 7300') && r1.includes('After the confirm')
     && c1.same === true && c1.cleared === true && c1.late === true,
    `R8 1a: a message written while the confirm waited stays with the admins; the period, the cut-off and cleared_at end at the clock after the lock (${t1.error || JSON.stringify(r1)}, ${JSON.stringify(c1)})`);

  // 1b: a gig back to a quote, then confirmed again (the open period ends).
  const [T2E, T2C] = [2903, 2904].map(id);
  await asServer(ADMIN, `INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, created_at)
      VALUES ('${T2E}','${BAND}','Hudson Deck','confirmed','gig','${ADMIN}', current_date + 37, now() - interval '1 day');
    INSERT INTO event_members (event_id, user_id, status) VALUES ('${T2E}','${MEM}','confirmed');
    INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${T2C}','event','Hudson Deck','${BAND}','${T2E}','${ADMIN}');
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${T2C}','${ADMIN}'), ('${T2C}','${MEM}');`);
  await say(T2C, 'Gig talk: doors at 7');
  const t2a = await slowTx(ADMIN, `${during(T2C, 'Mid-revert note 4100')}; UPDATE events SET status = 'tentative' WHERE id = '${T2E}'`);
  await say(T2C, 'Second offer 6400');
  const t2b = await slowTx(ADMIN, `${during(T2C, 'Late haggle 8100')}; UPDATE events SET status = 'confirmed' WHERE id = '${T2E}'`);
  await say(T2C, 'Gig talk: see you there');
  const r2 = await readsAs(MEM, T2C);
  ok(!t2a.error && !t2b.error && !r2.includes('Late haggle 8100') && !r2.includes('Second offer 6400')
     && r2.includes('Gig talk: doors at 7') && r2.includes('Gig talk: see you there'),
    `R8 1b: reconfirmed: a message written while the confirm waited stays with the admins, both gig periods readable (${t2a.error || t2b.error || JSON.stringify(r2)})`);
  // Guard (true before round 8 too): a period still starts at the
  // transaction's now(), so what was written while a revert ran is inside.
  ok(!t2a.error && !r2.includes('Mid-revert note 4100'),
    `R8 1b guard: a period starts at the transaction's start: a message written while the revert ran is hidden (${JSON.stringify(r2)})`);

  // 1c: an exit with no open period (the third branch) ends at the clock too.
  const t3 = await slowTx(ADMIN, `SELECT public.bw_quote_private_period('${T2E}','${BAND}', false)`);
  const c3 = (await tryq(`SELECT upper(private_periods) > '${t3.t || 'epoch'}'::timestamptz + interval '200 milliseconds' AS late,
      upper_inf(private_periods) AS open FROM event_date_holds WHERE event_id = '${T2E}'`)).rows[0] || {};
  ok(!t3.error && c3.late === true && c3.open === false,
    `R8 1c: an exit with no open period hides up to the clock after the lock, not the transaction's start (${t3.error || JSON.stringify(c3)})`);

  // 2: a link write locks its quote's row before the events rows (link,
  // quote, event, hold's lock): the order of a save of the quote.
  const at = (src, re) => { const m = re.exec(src || ''); return m ? m.index : -1; };
  const Q_LOCK = /PERFORM 1 FROM (public\.)?quotes\b[^;]*FOR NO KEY UPDATE/;
  const E_LOCK = /PERFORM 1 FROM (public\.)?events\b[^;]*FOR NO KEY UPDATE/;
  const qc = await fnDef('bw_trg_date_hold_quote_changed');
  const qp = await fnDef('bw_trg_quote_privacy');
  const evt = await fnDef('bw_trg_event_changed');
  const o1 = [qc.indexOf(`TG_TABLE_NAME = 'quote_links'`), at(qc, Q_LOCK), at(qc, E_LOCK), qc.indexOf('bw_date_hold_sync(')];
  const iqp = at(qp, Q_LOCK);
  const o2 = [qp.lastIndexOf(`TG_TABLE_NAME = 'quote_links'`, iqp), iqp, at(qp, E_LOCK), qp.indexOf('bw_quote_private_period(')];
  const rising = (a) => a.every((v, i) => v > 0 && (i === 0 || a[i - 1] < v));
  ok(rising(o1) && rising(o2) && /quote_links row, quotes\s+-- row, events row, hold's lock/.test(evt),
    `R8 2a: on a link write, quote_changed and the privacy trigger lock the quotes row, then the events rows, then the hold; the event trigger comment states the order (${o1.join(' < ')}; ${o2.join(' < ')})`);
  // The lock is really taken (xmax of the quotes row = the writer), on both paths.
  const lockedIn = async (sql, quote) => {
    const pre = (await tryq(`SELECT xmax::text x FROM quotes WHERE id = '${quote}'`)).rows[0]?.x;
    await db.exec('BEGIN');
    try {
      await db.exec(sql);
      const x = (await db.query(`SELECT xmax::text x FROM quotes WHERE id = '${quote}'`)).rows[0]?.x;
      return { pre, x, locked: !!x && x !== '0' && x !== pre };
    } catch (e) { return { error: e.message, locked: false }; } finally { await db.exec('ROLLBACK').catch(() => {}); }
  };
  const [L1E, L1Q, L2E, L2Q] = [2905, 2906, 2907, 2908].map(id);
  await mkQuote(L1E, 'Smith Atrium', `INSERT INTO quotes (id, band_id, status, valid_until, converted_to_event_id, created_at)
      VALUES ('${L1Q}','${BAND}','sent', current_date + 30, '${L1E}', now() - interval '1 day');
    INSERT INTO quote_links (quote_id, band_id, status) VALUES ('${L1Q}','${BAND}','sent');`);
  await mkQuote(L2E, 'Smith Arcade', `INSERT INTO quotes (id, band_id, status, valid_until, converted_to_event_id, created_at)
      VALUES ('${L2Q}','${BAND}','sent', current_date + 30, '${L2E}', now() - interval '1 day');`);
  await asServer(ADMIN, `UPDATE events SET status = 'cancelled' WHERE id = '${L2E}'`);
  const lk1 = await lockedIn(`UPDATE quote_links SET status = 'viewed' WHERE quote_id = '${L1Q}'`, L1Q);
  const lk2 = await lockedIn(`INSERT INTO quote_links (quote_id, band_id, status) VALUES ('${L2Q}','${BAND}','accepted')`, L2Q);
  ok(lk1.locked && lk2.locked,
    `R8 2b: a link status write (hold trigger) and an accepted link on a cancelled quote (privacy trigger) lock the quotes row (${JSON.stringify(lk1)}, ${JSON.stringify(lk2)})`);

  // 3: bw_answer_date_hold takes the events row (KEY SHARE) before the hold's lock.
  const ans = await fnDef('bw_answer_date_hold');
  const o3 = [at(ans, /PERFORM 1 FROM (public\.)?events\b[^;]*FOR KEY SHARE/), ans.indexOf('pg_advisory_xact_lock(178')];
  ok(rising(o3) && !/bw_answer_date_hold take the\s+-- lock and the hold row, never the events row/.test(evt)
     && /bw_answer_date_hold takes the events row \(KEY SHARE/.test(evt),
    `R8 3a: bw_answer_date_hold locks the events row (KEY SHARE), then the hold; the event trigger comment says so (${o3.join(' < ')})`);
  // The same, observed: when the hold's lock is held (the "is it live" check
  // right after it), the events row is already locked by this transaction.
  const A1E = id(2909);
  await mkQuote(A1E, 'Smith Veranda');
  const live = (await tryq(`SELECT pg_get_functiondef('public.bw_date_hold_live(uuid)'::regprocedure) d`)).rows[0]?.d;
  await db.exec(`CREATE TABLE IF NOT EXISTS public.r8_probe (x text); TRUNCATE public.r8_probe;
    CREATE OR REPLACE FUNCTION public.bw_date_hold_live(p_event_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
    BEGIN
      INSERT INTO r8_probe (x) SELECT e.xmax::text FROM events e WHERE e.id = p_event_id;
      RETURN true;
    END $f$;`);
  const preX = (await tryq(`SELECT xmax::text x FROM events WHERE id = '${A1E}'`)).rows[0]?.x;
  const a1 = await as(MEM, `SELECT public.bw_answer_date_hold('${A1E}', 'free') a`);
  if (live) await db.exec(live); else await db.exec(`DROP FUNCTION IF EXISTS public.bw_date_hold_live(uuid)`);
  const seenX = (await tryq(`SELECT x FROM r8_probe`)).rows[0]?.x;
  await db.exec(`DROP TABLE IF EXISTS public.r8_probe`);
  ok(a1.rows[0]?.a === 'free' && !!seenX && seenX !== '0' && seenX !== preX,
    `R8 3b: the answer holds the events row before the hold's lock (${a1.error || `xmax before ${preX}, at the live check ${seenX}`})`);

  // 4: the sweep opens a hold on any live quote with no open one, whatever
  // reason its released row carries (here 'cancelled': a quote saved less
  // than a minute ago, cancelled and restored at once), on the same row.
  const holdsFor = async (e) => (await notes(`type = 'date_hold' AND reference_id = '${e}'`)).length;
  const [S1E, S1Q] = [2910, 2911].map(id);
  await asServer(ADMIN, `INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, created_at)
      VALUES ('${S1E}','${BAND}','Hudson Late Show','tentative','gig','${ADMIN}', current_date + 35, now());
    INSERT INTO quotes (id, band_id, status, valid_until, converted_to_event_id, created_at)
      VALUES ('${S1Q}','${BAND}','sent', current_date + 30, '${S1E}', now());`);
  await asServer(ADMIN, `UPDATE events SET status = 'cancelled' WHERE id = '${S1E}'`);
  await asServer(ADMIN, `UPDATE events SET status = 'tentative' WHERE id = '${S1E}'`);
  const s0 = await hold(S1E);
  await db.exec(`DELETE FROM notifications`);
  await db.exec(`ALTER TABLE events DISABLE TRIGGER USER;
    UPDATE events SET created_at = now() - interval '10 minutes' WHERE id = '${S1E}';
    ALTER TABLE events ENABLE TRIGGER USER;`);
  await db.exec(`SELECT public.bw_date_hold_sweep()`).catch(() => {});
  const n1 = await holdsFor(S1E);
  await db.exec(`SELECT public.bw_date_hold_sweep()`).catch(() => {});
  const n2 = await holdsFor(S1E);
  const s1 = await hold(S1E);
  const rows = (await tryq(`SELECT count(*)::int n FROM event_date_holds WHERE event_id = '${S1E}'`)).rows[0]?.n;
  ok(s0.r === 'cancelled' && s0.live === false && n1 === 2 && n2 === 2 && s1.live === true && rows === 1,
    `R8 4: a restored quote whose released row says 'cancelled' is announced by the sweep, once, on its one row (before: ${s0.r}/${s0.live}; notices ${n1} then ${n2}; open ${s1.live}; rows ${rows})`);
}

// ── The 002 shape: enum events.status / event_type / quotes.status ─────────
// 178 must apply (twice) and work on enum columns as well as text ones: it
// passes them on as ::text. CHAT_TYPE=text keeps chats.type text here.
{
  const db1 = db;
  db = new PGlite();
  await boot(db, { enums: true });
  const [EQ, EG, EQC, EQQ] = [2340, 2341, 2342, 2343].map(id);
  await db.exec(`
    INSERT INTO auth.users (id) SELECT unnest(ARRAY['${ADMIN}','${MEM}']::uuid[]);
    INSERT INTO profiles (id, full_name, preferred_language) VALUES ('${ADMIN}','Leo Admin','en'), ('${MEM}','Marta Drums','en');
    INSERT INTO bands VALUES ('${BAND}', 'Velvet Static');
    INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${ADMIN}','admin'), ('${BAND}','${MEM}','member');
    INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, start_time, created_at) VALUES
      ('${EQ}','${BAND}','Smith Wedding','tentative','wedding','${ADMIN}', current_date + 14, '18:00', now() - interval '1 day'),
      ('${EG}','${BAND}','Rooftop Session','confirmed','gig','${ADMIN}', current_date + 4, '21:00', now() - interval '1 day');
    INSERT INTO quotes (id, band_id, created_by, client_name, total, status, converted_to_event_id, created_at)
      VALUES ('${EQQ}','${BAND}','${ADMIN}','Smith', 4000, 'sent', '${EQ}', now() - interval '1 day');
    INSERT INTO event_members (event_id, user_id, status) VALUES ('${EQ}','${MEM}','Confirmed'), ('${EG}','${MEM}','confirmed');
    INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${EQC}','event','Smith Wedding','${BAND}','${EQ}','${ADMIN}');
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${EQC}','${ADMIN}'), ('${EQC}','${MEM}');`);
  const errs = [];
  for (const run of [1, 2]) await db.exec(readFileSync(MIG, 'utf8')).catch((e) => { errs.push(`run ${run}: ${e.message}`); return db.exec('ROLLBACK').catch(() => {}); });
  ok(errs.length === 0, `enum columns (chats.type ${process.env.CHAT_TYPE === 'text' ? 'text' : 'enum'}): 178 applies twice (${errs.join('; ') || 'ok'})`);
  const tag = 'enum columns';
  const srv = (sql) => asServer(ADMIN, sql).then(() => null, async (e) => { await db.exec('ROLLBACK').catch(() => {}); return { error: e.message }; });
  const hidden = (await as(MEM, `SELECT id FROM events WHERE id = '${EQ}'`)).rows.length;
  const gig = (await as(MEM, `SELECT id FROM events WHERE id = '${EG}'`)).rows.length;
  const hold = (await tryq(`SELECT 1 FROM event_date_holds WHERE event_id = '${EQ}'`)).rows.length;
  const ans = (await tryq(`SELECT answer FROM event_hold_answers WHERE event_id = '${EQ}' AND user_id = '${MEM}'`)).rows[0]?.answer;
  ok(hidden === 0 && gig === 1 && hold === 1 && ans === 'free', `${tag}: the quote is hidden, the gig shown, its hold made, 'Confirmed' carried as free (${hidden}, ${gig}, ${hold}, ${ans})`);
  const sc = (await tryq(`SELECT public.bw_chat_scope_ok(c.type::text, c.band_id, c.event_id, '${MEM}') ok FROM chats c WHERE c.id = '${EQC}'`));
  ok(sc.rows[0]?.ok === false && !sc.error, `${tag}: the quote chat is out of scope for the member (${sc.error || sc.rows[0]?.ok})`);
  const fs = await as(ADMIN, `SELECT free_count, total_count FROM public.bw_band_free_slots('${BAND}', current_date + 14, current_date + 14)`);
  ok(!fs.error && fs.rows[0]?.free_count === 0, `${tag}: free slots run, the live hold blocks its day (${fs.error || JSON.stringify(fs.rows[0])})`);
  const mv = await srv(`UPDATE events SET event_date = current_date + 15 WHERE id = '${EQ}'`);
  const cleared = (await tryq(`SELECT 1 FROM event_hold_answers WHERE event_id = '${EQ}'`)).rows.length;
  ok(!mv?.error && cleared === 0, `${tag}: moving the quote's date clears the answers (${mv?.error || cleared})`);
  const conf = await srv(`UPDATE events SET status = 'confirmed' WHERE id = '${EQ}'`);
  const back = (await as(MEM, `SELECT id FROM events WHERE id = '${EQ}'`)).rows.length;
  const rel = (await tryq(`SELECT release_reason r FROM event_date_holds WHERE event_id = '${EQ}'`)).rows[0]?.r;
  ok(!conf?.error && back === 1 && rel === 'confirmed', `${tag}: confirmed, the member sees the gig, the hold is released (${conf?.error || back}, ${rel})`);
  const cancel = await srv(`UPDATE events SET status = 'cancelled' WHERE id = '${EG}'`);
  ok(!cancel?.error, `${tag}: cancelling a gig works (${cancel?.error || 'ok'})`);
  db = db1;
}

// ── Cross-PR: the real 175 (chat scope, section 3) and 181, both orders ────
// MIG_175 / MIG_181 / MIG_193: paths to those branches' files (git show
// origin/fix/security-audit:supabase/migrations/175_security_audit_access.sql,
// origin/fix/event-chat-lineup:…/181_event_chat_lineup.sql,
// origin/fix/chat-audit:…/193_one_chat_per_gig.sql). Orders: 175 → 178
// (no 181), main's 175 → 178 → 193 → 181, and 178 last (175 → 193 → 181 →
// 178); 181 needs 193 first.
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
      if (err) { console.log(`order ${order}, ${st}:`, err); await db.exec('ROLLBACK').catch(() => {}); }
      if (st === '178') mid.grpOut = await sc(GRP, OUT);
    }
    const tag = order;
    const inChat = async (chat, uid) => (await tryq(`SELECT 1 FROM chat_participants WHERE chat_id = '${chat}' AND user_id = '${uid}'`)).rows.length;
    if (steps.indexOf('178') < steps.indexOf('181') || !has181) ok(mid.grpOut === false, `${tag}: 178's chat rule keeps 175's legacy 'group' = band rule (former member out: ${mid.grpOut})`);
    ok(await sc(GRP, MEM) === true && await sc(GRP, OUT) === false, `${tag}: legacy group chat follows the band`);
    ok((await tryq(`SELECT public.bw_is_event_participant('${GIG8}', '${MEM2}') p`)).rows[0]?.p === false,
      `${tag}: dropped out is off the gig (bw_is_event_participant keeps 181's status list)`);
    // Off the lineup: the row may be kept (175 r4 / 181 keep rows), but the chat doesn't reach them.
    const sees = async (chat, uid) => (await as(uid, `SELECT 1 FROM chats WHERE id = '${chat}'`)).rows.length
      + (await as(uid, `SELECT 1 FROM messages WHERE chat_id = '${chat}'`)).rows.length;
    if (has181) ok(await sees(GC, MEM2) === 0 && await inChat(GC, MEM) === 1 && await sees(GC, MEM) === 1,
      `${tag}: gig chat = lineup (dropped out can't reach it, lineup kept)`);
    // The lineup rule and the off-the-gig statuses, through the live rule.
    ok(await sc(GC, MEM) === true && await sc(GC, MEM2) === false && await sc(GC, RMV) === false && await sc(GC, NOLINE) === false,
      `${tag}: gig chat rule = lineup (on ${await sc(GC, MEM)}, dropped out ${await sc(GC, MEM2)}, removed ${await sc(GC, RMV)}, not on it ${await sc(GC, NOLINE)})`);
    ok(await sees(QC, MEM) === 0 && await sc(QC, MEM) === false, `${tag}: a member is out of the quote chat (row kept or not)`);
    // The rule itself, not only the cleanup: a stale row (written past the
    // triggers) still gives the member nothing.
    await db.exec(`ALTER TABLE chat_participants DISABLE TRIGGER USER;
      INSERT INTO chat_participants (chat_id, user_id) VALUES ('${QC}','${MEM}') ON CONFLICT DO NOTHING;
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
    // The member's row kept from before (as 178's prune now leaves it): the
    // confirmation reuses it and clears the history before it.
    await db.exec(`ALTER TABLE chat_participants DISABLE TRIGGER USER;
      INSERT INTO chat_participants (chat_id, user_id, cleared_at) VALUES ('${QC}','${MEM}', NULL) ON CONFLICT DO NOTHING;
      ALTER TABLE chat_participants ENABLE TRIGGER USER;`);
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
  // Lineup answers that differ only in case or surrounding spaces get the
  // same answer from bw_chat_scope_ok and get_user_chats with 175 alone and
  // with 175 → 178 (and the right one: 'Confirmed' in, 'DECLINED' out).
  const caseRun = async (steps) => {
    db = new PGlite();
    await boot(db);
    const [CG, CC, C1, C2, C3, C4] = [2320, 2321, 2322, 2323, 2324, 2325].map(id);
    const users = [C1, C2, C3, C4];
    await db.exec(`
      INSERT INTO auth.users (id) SELECT unnest(ARRAY['${ADMIN}','${C1}','${C2}','${C3}','${C4}']::uuid[]);
      INSERT INTO profiles (id, full_name) VALUES ('${ADMIN}','Leo Admin'), ('${C1}','Ann Horn'), ('${C2}','Bo Cello'), ('${C3}','Cy Flute'), ('${C4}','Di Harp');
      INSERT INTO bands VALUES ('${BAND}', 'Velvet Static');
      INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${ADMIN}','admin'), ('${BAND}','${C1}','member'),
        ('${BAND}','${C2}','member'), ('${BAND}','${C3}','member'), ('${BAND}','${C4}','member');
      INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, created_at)
        VALUES ('${CG}','${BAND}','Ferry Gig','confirmed','gig','${ADMIN}', current_date + 6, now() - interval '1 day');
      INSERT INTO event_members (event_id, user_id, status) VALUES ('${CG}','${C1}','Confirmed'), ('${CG}','${C2}','DECLINED'),
        ('${CG}','${C3}','  dropped_out  '), ('${CG}','${C4}',' Confirmed ');
      INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${CC}','event','Ferry Gig','${BAND}','${CG}','${ADMIN}');`);
    for (const st of steps) {
      const sql = st === '175' ? readFileSync(M175, 'utf8') : readFileSync(MIG, 'utf8');
      const err = await db.exec(sql).then(() => null, (e) => e.message);
      if (err) console.log(`case run ${steps.join(' → ')}, ${st}:`, err);
    }
    // Rows written past the triggers, so the rule itself answers.
    await db.exec(`ALTER TABLE chat_participants DISABLE TRIGGER USER;
      INSERT INTO chat_participants (chat_id, user_id) SELECT '${CC}', u FROM unnest(ARRAY['${ADMIN}','${C1}','${C2}','${C3}','${C4}']::uuid[]) u
        ON CONFLICT DO NOTHING;
      ALTER TABLE chat_participants ENABLE TRIGGER USER;`);
    const out = {};
    const roster = ((await as(ADMIN, `SELECT public.get_user_chats('${ADMIN}') j`)).rows[0]?.j || [])
      .find((c) => c.id === CC)?.participants?.map((x) => x.user_id) || [];
    for (const [i, u] of users.entries()) {
      const scope = (await tryq(`SELECT public.bw_chat_scope_ok('event', '${BAND}', '${CG}', '${u}') ok`)).rows[0]?.ok;
      const listed = JSON.stringify((await as(u, `SELECT public.get_user_chats('${u}') j`)).rows[0]?.j || []).includes(CC);
      out[['Confirmed', 'DECLINED', '  dropped_out  ', ' Confirmed '][i]] = `${scope}/${listed}/${roster.includes(u)}`;
    }
    return out;
  };
  {
    const alone = await caseRun(['175']);
    const both = await caseRun(['175', '178']);
    const want = { 'Confirmed': 'true/true/true', 'DECLINED': 'false/false/false', '  dropped_out  ': 'false/false/false', ' Confirmed ': 'true/true/true' };
    ok(JSON.stringify(alone) === JSON.stringify(both) && JSON.stringify(both) === JSON.stringify(want),
      `lineup status case/spaces: 175 alone and 175 → 178 agree, and are right (scope/listed/roster; 175 ${JSON.stringify(alone)}, 175 → 178 ${JSON.stringify(both)})`);
  }

  await cross('175 → 178');
  // 181 now needs 193 first (#291): its orders always carry 193.
  if (M193) await cross('175 → 178 → 193 → 181');
  if (M193) await cross('175 → 193 → 181 → 178');
  else console.log('skip: 175 → 178 → 193 → 181 (set MIG_193)');
  db = db1;
} else {
  console.log('skip: cross-PR 175 + 181 (+ 193) (set MIG_175, MIG_181, MIG_193)');
}

// ── 178's copies of 175's functions have not drifted ───────────────────────
// Main's rule: every function 178 redefines from 175 (bw_chat_scope_ok,
// get_user_chats) is 175's whole body plus 178's own lines. Text check, no
// database: 175 from origin/fix/security-audit (or the repo file once merged;
// SCOPE_175=<file> to point at another copy), 178 from MIG; comments,
// whitespace, 175's quote placeholder (%s) and 178's own lines removed, the
// rest must be identical. Fails as soon as #281 changes one of them and 178
// hasn't followed, or 178 starts sharing a new one without a rule here.
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
  // Every function both files define, by name (fnscan: create [or replace]
  // function [public.]name); each needs a rule here, or the check fails.
  const fnames = (sql) => new Set([...(sql || '').matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)/gi)].map((m) => m[1].toLowerCase()));
  // 178's own additions on top of 175's body, and 175's quote placeholder.
  const rules = {
    bw_chat_scope_ok: { end: '$f$;', drop178: ['AND NOT public.bw_event_quote_hidden(e.id, w.u)'], drop175: ['%s'] },
    get_user_chats: { end: '\n$$;', drop178: ['AND NOT (c.id = ANY ((SELECT public.bw_hidden_quote_chat_ids())::uuid[]))'], drop175: [] },
  };
  const body = (sql, name, end) => {
    const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, 'i');
    const m = sql ? re.exec(sql) : null;
    const b = m ? sql.indexOf(end, m.index) : -1;
    return b < 0 ? null : sql.slice(m.index, b);
  };
  const norm = (t, drops) => {
    let x = t.replace(/--[^\n]*/g, '');
    for (const d of drops) x = x.replace(d, '');
    return x.replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').trim();
  };
  const src178 = readFileSync(MIG, 'utf8');
  if (!body(src175, 'bw_chat_scope_ok', '$f$;')) {
    console.log(`WARN skip: 178 vs 175 function bodies (no 175 found: origin/fix/security-audit or the repo file)`);
  } else {
    const shared = [...fnames(src175)].filter((n) => fnames(src178).has(n));
    ok(shared.every((n) => rules[n]), `every function 178 shares with 175 has a drift rule (${shared.join(', ')})`);
    for (const name of Object.keys(rules)) {
      const r = rules[name];
      const [b75, b78] = [body(src175, name, r.end), body(src178, name, r.end)];
      const [x, y] = [b75 ? norm(b75, r.drop175) : '', b78 ? norm(b78, r.drop178) : ''];
      let at = 0;
      while (at < x.length && x[at] === y[at]) at++;
      ok(!!b75 && !!b78 && x === y, `178's ${name} = 175's (${from}) + 178's own lines${x === y ? '' : `; first difference at ${at}: 175 "${x.slice(at, at + 60)}" vs 178 "${y.slice(at, at + 60)}"`}`);
    }
  }
}

console.log(fails ? `\n${passes} passed, ${fails} FAILED` : `\n${passes} passed, ALL OK`);
process.exit(fails ? 1 : 0);
