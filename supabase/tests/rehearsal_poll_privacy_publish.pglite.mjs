// Local check of migration 195 (rehearsal polls: invite-only reads, one-step
// publish of a proposal, the deadline the database enforces; audit 05 #1 #3
// #8 #11; Codex #297: one-step skip of a rehearsal date, the single-poll
// deadline no longer callable) without Docker: PGlite with the poll tables as 038 + 058 + 097 +
// 098 + 102 left them, the live read policies (073 / 102 / 118) and the
// real 114 and 117 migrations loaded from the repo.
// Failing first: with /dev/null as the migration every new check FAILs.
//
//   mkdir -p /tmp/pg195 && cd /tmp/pg195 && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/rehearsal_poll_privacy_publish.pglite.mjs . && node rehearsal_poll_privacy_publish.pglite.mjs <repo>
//   node rehearsal_poll_privacy_publish.pglite.mjs <repo> /dev/null    # before: FAILs expected
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO = process.argv[2];
const MIG = process.argv[3] ?? `${REPO}/supabase/migrations/195_rehearsal_poll_privacy_publish.sql`;
const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND_A, BAND_B, ADMIN, ADMIN2, INVITED, OUTSIDER, B_ONLY, PROPOSER] = [1, 2, 3, 4, 5, 6, 7, 8].map(id);
const [POLL_PRIV, POLL_OPEN, PROPOSAL_B] = [11, 12, 13].map(id);
const [OPT_PRIV, OPT_OPEN] = [21, 22].map(id);
const [SERIES, ONCE] = [31, 32].map(id);

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, timezone text);
CREATE TABLE public.band_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, user_id uuid, role text, is_active boolean DEFAULT true);
CREATE TABLE public.rehearsal_polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid NOT NULL, created_by uuid NOT NULL,
  creator_role text NOT NULL DEFAULT 'member', title text NOT NULL, notes text,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','polling','confirmed','cancelled','expired')),
  confirmed_event_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  vote_by date, location text, room_cost numeric(10,2), focus_song_ids uuid[] NOT NULL DEFAULT '{}',
  invited_user_ids uuid[] NOT NULL DEFAULT '{}', vote_by_time time);
CREATE TABLE public.rehearsal_poll_options (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.rehearsal_polls(id) ON DELETE CASCADE,
  proposed_date date NOT NULL, start_time time NOT NULL, end_time time, created_at timestamptz DEFAULT now());
CREATE TABLE public.rehearsal_poll_votes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES public.rehearsal_polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES public.rehearsal_poll_options(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, created_at timestamptz DEFAULT now(), UNIQUE (option_id, user_id));
CREATE TABLE public.rehearsal_poll_unavailable (poll_id uuid NOT NULL REFERENCES public.rehearsal_polls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL, created_at timestamptz DEFAULT now(), PRIMARY KEY (poll_id, user_id));

CREATE FUNCTION public.bw_is_band_admin(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND role = 'admin' AND COALESCE(is_active, true)); $f$;
CREATE FUNCTION public.bw_is_band_member(p_band_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band_id AND user_id = p_user_id AND COALESCE(is_active, true)); $f$;

CREATE TABLE public.events (id uuid PRIMARY KEY, band_id uuid, title text, event_date date, is_recurring boolean DEFAULT false,
  recurrence_rule jsonb, updated_at timestamptz DEFAULT now(),
  status text, start_time time, "time" time, end_time time, duration_hours numeric, created_by uuid);
ALTER TABLE public.band_members ADD COLUMN left_at timestamptz;
CREATE TABLE public.event_members (event_id uuid, user_id uuid, status text);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events_select" ON public.events FOR SELECT TO authenticated USING (bw_is_band_member(band_id));
CREATE POLICY "events_update" ON public.events FOR UPDATE TO authenticated USING (bw_is_band_admin(band_id)) WITH CHECK (bw_is_band_admin(band_id));
GRANT SELECT, UPDATE ON public.events TO authenticated;

ALTER TABLE public.rehearsal_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rehearsal_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rehearsal_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rehearsal_poll_unavailable ENABLE ROW LEVEL SECURITY;

-- Live read / write policies before 195 (073, 102, 118).
CREATE POLICY "rehearsal_polls_select" ON public.rehearsal_polls FOR SELECT TO authenticated USING (bw_is_band_member(band_id));
CREATE POLICY "rehearsal_polls_update" ON public.rehearsal_polls FOR UPDATE TO authenticated
  USING ((bw_is_band_admin(band_id) OR ((created_by = auth.uid()) AND (status = 'proposed'::text) AND bw_is_band_member(band_id))))
  WITH CHECK ((bw_is_band_admin(band_id) OR ((created_by = auth.uid()) AND (status = 'proposed'::text))));
CREATE POLICY "rehearsal_poll_options_select" ON public.rehearsal_poll_options FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM rehearsal_polls rp WHERE rp.id = rehearsal_poll_options.poll_id AND bw_is_band_member(rp.band_id)));
CREATE POLICY "rehearsal_poll_options_write" ON public.rehearsal_poll_options FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM rehearsal_polls rp WHERE rp.id = rehearsal_poll_options.poll_id AND (bw_is_band_admin(rp.band_id) OR (rp.created_by = auth.uid() AND rp.status = 'proposed' AND bw_is_band_member(rp.band_id)))))
  WITH CHECK (EXISTS (SELECT 1 FROM rehearsal_polls rp WHERE rp.id = rehearsal_poll_options.poll_id AND (bw_is_band_admin(rp.band_id) OR (rp.created_by = auth.uid() AND rp.status = 'proposed' AND bw_is_band_member(rp.band_id)))));
CREATE POLICY "band_members_can_select_votes" ON public.rehearsal_poll_votes FOR SELECT TO public
  USING (EXISTS (SELECT 1 FROM public.rehearsal_polls rp WHERE rp.id = rehearsal_poll_votes.poll_id AND public.bw_is_band_member(rp.band_id)));
CREATE POLICY "band_members_can_select_unavailable" ON public.rehearsal_poll_unavailable FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rehearsal_polls rp JOIN public.band_members bm ON bm.band_id = rp.band_id
    WHERE rp.id = rehearsal_poll_unavailable.poll_id AND bm.user_id = auth.uid() AND COALESCE(bm.is_active, true)));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rehearsal_polls, public.rehearsal_poll_options, public.rehearsal_poll_votes, public.rehearsal_poll_unavailable TO authenticated;
GRANT SELECT ON public.band_members, public.profiles TO authenticated;
`);
// 114 (room cost RPC) and 117 (vote deadline + vote policies), as they are live.
await db.exec(readFileSync(`${REPO}/supabase/migrations/114_poll_room_cost_rpc.sql`, 'utf8'));
await db.exec(readFileSync(`${REPO}/supabase/migrations/117_poll_vote_deadline.sql`, 'utf8'));
// 095 (free-slot heatmap), as it is live.
await db.exec(readFileSync(`${REPO}/supabase/migrations/095_band_free_slots.sql`, 'utf8'));

await db.exec(`
INSERT INTO profiles VALUES ('${ADMIN}','America/New_York'), ('${INVITED}','Europe/London'), ('${OUTSIDER}','America/New_York');
-- ADMIN and ADMIN2 run both bands; B_ONLY is a member of band B only.
INSERT INTO band_members (band_id, user_id, role) VALUES
  ('${BAND_A}','${ADMIN}','admin'), ('${BAND_A}','${ADMIN2}','admin'), ('${BAND_A}','${INVITED}','member'), ('${BAND_A}','${OUTSIDER}','member'),
  ('${BAND_B}','${ADMIN}','admin'), ('${BAND_B}','${ADMIN2}','admin'), ('${BAND_B}','${B_ONLY}','member'), ('${BAND_B}','${PROPOSER}','member');
-- An invite-only poll (INVITED + ADMIN) with place, notes and a room cost, and an open poll.
INSERT INTO rehearsal_polls (id, band_id, created_by, creator_role, title, notes, status, location, room_cost, invited_user_ids, vote_by, vote_by_time) VALUES
  ('${POLL_PRIV}','${BAND_A}','${ADMIN}','admin','Duo prep','private scheduling notes','polling','Studio 4, Brooklyn', 80, ARRAY['${INVITED}','${ADMIN}']::uuid[], '2099-12-11', '18:00'),
  ('${POLL_OPEN}','${BAND_A}','${ADMIN}','admin','Full band','','polling', NULL, NULL, '{}', NULL, NULL),
  ('${PROPOSAL_B}','${BAND_B}','${PROPOSER}','member','Band B proposal','[Preferred Days: Mon]','proposed', NULL, NULL, '{}', NULL, NULL);
INSERT INTO rehearsal_poll_options (id, poll_id, proposed_date, start_time) VALUES
  ('${OPT_PRIV}','${POLL_PRIV}','2099-12-14','20:00'), ('${OPT_OPEN}','${POLL_OPEN}','2099-12-15','20:00');
INSERT INTO rehearsal_poll_options (poll_id, proposed_date, start_time) VALUES ('${PROPOSAL_B}','2099-12-07','19:00');
INSERT INTO rehearsal_poll_votes (poll_id, option_id, user_id) VALUES ('${POLL_PRIV}','${OPT_PRIV}','${INVITED}'), ('${POLL_OPEN}','${OPT_OPEN}','${OUTSIDER}');
INSERT INTO rehearsal_poll_unavailable (poll_id, user_id) VALUES ('${POLL_PRIV}','${ADMIN}');
-- A weekly rehearsal: another admin has just taken out Dec 1; 'custom' is a key this build does not know.
INSERT INTO events (id, band_id, title, event_date, is_recurring, recurrence_rule) VALUES
  ('${SERIES}','${BAND_A}','Weekly rehearsal','2099-11-24', true, '{"frequency":"weekly","interval":1,"custom":"keep me","skip_dates":["2099-12-01"]}'),
  ('${ONCE}','${BAND_A}','One-off','2099-11-25', false, NULL);
-- INVITED plays both.
INSERT INTO event_members (event_id, user_id, status) VALUES ('${SERIES}','${INVITED}','confirmed'), ('${ONCE}','${INVITED}','confirmed');
`);

async function as(user, fn) {
  await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true); SET LOCAL ROLE authenticated;`);
  try { return await fn(); } finally { await db.exec('ROLLBACK'); }
}
async function asCommit(user, fn) {
  await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true); SET LOCAL ROLE authenticated;`);
  try { const r = await fn(); await db.exec('COMMIT'); return r; } catch (e) { await db.exec('ROLLBACK'); throw e; }
}
const tryRows = async (user, sql, params) => {
  try { return await as(user, async () => (await db.query(sql, params)).rows); } catch (e) { return { error: e.message }; }
};

// ---- the problem before 195
const before = await tryRows(OUTSIDER, `SELECT title, notes, location, invited_user_ids FROM rehearsal_polls WHERE id = $1`, [POLL_PRIV]);
console.log(`info: before the migration an uninvited member reads ${Array.isArray(before) ? before.length : 0} row(s) of the invite-only poll`);

// ---- the migration
await db.exec(readFileSync(MIG, 'utf8'));
await db.exec(readFileSync(MIG, 'utf8')); // idempotent
ok(true, 'migration runs twice');

// ---- #3 reads
const seen = async (user) => ({
  polls: await tryRows(user, `SELECT id FROM rehearsal_polls WHERE id = $1`, [POLL_PRIV]),
  options: await tryRows(user, `SELECT id FROM rehearsal_poll_options WHERE poll_id = $1`, [POLL_PRIV]),
  votes: await tryRows(user, `SELECT id FROM rehearsal_poll_votes WHERE poll_id = $1`, [POLL_PRIV]),
  none: await tryRows(user, `SELECT user_id FROM rehearsal_poll_unavailable WHERE poll_id = $1`, [POLL_PRIV]),
  cost: await tryRows(user, `SELECT poll_id FROM bw_rehearsal_poll_costs($1::uuid[])`, [[POLL_PRIV]]),
});
const n = (r) => (Array.isArray(r) ? r.length : -1);
const out = await seen(OUTSIDER);
ok(n(out.polls) === 0, `#3 uninvited member: no invite-only poll row (got ${JSON.stringify(out.polls)})`);
ok(n(out.options) === 0 && n(out.votes) === 0 && n(out.none) === 0, '#3 uninvited member: no options, votes or "none work" answers');
ok(n(out.cost) === 0, '#3 uninvited member: no room cost share');
const inv = await seen(INVITED);
ok(n(inv.polls) === 1 && n(inv.options) === 1 && n(inv.votes) === 1 && n(inv.none) === 1 && n(inv.cost) === 1, '#3 invited member reads the poll and its rows');
const adm = await seen(ADMIN2);
ok(n(adm.polls) === 1 && n(adm.options) === 1 && n(adm.votes) === 1, '#3 another admin of the band reads it');
const open = await tryRows(OUTSIDER, `SELECT id FROM rehearsal_poll_options WHERE poll_id = $1 UNION ALL SELECT id FROM rehearsal_polls WHERE id = $1`, [POLL_OPEN]);
ok(n(open) === 2, '#3 a poll without a list stays readable by every member');
const prop = await tryRows(PROPOSER, `SELECT id FROM rehearsal_polls WHERE id = $1`, [PROPOSAL_B]);
ok(n(prop) === 1, '#3 the proposer still reads their own proposal');
const vote = await (async () => {
  try {
    await asCommit(INVITED, () => db.query(`INSERT INTO rehearsal_poll_votes (poll_id, option_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [POLL_PRIV, OPT_PRIV, INVITED]));
    return true;
  } catch (e) { return e.message; }
})();
ok(vote === true, `#3 the invited member can still vote (${vote})`);

// ---- #1 #8 publish
const fields = { title: 'Band B rehearsal', notes: 'Bring the new charts', vote_by: '2099-12-05', vote_by_time: '18:00', location: 'Rehearsal Room 2, Queens', room_cost: 60, focus_song_ids: [], invited_user_ids: [] };
const slots = [{ proposed_date: '2099-12-07', start_time: '20:00', end_time: '22:00' }, { proposed_date: '2099-12-08', start_time: '20:00' }];
const publish = (user, f = fields, o = slots) =>
  asCommit(user, () => db.query(`SELECT public.bw_publish_rehearsal_proposal($1, $2::jsonb, $3::jsonb) AS r`, [PROPOSAL_B, JSON.stringify(f), JSON.stringify(o)]))
    .then((r) => r.rows[0].r, (e) => ({ error: e.message }));

const r1 = await publish(ADMIN);
ok(r1?.published === true, `#8 first admin publishes the proposal (${JSON.stringify(r1)})`);
ok(r1?.band_id === BAND_B, '#1 the result names the proposal\'s own band (B), whatever band the app has selected');
const pollRow = (await db.query(`SELECT status, title, location, room_cost, vote_by::text, vote_by_time::text FROM rehearsal_polls WHERE id = $1`, [PROPOSAL_B])).rows[0];
ok(pollRow?.status === 'polling' && pollRow.title === 'Band B rehearsal' && pollRow.location === 'Rehearsal Room 2, Queens' && Number(pollRow.room_cost) === 60
  && pollRow.vote_by === '2099-12-05' && pollRow.vote_by_time === '18:00:00', '#8 fields saved with the status');
const opts = (await db.query(`SELECT id, proposed_date::text AS d, start_time::text AS s, end_time::text AS e FROM rehearsal_poll_options WHERE poll_id = $1 ORDER BY proposed_date`, [PROPOSAL_B])).rows;
ok(opts.length === 2 && opts[0].d === '2099-12-07' && opts[0].e === '22:00:00' && opts[1].e === null, '#8 the proposal\'s suggestions replaced by the poll\'s options');

// Members vote, then a second admin publishes the form they left open.
if (opts[0]) {
  await asCommit(B_ONLY, () => db.query(`INSERT INTO rehearsal_poll_votes (poll_id, option_id, user_id) VALUES ($1,$2,$3)`, [PROPOSAL_B, opts[0].id, B_ONLY])).catch((e) => console.log('info: vote', e.message));
}
const votesBefore = (await db.query(`SELECT count(*)::int AS n FROM rehearsal_poll_votes WHERE poll_id = $1`, [PROPOSAL_B])).rows[0].n;
const r2 = await publish(ADMIN2, { ...fields, title: 'Stale form' }, [{ proposed_date: '2099-12-20', start_time: '19:00' }]);
const votesAfter = (await db.query(`SELECT count(*)::int AS n FROM rehearsal_poll_votes WHERE poll_id = $1`, [PROPOSAL_B])).rows[0].n;
const titleAfter = (await db.query(`SELECT title FROM rehearsal_polls WHERE id = $1`, [PROPOSAL_B])).rows[0].title;
ok(votesBefore === 1, `members voted on the published poll (${votesBefore})`);
ok(r2?.published === false && r2?.status === 'polling', `#8 stale second publish changes nothing (${JSON.stringify(r2)})`);
ok(votesAfter === 1 && titleAfter === 'Band B rehearsal', '#8 votes and the first admin\'s poll kept');

// Not an admin of the proposal's band.
await db.exec(`UPDATE rehearsal_polls SET status = 'proposed' WHERE id = '${PROPOSAL_B}'`);
const r3 = await publish(B_ONLY);
ok(!!r3?.error && /admin/i.test(r3.error), `#1 a member of band B cannot publish (${JSON.stringify(r3)})`);
const r4 = await publish(OUTSIDER);
ok(!!r4?.error, '#1 a member of another band cannot publish it');
const r5 = await publish(ADMIN, fields, []);
ok(!!r5?.error && /option/i.test(r5.error), '#8 no options: refused');
const r6 = await publish(ADMIN, { ...fields, invited_user_ids: [B_ONLY] });
const invitedNow = (await db.query(`SELECT invited_user_ids::text[] AS i FROM rehearsal_polls WHERE id = $1`, [PROPOSAL_B])).rows[0].i;
ok(r6?.published === true && invitedNow.includes(B_ONLY) && invitedNow.includes(ADMIN), '#8 an invite list always has the publishing admin');

// ---- #11 deadline
const dl = await tryRows(INVITED, `SELECT poll_id, vote_deadline FROM bw_poll_vote_deadlines($1::uuid[])`, [[POLL_PRIV, POLL_OPEN]]);
const priv = Array.isArray(dl) ? dl.find((r) => r.poll_id === POLL_PRIV) : null;
ok(!!priv && new Date(priv.vote_deadline).toISOString() === '2099-12-11T23:00:00.000Z',
  `#11 deadline is 18:00 in the creator's zone (New York), as an absolute time (${JSON.stringify(dl)})`);
ok(Array.isArray(dl) && dl.find((r) => r.poll_id === POLL_OPEN)?.vote_deadline === null, '#11 no vote-by date: no deadline');
const dlOut = await tryRows(OUTSIDER, `SELECT poll_id FROM bw_poll_vote_deadlines($1::uuid[])`, [[POLL_PRIV]]);
ok(n(dlOut) === 0, '#11 nothing about polls the caller cannot read');

// ---- Codex #297 MINOR: the single-poll deadline is not callable by clients
const directDl = await tryRows(OUTSIDER, `SELECT public.bw_poll_vote_deadline($1) AS d`, [POLL_PRIV]);
ok(!!directDl?.error, `uninvited member cannot read a poll's deadline directly (${JSON.stringify(directDl)})`);
const authDl = (await db.query(`SELECT has_function_privilege('authenticated', 'public.bw_poll_vote_deadline(uuid)', 'EXECUTE') AS a`)).rows[0].a;
ok(authDl === false, 'bw_poll_vote_deadline is not granted to authenticated');
await db.exec(`UPDATE rehearsal_polls SET vote_by = '2000-01-01' WHERE id = '${POLL_OPEN}'`);
const late = await (async () => {
  try { await asCommit(ADMIN2, () => db.query(`INSERT INTO rehearsal_poll_votes (poll_id, option_id, user_id) VALUES ($1,$2,$3)`, [POLL_OPEN, OPT_OPEN, ADMIN2])); return 'saved'; }
  catch (e) { return e.message; }
})();
ok(late !== 'saved', `the vote policies still close voting after the deadline (${late})`);
await db.exec(`UPDATE rehearsal_polls SET vote_by = NULL WHERE id = '${POLL_OPEN}'`);
const onTime = await (async () => {
  try { await asCommit(ADMIN2, () => db.query(`INSERT INTO rehearsal_poll_votes (poll_id, option_id, user_id) VALUES ($1,$2,$3)`, [POLL_OPEN, OPT_OPEN, ADMIN2])); return 'saved'; }
  catch (e) { return e.message; }
})();
ok(onTime === 'saved', `and voting with no deadline still works (${onTime})`);

// ---- Codex #297 B3: skip one date in one server step
const skip = (user, ev, day) =>
  asCommit(user, () => db.query(`SELECT public.bw_skip_rehearsal_date($1, $2::date) AS r`, [ev, day]))
    .then((r) => r.rows[0].r, (e) => ({ error: e.message, code: e.code }));
const rule = async () => (await db.query(`SELECT recurrence_rule AS r FROM events WHERE id = $1`, [SERIES])).rows[0].r;
const s1 = await skip(ADMIN, SERIES, '2099-12-08');
const afterS1 = await rule();
ok(JSON.stringify(afterS1?.skip_dates) === '["2099-12-01","2099-12-08"]', `B3 the date is appended to the stored list, the other admin's date kept (${JSON.stringify(afterS1)} / ${JSON.stringify(s1)})`);
ok(afterS1?.custom === 'keep me' && afterS1?.frequency === 'weekly', 'B3 the rest of the rule is kept');
ok(Array.isArray(s1?.skip_dates) && s1.skip_dates.length === 2, 'B3 the answer lists the skipped dates');
await skip(ADMIN2, SERIES, '2099-12-08');
await skip(ADMIN2, SERIES, '2099-11-24');
ok(JSON.stringify((await rule())?.skip_dates) === '["2099-11-24","2099-12-01","2099-12-08"]', 'B3 sorted, no duplicates, the first date too');
const s2 = await skip(OUTSIDER, SERIES, '2099-12-15');
ok(!!s2?.error && s2.code === '42501', `B3 a member cannot skip a date (${JSON.stringify(s2)})`);
const s3 = await skip(B_ONLY, SERIES, '2099-12-15');
ok(!!s3?.error && s3.code === '42501', 'B3 someone outside the band cannot either');
const s4 = await skip(ADMIN, ONCE, '2099-11-25');
ok(!!s4?.error && s4.code === '22023', `B3 an event that does not repeat is refused (${JSON.stringify(s4)})`);
const def = (await db.query(`SELECT pg_get_functiondef('public.bw_skip_rehearsal_date(uuid, date)'::regprocedure) AS d`).catch(() => ({ rows: [{ d: '' }] }))).rows[0].d;
ok(/FOR UPDATE/i.test(def), 'B3 the row is locked while the date is added');
const anonSkip = (await db.query(`SELECT has_function_privilege('anon', 'public.bw_skip_rehearsal_date(uuid, date)', 'EXECUTE') AS a`).catch(() => ({ rows: [{ a: null }] }))).rows[0].a;
ok(anonSkip === false, 'anon cannot call the skip function');

const anonCan = (await db.query(`SELECT has_function_privilege('anon', 'public.bw_publish_rehearsal_proposal(uuid, jsonb, jsonb)', 'EXECUTE') AS a`).catch(() => ({ rows: [{ a: null }] }))).rows[0].a;
ok(anonCan === false, 'anon cannot call the publish function');

// Codex #297 round 3: free-slot counts and a deleted date. The skip_dates
// line lands in 178 (#294, feat/date-on-hold), not in 195. This check loads
// bw_band_free_slots as 178 defines it, from origin/feat/date-on-hold, and
// SKIPs with a warning while that branch, or that line, is not there yet.
const free = async (day) => (await as(ADMIN, () => db.query(`SELECT free_count, total_count FROM public.bw_band_free_slots($1, $2::date, $2::date)`, [BAND_A, day]))).rows[0];
let fn178 = null;
try {
  const src = execFileSync('git', ['-C', REPO, 'show', 'origin/feat/date-on-hold:supabase/migrations/178_date_on_hold.sql'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  fn178 = src.match(/CREATE OR REPLACE FUNCTION public\.bw_band_free_slots\([\s\S]*?\n\$\$;/)?.[0] ?? null;
} catch { fn178 = null; }
if (!fn178) {
  console.log('SKIP availability: origin/feat/date-on-hold (178) not found; fetch it to run this check');
} else if (!/skip_dates/.test(fn178)) {
  console.log('SKIP availability: 178 on origin/feat/date-on-hold has no skip_dates line yet (#294)');
} else {
  // What 178's body needs beyond this file's tables: quote helpers (111, 178) as stubs.
  await db.exec(`
    ALTER TABLE public.events ADD COLUMN IF NOT EXISTS date date, ADD COLUMN IF NOT EXISTS event_type text, ADD COLUMN IF NOT EXISTS quote_id uuid;
    CREATE OR REPLACE FUNCTION public.bw_event_is_quote(p_status text, p_event_type text, p_quote_id uuid) RETURNS boolean
      LANGUAGE sql IMMUTABLE AS $f$ SELECT lower(coalesce(p_status, '')) IN ('quote', 'quoted') $f$;
    CREATE OR REPLACE FUNCTION public.bw_date_hold_live(p_event_id uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $f$ SELECT false $f$;
  `);
  await db.exec(fn178);
  const fSkipped = await free('2099-11-24');
  const fOnce = await free('2099-11-25');
  ok(fSkipped?.total_count === 4 && fSkipped?.free_count === 4, `availability (178): a deleted first date is not busy (${JSON.stringify(fSkipped)})`);
  ok(fOnce?.free_count === 3, `availability (178): a real event still counts (${JSON.stringify(fOnce)})`);
}

// Claude #297 round 3: the votes policy is for signed-in users, as in 118.
const voteRoles = (await db.query(`SELECT roles::text AS r FROM pg_policies WHERE tablename = 'rehearsal_poll_votes' AND policyname = 'band_members_can_select_votes'`)).rows[0]?.r;
ok(voteRoles === '{authenticated}', `the votes policy is TO authenticated (${voteRoles})`);

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
