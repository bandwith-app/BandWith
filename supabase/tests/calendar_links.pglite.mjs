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
await db.exec(`GRANT EXECUTE ON FUNCTION public.bw_deputy_claim(text) TO authenticated;`);
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
const tok = async (r) => (await one(`SELECT token FROM deputy_requests WHERE id = $1`, [r])).token;
const [TA, TB, TC] = [await tok(RA), await tok(RB), await tok(RC)];

const mig = readFileSync(MIG, 'utf8');

// 178 (#294) comes first, hard (Codex review #285 round 5): 182 stops when
// its bw_event_deputy_hidden is missing. 178's helpers come from #294's
// branch head, or the repo once merged.
let m178 = null;
try {
  m178 = execSync('git show origin/feat/date-on-hold:supabase/migrations/178_date_on_hold.sql', { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
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
  for (const name of ['bw_event_quote_private', 'bw_event_deputy_hidden']) await db.exec(fn(m178, name));
}

// Two runs: the migration is safe to run more than once.
await db.exec(mig);
await db.exec(mig);
ok(true, 'migration runs twice');

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
  const first = (await one(`SELECT (current_date - 70)::text AS d`)).d;
  const t2 = await evTok(MEM, EV_R4OLD, first);
  const l1 = t1 && (await one(`SELECT public.bw_member_event_calendar($1) AS l`, [t1])).l;
  const l2 = t2 && (await one(`SELECT public.bw_member_event_calendar($1) AS l`, [t2])).l;
  const today = (await one(`SELECT current_date::text AS d`)).d;
  const next = l1?.event?.event_date;
  return /^[0-9a-f]{64}$/.test(t1 ?? '') && next >= today && next < (await one(`SELECT (current_date + 7)::text AS d`)).d
    && l2?.event?.event_date === next;
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

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
