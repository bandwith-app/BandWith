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
const [SERIES, ONCE, PAID, SETLIST] = [31, 32, 33, 34].map(id);
const [REQ_A, REQ_B, REQ_C, MOVE_1, MOVE_2] = [41, 42, 43, 44, 45].map(id);

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
  status text, start_time time, "time" time, end_time time, duration_hours numeric, created_by uuid,
  event_type text, fee numeric(10,2), setlist_id uuid, venue_name text, notes text, parent_event_id uuid,
  created_at timestamptz DEFAULT now(), "date" date, currency text DEFAULT 'USD');
ALTER TABLE public.band_members ADD COLUMN left_at timestamptz;
CREATE TABLE public.event_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid, status text, fee numeric(10,2) DEFAULT 0, role text, notes text, paid_at timestamptz, UNIQUE (event_id, user_id));
CREATE TABLE public.event_stage (event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE, band_id uuid NOT NULL,
  plots jsonb NOT NULL DEFAULT '[]', inputs jsonb NOT NULL DEFAULT '[]', mixer text, band_brings jsonb NOT NULL DEFAULT '[]',
  venue_provides jsonb NOT NULL DEFAULT '[]', venue_agreed boolean NOT NULL DEFAULT false, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
-- 002's updated_at trigger, the other BEFORE UPDATE trigger on events.
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN NEW.updated_at := now(); RETURN NEW; END $f$;
CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
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
-- 119 (live): members read rehearsal_polls only through this column list.
REVOKE SELECT ON public.rehearsal_polls FROM anon, authenticated;
GRANT SELECT (id, band_id, created_by, creator_role, title, notes, status, confirmed_event_id, created_at, updated_at, vote_by, location, focus_song_ids, invited_user_ids, vote_by_time)
  ON public.rehearsal_polls TO authenticated;
`);
// 114 (room cost RPC) and 117 (vote deadline + vote policies), as they are live.
await db.exec(readFileSync(`${REPO}/supabase/migrations/114_poll_room_cost_rpc.sql`, 'utf8'));
await db.exec(readFileSync(`${REPO}/supabase/migrations/117_poll_vote_deadline.sql`, 'utf8'));
// Server notices as live: notifications, bw_notify + recipients (046, 111),
// the translators (088, 089, 090).
const fnFrom = (file, name) => {
  const src = readFileSync(`${REPO}/supabase/migrations/${file}`, 'utf8');
  const m = src.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`));
  if (!m) throw new Error(`${name} not found in ${file}`);
  return m[0];
};
await db.exec(`
  ALTER TABLE public.profiles ADD COLUMN preferred_language text;
  CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, band_id uuid, type text NOT NULL,
    title varchar(255) NOT NULL, body text, data jsonb DEFAULT '{}', read boolean DEFAULT false, reference_id uuid, reference_type text,
    created_at timestamptz DEFAULT now());
`);
for (const [file, name] of [['046_server_notifications_and_push.sql', 'bw_notify'], ['046_server_notifications_and_push.sql', 'bw_active_band_member_ids']]) await db.exec(fnFrom(file, name));
await db.exec(fnFrom('111_quote_events_private.sql', 'bw_event_recipient_ids').split('\n-- The 2-argument form')[0]);
for (const f of ['088_deputy_push_i18n.sql', '089_server_notifications_i18n.sql', '090_app_notifications_i18n.sql']) await db.exec(readFileSync(`${REPO}/supabase/migrations/${f}`, 'utf8'));
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
-- A paid weekly rehearsal (studio cost 120) with a setlist, a lineup with fees and a stage plot.
INSERT INTO events (id, band_id, title, event_date, "date", is_recurring, recurrence_rule, status, event_type, start_time, end_time, fee, setlist_id, venue_name, notes, created_by) VALUES
  ('${PAID}','${BAND_A}','Studio night','2099-11-26','2099-11-26', true, '{"frequency":"weekly","interval":1}', 'confirmed', 'rehearsal', '19:00', '22:00', 120, '${SETLIST}', 'Studio 4, Brooklyn', 'Bring in-ears', '${ADMIN}');
INSERT INTO event_members (event_id, user_id, status, fee, role, paid_at) VALUES
  ('${PAID}','${INVITED}','confirmed', 15, 'Bass', now()), ('${PAID}','${OUTSIDER}','invited', 0, 'Keys', NULL);
INSERT INTO event_stage (event_id, band_id, plots, mixer) VALUES ('${PAID}','${BAND_A}','[{"id":"p1","name":"Full band"}]','X32');
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
const publish = (user, f = fields, o = slots, client = null) =>
  asCommit(user, () => client
    ? db.query(`SELECT public.bw_publish_rehearsal_proposal($1, $2::jsonb, $3::jsonb, $4::uuid) AS r`, [PROPOSAL_B, JSON.stringify(f), JSON.stringify(o), client])
    : db.query(`SELECT public.bw_publish_rehearsal_proposal($1, $2::jsonb, $3::jsonb) AS r`, [PROPOSAL_B, JSON.stringify(f), JSON.stringify(o)]))
    .then((r) => r.rows[0].r, (e) => ({ error: e.message }));

const r1 = await publish(ADMIN, fields, slots, REQ_A);
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

// Codex #297 round 3 B1: the same slots from another request, with other invitees.
const r2b = await publish(ADMIN2, { ...fields, invited_user_ids: [B_ONLY] }, slots, REQ_B);
const invAfterB = (await db.query(`SELECT invited_user_ids::text[] AS i FROM rehearsal_polls WHERE id = $1`, [PROPOSAL_B])).rows[0].i;
ok(r2b?.published === false && !r2b?.replayed && invAfterB.length === 0, `B1 another request with the same slots is "already published", invitees untouched (${JSON.stringify(r2b)})`);
// The first request again, its answer lost: recognised, nothing changed.
const r1b = await publish(ADMIN, fields, slots, REQ_A);
const votesReplay = (await db.query(`SELECT count(*)::int AS n FROM rehearsal_poll_votes WHERE poll_id = $1`, [PROPOSAL_B])).rows[0].n;
ok(r1b?.published === true && r1b?.replayed === true && r1b?.band_id === BAND_B && votesReplay === 1, `B1 the same request replays as published, votes kept (${JSON.stringify(r1b)})`);
const r1c = await publish(ADMIN, fields, slots, REQ_C);
ok(r1c?.published === false, 'B1 the same admin from a new request: already published');
const reqCol = (await db.query(`SELECT has_column_privilege('authenticated', 'public.rehearsal_polls', 'publish_request_id', 'SELECT') AS a`).catch(() => ({ rows: [{ a: null }] }))).rows[0].a;
ok(reqCol === false, 'B1 members cannot read publish_request_id');

// ---- Claude #297 round 3: an older build's stale publish (update, delete, insert)
// on PROPOSAL_B, now a poll with a vote.
const oldBuild = await (async () => {
  const out = {};
  try { await asCommit(ADMIN2, () => db.query(`DELETE FROM rehearsal_poll_options WHERE poll_id = $1`, [PROPOSAL_B])); out.del = 'deleted'; } catch (e) { out.del = e.message; }
  try { await asCommit(ADMIN2, () => db.query(`INSERT INTO rehearsal_poll_options (poll_id, proposed_date, start_time) VALUES ($1, '2099-12-20', '19:00')`, [PROPOSAL_B])); out.ins = 'inserted'; } catch (e) { out.ins = e.message; }
  return out;
})();
const optsLeft = (await db.query(`SELECT count(*)::int AS n FROM rehearsal_poll_options WHERE poll_id = $1`, [PROPOSAL_B])).rows[0].n;
const votesLeft = (await db.query(`SELECT count(*)::int AS n FROM rehearsal_poll_votes WHERE poll_id = $1`, [PROPOSAL_B])).rows[0].n;
ok(/already has votes/.test(oldBuild.del) && /already has votes/.test(oldBuild.ins) && votesLeft === 1 && optsLeft === 2,
  `an old build cannot remove or add options of a poll with votes; it shows the message (${JSON.stringify(oldBuild)}, ${optsLeft} options, ${votesLeft} vote)`);
// A poll with no votes yet, and deleting a whole poll, still work.
await db.exec(`INSERT INTO rehearsal_polls (id, band_id, created_by, creator_role, title, status) VALUES ('${id(51)}','${BAND_A}','${ADMIN}','admin','Empty','polling');
  INSERT INTO rehearsal_poll_options (poll_id, proposed_date, start_time) VALUES ('${id(51)}','2099-12-21','19:00');`);
const noVotes = await asCommit(ADMIN, () => db.query(`DELETE FROM rehearsal_poll_options WHERE poll_id = $1`, [id(51)])).then(() => 'deleted', (e) => e.message);
ok(noVotes === 'deleted', `options of a poll with no votes can still change (${noVotes})`);
await db.exec(`INSERT INTO rehearsal_polls (id, band_id, created_by, creator_role, title, status) VALUES ('${id(52)}','${BAND_A}','${ADMIN}','admin','Voted','polling');
  INSERT INTO rehearsal_poll_options (id, poll_id, proposed_date, start_time) VALUES ('${id(53)}','${id(52)}','2099-12-22','19:00');
  INSERT INTO rehearsal_poll_votes (poll_id, option_id, user_id) VALUES ('${id(52)}','${id(53)}','${INVITED}');`);
const wholePoll = await db.query(`DELETE FROM rehearsal_polls WHERE id = $1`, [id(52)]).then(() => 'deleted', (e) => e.message);
ok(wholePoll === 'deleted' && (await db.query(`SELECT count(*)::int AS n FROM rehearsal_poll_options WHERE poll_id = $1`, [id(52)])).rows[0].n === 0, `deleting a voted poll still removes its options (${wholePoll})`);


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

const anonCan = (await db.query(`SELECT has_function_privilege('anon', 'public.bw_publish_rehearsal_proposal(uuid, jsonb, jsonb, uuid)', 'EXECUTE') AS a`).catch(() => ({ rows: [{ a: null }] }))).rows[0].a;
ok(anonCan === false, 'anon cannot call the publish function');

// ---- Codex #297 round 3 B2 B3: "Only this date" in one transaction
const move = (user, ev, from, to, f, client) =>
  asCommit(user, () => db.query(`SELECT public.bw_move_rehearsal_date($1, $2::date, $3::date, $4::jsonb, $5::uuid) AS r`, [ev, from, to, JSON.stringify(f), client]))
    .then((r) => r.rows[0].r, (e) => ({ error: e.message, code: e.code }));
const m1 = await move(ADMIN, PAID, '2099-12-03', '2099-12-04', { title: 'Studio night (Thu)', start_time: '20:00', end_time: '23:00' }, MOVE_1);
const copy = (await db.query(`SELECT * FROM events WHERE id = $1`, [MOVE_1])).rows[0];
ok(m1?.event_id === MOVE_1 && !!copy, `B2 the one-off is created under the request's id (${JSON.stringify(m1)})`);
ok(copy?.event_date?.toISOString?.().slice(0, 10) === '2099-12-04' || String(copy?.event_date).includes('2099-12-04') || copy?.event_date === '2099-12-04', `B2 on the new date (${copy?.event_date})`);
ok(copy?.is_recurring === false && copy?.recurrence_rule === null && copy?.parent_event_id === PAID, 'B2 a one-off, linked to its series');
ok(Number(copy?.fee) === 120 && copy?.setlist_id === SETLIST && copy?.venue_name === 'Studio 4, Brooklyn' && copy?.notes === 'Bring in-ears' && copy?.event_type === 'rehearsal' && copy?.status === 'confirmed',
  `B3 studio cost, setlist, place, notes, type and status copied (${JSON.stringify({ fee: copy?.fee, setlist: copy?.setlist_id, venue: copy?.venue_name })})`);
ok(copy?.title === 'Studio night (Thu)' && String(copy?.start_time).startsWith('20:00') && String(copy?.end_time).startsWith('23:00'), 'B2 title and times from the form');
const lineup = (await db.query(`SELECT user_id, status, fee::numeric AS fee, role, paid_at FROM event_members WHERE event_id = $1 ORDER BY role`, [MOVE_1])).rows;
ok(lineup.length === 2 && Number(lineup[0].fee) === 15 && lineup[0].role === 'Bass' && lineup[0].paid_at === null && lineup[1].status === 'invited',
  `B3 the lineup copied, each member's own fee, nobody marked paid (${JSON.stringify(lineup)})`);
const stageCopy = (await db.query(`SELECT mixer, plots FROM event_stage WHERE event_id = $1`, [MOVE_1])).rows[0];
ok(stageCopy?.mixer === 'X32' && stageCopy?.plots?.[0]?.name === 'Full band', 'B3 rider & stage copied');
const paidRule = async () => (await db.query(`SELECT recurrence_rule AS r FROM events WHERE id = $1`, [PAID])).rows[0].r;
ok(JSON.stringify((await paidRule())?.skip_dates) === '["2099-12-03"]', 'B2 the old date is skipped in the same transaction');
const m1again = await move(ADMIN, PAID, '2099-12-03', '2099-12-04', { title: 'Studio night (Thu)' }, MOVE_1);
const copies = (await db.query(`SELECT count(*)::int AS n FROM events WHERE parent_event_id = $1`, [PAID])).rows[0].n;
const lineupN = (await db.query(`SELECT count(*)::int AS n FROM event_members WHERE event_id = $1`, [MOVE_1])).rows[0].n;
ok(m1again?.replayed === true && copies === 1 && lineupN === 2, `B2 a retry with the same id creates nothing more (${JSON.stringify(m1again)}, ${copies} copy)`);
const mMember = await move(INVITED, PAID, '2099-12-10', '2099-12-11', {}, MOVE_2);
ok(mMember?.code === '42501' && (await db.query(`SELECT count(*)::int AS n FROM events WHERE id = $1`, [MOVE_2])).rows[0].n === 0, 'B2 a member cannot move a date');
const mOnce = await move(ADMIN, ONCE, '2099-11-25', '2099-11-26', {}, MOVE_2);
ok(mOnce?.code === '22023', 'B2 a rehearsal that does not repeat is refused');
const moveDef = (await db.query(`SELECT pg_get_functiondef('public.bw_move_rehearsal_date(uuid, date, date, jsonb, uuid)'::regprocedure) AS d`).catch(() => ({ rows: [{ d: '' }] }))).rows[0].d;
ok(/FOR UPDATE/i.test(moveDef) && moveDef.indexOf('FOR UPDATE') < moveDef.indexOf('INSERT INTO public.events'), 'B2 the series row is locked first');
const anonMove = (await db.query(`SELECT has_function_privilege('anon', 'public.bw_move_rehearsal_date(uuid, date, date, jsonb, uuid)', 'EXECUTE') AS a`).catch(() => ({ rows: [{ a: null }] }))).rows[0].a;
ok(anonMove === false, 'B2 anon cannot call it');

// ---- Codex #297 round 3 B4: deleted dates survive every write
// A cadence edit read before the delete, saved after it (the rule it read had none).
await asCommit(ADMIN, () => db.query(`UPDATE events SET recurrence_rule = '{"frequency":"weekly","interval":2}'::jsonb WHERE id = $1`, [PAID]));
const afterCadence = await paidRule();
ok(afterCadence?.interval === 2 && JSON.stringify(afterCadence?.skip_dates) === '["2099-12-03"]', `B4 a cadence edit keeps the deleted date (${JSON.stringify(afterCadence)})`);
// An older build (383f15b) writes the whole rule {frequency, interval} on a rename, with an older list.
await asCommit(ADMIN2, () => db.query(`UPDATE events SET recurrence_rule = '{"frequency":"weekly","interval":2,"skip_dates":["2099-12-17"]}'::jsonb, title = 'Studio night' WHERE id = $1`, [PAID]));
ok(JSON.stringify((await paidRule())?.skip_dates) === '["2099-12-03","2099-12-17"]', 'B4 an old build writing the whole rule keeps both (union)');
// The whole series moves two days later (an old build sends only the date, or
// a new build sends the date and the rule it read): deleted dates move too.
await asCommit(ADMIN, () => db.query(`UPDATE events SET event_date = '2099-11-28' WHERE id = $1`, [PAID]));
ok(JSON.stringify((await paidRule())?.skip_dates) === '["2099-12-05","2099-12-19"]', `B4 a series moved by 2 days moves its deleted dates (${JSON.stringify((await paidRule())?.skip_dates)})`);
await asCommit(ADMIN, () => db.query(`UPDATE events SET event_date = '2099-11-26', recurrence_rule = '{"frequency":"weekly","interval":2,"skip_dates":["2099-12-05","2099-12-19","2099-12-31"]}'::jsonb WHERE id = $1`, [PAID]));
ok(JSON.stringify((await paidRule())?.skip_dates) === '["2099-12-03","2099-12-17","2099-12-31"]', `B4 moved back with the rule it read: stored dates shift back, a new one is kept (${JSON.stringify((await paidRule())?.skip_dates)})`);
await asCommit(ADMIN, () => db.query(`SELECT public.bw_restore_rehearsal_date($1, '2099-12-31'::date)`, [PAID])).catch(() => null);
// Turning the repeat off still clears the rule.
await db.exec(`UPDATE events SET recurrence_rule = '{"frequency":"weekly","skip_dates":["2099-12-01"]}' WHERE id = '${ONCE}'`);
await asCommit(ADMIN, () => db.query(`UPDATE events SET is_recurring = false, recurrence_rule = NULL WHERE id = $1`, [ONCE]));
ok((await db.query(`SELECT recurrence_rule AS r FROM events WHERE id = $1`, [ONCE])).rows[0].r === null, 'B4 turning the repeat off clears the rule');
// Only the restore RPC takes a date out.
const restore = (user, ev, day) =>
  asCommit(user, () => db.query(`SELECT public.bw_restore_rehearsal_date($1, $2::date) AS r`, [ev, day]))
    .then((r) => r.rows[0].r, (e) => ({ error: e.message, code: e.code }));
const rs = await restore(ADMIN, PAID, '2099-12-17');
ok(JSON.stringify((await paidRule())?.skip_dates) === '["2099-12-03"]' && Array.isArray(rs?.skip_dates), `B4 the restore RPC puts a date back (${JSON.stringify(rs)})`);
const rsMember = await restore(INVITED, PAID, '2099-12-03');
ok(rsMember?.code === '42501' && JSON.stringify((await paidRule())?.skip_dates) === '["2099-12-03"]', 'B4 a member cannot restore a date');
await asCommit(ADMIN, () => db.query(`UPDATE events SET recurrence_rule = recurrence_rule - 'skip_dates' WHERE id = $1`, [PAID]));
ok(JSON.stringify((await paidRule())?.skip_dates) === '["2099-12-03"]', 'B4 removing skip_dates with a plain update does nothing');
const flagAfter = await as(ADMIN, async () => {
  await db.query(`SELECT public.bw_restore_rehearsal_date($1, '2099-12-24'::date)`, [PAID]);
  return (await db.query(`SELECT coalesce(current_setting('bw.restore_skip', true), '') AS f`)).rows[0].f;
}).catch((e) => `error: ${e.message}`);
ok(flagAfter === '', `B4 the restore flag is off again after the RPC (${JSON.stringify(flagAfter)})`);
const trg = (await db.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.events'::regclass AND NOT tgisinternal ORDER BY tgname`)).rows.map((r) => r.tgname);
ok(trg[0] === 'bw_events_00_keep_skip_dates', `B4 the keep trigger fires first by name (${trg.join(', ')})`);

// ---- Claude #297 round 3 #3: a deleted date is announced, in each member's language
await db.exec(`UPDATE profiles SET preferred_language = 'it' WHERE id = '${INVITED}'; DELETE FROM notifications;`);
const notes = async () => (await db.query(`SELECT user_id, type, title, body, data FROM notifications ORDER BY user_id`)).rows;
const addSkip = (day) => asCommit(ADMIN, () => db.query(
  `UPDATE events SET recurrence_rule = recurrence_rule || jsonb_build_object('skip_dates', coalesce(recurrence_rule -> 'skip_dates', '[]'::jsonb) || to_jsonb($2::text)) WHERE id = $1`, [PAID, day]));
await addSkip('2099-12-10');
const n1 = await notes();
const itWhen = (await db.query(`SELECT public.bw_i18n_short_date('2099-12-10'::date, 'it') AS w`)).rows[0].w;
const enWhen = (await db.query(`SELECT to_char('2099-12-10'::date, 'Dy DD Mon') AS w`)).rows[0].w;
const nIt = n1.find((n) => n.user_id === INVITED);
const nEn = n1.find((n) => n.user_id === OUTSIDER);
ok(nIt?.type === 'event_cancelled' && nIt?.title === 'Prova annullata' && nIt?.body?.includes(itWhen), `#3 the Italian member reads "Prova annullata" with the deleted date (${JSON.stringify(nIt && { t: nIt.title, b: nIt.body })})`);
ok(nEn?.type === 'event_cancelled' && nEn?.title === 'Rehearsal cancelled' && nEn?.body?.includes(enWhen) && nEn?.data?.occurrence_date === '2099-12-10', `#3 the English member reads "Rehearsal cancelled" with the deleted date (${JSON.stringify(nEn && { t: nEn.title, b: nEn.body })})`);
ok(n1.length === 2 && !n1.some((n) => n.user_id === ADMIN || n.user_id === B_ONLY || n.user_id === PROPOSER), `#3 only the series' lineup hears it: not the admin who did it, nobody from another band (${n1.map((n) => n.user_id.slice(-2)).join(',')})`);
await db.exec(`DELETE FROM notifications;`);
await addSkip('2020-01-02');
ok((await notes()).length === 0, '#3 a past date taken out is not announced');
await asCommit(ADMIN2, () => db.query(`UPDATE events SET title = 'Studio night' WHERE id = $1`, [PAID]));
ok((await notes()).length === 0, '#3 a write that adds no date announces nothing');
const MOVE_3 = id(46);
await move(ADMIN, PAID, '2099-12-24', '2099-12-26', { title: 'Studio night', start_time: '19:00', end_time: '22:00' }, MOVE_3);
const n2 = await notes();
const mIt = n2.find((n) => n.user_id === INVITED);
ok(n2.length > 0 && n2.every((n) => n.type === 'event_update' && n.data?.event_id === MOVE_3 && n.data?.moved_from === '2099-12-24') && mIt?.title === 'Prova aggiornata',
  `#3 "Only this date" is announced as a change of the new date, not a cancellation (${JSON.stringify(n2.map((n) => [n.type, n.title]))})`);

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
