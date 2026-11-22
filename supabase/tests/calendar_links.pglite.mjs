// Local check of migration 182 (calendar links without feed or reply
// credentials) without Docker: PGlite (Postgres in WebAssembly) with
// stand-ins for Supabase's auth and the public tables the functions use.
// The live state it builds on is loaded from the repo: 165 in full, and the
// deputy functions of 084 / 087 that 182 replaces. Then the migration runs
// twice and the checks below run.
//
//   mkdir -p /tmp/pgC4 && cd /tmp/pgC4 && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/calendar_links.pglite.mjs . && node calendar_links.pglite.mjs <repo> <repo>/supabase/migrations/182_calendar_link_tokens.sql
//
// With /dev/null as the migration, the checks show what was wrong before.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const [REPO, MIG] = process.argv.slice(2);
const db = new PGlite();
const q = (sql, p) => db.query(sql, p);
const one = async (sql, p) => (await q(sql, p)).rows[0];
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const check = async (msg, fn) => {
  try { ok(await fn(), msg); } catch (e) { fails++; console.log('FAIL', msg, `(${String(e.message).split('\n')[0]})`); }
  await db.exec('RESET ROLE').catch(() => {});
};
const as = async (uid) => {
  await db.exec(`SET ROLE authenticated`);
  await q(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: uid })]);
};

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, preferred_language varchar);
CREATE TABLE public.bands (id uuid PRIMARY KEY, name text);
CREATE TABLE public.band_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, user_id uuid, role text,
  is_active boolean DEFAULT true, left_at timestamptz);
CREATE TABLE public.events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, title text NOT NULL, event_type varchar,
  status varchar, "date" date, event_date date, "time" time, start_time time, end_time time, load_in_time time, soundcheck_time time,
  venue text, venue_name text, venue_city text, venue_address text, address text, quote_id uuid, currency text,
  is_recurring boolean DEFAULT false, recurrence_rule jsonb, created_by uuid, fee numeric, updated_at timestamptz DEFAULT now());
CREATE TABLE public.event_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid, user_id uuid, role text, status varchar);
CREATE TABLE public.band_deputies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, name text, user_id uuid,
  updated_at timestamptz DEFAULT now());
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, band_id uuid, type text,
  title text, body text, data jsonb);
-- 084's table, as live.
CREATE TABLE public.deputy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id uuid NOT NULL, event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  deputy_id uuid REFERENCES public.band_deputies(id) ON DELETE SET NULL,
  deputy_name text NOT NULL, replaces_user_id uuid, role text, fee_offered numeric, currency text,
  token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
    CHECK (token ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'available', 'maybe', 'unavailable', 'cancelled')),
  reply_note text, responded_at timestamptz, answer_snapshot jsonb, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.deputy_requests TO authenticated;

CREATE FUNCTION public.bw_is_band_admin(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND role = 'admin' AND COALESCE(is_active, true)); $f$;
`);

// The live state 182 builds on.
const fn = (src, name) => {
  const i = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const j = src.indexOf('$$;\n', i) + 4;
  if (i < 0) throw new Error(`no ${name}`);
  return src.slice(i, j);
};
const m084 = readFileSync(`${REPO}/supabase/migrations/084_deputy_requests.sql`, 'utf8');
const m087 = readFileSync(`${REPO}/supabase/migrations/087_deputy_unlink.sql`, 'utf8');
await db.exec(readFileSync(`${REPO}/supabase/migrations/165_member_calendar.sql`, 'utf8'));
for (const name of ['bw_deputy_event_snapshot', 'bw_deputy_request_view', 'bw_deputy_request_reply', 'bw_deputy_feed']) await db.exec(fn(m084, name));
await db.exec(fn(m087, 'bw_deputy_unlink'));
await db.exec(`GRANT EXECUTE ON FUNCTION public.bw_deputy_request_view(text), public.bw_deputy_request_reply(text, text, text),
  public.bw_deputy_feed(text) TO anon, authenticated; GRANT EXECUTE ON FUNCTION public.bw_deputy_unlink(uuid) TO authenticated;`);

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, BAND2, ADMIN, MEM, OUT, DEP_USER] = [1, 2, 3, 4, 5, 6].map(id);
const [EV, EV2, EV_REH, EV_OTHER, EV_DECL] = [10, 11, 12, 13, 14].map(id);
const [DEPUTY, RA, RB, RC] = [20, 21, 22, 23].map(id);
await db.exec(`
INSERT INTO auth.users SELECT unnest(ARRAY['${ADMIN}','${MEM}','${OUT}','${DEP_USER}']::uuid[]);
INSERT INTO profiles VALUES ('${ADMIN}','en'),('${MEM}','it'),('${OUT}','en');
INSERT INTO bands VALUES ('${BAND}','Velvet Static'),('${BAND2}','Other Band');
INSERT INTO band_members (band_id, user_id, role) VALUES ('${BAND}','${ADMIN}','admin'),('${BAND}','${MEM}','member'),('${BAND2}','${OUT}','admin');
INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, venue_name, venue_city, venue_address, is_recurring, recurrence_rule, created_by, fee) VALUES
  ('${EV}','${BAND}','Rooftop Session','gig','confirmed', current_date + 10, '21:00','The Loft','Brooklyn','12 Water St', false, NULL, '${ADMIN}', 1800),
  ('${EV2}','${BAND}','Hoboken Pier','gig','confirmed', current_date + 20, '20:00','Pier 13','Hoboken', NULL, false, NULL, '${ADMIN}', 900),
  ('${EV_REH}','${BAND}','Weekly rehearsal','rehearsal','confirmed', current_date + 1, '19:00','Studio B','Queens', NULL, true, '{"frequency":"weekly","interval":1}', '${ADMIN}', 0),
  ('${EV_OTHER}','${BAND2}','Other band gig','gig','confirmed', current_date + 5, '20:00','Elsewhere','Newark', NULL, false, NULL, '${OUT}', 1),
  ('${EV_DECL}','${BAND}','Declined gig','gig','confirmed', current_date + 7, '20:00','Bar','Queens', NULL, false, NULL, '${ADMIN}', 1);
INSERT INTO event_members (event_id, user_id, role, status) VALUES
  ('${EV}','${MEM}','Bass','confirmed'),('${EV2}','${MEM}','Bass','confirmed'),('${EV_REH}','${MEM}',NULL,'confirmed'),('${EV_DECL}','${MEM}',NULL,'declined');
INSERT INTO band_deputies (id, band_id, name, user_id) VALUES ('${DEPUTY}','${BAND}','Leo',NULL);
INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, role, fee_offered, currency, status, answer_snapshot) VALUES
  ('${RA}','${BAND}','${EV}','${DEPUTY}','Leo','Bass', 250, 'USD', 'available', '{}'),
  ('${RB}','${BAND}','${EV2}','${DEPUTY}','Leo','Bass', 300, 'USD', 'available', '{}'),
  ('${RC}','${BAND}','${EV_REH}','${DEPUTY}','Leo','Bass', 50, 'USD', 'cancelled', NULL);
`);
const tok = async (r) => (await one(`SELECT token FROM deputy_requests WHERE id = $1`, [r])).token;
const [TA, TB, TC] = [await tok(RA), await tok(RB), await tok(RC)];

// Two runs: the migration is safe to run more than once.
const mig = readFileSync(MIG, 'utf8');
await db.exec(mig);
await db.exec(mig);
ok(true, 'migration runs twice');

// ------------------------------------------------------------- deputies --
console.log('-- deputies (02 #3 / 03 #2)');
await check('084 feed by one reply token hands out no other gig\'s reply token', async () => {
  const f = JSON.stringify((await one(`SELECT public.bw_deputy_feed($1) AS f`, [TA])).f);
  return f.includes('Hoboken Pier') && !f.includes(TB);
});
const cal = async (r) => (await one(`SELECT calendar_token FROM deputy_requests WHERE id = $1`, [r])).calendar_token;
await check('each request has its own read-only calendar token', async () => {
  const [a, b] = [await cal(RA), await cal(RB)];
  return /^[0-9a-f]{64}$/.test(a) && a !== b && a !== TA;
});
await check('new requests get a calendar token too', async () => {
  const r = await one(`INSERT INTO deputy_requests (band_id, event_id, deputy_name) VALUES ($1, $2, 'Mia') RETURNING calendar_token`, [BAND, EV]);
  await q(`DELETE FROM deputy_requests WHERE deputy_name = 'Mia'`);
  return /^[0-9a-f]{64}$/.test(r.calendar_token);
});
await check('the reply page (view) gives the calendar token', async () =>
  (await one(`SELECT public.bw_deputy_request_view($1) ->> 'calendar_token' AS c`, [TA])).c === await cal(RA));
await check('calendar feed by calendar token: the deputy\'s gigs, no token of any kind', async () => {
  const f = (await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [await cal(RA)])).f;
  const s = JSON.stringify(f);
  const ids = f.gigs.map((g) => g.id).sort();
  const leaks = [TA, TB, TC, await cal(RA), await cal(RB)].filter((t) => s.includes(t));
  return ids.join() === [RA, RB].sort().join() && leaks.length === 0 && !s.includes('"fee') && f.gigs.find((g) => g.id === RA).mine === true
    && f.gigs.find((g) => g.id === RB).mine === false;
});
await check('old subscriptions (reply token in the URL) keep working, without tokens', async () => {
  const f = (await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [TA])).f;
  return f.gigs.length === 2 && !JSON.stringify(f).includes(TB);
});
await check('a calendar token opens no reply page and changes no answer', async () => {
  const c = await cal(RA);
  const v = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [c])).v;
  const r = (await one(`SELECT public.bw_deputy_request_reply($1, 'unavailable') AS r`, [c])).r;
  const st = (await one(`SELECT status FROM deputy_requests WHERE id = $1`, [RA])).status;
  return v === null && r === null && st === 'available';
});
await check('a withdrawn (cancelled) request takes no answer', async () => {
  await q(`SELECT public.bw_deputy_request_reply($1, 'available')`, [TC]);
  return (await one(`SELECT status FROM deputy_requests WHERE id = $1`, [RC])).status === 'cancelled';
});
await check('anon may read the calendar feed (edge function key), as before', async () =>
  (await one(`SELECT has_function_privilege('anon', 'public.bw_deputy_calendar_feed(text)', 'EXECUTE') AS x`)).x === true);
await check('unlinking the deputy ends the calendar tokens too', async () => {
  await q(`UPDATE band_deputies SET user_id = $1 WHERE id = $2`, [DEP_USER, DEPUTY]);
  const old = await cal(RA);
  await as(ADMIN);
  await q(`SELECT public.bw_deputy_unlink($1)`, [DEPUTY]);
  await db.exec('RESET ROLE');
  const f = (await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [old])).f;
  return f === null && (await cal(RA)) !== old;
});

// -------------------------------------------------------------- members --
console.log('-- members (02 #5 / 03 #6, 02 #11)');
const evTok = async (uid, ev, date) => {
  await as(uid);
  const r = await one(`SELECT public.bw_my_event_calendar_token($1, $2::date) AS t`, [ev, date]);
  await db.exec('RESET ROLE');
  return r.t;
};
let T1;
await check('a member gets a link token bound to one event they see', async () => {
  T1 = await evTok(MEM, EV, null);
  return /^[0-9a-f]{64}$/.test(T1);
});
await check('the link shows that event only, not the rest of the calendar', async () => {
  const l = (await one(`SELECT public.bw_member_event_calendar($1) AS l`, [T1])).l;
  const s = JSON.stringify(l);
  return l.event.id === EV && l.language === 'it' && !s.includes('Hoboken Pier') && !s.includes('Weekly rehearsal') && !s.includes('1800');
});
await check('no token for an event of another band, a declined one, or nobody signed in', async () => {
  const a = await evTok(MEM, EV_OTHER, null);
  const b = await evTok(MEM, EV_DECL, null);
  let refused = false;
  try { await q(`SET ROLE authenticated`); await q(`SELECT set_config('request.jwt.claims', '', false)`); await q(`SELECT public.bw_my_event_calendar_token($1)`, [EV]); }
  catch { refused = true; }
  await db.exec('RESET ROLE');
  return a === null && b === null && refused;
});
await check('same event: same token; one date of a repeating rehearsal: its own token and date', async () => {
  const again = await evTok(MEM, EV, '2026-01-01');
  const r1 = await evTok(MEM, EV_REH, null);
  const occ = (await one(`SELECT (current_date + 15)::text AS d`)).d;
  const r2 = await evTok(MEM, EV_REH, occ);
  const l1 = (await one(`SELECT public.bw_member_event_calendar($1) AS l`, [r1])).l;
  const l2 = (await one(`SELECT public.bw_member_event_calendar($1) AS l`, [r2])).l;
  const start = (await one(`SELECT (current_date + 1)::text AS d`)).d;
  return again === T1 && (await one(`SELECT public.bw_member_event_calendar($1) AS l`, [T1])).l.occurrence === null
    && r1 !== r2 && l1.occurrence === start && l2.occurrence === occ && l2.event.recurrence.frequency === 'weekly';
});
await check('the link stops when the member declines the event', async () => {
  const t2 = await evTok(MEM, EV2, null);
  await q(`UPDATE event_members SET status = 'declined' WHERE event_id = $1 AND user_id = $2`, [EV2, MEM]);
  const l = (await one(`SELECT public.bw_member_event_calendar($1) AS l`, [t2])).l;
  await q(`UPDATE event_members SET status = 'confirmed' WHERE event_id = $1 AND user_id = $2`, [EV2, MEM]);
  return l === null;
});
await check('"Make a new link" also ends the one-event links', async () => {
  await as(MEM);
  await q(`SELECT public.bw_my_calendar_token(true)`);
  await db.exec('RESET ROLE');
  return (await one(`SELECT public.bw_member_event_calendar($1) AS l`, [T1])).l === null && (await evTok(MEM, EV, null)) !== T1;
});
await check('grants: anon reads a link, only signed-in users make one, nobody reads the table', async () => {
  const r = await one(`SELECT has_function_privilege('anon', 'public.bw_member_event_calendar(text)', 'EXECUTE') AS a,
    has_function_privilege('anon', 'public.bw_my_event_calendar_token(uuid, date)', 'EXECUTE') AS b,
    has_function_privilege('authenticated', 'public.bw_my_event_calendar_token(uuid, date)', 'EXECUTE') AS c,
    has_table_privilege('authenticated', 'public.calendar_event_links', 'SELECT') AS d,
    has_table_privilege('anon', 'public.calendar_event_links', 'SELECT') AS e`);
  return r.a && !r.b && r.c && !r.d && !r.e;
});
await check('the account feed is unchanged: every event the member sees', async () => {
  await as(MEM);
  const t = (await one(`SELECT public.bw_my_calendar_token() AS t`)).t;
  await db.exec('RESET ROLE');
  const f = (await one(`SELECT public.bw_member_calendar_feed($1) AS f`, [t])).f;
  return f.events.map((e) => e.id).sort().join() === [EV, EV2, EV_REH].sort().join();
});

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
