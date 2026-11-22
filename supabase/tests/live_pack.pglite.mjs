// Local check of migration 170 (live pack) without Docker: PGlite (Postgres
// in WebAssembly) with stand-ins for Supabase's auth / vault / cron / net and
// the public tables and helpers the migration uses. Runs the migration twice,
// then checks invites (who, when, text in the person's language, no fee),
// RLS on live_pack_status, the silent-refresh queue and flush, Remind, cron.
//
//   mkdir -p /tmp/pg170 && cd /tmp/pg170 && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/live_pack.pglite.mjs . && node live_pack.pglite.mjs <repo>/supabase/migrations/170_live_pack.sql [earlier-170.sql]
//
// With a second file (an earlier copy of 170, e.g. `git show origin/main:supabase/migrations/170_live_pack.sql`)
// that one is applied first: a database that already has it gets every new part.
//
// (PGlite 0.3.x cannot run PL/pgSQL RAISE; use 0.5.15 or later.)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const MIG = process.argv[2];
const db = new PGlite();
const q = (sql, p) => db.query(sql, p);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth; CREATE SCHEMA vault; CREATE SCHEMA cron; CREATE SCHEMA net; CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('bw_project_url', 'https://x.supabase.co'), ('bw_push_dispatch_secret', 's3cret');
CREATE TABLE net.calls (id serial, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) RETURNS bigint
  LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id $$;
CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job VALUES (n, s, c) RETURNING 1::bigint $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, preferred_language varchar, notification_preferences jsonb);
CREATE TABLE public.band_members (band_id uuid, user_id uuid, role text, is_active boolean DEFAULT true);
CREATE TABLE public.events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, title text NOT NULL, event_type varchar,
  venue text, "date" date, event_date date, start_time time, venue_name text, status varchar, setlist_id uuid, created_by uuid, fee numeric);
CREATE TABLE public.event_members (event_id uuid, user_id uuid, status varchar);
CREATE TABLE public.setlist_songs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), setlist_id uuid, song_id uuid, position int);
CREATE TABLE public.songs (id uuid PRIMARY KEY, band_id uuid, title text, artist text, key text, bpm int, duration_seconds int,
  lyrics text, chord_chart jsonb, audio_url text, times_played int DEFAULT 0);
CREATE TABLE public.push_tokens (user_id uuid, token text, platform text, is_active boolean DEFAULT true);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, band_id uuid, type text,
  title varchar, body text, data jsonb, read boolean, reference_id uuid, reference_type varchar, created_at timestamptz DEFAULT now());
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.events, public.band_members, public.event_members TO authenticated;

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
CREATE FUNCTION public.bw_active_band_member_ids(p_band_id uuid, p_admins_only boolean DEFAULT false) RETURNS uuid[]
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
  SELECT coalesce(array_agg(DISTINCT user_id), '{}'::uuid[]) FROM public.band_members
  WHERE band_id = p_band_id AND coalesce(is_active, true) AND (NOT p_admins_only OR role = 'admin'); $f$;
CREATE FUNCTION public.bw_trg_dispatch_push() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;
CREATE TRIGGER bw_dispatch_push AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.bw_trg_dispatch_push();
`);

// Two runs: the migration is safe to run more than once (and over an earlier copy).
const mig = readFileSync(MIG, 'utf8');
if (process.argv[3]) { await db.exec(readFileSync(process.argv[3], 'utf8')); ok(true, 'earlier 170 applied first'); }
await db.exec(mig);
await db.exec(mig);
ok(true, 'migration runs twice');

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, ADMIN, MEM, DECL, DEP, NOAPP, AUTO, OTHER] = [1, 2, 3, 4, 5, 6, 7, 8].map(id);
const SL = id(20), SONG = id(30), SONG2 = id(31);
const EV = id(40), EV_FAR = id(41), EV_REH = id(42), EV_NOSL = id(43);
await db.exec(`
INSERT INTO auth.users SELECT unnest(ARRAY['${ADMIN}','${MEM}','${DECL}','${DEP}','${NOAPP}','${AUTO}','${OTHER}']::uuid[]);
INSERT INTO profiles (id, preferred_language) VALUES ('${ADMIN}','en'),('${MEM}','it'),('${DECL}','en'),('${DEP}','en'),('${NOAPP}','en'),('${AUTO}','de'),('${OTHER}','fr');
UPDATE profiles SET live_pack_auto = true WHERE id = '${AUTO}';
INSERT INTO band_members VALUES ('${BAND}','${ADMIN}','admin',true),('${BAND}','${MEM}','member',true),('${BAND}','${DECL}','member',true),
  ('${BAND}','${NOAPP}','member',true),('${BAND}','${AUTO}','member',true);
INSERT INTO push_tokens (user_id, token, platform) SELECT u, 't', 'ios' FROM unnest(ARRAY['${ADMIN}','${MEM}','${DECL}','${DEP}','${AUTO}','${OTHER}']::uuid[]) u;
INSERT INTO songs (id, band_id, title) VALUES ('${SONG}','${BAND}','Empire State of Mind'),('${SONG2}','${BAND}','New York, New York');
INSERT INTO setlist_songs (setlist_id, song_id, position) VALUES ('${SL}','${SONG}',1),('${SL}','${SONG2}',2);
INSERT INTO events (id, band_id, title, event_type, event_date, venue_name, status, setlist_id, created_by, fee) VALUES
  ('${EV}','${BAND}','Rooftop Session','gig', current_date + 3, 'The Loft, Brooklyn','confirmed','${SL}','${ADMIN}', 1800),
  ('${EV_FAR}','${BAND}','Far gig','gig', current_date + 20, 'Far','confirmed','${SL}','${ADMIN}', 1),
  ('${EV_REH}','${BAND}','Weekly rehearsal','rehearsal', current_date + 1, NULL,'confirmed','${SL}','${ADMIN}', 0);
INSERT INTO event_members (event_id, user_id, status) SELECT e, u, CASE WHEN u = '${DECL}' THEN 'declined' ELSE 'confirmed' END
  FROM unnest(ARRAY['${EV}','${EV_REH}']::uuid[]) e, unnest(ARRAY['${MEM}','${DECL}','${DEP}','${NOAPP}','${AUTO}']::uuid[]) u;
DELETE FROM notifications; DELETE FROM live_pack_refresh_queue; DELETE FROM net.calls;
`);
ok(true, 'seed (event inserts fired the new-event trigger without errors)');

// ---- Kill switch live_pack (173, docs/flags.md). Without the table (above)
// the sweep runs; with the row off, no invite, no Remind, no queued download.
await db.exec(`CREATE TABLE public.app_flags (key text PRIMARY KEY, enabled boolean NOT NULL DEFAULT true);
  INSERT INTO public.app_flags VALUES ('live_pack', false);`);
ok((await q(`SELECT public.bw_live_pack_invite_sweep() AS n`)).rows[0].n === 0, 'flag off: the sweep sends nothing');
ok((await as(ADMIN, () => q(`SELECT public.bw_live_pack_remind($1, $2) r`, [EV, MEM]).then((r) => r.rows[0].r))) === false, 'flag off: Remind sends nothing');
ok((await q(`SELECT count(*)::int n FROM notifications WHERE type = 'live_pack_ready'`)).rows[0].n === 0, 'flag off: no live_pack_ready rows');
ok((await q(`SELECT count(*)::int n FROM live_pack_refresh_queue`)).rows[0].n === 0, 'flag off: nothing queued for automatic members');
await db.exec(`UPDATE public.app_flags SET enabled = true WHERE key = 'live_pack'`);

// ---- invite sweep
const n1 = (await q(`SELECT public.bw_live_pack_invite_sweep() AS n`)).rows[0].n;
const inv = (await q(`SELECT user_id, title, body, data FROM notifications WHERE type = 'live_pack_ready' ORDER BY title`)).rows;
const to = (u, ev) => inv.filter((r) => r.user_id === u && r.data.event_id === ev);
ok(n1 === 4, `sweep sends 4 (admin + member, gig + rehearsal), got ${n1}`);
ok(to(MEM, EV).length === 1 && to(ADMIN, EV).length === 1, 'member and admin invited for the gig');
ok(to(DECL, EV).length === 0, 'declined member not invited');
ok(to(DEP, EV).length === 0, 'deputy (not a band member) not invited');
ok(to(NOAPP, EV).length === 0, 'member with no app not invited');
ok(to(AUTO, EV).length === 0, 'automatic member not asked');
ok(inv.every((r) => r.data.event_id !== EV_FAR), 'event 20 days ahead not in the window');
const mi = to(MEM, EV)[0];
const day = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'][new Date(Date.now() + 3 * 864e5).getUTCDay()];
ok(mi.title === `La scaletta di ${day}, pronta anche senza segnale`, `Italian title: ${mi.title}`);
ok(mi.body === 'Scarica testi, accordi e strutture per The Loft, Brooklyn (2 brani). Tocca per vedere cosa include.', `Italian body: ${mi.body}`);
ok(mi.data.kind === 'invite' && mi.data.round === 1 && mi.data.tag === `live-pack-${EV}`, 'invite data');
ok(!JSON.stringify(inv).includes('1800'), 'no fee in the notification');
const ar = to(ADMIN, EV_REH)[0];
ok(/rehearsal songs, ready without signal$/.test(ar.title) && ar.body.includes('Weekly rehearsal'), `rehearsal text: ${ar.title} / ${ar.body}`);
const queued = (await q(`SELECT event_id FROM live_pack_refresh_queue`)).rows.map((r) => r.event_id).sort();
ok(queued.includes(EV) && queued.includes(EV_REH), 'automatic member: events queued for a silent refresh');

// Second run the same day: nothing new.
const n2 = (await q(`SELECT public.bw_live_pack_invite_sweep() AS n`)).rows[0].n;
ok(n2 === 0, `second sweep sends nothing, got ${n2}`);
// The day before, asked again once (round 2) to whoever still has no pack.
await db.exec(`UPDATE notifications SET created_at = now() - interval '2 days'`);
const n3 = (await q(`SELECT public.bw_live_pack_invite_sweep() AS n`)).rows[0].n;
const r2 = (await q(`SELECT user_id, data FROM notifications WHERE (data->>'round')::int = 2`)).rows;
ok(n3 === 2 && r2.every((r) => r.data.event_id === EV_REH), `round 2 only the day before (rehearsal tomorrow), got ${n3}`);
await db.exec(`UPDATE notifications SET created_at = now() - interval '2 days'`);
const n4 = (await q(`SELECT public.bw_live_pack_invite_sweep() AS n`)).rows[0].n;
ok(n4 === 0, `never a third time, got ${n4}`);

// ---- RLS on live_pack_status
async function as(user, fn) {
  await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true); SET LOCAL ROLE authenticated;`);
  try { return await fn(); } finally { await db.exec('ROLLBACK'); }
}
const tryIns = (user, ev) => as(user, () => q(`INSERT INTO live_pack_status (event_id, device_id, version) VALUES ($1, 'dev-1', 'v1')`, [ev]).then(() => true, (e) => e.message));
ok((await tryIns(MEM, EV)) === true, 'member writes their own row');
ok((await tryIns(DECL, EV)) !== true, 'declined member cannot write');
ok((await tryIns(DEP, EV)) !== true, 'deputy cannot write');
ok((await tryIns(OTHER, EV)) !== true, 'stranger cannot write');
ok((await as(MEM, () => q(`INSERT INTO live_pack_status (event_id, user_id, device_id, version) VALUES ($1, $2, 'd', 'v')`, [EV, ADMIN]).then(() => true, () => false))) === false, 'cannot write a row for someone else');

await db.exec(`INSERT INTO live_pack_status (event_id, user_id, device_id, version) VALUES ('${EV}','${MEM}','dev-1','v1'), ('${EV}','${AUTO}','dev-9','v1')`);
const adminSees = await as(ADMIN, () => q(`SELECT user_id FROM live_pack_status WHERE event_id = $1`, [EV]));
ok(adminSees.rows.length === 2, 'band admin reads the rows of their event');
const memSees = await as(MEM, () => q(`SELECT user_id FROM live_pack_status`));
ok(memSees.rows.length === 1 && memSees.rows[0].user_id === MEM, 'member reads only their own row');
const strangerSees = await as(OTHER, () => q(`SELECT user_id FROM live_pack_status`));
ok(strangerSees.rows.length === 0, 'stranger reads nothing');
ok((await as(MEM, () => q(`UPDATE live_pack_status SET version = 'v2' WHERE event_id = $1`, [EV]).then((r) => r.affectedRows))) === 1, 'member updates own row');
ok((await as(MEM, () => q(`DELETE FROM live_pack_status WHERE user_id = $1`, [AUTO]).then((r) => r.affectedRows))) === 0, 'member cannot delete another row');
ok((await as(MEM, () => q(`SELECT 1 FROM live_pack_refresh_queue`).then(() => 'read', () => 'denied'))) === 'denied', 'refresh queue is server only');
ok((await as(MEM, () => q(`UPDATE profiles SET live_pack_auto = true, live_pack_asked_at = now() WHERE id = $1`, [MEM]).then(() => true, (e) => e.message))) === true, 'profile choice writable');

// ---- silent refresh: song change in the window queues, flush posts silent push
await db.exec(`DELETE FROM live_pack_refresh_queue; DELETE FROM net.calls;`);
await db.exec(`UPDATE songs SET times_played = times_played + 1 WHERE id = '${SONG}'`);
ok((await q(`SELECT count(*)::int n FROM live_pack_refresh_queue`)).rows[0].n === 0, 'play counter change does not queue');
await db.exec(`UPDATE songs SET lyrics = 'Concrete jungle' WHERE id = '${SONG}'`);
const q1 = (await q(`SELECT event_id FROM live_pack_refresh_queue ORDER BY event_id`)).rows.map((r) => r.event_id);
ok(q1.length === 2 && !q1.includes(EV_FAR), `lyrics change queues the 2 window events, got ${q1.length}`);
ok((await q(`SELECT public.bw_live_pack_refresh_flush() n`)).rows[0].n === 0, 'flush waits for 2 quiet minutes');
await db.exec(`UPDATE live_pack_refresh_queue SET queued_at = now() - interval '3 minutes'`);
const f = (await q(`SELECT public.bw_live_pack_refresh_flush() n`)).rows[0].n;
const calls = (await q(`SELECT url, body FROM net.calls ORDER BY id`)).rows;
const gigCall = calls.find((c) => c.body.data.event_id === EV);
ok(f === 2 && calls.length === 2, `flush posts one silent push per event, got ${f}/${calls.length}`);
ok(gigCall && gigCall.body.silent === true && gigCall.body.data.type === 'live_pack_refresh' && gigCall.url.endsWith('/functions/v1/send-push'), 'silent body');
ok(gigCall && [...gigCall.body.user_ids].sort().join() === [MEM, AUTO].sort().join(), `targets: pack holders + automatic, got ${gigCall && gigCall.body.user_ids}`);
ok((await q(`SELECT count(*)::int n FROM live_pack_refresh_queue`)).rows[0].n === 0, 'queue emptied');
// Kill switch off: the silent refresh goes only to people who already hold
// the pack (it keeps their copy current); "automatic" alone starts no download.
const targets = async (ev) => [...(await q(`SELECT public.bw_live_pack_refresh_targets($1) t`, [ev])).rows[0].t].sort().join();
ok((await targets(EV_REH)).includes(AUTO), 'on: an automatic member with no pack is a target');
await db.exec(`UPDATE public.app_flags SET enabled = false WHERE key = 'live_pack'`);
ok((await targets(EV_REH)) === '', `off: no pack, no silent push, got ${await targets(EV_REH)}`);
ok((await targets(EV)) === [MEM, AUTO].sort().join(), 'off: pack holders are the targets (once it is back on)');
// Off: no push at all (the flag is read before every push), the queue is kept.
await db.exec(`DELETE FROM net.calls; INSERT INTO live_pack_refresh_queue (event_id, queued_at) VALUES ('${EV}', now() - interval '3 minutes')`);
ok((await q(`SELECT public.bw_live_pack_refresh_flush() n`)).rows[0].n === 0, 'off: the flush sends nothing');
ok((await q(`SELECT count(*)::int n FROM net.calls`)).rows[0].n === 0, 'off: no silent push posted');
ok((await q(`SELECT count(*)::int n FROM live_pack_refresh_queue`)).rows[0].n === 1, 'off: the queued refresh is kept');
await db.exec(`UPDATE public.app_flags SET enabled = true WHERE key = 'live_pack'`);
ok((await q(`SELECT public.bw_live_pack_refresh_flush() n`)).rows[0].n === 1, 'back on: the kept refresh goes out');
ok((await q(`SELECT count(*)::int n FROM net.calls`)).rows[0].n === 1, 'back on: one silent push posted');
// Switched off while the flush runs: the next push is not sent, its event goes back in the queue.
await db.exec(`DELETE FROM net.calls; DELETE FROM live_pack_refresh_queue;
  INSERT INTO live_pack_refresh_queue (event_id, queued_at) VALUES ('${EV}', now() - interval '4 minutes'), ('${EV_REH}', now() - interval '3 minutes');
  CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) RETURNS bigint
    LANGUAGE sql AS $$ UPDATE public.app_flags SET enabled = false WHERE key = 'live_pack'; INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id $$;`);
ok((await q(`SELECT public.bw_live_pack_refresh_flush() n`)).rows[0].n === 1, 'off mid-run: only the push before the switch went out');
ok((await q(`SELECT count(*)::int n FROM live_pack_refresh_queue`)).rows[0].n === 1, 'off mid-run: the other event is queued again');
await db.exec(`CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) RETURNS bigint
    LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id $$;
  UPDATE public.app_flags SET enabled = true WHERE key = 'live_pack'; DELETE FROM net.calls;`);
// The sweep, switched off on its first row: the rows after it get nothing.
await db.exec(`DELETE FROM notifications; DELETE FROM live_pack_status;
  CREATE OR REPLACE FUNCTION public.bw_test_off_after_first() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN UPDATE public.app_flags SET enabled = false WHERE key = 'live_pack'; RETURN NEW; END $$;
  CREATE TRIGGER bw_test_off_after_first AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.bw_test_off_after_first();`);
await q(`SELECT public.bw_live_pack_invite_sweep()`);
ok((await q(`SELECT count(*)::int n FROM notifications WHERE type = 'live_pack_ready'`)).rows[0].n === 1, 'off mid-sweep: no invite after the switch');
await db.exec(`DROP TRIGGER bw_test_off_after_first ON public.notifications; DROP FUNCTION public.bw_test_off_after_first();
  UPDATE public.app_flags SET enabled = true WHERE key = 'live_pack'; DELETE FROM notifications;`);
await db.exec(`DELETE FROM live_pack_refresh_queue`);
await db.exec(`INSERT INTO setlist_songs (setlist_id, song_id, position) VALUES ('${SL}','${SONG}',3)`);
ok((await q(`SELECT count(*)::int n FROM live_pack_refresh_queue`)).rows[0].n === 2, 'setlist change queues');

// ---- first setlist attached inside the window: invite now
await db.exec(`DELETE FROM notifications; INSERT INTO events (id, band_id, title, event_type, event_date, venue_name, status, created_by) VALUES ('${EV_NOSL}','${BAND}','Jazz Night','gig', current_date + 2, 'Blue Room, Queens','confirmed','${ADMIN}');
INSERT INTO event_members VALUES ('${EV_NOSL}','${MEM}','confirmed');`);
ok((await q(`SELECT count(*)::int n FROM notifications`)).rows[0].n === 0, 'no setlist: no invite');
await db.exec(`UPDATE events SET setlist_id = '${SL}' WHERE id = '${EV_NOSL}'`);
const att = (await q(`SELECT user_id FROM notifications WHERE data->>'event_id' = $1`, [EV_NOSL])).rows.map((r) => r.user_id).sort();
ok(att.join() === [ADMIN, MEM].sort().join(), `setlist attached: admin + member invited, got ${att.length}`);

// ---- Remind
await db.exec(`DELETE FROM notifications; DELETE FROM live_pack_status;`);
ok((await as(MEM, () => q(`SELECT public.bw_live_pack_remind($1, $2) r`, [EV, NOAPP]).then(() => 'ok', () => 'denied'))) === 'denied', 'only admins can remind');
ok((await as(ADMIN, () => q(`SELECT public.bw_live_pack_remind($1, $2) r`, [EV, MEM]).then((r) => r.rows[0].r))) === true, 'admin reminds a member');
await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN}"}', true); SELECT public.bw_live_pack_remind('${EV}', '${MEM}'); SELECT public.bw_live_pack_remind('${EV}', '${MEM}'); COMMIT;`);
ok((await q(`SELECT count(*)::int n FROM notifications WHERE data->>'kind' = 'remind'`)).rows[0].n === 1, 'one remind per 6 hours');
ok((await as(ADMIN, () => q(`SELECT public.bw_live_pack_remind($1, $2) r`, [EV, DECL]).then((r) => r.rows[0].r))) === false, 'no remind to a declined member');
ok((await as(ADMIN, () => q(`SELECT public.bw_live_pack_remind($1, $2) r`, [EV, DEP]).then((r) => r.rows[0].r))) === false, 'no remind to a deputy');

// ---- A partial pack (round 4): a holder for the silent refresh (sent only
// while on), but not "ready": invited and reminded like no pack at all.
await db.exec(`DELETE FROM notifications; DELETE FROM live_pack_status; DELETE FROM profiles WHERE false;
  INSERT INTO live_pack_status (event_id, user_id, device_id, version, partial) VALUES ('${EV}','${MEM}','dev-1','v1', true)`);
await db.exec(`UPDATE public.app_flags SET enabled = false WHERE key = 'live_pack'`);
ok((await targets(EV)).split(',').includes(MEM), 'a partial holder is a refresh target');
await db.exec(`UPDATE public.app_flags SET enabled = true WHERE key = 'live_pack'`);
ok((await as(ADMIN, () => q(`SELECT public.bw_live_pack_remind($1, $2) r`, [EV, MEM]).then((r) => r.rows[0].r))) === true, 'a partial holder can be reminded');
await db.exec(`DELETE FROM notifications`);
await q(`SELECT public.bw_live_pack_invite_sweep()`);
ok((await q(`SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND data->>'event_id' = $2 AND data->>'kind' = 'invite'`, [MEM, EV])).rows[0].n === 1, 'a partial holder is invited');

// ---- An older status never overwrites a newer one (round 6): a partial write
// that arrives after the full one is ignored.
await db.exec(`DELETE FROM live_pack_status`);
// (as the table owner: the guard is a trigger, it holds for every role)
await q(`INSERT INTO live_pack_status (event_id, user_id, device_id, version, downloaded_at, partial) VALUES ($1, $2, 'dev-1', 'v2', '2026-11-23T10:00:05Z', false)`, [EV, MEM]);
await q(`INSERT INTO live_pack_status (event_id, user_id, device_id, version, downloaded_at, partial) VALUES ($1, $2, 'dev-1', 'v1', '2026-11-23T10:00:00Z', true)
  ON CONFLICT (event_id, user_id, device_id) DO UPDATE SET version = EXCLUDED.version, downloaded_at = EXCLUDED.downloaded_at, partial = EXCLUDED.partial`, [EV, MEM]);
const kept = (await q(`SELECT version, partial FROM live_pack_status WHERE event_id = $1 AND user_id = $2`, [EV, MEM])).rows[0];
ok(kept.version === 'v2' && kept.partial === false, `older status ignored: ${JSON.stringify(kept)}`);
await q(`UPDATE live_pack_status SET version = 'v3', downloaded_at = '2026-11-23T10:01:00Z', partial = true WHERE event_id = $1 AND user_id = $2`, [EV, MEM]);
ok((await q(`SELECT version FROM live_pack_status WHERE event_id = $1 AND user_id = $2`, [EV, MEM])).rows[0].version === 'v3', 'a newer status still lands');

// ---- bw_live_pack_can_hold asks only about the caller, or, for a band admin,
// about a member (round 7): nobody else can probe who takes part.
const canHold = (as_, ev, user) => as(as_, () => q(`SELECT public.bw_live_pack_can_hold($1, $2) r`, [ev, user]).then((r) => r.rows[0].r, (e) => e.message));
ok((await canHold(MEM, EV, MEM)) === true, 'a member asks about themself');
ok((await canHold(MEM, EV, ADMIN)) === false, 'a member cannot ask about someone else');
ok((await canHold(OTHER, EV, MEM)) === false, 'a stranger cannot ask about a member');
ok((await canHold(ADMIN, EV, MEM)) === true, 'a band admin asks about a member');
ok((await q(`SELECT has_function_privilege('anon', 'public.bw_live_pack_can_hold(uuid, uuid)', 'EXECUTE') r`)).rows[0].r === false, 'anon cannot call it');

ok((await q(`SELECT count(*)::int n FROM cron.job WHERE jobname LIKE 'bw-live-pack-%'`)).rows[0].n === 2, 'two cron jobs scheduled');
console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
