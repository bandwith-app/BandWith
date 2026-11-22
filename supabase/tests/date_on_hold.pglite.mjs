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
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const REPO = process.argv[2];
const MIG = process.argv[3] ?? `${REPO}/supabase/migrations/178_date_on_hold.sql`;
const migFile = (n) => readFileSync(`${REPO}/supabase/migrations/${n}`, 'utf8');
const lines = (n, a, b) => migFile(n).split('\n').slice(a - 1, b).join('\n');

const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
let passes = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else { passes++; console.log('ok  ', msg); } };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, ADMIN, ADMIN2, MEM, MEM2, OUT] = [1, 2, 3, 4, 5, 6].map(id);
const [GIG, QE0, QE, QE2, QE3, QE4, QE5] = [30, 31, 32, 33, 34, 35, 36].map(id);
const [Q, Q4, Q5] = [40, 44, 45].map(id);
const [EVCHAT, SL, SONG] = [50, 60, 61].map(id);
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
const notes = async (where = 'true') =>
  (await db.query(`SELECT user_id, type, title, body, data FROM notifications WHERE ${where} ORDER BY created_at, type`)).rows;

await db.exec(`
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
  status text DEFAULT 'draft', valid_until date, converted_to_event_id uuid, quote_number text);
CREATE TABLE public.quote_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid, band_id uuid, status text DEFAULT 'draft');
CREATE TABLE public.events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, title text, status text, event_type text,
  quote_id uuid, created_by uuid, event_date date, "date" date, start_time time, end_time time, load_in_time time,
  soundcheck_time time, venue text, venue_name text, venue_address text, venue_city text, setlist_id uuid,
  fee numeric, client_name text, notes text, updated_at timestamptz DEFAULT now());
CREATE TABLE public.event_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid, status text, fee numeric, paid_at timestamptz, role text, notes text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, band_id uuid, type text,
  title text, body text, data jsonb, read boolean DEFAULT false, reference_id uuid, reference_type text, created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE public.chats (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text, name text, band_id uuid, event_id uuid,
  created_by uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.chat_participants (chat_id uuid, user_id uuid, UNIQUE (chat_id, user_id));
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chat_id uuid, sender_id uuid, content text);
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
GRANT SELECT ON public.events, public.band_members, public.bands, public.profiles TO authenticated;
GRANT SELECT (id, event_id, user_id, status, role, notes), UPDATE (status) ON public.event_members TO authenticated;
GRANT SELECT, INSERT ON public.notifications, public.chats, public.chat_participants, public.messages TO authenticated;
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
await db.exec(lines('046_server_notifications_and_push.sql', 47, 101)); // bw_notify, bw_active_band_member_ids
await db.exec(lines('046_server_notifications_and_push.sql', 128, 138)); // bw_display_name
await db.exec(lines('088_deputy_push_i18n.sql', 18, 44)); // bw_i18n_short_date
await db.exec(lines('073_baseline_live_policies.sql', 71, 85)); // bw_can_manage_event
await db.exec(lines('073_baseline_live_policies.sql', 197, 216)); // bw_is_event_participant
await db.exec(lines('071_member_permissions.sql', 221, 238)); // bw_event_member_money
await db.exec(lines('093_rider_seen_member_paid.sql', 142, 160)); // bw_event_rider
await db.exec(lines('087_stage_keys.sql', 22, 58)); // bw_stage_key
await db.exec(lines('085_stage_live_channel.sql', 13, 39)); // bw_stage_topic_allowed
await db.exec(lines('170_live_pack.sql', 157, 175)); // bw_live_pack_window_events
await db.exec(migFile('111_quote_events_private.sql')); // events read, bw_can_view_event, bw_trg_event_changed
await db.exec(`
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
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
-- The app writes notices for other members (bw_can_notify in prod: an admin may write to any member).
CREATE POLICY notifications_insert_admin ON public.notifications FOR INSERT TO authenticated WITH CHECK (public.bw_is_band_admin(band_id));
`);

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
INSERT INTO event_members (event_id, user_id, status, fee) VALUES ('${GIG}','${MEM}','confirmed', 250), ('${QE0}','${MEM}','pending', 300);
-- An "Availability check" an older build wrote before 178.
INSERT INTO notifications (user_id, band_id, type, title, body, data, reference_id, reference_type) VALUES
  ('${MEM}','${BAND}','event_invite','Availability check: Smith Wedding (old)','Jane is quoting. Your fee: $300',
   jsonb_build_object('event_id','${QE0}','tentative',true), NULL, NULL),
  ('${MEM}','${BAND}','event_update','Gig updated','Rooftop Session moved', jsonb_build_object('event_id','${GIG}'), '${GIG}', 'event');
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

// ── A new quote: the admin makes it, the band hears about a hold ───────────
await db.exec(`DELETE FROM notifications`);
await asServer(ADMIN, `
INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, start_time, end_time, venue, venue_name,
  venue_address, venue_city, fee, client_name, notes, setlist_id)
VALUES ('${QE}','${BAND}','Smith Wedding','tentative','gig','${ADMIN}', current_date + 10, '20:00','23:00','Blue Note','Blue Note',
  '131 W 3rd St','New York', 4200, 'Jane Smith', 'secret notes', '${SL}');
INSERT INTO event_members (event_id, user_id, status, fee, notes) VALUES ('${QE}','${MEM}','pending', 300, 'secret notes');
INSERT INTO quotes (id, band_id, created_by, client_name, total, status, valid_until, converted_to_event_id, quote_number)
VALUES ('${Q}','${BAND}','${ADMIN}','Jane Smith', 4200, 'sent', current_date + 30, '${QE}', 'Q-2026-0042');
INSERT INTO setlist_songs (setlist_id, song_id, position) VALUES ('${SL}','${SONG}',1);
INSERT INTO contracts (band_id, event_id, type, title, status) VALUES ('${BAND}','${QE}','rider','Smith Wedding rider','draft');
INSERT INTO event_stage VALUES ('${QE}','${BAND}','{"items":[]}');
INSERT INTO event_gear_kits VALUES ('${QE}', gen_random_uuid(), '${BAND}');
INSERT INTO chats (id, type, name, band_id, event_id, created_by) VALUES ('${EVCHAT}','event','Smith Wedding','${BAND}','${QE}','${ADMIN}');
INSERT INTO chat_participants VALUES ('${EVCHAT}','${ADMIN}'), ('${EVCHAT}','${MEM}');
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
  INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date, start_time, venue_name, venue_city, client_name)
  VALUES ('${ev}','${BAND}','${title}','tentative','gig','${ADMIN}', current_date + 12, '20:00','Blue Note','New York','Jane Smith'); ${extra}`);
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

console.log(fails ? `\n${passes} passed, ${fails} FAILED` : `\n${passes} passed, ALL OK`);
process.exit(fails ? 1 : 0);
