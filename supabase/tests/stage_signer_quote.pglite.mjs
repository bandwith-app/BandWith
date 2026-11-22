// Local check of migration 190 (stage signing keys) on top of 178 (date on
// hold, #294) without Docker: PGlite (Postgres in WebAssembly) with the same
// stand-ins and live functions as supabase/tests/date_on_hold.pglite.mjs
// (#294), whose boot is copied here. Checks:
// - 178 hides a tentative quote from every member (lineup included): the
//   gig's public key too, with or without 178 applied before 190;
// - after a rotation the server says "pending" ({public: null, version}),
//   never "no pair" (rule C), also when the pair was still empty (B1);
// - an admin replaces a broken pair (its private key doesn't sign for its
//   public one) only by naming the stored public key, and the version goes up.
//
//   mkdir -p /tmp/pg190 && cd /tmp/pg190 && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/stage_signer_quote.pglite.mjs . && node stage_signer_quote.pglite.mjs <repo> <178 file>
//   node stage_signer_quote.pglite.mjs <repo> /dev/null    # 190 without 178 (111's rules)
//
// <178 file>: supabase/migrations/178_date_on_hold.sql from #294 (feat/date-on-hold).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const REPO = process.argv[2];
const MIG178 = process.argv[3];
const MIG190 = process.argv[4] ?? `${REPO}/supabase/migrations/190_stage_signing_keys.sql`;
const with178 = MIG178 && MIG178 !== '/dev/null';
const migFile = (n) => readFileSync(`${REPO}/supabase/migrations/${n}`, 'utf8');
const lines = (n, a, b) => migFile(n).split('\n').slice(a - 1, b).join('\n');
/** One function's CREATE block from a migration, by name (line numbers move when a migration is edited, #273). */
const fnFrom = (n, name) => {
  const m = migFile(n).match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS (\\$[a-z_]*\\$)[\\s\\S]*?\\1;`));
  if (!m) throw new Error(`${name} not found in ${n}`);
  return m[0];
};

const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, ADMIN, LINEUP, OFF, EX, ADMIN2, ADMIN3] = [1, 2, 3, 4, 5, 6, 7].map(id);
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
const b64 = (buf) => Buffer.from(buf).toString('base64');
async function pair() {
  const k = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { public: b64(await webcrypto.subtle.exportKey('raw', k.publicKey)), private: b64(await webcrypto.subtle.exportKey('pkcs8', k.privateKey)) };
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
  event_date date, event_time_start time, event_time_end time, created_at timestamptz DEFAULT now(),
  venue_name text, venue_address text, venue_city text);
CREATE TABLE public.quote_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid, band_id uuid, status text DEFAULT 'draft');
CREATE TABLE public.events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, title text, status text, event_type text,
  quote_id uuid, created_by uuid, event_date date, "date" date, start_time time, end_time time, load_in_time time,
  soundcheck_time time, venue text, venue_name text, venue_address text, venue_city text, setlist_id uuid,
  fee numeric, client_name text, notes text, updated_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(),
  "time" time, duration_hours numeric, recurrence_rule jsonb, is_recurring boolean DEFAULT false);
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
await d.exec(fnFrom('170_live_pack.sql', 'bw_live_pack_window_events'));
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

// A band: three admins, a member on the quote's lineup, one off it, an ex-member.
// A confirmed gig everyone plays, and a tentative quote gig (111: a quote).
await db.exec(`
INSERT INTO auth.users (id) SELECT unnest(ARRAY['${ADMIN}','${LINEUP}','${OFF}','${EX}','${ADMIN2}','${ADMIN3}']::uuid[]);
INSERT INTO bands VALUES ('${BAND}', 'Hudson Strings');
INSERT INTO band_members (band_id, user_id, role, is_active) VALUES ('${BAND}','${ADMIN}','admin',true),
  ('${BAND}','${LINEUP}','member',true), ('${BAND}','${OFF}','member',true), ('${BAND}','${EX}','member',false),
  ('${BAND}','${ADMIN2}','admin',true), ('${BAND}','${ADMIN3}','admin',true);
INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date)
VALUES ('${GIG}','${BAND}','Rooftop Session','confirmed','gig','${ADMIN}', current_date + 3),
       ('${QUOTE}','${BAND}','Lee Wedding','tentative','gig','${ADMIN}', current_date + 9);
INSERT INTO event_members (event_id, user_id, status) VALUES ('${GIG}','${LINEUP}','confirmed'), ('${GIG}','${OFF}','confirmed'),
  ('${QUOTE}','${LINEUP}','confirmed');
`);

if (with178) {
  try {
    await db.exec(readFileSync(MIG178, 'utf8'));
    ok(true, '178 applies');
  } catch (e) {
    ok(false, `178 applies: ${e.message}`);
  }
}
try {
  const mig = readFileSync(MIG190, 'utf8');
  await db.exec(mig);
  await db.exec(mig);
  ok(true, '190 runs twice');
} catch (e) {
  ok(false, `190 runs twice: ${e.message}`);
}

const verify = (ev) => `SELECT public.bw_stage_verify_key('${ev}')::text`;
const set = (ev, p, replace = null) =>
  `SELECT public.bw_stage_set_signer('${ev}', '${p.public}', '${p.private}'${replace ? `, '${replace}'` : ''})::text`;
const json = (r) => (r.v == null ? null : JSON.parse(r.v));

// The admin makes both gigs' pairs.
const p1 = await pair();
const madeGig = json(await as(ADMIN, set(GIG, p1)));
ok(madeGig?.public === p1.public && madeGig?.version === 1, 'gig: the admin stores the first pair (version 1)');
const pq = await pair();
ok(json(await as(ADMIN, set(QUOTE, pq)))?.public === pq.public, 'quote: the admin stores its pair');
ok(json(await as(LINEUP, set(GIG, await pair()))) === null, 'a member cannot store a pair');

// Who gets the public key.
for (const [uid, who] of [[LINEUP, 'lineup member'], [OFF, 'member']]) {
  ok(json(await as(uid, verify(GIG)))?.public === p1.public, `gig: the ${who} gets the public key`);
}
ok(json(await as(EX, verify(GIG))) === null, 'gig: the ex-member gets nothing');
{
  const r = await as(LINEUP, verify(QUOTE));
  ok(!r.error && (json(r) === null) === !!with178, `quote: the lineup member is ${with178 ? 'refused (178)' : 'given the key (111, no 178)'}${r.error ? ` (error: ${r.error})` : ''}`);
}
ok(json(await as(OFF, verify(QUOTE))) === null, 'quote: a member off the lineup gets nothing');

// A demotion: the pair goes, the version goes up, members are told "pending" (rule C).
await db.exec(`UPDATE band_members SET role = 'member' WHERE user_id = '${ADMIN2}'`);
{
  const v = json(await as(OFF, verify(GIG)));
  ok(v && v.public === null && v.version === 2, `after a demotion: members get "pending" ({public: null, version 2}), got ${JSON.stringify(v)}`);
}
ok(json(await as(ADMIN2, `SELECT public.bw_stage_signer('${GIG}')::text`)) === null, 'the demoted admin gets no pair');
// Another demotion while the pair is still empty: the version still goes up (B1).
await db.exec(`UPDATE band_members SET is_active = false WHERE user_id = '${ADMIN3}'`);
{
  const v = json(await as(OFF, verify(GIG)));
  ok(v && v.public === null && v.version === 3, `a demotion with the pair still empty still raises the version (3), got ${JSON.stringify(v)}`);
}
// A band whose gigs never had a pair (its admins all on 383f15b, which never makes one):
// a demotion leaves them as they were, so members keep following the band-key state there
// instead of going "pending" (Claude on #288, blocker).
{
  const [B2, A4, A5, M2, G2] = [20, 21, 22, 23, 32].map(id);
  await db.exec(`
INSERT INTO auth.users (id) SELECT unnest(ARRAY['${A4}','${A5}','${M2}']::uuid[]);
INSERT INTO bands VALUES ('${B2}', 'Bronx Brass');
INSERT INTO band_members (band_id, user_id, role, is_active) VALUES ('${B2}','${A4}','admin',true), ('${B2}','${A5}','admin',true), ('${B2}','${M2}','member',true);
INSERT INTO events (id, band_id, title, status, event_type, created_by, event_date) VALUES ('${G2}','${B2}','Pier 17','confirmed','gig','${A4}', current_date + 4);
INSERT INTO event_members (event_id, user_id, status) VALUES ('${G2}','${M2}','confirmed');
`);
  ok((await as(A4, `SELECT (public.bw_stage_key('${G2}') IS NOT NULL)::text`)).v === 'true', 'old-app band: the band key is made (no pair)');
  await db.exec(`UPDATE band_members SET role = 'member' WHERE user_id = '${A5}'`);
  const v = json(await as(M2, verify(G2)));
  ok(v && v.public === null && v.version === 0, `old-app band, a demotion: members get "no pair yet" ({public: null, version 0}), not "pending" nor a no, got ${JSON.stringify(v)}`);
  // SQL NULL is only the server's no (Codex on #288): someone outside the band.
  ok(json(await as(EX, verify(G2))) === null, 'old-app band: someone outside the band gets a no (NULL)');
  const ver = (await db.query(`SELECT sign_version FROM stage_keys WHERE event_id = '${G2}'`)).rows[0]?.sign_version;
  ok(ver === 1, `old-app band: the version stays 1, got ${ver}`);
  // The first pair made there afterwards is version 1, and a demotion after that does rotate.
  ok(json(await as(A4, set(G2, await pair())))?.version === 1, 'old-app band: the first pair is version 1');
  await db.exec(`UPDATE band_members SET is_active = false WHERE user_id = '${A4}'`);
  const after = json(await as(M2, verify(G2)));
  ok(after && after.public === null && after.version === 2, `once it had a pair, a demotion makes it "pending" (version 2), got ${JSON.stringify(after)}`);
}

// The next admin makes a pair at the new version.
const p3 = await pair();
ok(json(await as(ADMIN, set(GIG, p3)))?.version === 3, 'the next pair is stored at version 3');
ok(json(await as(OFF, verify(GIG)))?.public === p3.public, 'members get the new public key');

// A broken pair is replaced only by naming the stored public key; the version goes up.
const p4 = await pair();
ok(json(await as(ADMIN, set(GIG, p4)))?.public === p3.public, 'without naming it, the stored pair stays (first stored wins)');
ok(json(await as(ADMIN, set(GIG, p4, p1.public)))?.public === p3.public, 'naming another public key replaces nothing');
{
  const v = json(await as(ADMIN, set(GIG, p4, p3.public)));
  ok(v?.public === p4.public && v?.version === 4, `naming the stored public key replaces the pair, version 4, got ${JSON.stringify(v && { version: v.version })}`);
}
ok(json(await as(LINEUP, set(GIG, await pair(), p4.public))) === null, 'a member cannot replace it');

// A gig moved to another band (Codex on #288): its pair goes and the version goes up,
// so the old band's admins (who kept the private key) lead nobody there.
{
  const row = async () => (await db.query(`SELECT sign_public, sign_version FROM stage_keys WHERE event_id = '${QUOTE}'`)).rows[0];
  await as(ADMIN, set(QUOTE, await pair()));
  const before = await row();
  ok(before.sign_public !== null, 'the quote has a pair again');
  await db.exec(`INSERT INTO bands VALUES ('${id(9)}', 'Other band')`);
  await db.exec(`UPDATE events SET title = 'Lee Wedding (late)' WHERE id = '${QUOTE}'`);
  ok((await row()).sign_public === before.sign_public, 'another edit of the gig keeps its pair');
  await db.exec(`UPDATE events SET band_id = '${id(9)}' WHERE id = '${QUOTE}'`);
  const after = await row();
  ok(after.sign_public === null && after.sign_version === before.sign_version + 1, `moved to another band: no pair, version ${before.sign_version + 1}, got ${JSON.stringify(after)}`);
  ok((await db.query(`SELECT has_function_privilege('authenticated', 'public.bw_stage_event_moved()', 'EXECUTE') x`)).rows[0]?.x === false, 'clients cannot call the trigger function');
}

// 178's own rule is spelled out in 190's public-key function, not only inherited through bw_can_view_event.
if (with178) {
  const def = (await db.query(`SELECT pg_get_functiondef('public.bw_stage_verify_key(uuid)'::regprocedure) d`)).rows[0].d;
  ok(/bw_event_quote_hidden/.test(def), "the public key checks bw_event_quote_hidden (178's rule)");
}

console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
