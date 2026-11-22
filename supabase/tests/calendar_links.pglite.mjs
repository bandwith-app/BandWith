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
// 182 needs #294's 178 first: without it (no origin/feat/date-on-hold and no
// 178 in the repo) every check is skipped with a warning.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

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

CREATE TABLE public.profiles (id uuid PRIMARY KEY, preferred_language varchar, full_name text);
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
const m086 = readFileSync(`${REPO}/supabase/migrations/086_deputy_in_app.sql`, 'utf8');
await db.exec(readFileSync(`${REPO}/supabase/migrations/165_member_calendar.sql`, 'utf8'));
for (const name of ['bw_deputy_event_snapshot', 'bw_deputy_request_view', 'bw_deputy_request_reply', 'bw_deputy_feed']) await db.exec(fn(m084, name));
await db.exec(fn(m087, 'bw_deputy_unlink'));
await db.exec(`CREATE FUNCTION public.bw_notify(p_users uuid[], p_band uuid, p_type text, p_title text, p_body text, p_data jsonb, p_ref uuid, p_ref_type text)
  RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;`);
await db.exec(fn(m086, 'bw_deputy_claim'));
await db.exec(fn(m086, 'bw_my_deputy_gigs'));
await db.exec(`GRANT EXECUTE ON FUNCTION public.bw_deputy_claim(text), public.bw_my_deputy_gigs() TO authenticated;`);
await db.exec(`GRANT EXECUTE ON FUNCTION public.bw_deputy_request_view(text), public.bw_deputy_request_reply(text, text, text),
  public.bw_deputy_feed(text) TO anon, authenticated; GRANT EXECUTE ON FUNCTION public.bw_deputy_unlink(uuid) TO authenticated;`);

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, BAND2, ADMIN, MEM, OUT, DEP_USER] = [1, 2, 3, 4, 5, 6].map(id);
const [EV, EV2, EV_REH, EV_OTHER, EV_DECL] = [10, 11, 12, 13, 14].map(id);
const [DEPUTY, RA, RB, RC, RM, RX] = [20, 21, 22, 23, 24, 25].map(id);
const [DEPUTY2, RD] = [26, 27].map(id);
const [EV_MAYBE, EV_GONE] = [15, 16].map(id);
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
  ('${EV_DECL}','${BAND}','Declined gig','gig','confirmed', current_date + 7, '20:00','Bar','Queens', NULL, false, NULL, '${ADMIN}', 1),
  ('${EV_MAYBE}','${BAND}','Maybe gig','gig','confirmed', current_date + 8, '20:00','Maybe Hall','Queens','7 Secret Ave', false, NULL, '${ADMIN}', 1),
  ('${EV_GONE}','${BAND}','Gone gig','gig','confirmed', current_date + 9, '20:00','Gone Hall','Queens','9 Gone St', false, NULL, '${ADMIN}', 1);
INSERT INTO event_members (event_id, user_id, role, status) VALUES
  ('${EV}','${MEM}','Bass','confirmed'),('${EV2}','${MEM}','Bass','confirmed'),('${EV_REH}','${MEM}',NULL,'confirmed'),('${EV_DECL}','${MEM}',NULL,'declined');
INSERT INTO band_deputies (id, band_id, name, user_id) VALUES ('${DEPUTY}','${BAND}','Leo',NULL),('${DEPUTY2}','${BAND}','Ada',NULL);
INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, role, fee_offered, currency, status, answer_snapshot) VALUES
  ('${RA}','${BAND}','${EV}','${DEPUTY}','Leo','Bass', 250, 'USD', 'available', '{}'),
  ('${RB}','${BAND}','${EV2}','${DEPUTY}','Leo','Bass', 300, 'USD', 'available', '{}'),
  ('${RC}','${BAND}','${EV_REH}','${DEPUTY}','Leo','Bass', 50, 'USD', 'cancelled', NULL),
  ('${RD}','${BAND}','${EV}','${DEPUTY2}','Ada','Keys', 200, 'USD', 'pending', NULL);
`);
// An account link made before 182 ("Add to calendar" links shared until now carry it).
await q(`INSERT INTO calendar_feeds (user_id) VALUES ($1)`, [ADMIN]);
// Claude r5 (M3): a yes withdrawn before 182, its snapshot without a title.
const [EV_PRE, DEPUTY6, RPRE] = [90, 91, 92].map(id);
await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, venue_name, is_recurring, created_by, fee)
  VALUES ($1, $2, 'Old Withdrawn Gig', 'gig', 'confirmed', current_date - 400, 'Old Hall', false, $3, 1)`, [EV_PRE, BAND, ADMIN]);
await q(`INSERT INTO band_deputies (id, band_id, name, user_id) VALUES ($1, $2, 'Old', NULL)`, [DEPUTY6, BAND]);
await q(`INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, status, answer_snapshot)
  VALUES ($1, $2, $3, $4, 'Old', 'cancelled', '{"venue":"Old Hall"}')`, [RPRE, BAND, EV_PRE, DEPUTY6]);
// Codex round 7 (B3): a deputy deleted before 182 (no trigger then): the
// request stays with deputy_id NULL and its reply link still worked.
const [EV_ORPH, RORPH] = [93, 94].map(id);
await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, venue_name, venue_city, venue_address, is_recurring, created_by, fee)
  VALUES ($1, $2, 'Orphan Gig', 'gig', 'confirmed', current_date + 12, '20:00', 'Dock Bar', 'Jersey City', '5 Secret Pier', false, $3, 1)`, [EV_ORPH, BAND, ADMIN]);
await q(`INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, role, fee_offered, currency, status, answer_snapshot)
  VALUES ($1, $2, $3, NULL, 'Gone', 'Drums', 400, 'USD', 'available', '{}')`, [RORPH, BAND, EV_ORPH]);
const TORPH = (await one(`SELECT token FROM deputy_requests WHERE id = $1`, [RORPH])).token;
const tok = async (r) => (await one(`SELECT token FROM deputy_requests WHERE id = $1`, [r])).token;
const [TA, TB, TC] = [await tok(RA), await tok(RB), await tok(RC)];

const mig = readFileSync(MIG, 'utf8');

// 178 (#294) comes first, hard (Codex review #285 round 5): 182 stops when
// its bw_event_deputy_hidden is missing. 178's helpers come from #294's
// branch head (BW_178_REF pins another commit of it), or the repo once merged.
let m178 = null;
const REF178 = /^[\w./-]+$/.test(process.env.BW_178_REF ?? '') ? process.env.BW_178_REF : 'origin/feat/date-on-hold';
try {
  m178 = execSync(`git show ${REF178}:supabase/migrations/178_date_on_hold.sql`, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  console.log(`178 from ${REF178}`);
} catch {
  const local = `${REPO}/supabase/migrations/178_date_on_hold.sql`;
  m178 = existsSync(local) ? readFileSync(local, 'utf8') : null;
}
if (!m178 && mig.trim()) {
  // Main's guard rule: the whole 182 run is skipped until 178 is reachable.
  console.log('SKIP (pending #294) every 182 check: 178 not found, and 182 needs it first');
  console.log('WARNING: neither origin/feat/date-on-hold nor supabase/migrations/178_date_on_hold.sql is available; nothing of 182 was checked');
  process.exit(0);
}
if (mig.trim()) {
  let refused = null;
  try { await db.exec(mig); } catch (e) { refused = String(e.message); }
  await db.exec('ROLLBACK').catch(() => {});
  ok(refused && /182 needs 178 first/.test(refused), 'without 178, 182 stops at its first statement (hard order)');
} else {
  ok(false, 'without 178, 182 stops at its first statement (hard order)');
}
if (m178) {
  const m111 = readFileSync(`${REPO}/supabase/migrations/111_quote_events_private.sql`, 'utf8');
  await db.exec(`CREATE TABLE IF NOT EXISTS public.event_date_holds (event_id uuid PRIMARY KEY, band_id uuid, release_reason text, confirmed_once_at timestamptz);
    CREATE TABLE IF NOT EXISTS public.quotes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), converted_to_event_id uuid, status text);`);
  await db.exec(fn(m111, 'bw_event_is_quote'));
  // 073's body (live): an active row of the band.
  await db.exec(`CREATE OR REPLACE FUNCTION public.bw_is_band_member(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
    SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND COALESCE(is_active, true)); $f$;`);
  for (const name of ['bw_event_quote_private', 'bw_event_deputy_hidden', 'bw_event_quote_hidden']) await db.exec(fn(m178, name));
  // The read paths 178 patches and 182 rewrites: 182 must start from 178's
  // body (the live state when 182 runs), so load 178's where it has one.
  for (const name of ['bw_member_calendar_feed', 'bw_deputy_request_view', 'bw_deputy_feed', 'bw_my_deputy_gigs']) {
    if (m178.includes(`CREATE OR REPLACE FUNCTION public.${name}(`)) await db.exec(fn(m178, name));
  }
}

// Two runs: the migration is safe to run more than once.
await db.exec(mig);
const snapPre = async () => (await one(`SELECT answer_snapshot AS s FROM deputy_requests WHERE id = $1`, [RPRE])).s;
const firstPre = await snapPre();
await q(`UPDATE events SET title = 'Renamed Later' WHERE id = $1`, [EV_PRE]);
await db.exec(mig);
ok(true, 'migration runs twice');
{
  const again = await snapPre();
  const untouched = (await q(`SELECT id, answer_snapshot AS s FROM deputy_requests WHERE id IN ($1, $2)`, [RA, RC])).rows;
  ok(firstPre?.title === 'Old Withdrawn Gig' && firstPre.venue === 'Old Hall'
    && again?.title === 'Old Withdrawn Gig'
    && untouched.find((r) => r.id === RA)?.s && !('title' in untouched.find((r) => r.id === RA).s)
    && untouched.find((r) => r.id === RC)?.s === null,
    'Claude r5 M3: a withdrawn yes saved before 182 gets its title once (a second run keeps it; other rows untouched)');
}

// Answered through the reply page, then withdrawn by the admin.
await q(`INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, role, status) VALUES
  ($1, $3, $4, $6, 'Leo', 'Bass', 'pending'), ($2, $3, $5, $6, 'Leo', 'Bass', 'pending')`, [RM, RX, BAND, EV_MAYBE, EV_GONE, DEPUTY]);
const [TM, TX] = [await tok(RM), await tok(RX)];
await q(`SELECT public.bw_deputy_request_reply($1, 'maybe')`, [TM]);
await q(`SELECT public.bw_deputy_request_reply($1, 'available')`, [TX]);
await q(`UPDATE deputy_requests SET status = 'cancelled' WHERE id IN ($1, $2)`, [RM, RX]);

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
  // RX: said yes, then withdrawn (shown cancelled). Never RM (only "maybe").
  return ids.join() === [RA, RB, RX].sort().join() && leaks.length === 0 && !s.includes('"fee') && f.gigs.find((g) => g.id === RA).mine === true
    && f.gigs.find((g) => g.id === RB).mine === false;
});
await check('old subscriptions (reply token in the URL) keep working, without tokens', async () => {
  const f = (await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [TA])).f;
  return f.gigs.length === 3 && !JSON.stringify(f).includes(TB);
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


console.log('-- review fixes (PR #285)');
const col = async (r, c) => (await one(`SELECT ${c} AS v FROM deputy_requests WHERE id = $1`, [r])).v;
await check('Codex B1: the one-gig file has its own key, which opens that gig only and no feed', async () => {
  const g = await col(RA, 'gig_calendar_token');
  const v = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [await tok(RA)])).v;
  const file = (await one(`SELECT public.bw_deputy_gig_calendar($1) AS f`, [g])).f;
  const feed = (await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [g])).f;
  return /^[0-9a-f]{64}$/.test(g) && g !== await col(RA, 'calendar_token') && v.gig_calendar_token === g
    && file.gigs.length === 1 && file.gigs[0].id === RA && file.gigs[0].mine === true && feed === null
    && !JSON.stringify(file).includes(await tok(RA));
});
await check('Codex B3: "Maybe" then withdrawn is not in the calendar (no address either)', async () => {
  const f = JSON.stringify((await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [await col(RA, 'calendar_token')])).f);
  const legacy = JSON.stringify((await one(`SELECT public.bw_deputy_feed($1) AS f`, [await tok(RA)])).f);
  return !f.includes('Maybe gig') && !f.includes('7 Secret Ave') && !legacy.includes('7 Secret Ave');
});
await check('Codex B3: a yes then withdrawn shows as cancelled, without the street address', async () => {
  const f = (await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [await col(RA, 'calendar_token')])).f;
  const g = f.gigs.find((x) => x.id === RX);
  return g && g.cancelled === true && g.venue_address === null && g.venue_name === 'Gone Hall';
});
await check('Claude #4: the 084 feed (old function) takes a calendar token and writes no token at all', async () => {
  const f = (await one(`SELECT public.bw_deputy_feed($1) AS f`, [await col(RA, 'calendar_token')])).f;
  const all = (await q(`SELECT token, calendar_token, gig_calendar_token FROM deputy_requests`)).rows.flatMap((r) => Object.values(r));
  const s = JSON.stringify(f);
  return f && f.gigs.length >= 2 && f.gigs.every((g) => g.token === null) && all.every((t) => !s.includes(t));
});
await check('Claude #1: unlink of a deputy with no account still rotates every key', async () => {
  const before = [await tok(RD), await col(RD, 'calendar_token'), await col(RD, 'gig_calendar_token')];
  await as(ADMIN);
  const r = (await one(`SELECT public.bw_deputy_unlink($1) AS r`, [DEPUTY2])).r;
  await db.exec('RESET ROLE');
  const after = [await tok(RD), await col(RD, 'calendar_token'), await col(RD, 'gig_calendar_token')];
  // 'revoked' (round 4): the app can tell it from a server before 182,
  // which answers 'not_linked' without rotating anything.
  return r === 'revoked' && before.every((t, i) => t !== after[i]);
});

console.log('-- review round 2 (PR #285)');
// The band cancels the event; the deputy's request stays 'available'.
const [EV_CXL, RY] = [17, 28].map(id);
await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, venue_name, venue_city, venue_address, is_recurring, created_by, fee)
  VALUES ($1, $2, 'Called off', 'gig', 'confirmed', current_date + 12, '20:00', 'Shut Hall', 'Queens', '5 Cancel Rd', false, $3, 1)`, [EV_CXL, BAND, ADMIN]);
await q(`INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, role, status) VALUES ($1, $2, $3, $4, 'Ada', 'Keys', 'available')`, [RY, BAND, EV_CXL, DEPUTY2]);
await check('round 2: while the gig is on, the deputy who said yes gets its street address', async () => {
  const f = (await one(`SELECT public.bw_deputy_gig_calendar($1) AS f`, [await col(RY, 'gig_calendar_token')])).f;
  return f.gigs[0]?.venue_address === '5 Cancel Rd';
});
await q(`UPDATE events SET status = 'cancelled' WHERE id = $1`, [EV_CXL]);
await check('Codex r2 BLOCKER: a gig the band cancelled gives no street address to any calendar link', async () => {
  const feed = (await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [await col(RY, 'calendar_token')])).f;
  const file = (await one(`SELECT public.bw_deputy_gig_calendar($1) AS f`, [await col(RY, 'gig_calendar_token')])).f;
  const old = (await one(`SELECT public.bw_deputy_feed($1) AS f`, [await tok(RY)])).f;
  const g = feed.gigs.find((x) => x.id === RY);
  return g?.cancelled === true && g.venue_name === 'Shut Hall' && file.gigs[0]?.cancelled === true
    && ![feed, file, old].some((x) => JSON.stringify(x).includes('5 Cancel Rd'));
});
await check('round 2: nor the reply page once the gig is cancelled', async () => {
  const v = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [await tok(RY)])).v;
  return v.event_cancelled === true && v.closed === true && v.venue_address === null;
});

console.log('-- review round 3 (PR #285)');
// A deputy says yes, then the band edits or clears the address and cancels.
const [EV_R3A, EV_R3B, EV_R3C, RZ1, RZ2, RZ3] = [30, 31, 32, 33, 34, 35].map(id);
await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, venue_name, venue_city, venue_address, is_recurring, created_by, fee) VALUES
  ($1, $4, 'R3 cleared', 'gig', 'confirmed', current_date + 13, '20:00', 'Hall A', 'Queens', '1 First Ave', false, $5, 1),
  ($2, $4, 'R3 edited', 'gig', 'confirmed', current_date + 14, '20:00', 'Hall B', 'Queens', '2 Second Ave', false, $5, 1),
  ($3, $4, 'R3 cleared only', 'gig', 'confirmed', current_date + 15, '20:00', 'Hall C', 'Queens', '3 Third Ave', false, $5, 1)`, [EV_R3A, EV_R3B, EV_R3C, BAND, ADMIN]);
await q(`INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, role, status) VALUES
  ($1, $4, $5, $8, 'Ada', 'Keys', 'pending'), ($2, $4, $6, $8, 'Ada', 'Keys', 'pending'), ($3, $4, $7, $8, 'Ada', 'Keys', 'pending')`,
  [RZ1, RZ2, RZ3, BAND, EV_R3A, EV_R3B, EV_R3C, DEPUTY2]);
for (const r of [RZ1, RZ2, RZ3]) await q(`SELECT public.bw_deputy_request_reply($1, 'available')`, [await tok(r)]);
await q(`UPDATE events SET venue_address = NULL, status = 'cancelled' WHERE id = $1`, [EV_R3A]);
await q(`UPDATE events SET venue_address = '9 New St', status = 'cancelled' WHERE id = $1`, [EV_R3B]);
await q(`UPDATE events SET venue_address = NULL WHERE id = $1`, [EV_R3C]);
const view = async (r) => (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [await tok(r)])).v;
await check('Codex r3 B2: address cleared, then gig cancelled: the reply page gives no old address', async () => {
  const v = await view(RZ1);
  return !JSON.stringify(v).includes('1 First Ave') && !v.changes.includes('address');
});
await check('Claude r3: address edited, then gig cancelled: no old (or new) address in changes or before', async () => {
  const v = await view(RZ2);
  const s = JSON.stringify(v);
  return !s.includes('2 Second Ave') && !s.includes('9 New St') && !v.changes.includes('address');
});
await check('Codex r3 B2: address cleared (gig still on): the old address is not shown as "before"', async () => {
  const v = await view(RZ3);
  return !JSON.stringify(v).includes('3 Third Ave') && v.venue_address === null;
});

await check('Claude r3: "Keep my link" holds: the owner using an old one-event link is not asked again', async () => {
  await as(MEM);
  const t = (await one(`SELECT public.bw_my_calendar_token() AS t`)).t;
  await q(`SELECT public.bw_my_calendar_link_keep()`);
  await db.exec('RESET ROLE');
  await q(`SELECT public.bw_member_calendar_flag_shared($1)`, [t]);
  await as(MEM);
  const again = (await one(`SELECT public.bw_my_calendar_link_review() AS r`)).r;
  await db.exec('RESET ROLE');
  return again === false;
});

await check('Codex r3: the 500-link cap is taken under a lock on the account (no 501 by two devices)', async () => {
  const def = (await one(`SELECT pg_get_functiondef('public.bw_my_event_calendar_token(uuid, date)'::regprocedure) AS d`)).d;
  return /FROM public\.calendar_feeds[^;]*WHERE[^;]*user_id = v_uid[^;]*FOR UPDATE/i.test(def);
});

// #297: one date of a series deleted (recurrence_rule.skip_dates); #298: a
// monthly series on the 29th-31st falls on the last day of shorter months.
const occ = async (rule, start, date) => (await one(`SELECT public.bw_calendar_is_occurrence($1::jsonb, $2::date, $3::date) AS x`, [JSON.stringify(rule), start, date])).x;
await check('#297: a deleted date (skip_dates) is no occurrence; the others still are', async () =>
  (await occ({ frequency: 'weekly', skip_dates: ['2027-01-12'] }, '2027-01-05', '2027-01-12')) === false
  && (await occ({ frequency: 'weekly', skip_dates: ['2027-01-12'] }, '2027-01-05', '2027-01-19')) === true
  && (await occ({ frequency: 'weekly', skip_dates: ['2027-01-05'] }, '2027-01-05', '2027-01-05')) === false
  && (await occ({ frequency: 'weekly', skip_dates: 'junk' }, '2027-01-05', '2027-01-12')) === true);
await check('#298: monthly on the 31st: Feb 28, Mar 31, Apr 30 (never Mar 3)', async () =>
  (await occ({ frequency: 'monthly' }, '2027-01-31', '2027-02-28')) === true
  && (await occ({ frequency: 'monthly' }, '2027-01-31', '2027-03-31')) === true
  && (await occ({ frequency: 'monthly' }, '2027-01-31', '2027-04-30')) === true
  && (await occ({ frequency: 'monthly' }, '2027-01-31', '2027-03-03')) === false
  && (await occ({ frequency: 'monthly' }, '2027-01-30', '2027-03-30')) === true
  && (await occ({ frequency: 'monthly', interval: 2 }, '2026-12-31', '2027-02-28')) === true
  && (await occ({ frequency: 'monthly', count: 1 }, '2027-01-31', '2027-03-31')) === false);

// Codex review #285 round 5: one rule for a monthly date, in one helper
// (bw_calendar_monthly_date): the start's day, else the month's last day,
// counted from the first date, so nothing carries over (Jan 31 2027 ->
// Feb 28 -> Mar 31).
const nextOcc = async (rule, start, from) => (await one(`SELECT public.bw_calendar_next_occurrence($1::jsonb, $2::date, $3::date)::text AS d`, [JSON.stringify(rule), start, from])).d;
await check('monthly from Jan 31 2027: Feb 28, then Mar 31, then Apr 30 (no overflow carried)', async () =>
  (await nextOcc({ frequency: 'monthly' }, '2027-01-31', '2027-02-01')) === '2027-02-28'
  && (await nextOcc({ frequency: 'monthly' }, '2027-01-31', '2027-03-01')) === '2027-03-31'
  && (await nextOcc({ frequency: 'monthly' }, '2027-01-31', '2027-04-01')) === '2027-04-30'
  && (await nextOcc({ frequency: 'monthly', skip_dates: ['2027-02-28'] }, '2027-01-31', '2027-02-01')) === '2027-03-31');
await check('one helper for the monthly date (bw_calendar_monthly_date)', async () => {
  const r = await one(`SELECT public.bw_calendar_monthly_date('2027-01-31', 1)::text AS a, public.bw_calendar_monthly_date('2027-01-31', 2)::text AS b,
                     public.bw_calendar_monthly_date('2028-01-31', 1)::text AS c, public.bw_calendar_monthly_date('2027-01-30', 0)::text AS d`);
  return r.a === '2027-02-28' && r.b === '2027-03-31' && r.c === '2028-02-29' && r.d === '2027-01-30';
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
    && r1 !== r2 && l1.occurrence === start && l2.occurrence === occ;
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
await check('Codex B2: an occurrence link gives that date only, never the series rule or start', async () => {
  const occ = (await one(`SELECT (current_date + 15)::text AS d`)).d;
  const t = await evTok(MEM, EV_REH, occ);
  const l = (await one(`SELECT public.bw_member_event_calendar($1) AS l`, [t])).l;
  return l.event.recurrence === null && l.event.event_date === occ && l.occurrence === occ;
});
await check('Codex B2: after a schedule change that drops the date, the link shows nothing', async () => {
  const occ = (await one(`SELECT (current_date + 8)::text AS d`)).d;
  const t = await evTok(MEM, EV_REH, occ);
  await q(`UPDATE events SET recurrence_rule = '{"frequency":"weekly","interval":2}' WHERE id = $1`, [EV_REH]);
  const l = (await one(`SELECT public.bw_member_event_calendar($1) AS l`, [t])).l;
  await q(`UPDATE events SET recurrence_rule = '{"frequency":"weekly","interval":1}' WHERE id = $1`, [EV_REH]);
  return l === null;
});
await check('Codex minor: a one-off turned weekly gives its date only; weekly turned one-off drops other dates', async () => {
  const t1 = await evTok(MEM, EV2, null);
  await q(`UPDATE events SET is_recurring = true, recurrence_rule = '{"frequency":"weekly"}' WHERE id = $1`, [EV2]);
  const a = (await one(`SELECT public.bw_member_event_calendar($1) AS l`, [t1])).l;
  await q(`UPDATE events SET is_recurring = false, recurrence_rule = NULL WHERE id = $1`, [EV2]);
  const occ = (await one(`SELECT (current_date + 8)::text AS d`)).d;
  const t2 = await evTok(MEM, EV_REH, occ);
  await q(`UPDATE events SET is_recurring = false WHERE id = $1`, [EV_REH]);
  const b = (await one(`SELECT public.bw_member_event_calendar($1) AS l`, [t2])).l;
  await q(`UPDATE events SET is_recurring = true WHERE id = $1`, [EV_REH]);
  const d20 = (await one(`SELECT (current_date + 20)::text AS d`)).d;
  return a && a.event.recurrence === null && a.event.event_date === d20 && b === null;
});
await check('Claude #2: a date that is not an occurrence, or years away, gets no token', async () => {
  const bad = (await one(`SELECT (current_date + 9)::text AS d`)).d;
  const far = (await one(`SELECT (current_date + 1 + 7 * 200)::text AS d`)).d;
  return (await evTok(MEM, EV_REH, bad)) === null && (await evTok(MEM, EV_REH, far)) === null;
});
await check('Claude #2: at most 500 links per account (the oldest go)', async () => {
  await q(`INSERT INTO calendar_event_links (user_id, event_id, occurrence, created_at)
           SELECT $1, $2, current_date + 1 + 7 * g, now() - interval '1 day' FROM generate_series(1, 520) g
           ON CONFLICT DO NOTHING`, [MEM, EV_REH]);
  const occ = (await one(`SELECT (current_date + 29)::text AS d`)).d;
  await q(`DELETE FROM calendar_event_links WHERE user_id = $1 AND occurrence = $2::date`, [MEM, occ]);
  const t = await evTok(MEM, EV_REH, occ);
  const n = (await one(`SELECT count(*)::int AS n FROM calendar_event_links WHERE user_id = $1`, [MEM])).n;
  return /^[0-9a-f]{64}$/.test(t) && n === 500 && (await one(`SELECT public.bw_member_event_calendar($1) AS l`, [t])).l !== null;
});
await check('Claude #3: a link made before 182 asks once to be replaced; keep or new link ends it', async () => {
  await as(ADMIN);
  const a = (await one(`SELECT public.bw_my_calendar_link_review() AS r`)).r;
  await q(`SELECT public.bw_my_calendar_link_keep()`);
  const b = (await one(`SELECT public.bw_my_calendar_link_review() AS r`)).r;
  await as(MEM);
  const c = (await one(`SELECT public.bw_my_calendar_link_review() AS r`)).r;
  await db.exec('RESET ROLE');
  // An older build served a one-event link (t=&e=): not asked again once
  // they chose to keep it (review of #285, round 3; the owner's own taps on
  // older builds use that form too).
  const t = (await one(`SELECT token FROM calendar_feeds WHERE user_id = $1`, [ADMIN])).token;
  await db.exec('SET ROLE anon');
  await q(`SELECT public.bw_member_calendar_flag_shared($1)`, [t]);
  await db.exec('RESET ROLE');
  await as(ADMIN);
  const d = (await one(`SELECT public.bw_my_calendar_link_review() AS r`)).r;
  await q(`SELECT public.bw_my_calendar_token(true)`);
  const e = (await one(`SELECT public.bw_my_calendar_link_review() AS r`)).r;
  await db.exec('RESET ROLE');
  return a === true && b === false && c === false && d === false && e === false;
});
await check('an account that never answered is asked when an old one-event link of it is used', async () => {
  await as(OUT);
  const t = (await one(`SELECT public.bw_my_calendar_token() AS t`)).t;
  const before = (await one(`SELECT public.bw_my_calendar_link_review() AS r`)).r;
  await db.exec('RESET ROLE');
  await db.exec('SET ROLE anon');
  await q(`SELECT public.bw_member_calendar_flag_shared($1)`, [t]);
  await db.exec('RESET ROLE');
  await as(OUT);
  const after = (await one(`SELECT public.bw_my_calendar_link_review() AS r`)).r;
  await db.exec('RESET ROLE');
  return before === false && after === true;
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

console.log('-- review round 4 (PR #285)');
const [EV_R4, EV_R4OLD, DEPUTY3, R41, R42] = [40, 41, 42, 43, 44].map(id);
const NEWBIE = id(45);
await q(`INSERT INTO auth.users VALUES ($1)`, [NEWBIE]);
await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, venue_name, venue_city, venue_address, is_recurring, recurrence_rule, created_by, fee) VALUES
  ($1, $3, 'US spelling', 'gig', 'confirmed', current_date + 12, '20:00', 'Spelling Hall', 'Queens', '4 Spelling St', false, NULL, $4, 1),
  ($2, $3, 'Old weekly', 'rehearsal', 'confirmed', current_date - 70, '19:00', 'Studio C', 'Queens', NULL, true, '{"frequency":"weekly","interval":1}', $4, 0)`,
  [EV_R4, EV_R4OLD, BAND, ADMIN]);
await q(`INSERT INTO event_members (event_id, user_id, status) VALUES ($1, $2, 'confirmed')`, [EV_R4OLD, MEM]);
await q(`INSERT INTO band_deputies (id, band_id, name, user_id) VALUES ($1, $2, 'Max', NULL)`, [DEPUTY3, BAND]);
await q(`INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, role, status, answer_snapshot) VALUES
  ($1, $3, $4, $5, 'Max', 'Drums', 'available', '{}'), ($2, $3, $6, $5, 'Max', 'Drums', 'available', '{}')`, [R41, R42, BAND, EV_R4, DEPUTY3, EV]);

await check("B3: 'canceled' (US spelling) hides the address like 'cancelled', in the page, the feed and the file", async () => {
  await q(`UPDATE events SET status = 'Canceled' WHERE id = $1`, [EV_R4]);
  const v = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [await tok(R41)])).v;
  const f = (await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [await col(R41, 'calendar_token')])).f;
  const g = (await one(`SELECT public.bw_deputy_gig_calendar($1) AS g`, [await col(R41, 'gig_calendar_token')])).g;
  const fg = f?.gigs?.find((x) => x.id === R41);
  const gg = g?.gigs?.[0] ?? g?.gig ?? g;
  return v.venue_address == null && v.event_cancelled === true && v.closed === true
    && fg && fg.venue_address == null && fg.cancelled === true
    && gg && gg.venue_address == null && gg.cancelled === true;
});
await check('B3: one helper decides it, on lower(status::text)', async () => {
  const r = await one(`SELECT public.bw_event_status_cancelled('cancelled') AS a, public.bw_event_status_cancelled('CANCELED') AS b,
    public.bw_event_status_cancelled('confirmed') AS c, public.bw_event_status_cancelled(NULL) AS d`);
  return r.a === true && r.b === true && r.c === false && r.d === false;
});
await check('B1: a claim locks the deputy before it checks the token', async () => {
  const src = (await one(`SELECT pg_get_functiondef('public.bw_deputy_claim(text)'::regprocedure) AS s`)).s;
  const lock = src.search(/FROM public\.band_deputies[^;]*FOR UPDATE/);
  const recheck = src.slice(lock).search(/FROM public\.deputy_requests[^;]*token = p_token/);
  return lock > 0 && recheck > 0;
});
await check('B1: a token rotated by "Revoke sent links" can no longer link an account', async () => {
  const old = await tok(R42);
  await as(ADMIN);
  await q(`SELECT public.bw_deputy_unlink($1)`, [DEPUTY3]);
  await as(NEWBIE);
  const r1 = (await one(`SELECT public.bw_deputy_claim($1) AS r`, [old])).r;
  await db.exec('RESET ROLE');
  const linked1 = (await one(`SELECT user_id FROM band_deputies WHERE id = $1`, [DEPUTY3])).user_id;
  await as(NEWBIE);
  const r2 = (await one(`SELECT public.bw_deputy_claim($1) AS r`, [await tok(R42)])).r;
  await db.exec('RESET ROLE');
  const linked2 = (await one(`SELECT user_id FROM band_deputies WHERE id = $1`, [DEPUTY3])).user_id;
  await q(`UPDATE band_deputies SET user_id = NULL WHERE id = $1`, [DEPUTY3]);
  return r1.status === 'not_found' && linked1 === null && r2.status === 'linked' && linked2 === NEWBIE;
});
// Codex r5 BLOCKER (DeputiesSection:155): "Revoke sent links" never unlinks.
// Its own call (bw_deputy_revoke_links) only rotates the links of a deputy
// with no account; if they joined between the admin's look and the tap, it
// changes nothing and says 'linked'.
await check('round 6: revoke rotates the links of a deputy with no account, and only then', async () => {
  const before = [await tok(R42), await col(R42, 'calendar_token'), await col(R42, 'gig_calendar_token')];
  await as(ADMIN);
  const r = (await one(`SELECT public.bw_deputy_revoke_links($1) AS r`, [DEPUTY3])).r;
  await db.exec('RESET ROLE');
  const after = [await tok(R42), await col(R42, 'calendar_token'), await col(R42, 'gig_calendar_token')];
  return r === 'revoked' && before.every((t, i) => t !== after[i]);
});
await check('round 6 race: they join between the look and the tap; the revoke leaves the account linked', async () => {
  // The admin saw no account (getDeputy); the deputy joins with the current link.
  await as(NEWBIE);
  const claim = (await one(`SELECT public.bw_deputy_claim($1) AS r`, [await tok(R42)])).r;
  await db.exec('RESET ROLE');
  const keys = [await tok(R42), await col(R42, 'calendar_token'), await col(R42, 'gig_calendar_token')];
  await as(ADMIN);
  const r = (await one(`SELECT public.bw_deputy_revoke_links($1) AS r`, [DEPUTY3])).r;
  await db.exec('RESET ROLE');
  const linked = (await one(`SELECT user_id FROM band_deputies WHERE id = $1`, [DEPUTY3])).user_id;
  const same = [await tok(R42), await col(R42, 'calendar_token'), await col(R42, 'gig_calendar_token')].every((t, i) => t === keys[i]);
  await q(`UPDATE band_deputies SET user_id = NULL WHERE id = $1`, [DEPUTY3]);
  return claim.status === 'linked' && r === 'linked' && linked === NEWBIE && same;
});
await check('round 6: only a band admin may revoke; grants', async () => {
  let refused = false;
  await as(MEM);
  try { await q(`SELECT public.bw_deputy_revoke_links($1)`, [DEPUTY3]); } catch { refused = true; }
  await db.exec('RESET ROLE');
  const g = await one(`SELECT has_function_privilege('anon', 'public.bw_deputy_revoke_links(uuid)', 'EXECUTE') AS a,
    has_function_privilege('authenticated', 'public.bw_deputy_revoke_links(uuid)', 'EXECUTE') AS b`);
  return refused && !g.a && g.b;
});
await check('Claude: deleting a deputy ends its reply, calendar and gig-file links first', async () => {
  const before = [await tok(R42), await col(R42, 'calendar_token'), await col(R42, 'gig_calendar_token')];
  await q(`DELETE FROM band_deputies WHERE id = $1`, [DEPUTY3]);
  const after = [await tok(R42), await col(R42, 'calendar_token'), await col(R42, 'gig_calendar_token')];
  const page = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [before[0]])).v;
  const feed = (await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [before[1]])).f;
  return before.every((t, i) => t !== after[i]) && page === null && (feed === null || (feed.gigs ?? []).length === 0);
});
await check('Claude 182:483: a series opened without a date (first date 70 days ago) gets its next date', async () => {
  const t1 = await evTok(MEM, EV_R4OLD, null);
  const l1 = t1 && (await one(`SELECT public.bw_member_event_calendar($1) AS l`, [t1])).l;
  const today = (await one(`SELECT current_date::text AS d`)).d;
  const next = l1?.event?.event_date;
  return /^[0-9a-f]{64}$/.test(t1 ?? '') && next >= today && next < (await one(`SELECT (current_date + 7)::text AS d`)).d;
});
// Claude review round 5 (182:648): only a missing date is replaced. A first
// date the user opened stays, also when past (within the 60-day window; a
// first date 70 days back is outside it, so no link rather than another date).
await check('round 5: a past first date the user opened stays that date (never moved to the next one)', async () => {
  const first10 = (await one(`SELECT (current_date - 14)::text AS d`)).d;
  await q(`UPDATE events SET event_date = $2::date WHERE id = $1`, [EV_R4OLD, first10]);
  const t = await evTok(MEM, EV_R4OLD, first10);
  const l = t && (await one(`SELECT public.bw_member_event_calendar($1) AS l`, [t])).l;
  await q(`UPDATE events SET event_date = current_date - 70 WHERE id = $1`, [EV_R4OLD]);
  const far = await evTok(MEM, EV_R4OLD, (await one(`SELECT (current_date - 70)::text AS d`)).d);
  return l?.event?.event_date === first10 && far === null;
});
await check('next date skips a deleted one (skip_dates)', async () => {
  const nxt = (await one(`SELECT public.bw_calendar_next_occurrence('{"frequency":"weekly"}'::jsonb, current_date - 70, current_date)::text AS d`)).d;
  const skip = JSON.stringify({ frequency: 'weekly', skip_dates: [nxt] });
  const after = (await one(`SELECT public.bw_calendar_next_occurrence($1::jsonb, current_date - 70, current_date)::text AS d`, [skip])).d;
  const ended = (await one(`SELECT public.bw_calendar_next_occurrence('{"frequency":"weekly","until":"2000-01-01"}'::jsonb, current_date - 70, current_date) AS d`)).d;
  return after > nxt && ended === null;
});

// Codex review #285 round 5: "today" is never UTC's. A member whose day is
// behind the server's (Los Angeles after midnight UTC) asks for the series'
// first date, which is still today for them: that date, not next week's.
// Here the server's own date is the latest on Earth (UTC+14), the series
// starts on the earliest date still current somewhere (UTC-12).
await check('the first date of a series is kept while it is still today somewhere (never UTC "today")', async () => {
  const EV_TZ = id(60);
  const start = (await one(`SELECT ((now() AT TIME ZONE 'Etc/GMT+12')::date)::text AS d`)).d;
  await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, venue_name, venue_city, is_recurring, recurrence_rule, created_by, fee) VALUES
    ($1, $2, 'Late rehearsal', 'rehearsal', 'confirmed', $3::date, '19:00', 'Studio C', 'Queens', true, '{"frequency":"weekly","interval":1}', $4, 0)`, [EV_TZ, BAND, start, ADMIN]);
  await q(`INSERT INTO event_members (event_id, user_id, role, status) VALUES ($1, $2, NULL, 'confirmed')`, [EV_TZ, MEM]);
  await db.exec(`SET TIME ZONE 'Etc/GMT-14'`);
  try {
    const picked = await evTok(MEM, EV_TZ, start);
    const opened = await evTok(MEM, EV_TZ, null);
    const occOf = async (t) => (await one(`SELECT occurrence::text AS o FROM calendar_event_links WHERE token = $1`, [t]))?.o;
    return !!picked && (await occOf(picked)) === start && !!opened && (await occOf(opened)) === start;
  } finally {
    await db.exec(`SET TIME ZONE 'UTC'`);
  }
});

// ---------------------------------------------------- round 5 (Claude) --
console.log('-- round 5');
// A: the shared monthly vectors (supabase/tests/monthly-clamp-vectors.json,
// the same in calendarLinks.test.tsx): 29th-31st, 2027 and 2028, 14 months.
await check('monthly vectors (29th-31st, 2027 and 2028, 14 months): the SQL next date gives every one, never Mar 28', async () => {
  const { vectors } = JSON.parse(readFileSync(`${REPO}/supabase/tests/monthly-clamp-vectors.json`, 'utf8'));
  if (vectors.length !== 6) return false;
  for (const { start, dates } of vectors) {
    if (dates.length !== 14) return false;
    for (let k = 0; k < dates.length; k++) {
      const from = k === 0 ? start : (await one(`SELECT ($1::date + 1)::text AS d`, [dates[k - 1]])).d;
      if ((await nextOcc({ frequency: 'monthly' }, start, from)) !== dates[k]) { console.log('   ', start, k, dates[k]); return false; }
      if ((await one(`SELECT public.bw_calendar_monthly_date($1::date, $2)::text AS d`, [start, k])).d !== dates[k]) return false;
    }
    if (!start.endsWith('-29') && (await occ({ frequency: 'monthly' }, start, `${start.slice(0, 4)}-03-28`)) !== false) return false;
  }
  return true;
});

// Codex round 7 (M1, 182:717): the app's calendar (src/lib/recurrence.ts,
// #298's repeatDates, used by EventsView) and the SQL give the same dates,
// so the date the app sends is one 182 takes: Jan 31 2027 first, then every
// vector. Node runs the .ts file as is (type stripping).
await check('UI = SQL: repeatDates (EventsView) and the SQL next date agree, Jan 31 2027 and every vector', async () => {
  const file = `${REPO}/src/lib/recurrence.ts`;
  if (!existsSync(file)) { console.log('    src/lib/recurrence.ts missing: the app still steps months with setMonth'); return false; }
  const { repeatDates } = await import(file);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const { vectors } = JSON.parse(readFileSync(`${REPO}/supabase/tests/monthly-clamp-vectors.json`, 'utf8'));
  const order = [...vectors].sort((x, y) => (x.start === '2027-01-31' ? -1 : y.start === '2027-01-31' ? 1 : 0));
  if (order[0].start !== '2027-01-31') return false;
  for (const { start, dates } of order) {
    const ui = [start, ...repeatDates(start, { frequency: 'monthly' }, new Date(2030, 0, 1), dates.length - 1).map(ymd)];
    const sql = [];
    for (let k = 0; k < dates.length; k++) {
      const from = k === 0 ? start : (await one(`SELECT ($1::date + 1)::text AS d`, [sql[k - 1]])).d;
      sql.push(await nextOcc({ frequency: 'monthly' }, start, from));
    }
    if (JSON.stringify(ui) !== JSON.stringify(sql) || JSON.stringify(ui) !== JSON.stringify(dates)) {
      console.log('    ', start, 'ui', ui.slice(0, 4).join(' '), 'sql', sql.slice(0, 4).join(' '));
      return false;
    }
    // Each app date is a date of the series for 182.
    for (const d of ui) if ((await occ({ frequency: 'monthly' }, start, d)) !== true) return false;
  }
  return true;
});

// B3: one event, without the whole feed; opening an event writes nothing.
await check('the one-event lookup equals the feed, for every account and event', async () => {
  await q(`INSERT INTO calendar_feeds (user_id) SELECT id FROM auth.users ON CONFLICT (user_id) DO NOTHING`);
  const r = await one(`SELECT bool_and(
      coalesce((SELECT x FROM jsonb_array_elements(public.bw_member_calendar_feed(f.token)->'events') x WHERE x->>'id' = e.id::text), 'null'::jsonb)
      = coalesce(public.bw_member_calendar_event(f.user_id, e.id), 'null'::jsonb)) AS same,
      count(*) FILTER (WHERE public.bw_member_calendar_event(f.user_id, e.id) IS NOT NULL) AS seen, count(*) AS n
    FROM calendar_feeds f CROSS JOIN events e`);
  return r.same === true && Number(r.seen) > 3 && Number(r.n) > 20;
});
const EV_OPEN = id(70);
await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, venue_name, venue_city, is_recurring, created_by, fee) VALUES
  ($1, $2, 'Open mic', 'gig', 'confirmed', current_date + 12, '20:00', 'Cafe', 'Queens', false, $3, 0)`, [EV_OPEN, BAND, ADMIN]);
await q(`INSERT INTO event_members (event_id, user_id, role, status) VALUES ($1, $2, 'Bass', 'confirmed')`, [EV_OPEN, MEM]);
const openLink = async (uid, ev, date, fnName = 'bw_my_event_calendar_link') => {
  await as(uid);
  await db.exec('BEGIN');
  try {
    const t = (await one(`SELECT public.${fnName}($1, $2::date) AS t`, [ev, date])).t;
    const xid = (await one(`SELECT pg_current_xact_id_if_assigned() AS x`)).x;
    await db.exec('COMMIT');
    return { t, wrote: xid !== null };
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  } finally {
    await db.exec('RESET ROLE');
  }
};
await check('opening an event with no link yet: nothing is made and nothing is written', async () => {
  const before = Number((await one(`SELECT count(*) AS n FROM calendar_event_links WHERE event_id = $1`, [EV_OPEN])).n);
  const r = await openLink(MEM, EV_OPEN, null);
  const after = Number((await one(`SELECT count(*) AS n FROM calendar_event_links WHERE event_id = $1`, [EV_OPEN])).n);
  return r.t === null && !r.wrote && before === 0 && after === 0;
});
await check('the first tap makes it; later opens read it back without a write (also the tap path)', async () => {
  const made = await openLink(MEM, EV_OPEN, null, 'bw_my_event_calendar_token');
  const open = await openLink(MEM, EV_OPEN, null);
  const tapAgain = await openLink(MEM, EV_OPEN, null, 'bw_my_event_calendar_token');
  return /^[0-9a-f]{64}$/.test(made.t ?? '') && made.wrote && open.t === made.t && !open.wrote && tapAgain.t === made.t && !tapAgain.wrote;
});
await check('the read path follows the same rules: another band, a declined event, nobody signed in', async () => {
  const other = await openLink(OUT, EV_OPEN, null);
  await q(`UPDATE event_members SET status = 'declined' WHERE event_id = $1 AND user_id = $2`, [EV_OPEN, MEM]);
  const declined = await openLink(MEM, EV_OPEN, null);
  await q(`UPDATE event_members SET status = 'confirmed' WHERE event_id = $1 AND user_id = $2`, [EV_OPEN, MEM]);
  let refused = false;
  try { await q(`SET ROLE authenticated`); await q(`SELECT set_config('request.jwt.claims', '', false)`); await q(`SELECT public.bw_my_event_calendar_link($1)`, [EV_OPEN]); }
  catch { refused = true; }
  await db.exec('RESET ROLE');
  return other.t === null && declined.t === null && refused;
});
await check('grants: the read path is for signed-in users only', async () => {
  const r = await one(`SELECT has_function_privilege('anon', 'public.bw_my_event_calendar_link(uuid, date)', 'EXECUTE') AS a,
    has_function_privilege('authenticated', 'public.bw_my_event_calendar_link(uuid, date)', 'EXECUTE') AS b,
    has_function_privilege('authenticated', 'public.bw_member_calendar_event(uuid, uuid)', 'EXECUTE') AS c`);
  return !r.a && r.b && !r.c;
});

// B5: a withdrawn gig stays as the deputy last saw it.
const [EV_W, DEPUTY5, RW] = [71, 72, 73].map(id);
await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, end_time, venue_name, venue_city, venue_address, is_recurring, created_by, fee) VALUES
  ($1, $2, 'Harbor Gala', 'gig', 'confirmed', current_date + 25, '19:00', '23:00', 'Harbor Hall', 'Jersey City', '5 Dock St', false, $3, 1000)`, [EV_W, BAND, ADMIN]);
await q(`INSERT INTO band_deputies (id, band_id, name, user_id) VALUES ($1, $2, 'Nia', NULL)`, [DEPUTY5, BAND]);
await q(`INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, role, status) VALUES ($1, $2, $3, $4, 'Nia', 'Drums', 'pending')`, [RW, BAND, EV_W, DEPUTY5]);
await q(`SELECT public.bw_deputy_request_reply($1, 'available')`, [await tok(RW)]);
await q(`UPDATE deputy_requests SET status = 'cancelled' WHERE id = $1`, [RW]); // withdrawn
await q(`UPDATE events SET title = 'Harbor Gala (moved)', start_time = '21:00', venue_name = 'New Hall', venue_city = 'Newark', event_date = current_date + 26 WHERE id = $1`, [EV_W]);
await check('a withdrawn gig: both calendars and the page keep it as it was, without the address', async () => {
  const day = (await one(`SELECT (current_date + 25)::text AS d`)).d;
  const feed = (await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [await col(RW, 'calendar_token')])).f;
  const file = (await one(`SELECT public.bw_deputy_gig_calendar($1) AS g`, [await col(RW, 'gig_calendar_token')])).g;
  const view = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [await tok(RW)])).v;
  const same = (g) => g && g.cancelled === true && g.event_title === 'Harbor Gala' && g.event_date === day
    && String(g.start_time).startsWith('19:00') && g.venue_name === 'Harbor Hall' && g.venue_city === 'Jersey City' && g.venue_address === null;
  return same(feed.gigs.find((g) => g.id === RW)) && same(file.gigs[0])
    && view.event_title === 'Harbor Gala' && view.event_date === day && view.venue_name === 'Harbor Hall' && view.venue_address === null && view.closed === true;
});
await check('withdrawn after an answer saved before 182 (no title in it): the title at withdrawal is kept', async () => {
  const RW2 = id(74);
  await q(`INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, role, status, answer_snapshot) VALUES
    ($1, $2, $3, $4, 'Nia', 'Drums', 'available', $5::jsonb)`, [RW2, BAND, EV_W, DEPUTY5, JSON.stringify({ date: '2030-01-01', start: '18:00', venue: 'Old Hall', city: 'Hoboken', address: '1 Old St' })]);
  await q(`UPDATE deputy_requests SET status = 'cancelled' WHERE id = $1`, [RW2]);
  await q(`UPDATE events SET title = 'Harbor Gala (again)' WHERE id = $1`, [EV_W]);
  const v = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [await tok(RW2)])).v;
  return v.event_title === 'Harbor Gala (moved)' && v.venue_name === 'Old Hall' && v.event_date === '2030-01-01';
});

console.log('-- #294: a gig reverted to a private quote (178)');
const [EV_Q, DEPUTY4, RQ] = [50, 51, 52].map(id);
await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, venue_name, venue_city, venue_address, is_recurring, created_by, fee) VALUES
  ($1, $2, 'Wedding at the Pier', 'gig', 'confirmed', current_date + 15, '18:00', 'Pier House', 'Hoboken', '1 Pier Rd', false, $3, 5000)`, [EV_Q, BAND, ADMIN]);
await q(`INSERT INTO band_deputies (id, band_id, name, user_id) VALUES ($1, $2, 'Rita', NULL)`, [DEPUTY4, BAND]);
await q(`INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, role, status, answer_snapshot) VALUES
  ($1, $2, $3, $4, 'Rita', 'Sax', 'available', '{}')`, [RQ, BAND, EV_Q, DEPUTY4]);
await q(`UPDATE events SET status = 'tentative' WHERE id = $1`, [EV_Q]); // back to a quote
const quoteViews = async () => ({
  view: (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [await tok(RQ)])).v,
  feed: (await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [await col(RQ, 'calendar_token')])).f,
  file: (await one(`SELECT public.bw_deputy_gig_calendar($1) AS g`, [await col(RQ, 'gig_calendar_token')])).g,
  old: (await one(`SELECT public.bw_deputy_feed($1) AS f`, [await col(RQ, 'calendar_token')])).f,
});
await check('with 178: a gig reverted to a quote is hidden from an existing deputy in all four', async () => {
  const r = await quoteViews();
  return r.view && r.view.closed === true && r.view.event_title === null && r.view.venue_address === null && r.view.event_date === null
    && !r.feed.gigs.some((g) => g.id === RQ) && r.file.gigs.length === 0
    && !r.old.gigs.some((g) => g.event_title === 'Wedding at the Pier');
});
// Claude review round 5 (182:259): hidden also means no offer, note or
// calendar keys, on the page and in the app (bw_my_deputy_gigs, 086).
await check('with 178: the hidden gig shows no fee, currency, note or calendar keys, on the page and in the app', async () => {
  const U = id(75);
  await q(`INSERT INTO auth.users VALUES ($1)`, [U]);
  await q(`INSERT INTO profiles (id, preferred_language) VALUES ($1, 'en')`, [U]);
  await q(`UPDATE band_deputies SET user_id = $2 WHERE id = $1`, [DEPUTY4, U]);
  await q(`UPDATE deputy_requests SET fee_offered = 400, currency = 'USD', reply_note = 'Can do' WHERE id = $1`, [RQ]);
  const v = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [await tok(RQ)])).v;
  await as(U);
  const mine = (await one(`SELECT public.bw_my_deputy_gigs() AS g`)).g;
  await db.exec('RESET ROLE');
  const g = mine.gigs.find((x) => x.id === RQ);
  const blank = (o) => o && ['fee', 'currency', 'reply_note', 'calendar_token', 'gig_calendar_token', 'event_title', 'venue_address'].every((k) => o[k] === null) && o.closed === true;
  return blank(v) && blank(g);
});
// #294 Codex (cross-PR, main): every link or token read path hides a gig
// reverted to a quote. A member on the lineup, with an "Add to calendar"
// link and the account feed, made while it was a gig.
const [EV_Q2] = [53].map(id);
await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, venue_name, venue_city, venue_address, is_recurring, created_by, fee) VALUES
  ($1, $2, 'Gala at the Boathouse', 'gig', 'confirmed', current_date + 16, '19:00', 'Boathouse', 'Weehawken', '2 Dock St', false, $3, 4000)`, [EV_Q2, BAND, ADMIN]);
await q(`INSERT INTO event_members (event_id, user_id, role, status) VALUES ($1, $2, 'Bass', 'confirmed')`, [EV_Q2, MEM]);
const TQ2 = await evTok(MEM, EV_Q2, null).catch(() => null);
const memberViews = async () => {
  const feedTok = (await one(`SELECT token FROM calendar_feeds WHERE user_id = $1`, [MEM])).token;
  const feed = (await one(`SELECT public.bw_member_calendar_feed($1) AS f`, [feedTok])).f;
  await as(MEM);
  const link = (await one(`SELECT public.bw_my_event_calendar_link($1) AS t`, [EV_Q2])).t;
  await db.exec('RESET ROLE');
  return {
    inFeed: JSON.stringify(feed).includes('Gala at the Boathouse') || JSON.stringify(feed).includes('2 Dock St'),
    file: (await one(`SELECT public.bw_member_event_calendar($1) AS v`, [TQ2])).v,
    lookup: (await one(`SELECT public.bw_member_calendar_event($1, $2) AS v`, [MEM, EV_Q2])).v,
    link,
  };
};
await check('#294 cross-PR: a gig reverted to a quote: the member feed, the one-event file and its link show nothing', async () => {
  const before = await memberViews();
  if (!/^[0-9a-f]{64}$/.test(TQ2 ?? '') || !before.inFeed || !before.file?.event || before.link !== TQ2) return false;
  for (const revert of [`status = 'tentative'`, `quote_id = gen_random_uuid(), status = 'quoted'`]) {
    await q(`UPDATE events SET ${revert} WHERE id = $1`, [EV_Q2]);
    const r = await memberViews();
    if (r.inFeed || r.file !== null || r.lookup !== null || r.link !== null) { console.log('   ', revert, JSON.stringify(r).slice(0, 200)); return false; }
    await q(`UPDATE events SET status = 'confirmed', quote_id = NULL WHERE id = $1`, [EV_Q2]);
  }
  const back = await memberViews();
  return back.inFeed && back.file?.event?.title === 'Gala at the Boathouse';
});
await check('#294 cross-PR: the same gig, reverted, gives an existing deputy nothing private (page, both calendars, old feed)', async () => {
  const [DEPQ2, RQ2] = [54, 55].map(id);
  await q(`INSERT INTO band_deputies (id, band_id, name, user_id) VALUES ($1, $2, 'Nia', NULL)`, [DEPQ2, BAND]);
  await q(`INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, role, fee_offered, currency, status, answer_snapshot)
    VALUES ($1, $2, $3, $4, 'Nia', 'Keys', 600, 'USD', 'available', '{}')`, [RQ2, BAND, EV_Q2, DEPQ2]);
  await q(`UPDATE events SET status = 'tentative' WHERE id = $1`, [EV_Q2]);
  const v = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [await tok(RQ2)])).v;
  const f = (await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [await col(RQ2, 'calendar_token')])).f;
  const g = (await one(`SELECT public.bw_deputy_gig_calendar($1) AS g`, [await col(RQ2, 'gig_calendar_token')])).g;
  const o = (await one(`SELECT public.bw_deputy_feed($1) AS f`, [await col(RQ2, 'calendar_token')])).f;
  const leaks = (x) => /Gala at the Boathouse|2 Dock St|Boathouse|600/.test(JSON.stringify(x));
  await q(`UPDATE events SET status = 'confirmed' WHERE id = $1`, [EV_Q2]);
  return v?.closed === true && !leaks(v) && !leaks(f) && !leaks(g) && !leaks(o);
});

// #294 Codex B2 (main: option a, deputy paths keep bw_event_deputy_hidden):
// confirmed, reverted to a quote, then the quote gets a client and a new
// title. An existing deputy (with an account too) sees none of it.
await check('#294 B2: reverted to a quote, then a client and a new title: no deputy path shows them', async () => {
  const [EV_B2, DEPB2, RB2, UB2] = [56, 57, 58, 59].map(id);
  await q(`ALTER TABLE public.events ADD COLUMN IF NOT EXISTS client_name text`);
  await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, venue_name, venue_city, venue_address, is_recurring, created_by, fee) VALUES
    ($1, $2, 'Spring Social', 'gig', 'confirmed', current_date + 18, '20:00', 'Hall B', 'Montclair', '8 Elm St', false, $3, 3000)`, [EV_B2, BAND, ADMIN]);
  await q(`INSERT INTO auth.users VALUES ($1)`, [UB2]);
  await q(`INSERT INTO profiles (id, preferred_language) VALUES ($1, 'en')`, [UB2]);
  await q(`INSERT INTO band_deputies (id, band_id, name, user_id) VALUES ($1, $2, 'Omar', $3)`, [DEPB2, BAND, UB2]);
  await q(`INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, role, fee_offered, currency, status, answer_snapshot)
    VALUES ($1, $2, $3, $4, 'Omar', 'Drums', 700, 'USD', 'available', '{}')`, [RB2, BAND, EV_B2, DEPB2]);
  await q(`UPDATE events SET status = 'tentative' WHERE id = $1`, [EV_B2]);
  await q(`UPDATE events SET client_name = 'Hartwell Family', title = 'Hartwell Wedding (private)', venue_address = '77 Secret Ln' WHERE id = $1`, [EV_B2]);
  const v = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [await tok(RB2)])).v;
  const f = (await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [await col(RB2, 'calendar_token')])).f;
  const g = (await one(`SELECT public.bw_deputy_gig_calendar($1) AS g`, [await col(RB2, 'gig_calendar_token')])).g;
  const o = (await one(`SELECT public.bw_deputy_feed($1) AS f`, [await col(RB2, 'calendar_token')])).f;
  await as(UB2);
  const mine = (await one(`SELECT public.bw_my_deputy_gigs() AS g`)).g;
  await db.exec('RESET ROLE');
  const leaks = (x) => /Hartwell|Secret Ln|Spring Social|8 Elm St|700/.test(JSON.stringify(x ?? null));
  const ok = v?.closed === true && !leaks(v) && !leaks(f) && !leaks(g) && !leaks(o) && !leaks(mine)
    && (mine?.gigs ?? []).some((x) => x.id === RB2 && x.closed === true);
  if (!ok) console.log('   ', [v, f, g, o, mine].map((x) => leaks(x)).join(' '));
  return ok;
});

await check('with 178: confirmed again, it is back', async () => {
  await q(`UPDATE events SET status = 'confirmed' WHERE id = $1`, [EV_Q]);
  const r = await quoteViews();
  return r.view?.event_title === 'Wedding at the Pier' && r.view.closed === false && r.view.venue_address === '1 Pier Rd'
    && r.feed.gigs.some((g) => g.id === RQ) && r.file.gigs.length === 1;
});
await check('with 178: rehearsals and other gigs are untouched', async () => {
  const f = (await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [await col(RA, 'calendar_token')])).f;
  return f.gigs.some((g) => g.id === RA);
});

// ----------------------------------------------------- round 7 (Codex) --
console.log('-- round 7');
await check('Codex r7 B3: a request whose deputy was deleted before 182 has a new reply key (the old link opens nothing)', async () => {
  const v = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [TORPH])).v;
  const now = (await one(`SELECT token FROM deputy_requests WHERE id = $1`, [RORPH])).token;
  return v === null && now !== TORPH && /^[0-9a-f]{64}$/.test(now);
});
await check('Codex r7 B3: with no deputy (deputy_id NULL) the reply page shows no fee, currency, address or calendar keys, and is closed', async () => {
  const now = (await one(`SELECT token FROM deputy_requests WHERE id = $1`, [RORPH])).token;
  const v = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [now])).v;
  return v && v.fee == null && v.currency == null && v.venue_address == null && v.reply_note == null
    && v.calendar_token == null && v.gig_calendar_token == null && v.closed === true
    && !(v.changes ?? []).includes('address') && !('address' in (v.before ?? {}));
});
await check('Codex r7 B3: a deputy deleted after 182 (trigger) gets the same page', async () => {
  const [EV_D7, DEP7, R7] = [95, 96, 97].map(id);
  await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, venue_name, venue_address, is_recurring, created_by, fee)
    VALUES ($1, $2, 'Later Gig', 'gig', 'confirmed', current_date + 14, 'Hall 7', '7 Hidden Rd', false, $3, 1)`, [EV_D7, BAND, ADMIN]);
  await q(`INSERT INTO band_deputies (id, band_id, name, user_id) VALUES ($1, $2, 'Seven', NULL)`, [DEP7, BAND]);
  await q(`INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, fee_offered, currency, status, answer_snapshot)
    VALUES ($1, $2, $3, $4, 'Seven', 500, 'USD', 'available', '{}')`, [R7, BAND, EV_D7, DEP7]);
  await q(`DELETE FROM band_deputies WHERE id = $1`, [DEP7]);
  const now = (await one(`SELECT token, deputy_id FROM deputy_requests WHERE id = $1`, [R7]));
  const v = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [now.token])).v;
  return now.deputy_id === null && v && v.fee == null && v.venue_address == null && v.closed === true;
});
await check('Codex r7 B3: a deputy still in the band keeps fee and address', async () => {
  const v = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [await tok(RA)])).v;
  return v && Number(v.fee) === 250 && v.venue_address === '12 Water St';
});

const [EV_END, EV_RUN] = [98, 99].map(id);
await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, venue_name, is_recurring, recurrence_rule, created_by, fee)
  VALUES ($1, $3, 'Ended rehearsal', 'rehearsal', 'confirmed', current_date - 30, '19:00', 'Studio C', true,
          jsonb_build_object('frequency', 'weekly', 'interval', 1, 'until', to_char(current_date - 10, 'YYYY-MM-DD')), $4, 0),
         ($2, $3, 'Running rehearsal', 'rehearsal', 'confirmed', current_date - 30, '19:00', 'Studio C', true,
          '{"frequency":"weekly","interval":1}', $4, 0)`, [EV_END, EV_RUN, BAND, ADMIN]);
await q(`INSERT INTO event_members (event_id, user_id, role, status) VALUES ($1, $3, NULL, 'confirmed'), ($2, $3, NULL, 'confirmed')`, [EV_END, EV_RUN, MEM]);
await check('Codex r7 M3: a series with no date left gives no link without a date (never its first rehearsal)', async () => {
  const made = await evTok(MEM, EV_END, null);
  await as(MEM);
  const read = (await one(`SELECT public.bw_my_event_calendar_link($1) AS t`, [EV_END])).t;
  await db.exec('RESET ROLE');
  const firstLinks = (await one(`SELECT count(*)::int AS n FROM calendar_event_links WHERE event_id = $1`, [EV_END])).n;
  return made === null && read === null && firstLinks === 0;
});
await check('Codex r7 M3: a date the user opened still gets its link; a running series still gets its next date', async () => {
  const first = (await one(`SELECT (current_date - 30)::text AS d`)).d;
  const opened = await evTok(MEM, EV_END, first);
  const running = await evTok(MEM, EV_RUN, null);
  const r = await one(`SELECT occurrence::text AS o, (SELECT public.bw_calendar_today())::date - occurrence AS ago FROM calendar_event_links WHERE token = $1`, [running]);
  return /^[0-9a-f]{64}$/.test(opened ?? '') && /^[0-9a-f]{64}$/.test(running ?? '') && r && r.ago <= 0 && r.ago > -7;
});

// ------------------------------------------- round 8 (Codex @ 0b5765f0) --
console.log('-- round 8');
// M4 (182:982): a link made for a one-off (occurrence NULL), then the event
// repeats and its first date is deleted: the file is the first date still on.
const [EV_M4] = [100].map(id);
await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, venue_name, is_recurring, recurrence_rule, created_by, fee)
  VALUES ($1, $2, 'Became weekly', 'rehearsal', 'confirmed', current_date + 3, '19:00', 'Studio D', false, NULL, $3, 0)`, [EV_M4, BAND, ADMIN]);
await q(`INSERT INTO event_members (event_id, user_id, role, status) VALUES ($1, $2, NULL, 'confirmed')`, [EV_M4, MEM]);
let TM4 = null;
try { TM4 = await evTok(MEM, EV_M4, null); } catch { await db.exec('RESET ROLE').catch(() => {}); } // no 182: none
const fileOf = async (t) => (await one(`SELECT public.bw_member_event_calendar($1) AS v`, [t])).v;
await check('Codex r8 M4: one-off link, now weekly with its first date deleted: the file has the first date still on', async () => {
  const first = (await one(`SELECT (current_date + 3)::text AS d, (current_date + 10)::text AS n`)).d;
  const next = (await one(`SELECT (current_date + 10)::text AS n`)).n;
  await q(`UPDATE events SET is_recurring = true, recurrence_rule = jsonb_build_object('frequency', 'weekly', 'interval', 1, 'skip_dates', jsonb_build_array($2::text)) WHERE id = $1`, [EV_M4, first]);
  const v = await fileOf(TM4);
  return !!TM4 && v?.event?.event_date === next && v.event.recurrence === null;
});
await check('Codex r8 M4: and none left (every date deleted): no file (404)', async () => {
  const [a, b] = Object.values(await one(`SELECT (current_date + 3)::text AS a, (current_date + 10)::text AS b`));
  await q(`UPDATE events SET recurrence_rule = jsonb_build_object('frequency', 'weekly', 'interval', 1, 'count', 1, 'skip_dates', jsonb_build_array($2::text, $3::text)) WHERE id = $1`, [EV_M4, a, b]);
  return (await fileOf(TM4)) === null;
});

// #297 B4: deleted dates (skip_dates, as #297 stores them: sorted YYYY-MM-DD)
// and a date moved with "Only this date" (the original deleted, a one-off
// row on the new date): the member feed keeps both, the series with its
// deleted dates for the EXDATEs, the one-off as its own event.
const [EV_SKIP, EV_MOVED] = [101, 102].map(id);
await check('#297 B4: the member feed gives the series its skip_dates and the moved date as its own event', async () => {
  const r = await one(`SELECT (current_date + 7)::text AS a, (current_date + 14)::text AS b, (current_date + 15)::text AS c`);
  await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, venue_name, is_recurring, recurrence_rule, created_by, fee) VALUES
    ($1, $3, 'Thursday rehearsal', 'rehearsal', 'confirmed', current_date, '19:00', 'Studio E', true,
     jsonb_build_object('frequency', 'weekly', 'interval', 1, 'skip_dates', jsonb_build_array($4::text, $5::text)), $7, 0),
    ($2, $3, 'Thursday rehearsal', 'rehearsal', 'confirmed', $6::date, '19:00', 'Studio E', false, NULL, $7, 0)`,
    [EV_SKIP, EV_MOVED, BAND, r.a, r.b, r.c, ADMIN]);
  await q(`INSERT INTO event_members (event_id, user_id, role, status) VALUES ($1, $3, NULL, 'confirmed'), ($2, $3, NULL, 'confirmed')`, [EV_SKIP, EV_MOVED, MEM]);
  const feedTok = (await one(`SELECT token FROM calendar_feeds WHERE user_id = $1`, [MEM])).token;
  const evs = (await one(`SELECT public.bw_member_calendar_feed($1) AS f`, [feedTok])).f.events;
  const series = evs.find((e) => e.id === EV_SKIP);
  const moved = evs.find((e) => e.id === EV_MOVED);
  return JSON.stringify(series?.recurrence?.skip_dates) === JSON.stringify([r.a, r.b])
    && moved?.event_date === r.c && moved.recurrence === null;
});
await check('#297 B4: a deleted date gets no one-event link; its neighbours do', async () => {
  const r = await one(`SELECT (current_date + 7)::text AS a, (current_date + 21)::text AS n, (current_date)::text AS p`);
  return (await evTok(MEM, EV_SKIP, r.a)) === null
    && /^[0-9a-f]{64}$/.test((await evTok(MEM, EV_SKIP, r.n)) ?? '') && /^[0-9a-f]{64}$/.test((await evTok(MEM, EV_SKIP, r.p)) ?? '');
});

// The deputy calendars carry one date per request (no RRULE, so no EXDATE):
// a request on a series' first date, deleted since, is shown cancelled,
// without the address.
await check('#297 B4: deputy calendars show a deleted date as cancelled, without the address', async () => {
  const [EV_DS, RDS] = [103, 104].map(id);
  await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, venue_name, venue_address, is_recurring, recurrence_rule, created_by, fee)
    VALUES ($1, $2, 'Deputy rehearsal', 'rehearsal', 'confirmed', current_date + 4, '19:00', 'Studio F', '4 Quiet Ln', true,
            jsonb_build_object('frequency', 'weekly', 'interval', 1, 'skip_dates', jsonb_build_array(to_char(current_date + 4, 'YYYY-MM-DD'))), $3, 0)`, [EV_DS, BAND, ADMIN]);
  await q(`INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, role, status, answer_snapshot)
    VALUES ($1, $2, $3, $4, 'Leo', 'Bass', 'available', '{}')`, [RDS, BAND, EV_DS, DEPUTY]);
  const cal = await col(RDS, 'calendar_token');
  const gig = await col(RDS, 'gig_calendar_token');
  const f = (await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [cal])).f.gigs.find((g) => g.id === RDS);
  const g = (await one(`SELECT public.bw_deputy_gig_calendar($1) AS f`, [gig])).f.gigs[0];
  const old = (await one(`SELECT public.bw_deputy_feed($1) AS f`, [cal])).f.gigs.find((x) => x.id === RDS);
  const live = (await one(`SELECT public.bw_deputy_calendar_feed($1) AS f`, [cal])).f.gigs.find((x) => x.id === RA);
  return f?.cancelled === true && f.venue_address == null && g?.cancelled === true && g.venue_address == null
    && old?.cancelled === true && old.venue_address == null && live?.cancelled === false && live.venue_address === '12 Water St';
});

// ------------------------------------------- round 9 (Codex @ 6ab65eb9) --
console.log('-- round 9');
// B2: a deputy request is on the series row, so its date is the series'
// first date. Deleted on its own (skip_dates), the reply page still gave
// the street address and stayed open; the calendars already showed it
// cancelled. The page treats it as a cancelled gig too: closed, no address,
// no address in "changes" or "before".
const [EV_R9, R9, EV_R9B, R9B] = [105, 106, 107, 108].map(id);
await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, venue_name, venue_address, is_recurring, recurrence_rule, created_by, fee) VALUES
  ($1, $3, 'First date gone', 'rehearsal', 'confirmed', current_date + 4, '19:00', 'Studio G', '9 Hidden Rd', true,
   jsonb_build_object('frequency', 'weekly', 'interval', 1, 'skip_dates', jsonb_build_array(to_char(current_date + 4, 'YYYY-MM-DD'))), $4, 0),
  ($2, $3, 'Later date gone', 'rehearsal', 'confirmed', current_date + 4, '19:00', 'Studio H', '3 Open Rd', true,
   jsonb_build_object('frequency', 'weekly', 'interval', 1, 'skip_dates', jsonb_build_array(to_char(current_date + 11, 'YYYY-MM-DD'))), $4, 0)`,
  [EV_R9, EV_R9B, BAND, ADMIN]);
await q(`INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, role, status, answer_snapshot) VALUES
  ($1, $3, $4, $5, 'Leo', 'Bass', 'available', jsonb_build_object('address', '1 Former Rd', 'venue', 'Studio G')),
  ($2, $3, $6, $5, 'Leo', 'Bass', 'available', jsonb_build_object('address', '3 Open Rd', 'venue', 'Studio H'))`,
  [R9, R9B, BAND, EV_R9, DEPUTY, EV_R9B]);
await check('Codex r9 B2: first date deleted: the reply page is closed, shows it cancelled, no street address (old or new)', async () => {
  const v = await view(R9);
  const s = JSON.stringify(v);
  return v?.closed === true && v.event_cancelled === true && v.venue_address == null
    && !(v.changes ?? []).includes('address') && !('address' in (v.before ?? {})) && !/Hidden Rd|Former Rd/.test(s);
});
await check('Codex r9 B2: a later date deleted leaves the request open, with its address', async () => {
  const v = await view(R9B);
  return v?.closed === false && v.event_cancelled === false && v.venue_address === '3 Open Rd';
});
await check('Codex r9 B2: and the deputy in-app list (bw_my_deputy_gigs) shows that page: closed, no address', async () => {
  const [DEP9, U9] = [109, 110].map(id);
  await q(`INSERT INTO auth.users VALUES ($1)`, [U9]);
  await q(`INSERT INTO profiles (id, preferred_language) VALUES ($1, 'en')`, [U9]);
  await q(`INSERT INTO band_deputies (id, band_id, name, user_id) VALUES ($1, $2, 'Ines', $3)`, [DEP9, BAND, U9]);
  await q(`UPDATE deputy_requests SET deputy_id = $2 WHERE id = $1`, [R9, DEP9]);
  await as(U9);
  const mine = (await one(`SELECT public.bw_my_deputy_gigs() AS g`)).g;
  await db.exec('RESET ROLE');
  const g = mine.gigs.find((x) => x.id === R9);
  return g?.closed === true && g.venue_address == null && !/Hidden Rd|Former Rd/.test(JSON.stringify(mine));
});

// Function rule (main, #294 @ 979641c3): 178 redefines the reply page and
// the 084 feed, and 182 redefines them after it, so 182 starts from 178's
// body: every key 178's version returns, 182's returns too (old builds and
// the live deputy-calendar function read them), and 178's hidden check
// stays (the #294 checks above). 178's bodies run here under another name.
if (m178) {
  for (const name of ['bw_deputy_request_view', 'bw_deputy_feed']) {
    if (!m178.includes(`CREATE OR REPLACE FUNCTION public.${name}(`)) continue;
    await db.exec(fn(m178, name).replace(`FUNCTION public.${name}(`, `FUNCTION public.bw178_${name.slice(3)}(`));
  }
}
const has178 = async (name) => !!(await one(`SELECT to_regprocedure($1) AS p`, [`public.bw178_${name.slice(3)}(text)`])).p;
await check('function rule: the reply page keeps every key of 178\'s body (top level)', async () => {
  if (!(await has178('bw_deputy_request_view'))) return true; // 178 without its own body: 084's keys, checked above
  const t = await tok(R9B);
  const a = (await one(`SELECT public.bw178_deputy_request_view($1) AS v`, [t])).v;
  const b = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [t])).v;
  return !!a && !!b && Object.keys(a).every((k) => k in b) && a.event_type === b.event_type;
});
await check('function rule: the 084 feed keeps every key of 178\'s body (deputy_name too), per gig as well', async () => {
  if (!(await has178('bw_deputy_feed'))) return true;
  const t = await tok(R9B);
  const a = (await one(`SELECT public.bw178_deputy_feed($1) AS v`, [t])).v;
  const b = (await one(`SELECT public.bw_deputy_feed($1) AS v`, [t])).v;
  const ga = a?.gigs?.find((g) => g.id === R9B);
  const gb = b?.gigs?.find((g) => g.id === R9B);
  return !!a && !!b && Object.keys(a).every((k) => k in b) && b.deputy_name === 'Leo'
    && !!ga && !!gb && Object.keys(ga).every((k) => k in gb);
});

// ------------------------------------------- round 12 (Claude r9) --
console.log('-- round 12');
// MINOR: a gig back to a private quote sent fee and both keys null, the
// shape the page read as "removed" ("{band} took you off this gig"). Only
// the orphan branch says removed, explicitly; the hidden one is a closed
// request ('status' 'cancelled', as #294's 178), so old builds (383f15b)
// show "This request is closed" / "Request withdrawn" too.
await check('Claude r9: a gig back to a quote: closed request, no "removed" key, status cancelled', async () => {
  const [EV_H, DEPH, RH] = [111, 112, 113].map(id);
  await q(`INSERT INTO events (id, band_id, title, event_type, status, event_date, start_time, venue_name, venue_address, is_recurring, created_by, fee)
    VALUES ($1, $2, 'Gala at the Club', 'gig', 'confirmed', current_date + 20, '19:00', 'Club Room', '5 Club St', false, $3, 2000)`, [EV_H, BAND, ADMIN]);
  await q(`INSERT INTO band_deputies (id, band_id, name, user_id) VALUES ($1, $2, 'Nora', NULL)`, [DEPH, BAND]);
  await q(`INSERT INTO deputy_requests (id, band_id, event_id, deputy_id, deputy_name, role, fee_offered, currency, status, answer_snapshot)
    VALUES ($1, $2, $3, $4, 'Nora', 'Keys', 300, 'USD', 'available', '{}')`, [RH, BAND, EV_H, DEPH]);
  await q(`UPDATE events SET status = 'tentative' WHERE id = $1`, [EV_H]); // back to a quote
  const v = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [await tok(RH)])).v;
  return !!v && v.closed === true && !('removed' in v) && v.status === 'cancelled' && v.event_title === null;
});
await check('Claude r9: a deputy deleted from the band: removed: true (and only then)', async () => {
  const now = (await one(`SELECT token FROM deputy_requests WHERE id = $1`, [RORPH])).token;
  const o = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [now])).v;
  const on = (await one(`SELECT public.bw_deputy_request_view($1) AS v`, [await tok(RA)])).v;
  return o?.removed === true && o.closed === true && !!on && !('removed' in on);
});

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
