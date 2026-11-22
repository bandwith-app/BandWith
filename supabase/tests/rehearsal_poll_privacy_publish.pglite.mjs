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
//   BW_AFTER_178=<178 file> node rehearsal_poll_privacy_publish.pglite.mjs <repo>
//     # 195 on top of 178's triggers on events and notifications (#294)
//   BW_FAKE_NOW=2026-11-23T00:00:00Z node rehearsal_poll_privacy_publish.pglite.mjs <repo>
//     # 19:00 in New York: the r8 checks run with the real pair (Rome profile, NY device)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// BW_FAKE_NOW=<ISO time>: the clock PGlite reads (now()), e.g. 2026-11-23T00:00:00Z
// = 19:00 in New York, already the 23rd in Rome (the r8 case itself).
if (process.env.BW_FAKE_NOW) {
  const off = Date.parse(process.env.BW_FAKE_NOW) - Date.now();
  const realNow = Date.now.bind(Date);
  Date.now = () => realNow() + off;
}
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

-- 004's default: every profile in prod holds Europe/Rome (the app never wrote it).
CREATE TABLE public.profiles (id uuid PRIMARY KEY, timezone text DEFAULT 'Europe/Rome');
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
  event_type text, fee numeric(10,2), setlist_id uuid, venue_name text, venue_address text, venue_city text, notes text, parent_event_id uuid,
  created_at timestamptz DEFAULT now(), "date" date, currency text DEFAULT 'USD', quote_id uuid);
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
-- As on prod: authenticated has table-level SELECT on rehearsal_polls (119's
-- column list does not cover it), so a new column there would be readable.
-- Setlists (002) for the copy "Only this date" makes.
CREATE TABLE public.setlists (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid NOT NULL, name varchar(255) NOT NULL,
  description text, is_template boolean DEFAULT false, total_duration_seconds integer, song_count integer DEFAULT 0,
  created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.setlist_songs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), setlist_id uuid NOT NULL REFERENCES public.setlists(id) ON DELETE CASCADE,
  song_id uuid NOT NULL, position integer NOT NULL, set_number integer DEFAULT 1, notes text, created_at timestamptz DEFAULT now(),
  UNIQUE (setlist_id, position));
`);
// 114 (room cost RPC) and 117 (vote deadline + vote policies), as they are live.
await db.exec(readFileSync(`${REPO}/supabase/migrations/114_poll_room_cost_rpc.sql`, 'utf8'));
await db.exec(readFileSync(`${REPO}/supabase/migrations/117_poll_vote_deadline.sql`, 'utf8'));
// 095 (the free-slot heatmap), as it is live (Codex #297 M1).
await db.exec(readFileSync(`${REPO}/supabase/migrations/095_band_free_slots.sql`, 'utf8'));
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
// 111's quote rule, as it is live (the skip / move refuse quotes, Codex #297 r7 B1).
await db.exec(fnFrom('111_quote_events_private.sql', 'bw_event_is_quote'));
for (const f of ['088_deputy_push_i18n.sql', '089_server_notifications_i18n.sql', '090_app_notifications_i18n.sql']) await db.exec(readFileSync(`${REPO}/supabase/migrations/${f}`, 'utf8'));
// 095 (free-slot heatmap), as it is live.
await db.exec(readFileSync(`${REPO}/supabase/migrations/095_band_free_slots.sql`, 'utf8'));

await db.exec(`
-- ADMIN's zone as the app's sign-in sync writes it; id(96) keeps the column
-- default, as every prod profile did before it.
INSERT INTO profiles VALUES ('${ADMIN}','America/New_York'), ('${INVITED}','Europe/London'), ('${OUTSIDER}','America/New_York');
INSERT INTO profiles (id) VALUES ('${id(96)}');
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
INSERT INTO setlists (id, band_id, name, song_count) VALUES ('${SETLIST}','${BAND_A}','Studio night set', 2);
INSERT INTO setlist_songs (setlist_id, song_id, position) VALUES ('${SETLIST}', gen_random_uuid(), 1), ('${SETLIST}', gen_random_uuid(), 2);
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

// ---- 178 first (#294), when asked: its AFTER INSERT trigger on events and
// its BEFORE INSERT guard on notifications, as 178 defines them, so the move
// and the notices of 195 run through them.
if (process.env.BW_AFTER_178) {
  const src178 = readFileSync(process.env.BW_AFTER_178, 'utf8');
  const fn178 = (name) => {
    const m = src178.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`));
    if (!m) throw new Error(`${name} not in 178`);
    return m[0];
  };
  await db.exec(`
    ALTER TABLE public.events ADD COLUMN IF NOT EXISTS quote_id uuid;
    CREATE TABLE IF NOT EXISTS public.event_date_holds (event_id uuid, release_reason text, confirmed_once_at timestamptz);
    CREATE TABLE IF NOT EXISTS public.quotes (id uuid PRIMARY KEY, band_id uuid, status text, converted_to_event_id uuid);
    CREATE TABLE IF NOT EXISTS public.deputy_requests (id uuid PRIMARY KEY, event_id uuid);
    CREATE TABLE IF NOT EXISTS public.chats (id uuid PRIMARY KEY, event_id uuid, type text);
    CREATE OR REPLACE FUNCTION public.bw_date_hold_sync(p_event_id uuid, p_changed boolean DEFAULT false) RETURNS void
      LANGUAGE sql AS $f$ SELECT $f$;
  `);
  await db.exec(fnFrom('111_quote_events_private.sql', 'bw_event_is_quote'));
  for (const name of ['bw_event_quote_private', 'bw_event_quote_hidden', 'bw_setlist_quote_hidden', 'bw_notification_event_id', 'bw_event_deputy_hidden',
    'bw_notification_setlist_id', 'bw_setlist_notice_hidden', 'bw_trg_notification_quote_guard', 'bw_trg_date_hold_event_insert']) {
    await db.exec(fn178(name));
  }
  await db.exec(`
    CREATE TRIGGER bw_date_hold_event_insert AFTER INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION public.bw_trg_date_hold_event_insert();
    CREATE TRIGGER bw_notifications_00_quote_guard BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.bw_trg_notification_quote_guard();
  `);
  // 178's bw_band_free_slots (it reads skip_dates already): 195 leaves it.
  await db.exec(`CREATE OR REPLACE FUNCTION public.bw_date_hold_live(p_event_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;`);
  await db.exec(fn178('bw_band_free_slots'));
  console.log('info: 178 triggers and free slots loaded first');
}

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
// Claude #297 round 5: the request id is in a side table nobody can read
// (authenticated reads rehearsal_polls table-wide on prod).
const reqTable = (await db.query(`SELECT has_table_privilege('authenticated', 'public.rehearsal_poll_publish_requests', 'SELECT') AS a`).catch(() => ({ rows: [{ a: null }] }))).rows[0].a;
const reqColumn = (await db.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'rehearsal_polls' AND column_name = 'publish_request_id'`)).rows[0].n;
const reqRead = await tryRows(B_ONLY, `SELECT * FROM public.rehearsal_poll_publish_requests`);
ok(reqTable === false && reqColumn === 0 && !!reqRead?.error, `B1 nobody can read the publish request id (table ${reqTable}, column ${reqColumn}, read ${JSON.stringify(reqRead)})`);
ok(Array.isArray(r1b?.invited_user_ids) && r1b.invited_user_ids.length === 0, `round 5: a replay returns the stored invite list (${JSON.stringify(r1b?.invited_user_ids)})`);

// ---- Claude #297 round 3: an older build's stale publish (update, delete, insert)
// on PROPOSAL_B, now a poll with a vote.
const oldBuild = await (async () => {
  const out = {};
  try { await asCommit(ADMIN2, () => db.query(`DELETE FROM rehearsal_poll_options WHERE poll_id = $1`, [PROPOSAL_B])); out.del = 'deleted'; } catch (e) { out.del = e.message; }
  try { await asCommit(ADMIN2, () => db.query(`INSERT INTO rehearsal_poll_options (poll_id, proposed_date, start_time) VALUES ($1, '2099-12-20', '19:00')`, [PROPOSAL_B])); out.ins = 'inserted'; } catch (e) { out.ins = e.message; }
  return out;
})();
// Its update of the poll itself (title, who is invited, vote-by) keeps what
// people voted on; closing the poll still works (Claude #297 round 5).
const before5 = (await db.query(`SELECT title, invited_user_ids::text[] AS i, vote_by::text AS v, vote_by_time::text AS t FROM rehearsal_polls WHERE id = $1`, [PROPOSAL_B])).rows[0];
await asCommit(ADMIN2, () => db.query(`UPDATE rehearsal_polls SET title = 'Stale form', invited_user_ids = ARRAY['${ADMIN2}']::uuid[], vote_by = '2099-12-30', vote_by_time = '09:00', notes = 'old build notes', status = 'polling' WHERE id = $1`, [PROPOSAL_B])).catch((e) => console.log('info: stale update', e.message));
const after5 = (await db.query(`SELECT title, invited_user_ids::text[] AS i, vote_by::text AS v, vote_by_time::text AS t FROM rehearsal_polls WHERE id = $1`, [PROPOSAL_B])).rows[0];
ok(JSON.stringify(after5) === JSON.stringify(before5), `round 5: an old build's stale update keeps the title, invitees and vote-by of a voted poll (${JSON.stringify(after5)})`);
await db.exec(`INSERT INTO rehearsal_polls (id, band_id, created_by, creator_role, title, status) VALUES ('${id(54)}','${BAND_A}','${ADMIN}','admin','Not voted yet','polling')`);
await asCommit(ADMIN, () => db.query(`UPDATE rehearsal_polls SET title = 'Renamed' WHERE id = $1`, [id(54)]));
ok((await db.query(`SELECT title FROM rehearsal_polls WHERE id = $1`, [id(54)])).rows[0].title === 'Renamed', 'round 5: a poll with no votes can still be renamed');
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
// Test set-up on a voted poll: as the publish RPC would (bw.poll_publish).
await db.exec(`BEGIN; SELECT set_config('bw.poll_publish', 'on', true); UPDATE rehearsal_polls SET vote_by = '2000-01-01' WHERE id = '${POLL_OPEN}'; COMMIT;`);
const late = await (async () => {
  try { await asCommit(ADMIN2, () => db.query(`INSERT INTO rehearsal_poll_votes (poll_id, option_id, user_id) VALUES ($1,$2,$3)`, [POLL_OPEN, OPT_OPEN, ADMIN2])); return 'saved'; }
  catch (e) { return e.message; }
})();
ok(late !== 'saved', `the vote policies still close voting after the deadline (${late})`);
await db.exec(`BEGIN; SELECT set_config('bw.poll_publish', 'on', true); UPDATE rehearsal_polls SET vote_by = NULL WHERE id = '${POLL_OPEN}'; COMMIT;`);
const onTime = await (async () => {
  try { await asCommit(ADMIN2, () => db.query(`INSERT INTO rehearsal_poll_votes (poll_id, option_id, user_id) VALUES ($1,$2,$3)`, [POLL_OPEN, OPT_OPEN, ADMIN2])); return 'saved'; }
  catch (e) { return e.message; }
})();
ok(onTime === 'saved', `and voting with no deadline still works (${onTime})`);

// ---- Codex #297 B3: skip one date in one server step
const skip = (user, ev, day) =>
  asCommit(user, () => db.query(`SELECT public.bw_skip_rehearsal_date($1, $2::date) AS r`, [ev, day]))
    .then((r) => r.rows[0].r, (e) => ({ error: e.message, code: e.code, hint: e.hint }));
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
const def = (await db.query(`SELECT pg_get_functiondef('public.bw_skip_rehearsal_date(uuid, date, text)'::regprocedure) AS d`).catch(() => ({ rows: [{ d: '' }] }))).rows[0].d;
ok(/FOR UPDATE/i.test(def), 'B3 the row is locked while the date is added');
const anonSkip = (await db.query(`SELECT has_function_privilege('anon', 'public.bw_skip_rehearsal_date(uuid, date, text)', 'EXECUTE') AS a`).catch(() => ({ rows: [{ a: null }] }))).rows[0].a;
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
ok(Number(copy?.fee) === 120 && !!copy?.setlist_id && copy?.venue_name === 'Studio 4, Brooklyn' && copy?.notes === 'Bring in-ears' && copy?.event_type === 'rehearsal' && copy?.status === 'confirmed',
  `B3 studio cost, setlist, place, notes, type and status copied (${JSON.stringify({ fee: copy?.fee, setlist: copy?.setlist_id, venue: copy?.venue_name })})`);
// Claude #297 round 5 #1: the one-off has its own copy of the setlist.
const slCopy = copy?.setlist_id ? (await db.query(`SELECT name, (SELECT count(*)::int FROM setlist_songs WHERE setlist_id = s.id) AS n FROM setlists s WHERE id = $1`, [copy.setlist_id])).rows[0] : null;
ok(!!copy?.setlist_id && copy.setlist_id !== SETLIST && slCopy?.name === 'Studio night set' && slCopy?.n === 2,
  `round 5: the one-off gets a copy of the series' setlist with its songs (${JSON.stringify({ id: copy?.setlist_id, ...slCopy })})`);
ok((await db.query(`SELECT setlist_id FROM events WHERE id = $1`, [PAID])).rows[0].setlist_id === SETLIST, 'round 5: the series keeps its own setlist');
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
// Claude #297 round 5 #4: only a date of the series, still on, to a day not past.
const hintOf = async (from, to) => {
  try { await asCommit(ADMIN, () => db.query(`SELECT public.bw_move_rehearsal_date($1, $2::date, $3::date, '{}'::jsonb, $4::uuid)`, [PAID, from, to, MOVE_2])); return 'moved'; }
  catch (e) { return `${e.code}/${e.hint}`; }
};
ok(await hintOf('2099-12-05', '2099-12-06') === '22023/bw:not_a_date', 'round 5: a day that is not one of the series\' dates is refused (bw:not_a_date)');
ok(await hintOf('2099-11-19', '2099-12-06') === '22023/bw:not_a_date', 'round 5: a day before the series starts is refused');
ok(await hintOf('2099-12-03', '2099-12-06') === '22023/bw:date_deleted', 'round 5: a date already deleted (or moved) is refused (bw:date_deleted)');
ok(await hintOf('2099-12-10', '2020-01-01') === '22023/bw:date_past', 'round 5: a new date in the past is refused (bw:date_past)');
ok((await db.query(`SELECT count(*)::int AS n FROM events WHERE id = $1`, [MOVE_2])).rows[0].n === 0, 'round 5: nothing was created by the refused moves');
const moveDef = (await db.query(`SELECT pg_get_functiondef('public.bw_move_rehearsal_date(uuid, date, date, jsonb, uuid, text)'::regprocedure) AS d`).catch(() => ({ rows: [{ d: '' }] }))).rows[0].d;
ok(/FOR UPDATE/i.test(moveDef) && moveDef.indexOf('FOR UPDATE') < moveDef.indexOf('INSERT INTO public.events'), 'B2 the series row is locked first');
const anonMove = (await db.query(`SELECT has_function_privilege('anon', 'public.bw_move_rehearsal_date(uuid, date, date, jsonb, uuid, text)', 'EXECUTE') AS a`).catch(() => ({ rows: [{ a: null }] }))).rows[0].a;
ok(anonMove === false, 'B2 anon cannot call it');

// ---- Codex #297 round 3 B4: deleted dates survive every write
// A cadence edit read before the delete, saved after it (the rule it read had none).
await asCommit(ADMIN, () => db.query(`UPDATE events SET recurrence_rule = '{"frequency":"weekly","interval":2}'::jsonb WHERE id = $1`, [PAID]));
const afterCadence = await paidRule();
ok(afterCadence?.interval === 2 && JSON.stringify(afterCadence?.skip_dates) === '["2099-12-03"]', `B4 a cadence edit keeps the deleted date (${JSON.stringify(afterCadence)})`);
// An older build (383f15b) writes the whole rule {frequency, interval} on a rename, with an older list.
await asCommit(ADMIN2, () => db.query(`UPDATE events SET recurrence_rule = '{"frequency":"weekly","interval":2,"skip_dates":["2099-12-17"]}'::jsonb, title = 'Studio night' WHERE id = $1`, [PAID]));
ok(JSON.stringify((await paidRule())?.skip_dates) === '["2099-12-03"]', `Codex M3: a plain write keeps the stored dates and adds none of its own list (${JSON.stringify((await paidRule())?.skip_dates)})`);
// The date used by the next checks, deleted the only way a date is added now
// (a date of the series: every 2 weeks from Nov 26 since the cadence edit).
await asCommit(ADMIN, () => db.query(`SELECT public.bw_skip_rehearsal_date($1, '2099-12-24'::date)`, [PAID])).catch(() => null);
// The whole series moves two days later (an old build sends only the date, or
// a new build sends the date and the rule it read): deleted dates move too.
await asCommit(ADMIN, () => db.query(`UPDATE events SET event_date = '2099-11-28' WHERE id = $1`, [PAID]));
ok(JSON.stringify((await paidRule())?.skip_dates) === '["2099-12-05","2099-12-26"]', `B4 a series moved by 2 days moves its deleted dates (${JSON.stringify((await paidRule())?.skip_dates)})`);
await asCommit(ADMIN, () => db.query(`UPDATE events SET event_date = '2099-11-26', recurrence_rule = '{"frequency":"weekly","interval":2,"skip_dates":["2099-12-05","2099-12-26","2099-12-31"]}'::jsonb WHERE id = $1`, [PAID]));
ok(JSON.stringify((await paidRule())?.skip_dates) === '["2099-12-03","2099-12-24"]', `B4 moved back with the rule it read: stored dates shift back; a date only in its list is not added (Codex M3) (${JSON.stringify((await paidRule())?.skip_dates)})`);
await asCommit(ADMIN, () => db.query(`SELECT public.bw_restore_rehearsal_date($1, '2099-12-31'::date)`, [PAID])).catch(() => null);
// ---- Claude #297 round 5 BLOCKER: a start moved along its own cadence moves no
// deleted date. The live 383f15b overview card saves every field: renaming
// the Nov 16 date of a weekly series from Nov 2 writes event_date = Nov 16.
const WEEKLY5 = id(36);
const w5 = async () => (await db.query(`SELECT recurrence_rule -> 'skip_dates' AS s FROM events WHERE id = $1`, [WEEKLY5])).rows[0].s;
const seed5 = async (start, rule) => {
  await db.exec(`DELETE FROM events WHERE id = '${WEEKLY5}'`);
  await db.exec(`INSERT INTO events (id, band_id, title, event_date, is_recurring, recurrence_rule, event_type, status) VALUES ('${WEEKLY5}','${BAND_A}','Weekly 5','${start}', true, '${JSON.stringify(rule)}', 'rehearsal', 'confirmed')`);
};
const startTo = (day, extra = '') => asCommit(ADMIN, () => db.query(`UPDATE events SET event_date = $2::date, title = 'Weekly 5'${extra} WHERE id = $1`, [WEEKLY5, day]));
await seed5('2099-11-02', { frequency: 'weekly', interval: 1, skip_dates: ['2099-11-30'] });
await startTo('2099-11-16');
ok(JSON.stringify(await w5()) === '["2099-11-30"]', `round 5: an old build renaming the Nov 16 date (start -> Nov 16) keeps Nov 30 deleted (${JSON.stringify(await w5())})`);
await startTo('2099-11-17');
ok(JSON.stringify(await w5()) === '["2099-12-01"]', `round 5: the series moved a day later (Mon -> Tue, two weeks on) moves the deleted date by a day (${JSON.stringify(await w5())})`);
await startTo('2099-11-16');
ok(JSON.stringify(await w5()) === '["2099-11-30"]', `round 5: and a day back to the nearest date (${JSON.stringify(await w5())})`);
await seed5('2099-11-02', { frequency: 'weekly', interval: 2, skip_dates: ['2099-11-30'] });
await startTo('2099-11-23');
ok(JSON.stringify(await w5()) === '["2099-12-07"]', `round 5: every 2 weeks, a start 3 weeks on is a week off the old dates: +7 (${JSON.stringify(await w5())})`);
await seed5('2099-11-02', { frequency: 'biweekly', skip_dates: ['2099-11-30'] });
await startTo('2099-11-30', `, recurrence_rule = '{"frequency":"biweekly"}'::jsonb`);
ok(JSON.stringify(await w5()) === '["2099-11-30"]', `round 5: biweekly, the start moved onto a later date with an old rule: nothing moves (${JSON.stringify(await w5())})`);
await seed5('2099-11-02', { frequency: 'monthly', interval: 1, skip_dates: ['2099-12-02', '2100-02-02'] });
await startTo('2099-12-02');
ok(JSON.stringify(await w5()) === '["2099-12-02","2100-02-02"]', `round 5: monthly, the start moved one month on keeps Dec 2 and Feb 2 (${JSON.stringify(await w5())})`);
await startTo('2099-12-05');
ok(JSON.stringify(await w5()) === '["2099-12-05","2100-02-05"]', `round 5: monthly, a new day of the month: each deleted date keeps its month (${JSON.stringify(await w5())})`);
const nWeekly5 = (await db.query(`SELECT count(*)::int AS n FROM notifications WHERE data ->> 'event_id' = $1 AND type = 'event_cancelled'`, [WEEKLY5]).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
ok(nWeekly5 === 0, `round 5: moving the start announces no cancelled date (${nWeekly5})`);
await db.exec(`DELETE FROM events WHERE id = '${WEEKLY5}'`);
// Turning the repeat off still clears the rule.
await db.exec(`UPDATE events SET recurrence_rule = '{"frequency":"weekly","skip_dates":["2099-12-01"]}' WHERE id = '${ONCE}'`);
await asCommit(ADMIN, () => db.query(`UPDATE events SET is_recurring = false, recurrence_rule = NULL WHERE id = $1`, [ONCE]));
ok((await db.query(`SELECT recurrence_rule AS r FROM events WHERE id = $1`, [ONCE])).rows[0].r === null, 'B4 turning the repeat off clears the rule');
// Only the restore RPC takes a date out.
const restore = (user, ev, day) =>
  asCommit(user, () => db.query(`SELECT public.bw_restore_rehearsal_date($1, $2::date) AS r`, [ev, day]))
    .then((r) => r.rows[0].r, (e) => ({ error: e.message, code: e.code }));
const rs = await restore(ADMIN, PAID, '2099-12-24');
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
// BEFORE (tgtype bit 2) UPDATE (bit 16) row triggers, in the order they fire.
const trg = (await db.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.events'::regclass AND NOT tgisinternal
  AND (tgtype & 2) = 2 AND (tgtype & 16) = 16 ORDER BY tgname`)).rows.map((r) => r.tgname);
ok(trg[0] === 'bw_events_00_keep_skip_dates' && trg.length === 2, `B4 the keep trigger fires first by name, before 002's updated_at (${trg.join(', ')})`);

// Claude #297 round 4: a monthly series moved keeps its deleted dates on the
// same repeats, counted in months and clamped (#298 MONTHLY_VECTORS), not
// shifted by days.
const MONTHLY = id(35);
await db.exec(`INSERT INTO events (id, band_id, title, event_date, is_recurring, recurrence_rule, event_type) VALUES
  ('${MONTHLY}','${BAND_A}','Monthly jam','2027-01-31', true, '{"frequency":"monthly","interval":1,"skip_dates":["2027-02-28","2027-04-30"]}', 'rehearsal')`);
const monthlySkips = async () => (await db.query(`SELECT recurrence_rule -> 'skip_dates' AS s FROM events WHERE id = $1`, [MONTHLY])).rows[0].s;
await asCommit(ADMIN, () => db.query(`UPDATE events SET event_date = '2027-01-29' WHERE id = $1`, [MONTHLY]));
ok(JSON.stringify(await monthlySkips()) === '["2027-02-28","2027-04-29"]', `monthly: the series moved from the 31st to the 29th keeps Feb 28 and Apr 30 → Apr 29 (${JSON.stringify(await monthlySkips())})`);
await db.exec(`DELETE FROM events WHERE id = '${MONTHLY}'`);
await db.exec(`INSERT INTO events (id, band_id, title, event_date, is_recurring, recurrence_rule, event_type) VALUES
  ('${MONTHLY}','${BAND_A}','Monthly jam','2027-01-30', true, '{"frequency":"monthly","interval":1,"skip_dates":["2027-02-28","2027-03-30"]}', 'rehearsal')`);
await asCommit(ADMIN, () => db.query(`UPDATE events SET event_date = '2027-01-27' WHERE id = $1`, [MONTHLY]));
ok(JSON.stringify(await monthlySkips()) === '["2027-02-27","2027-03-27"]', `monthly: the series on the 30th moved to the 27th: Feb 28 → Feb 27, 2027 (${JSON.stringify(await monthlySkips())})`);

// ---- Claude #297 round 3 #3: a deleted date is announced, in each member's language
await db.exec(`UPDATE profiles SET preferred_language = 'it' WHERE id = '${INVITED}'; DELETE FROM notifications;`);
const notes = async () => (await db.query(`SELECT user_id, type, title, body, data FROM notifications ORDER BY user_id`)).rows;
const addSkip = (day) => asCommit(ADMIN, () => db.query(`SELECT public.bw_skip_rehearsal_date($1, $2::date)`, [PAID, day])).catch(() => null);
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
// A past date of a series that began in 2020 (Codex #297 r7 B3: only a
// date of the series can be deleted).
const PAST = id(50);
await db.exec(`INSERT INTO events (id, band_id, title, event_date, is_recurring, recurrence_rule, event_type, status) VALUES ('${PAST}','${BAND_A}','Since 2020','2020-01-02', true, '{"frequency":"weekly"}', 'rehearsal', 'confirmed')`);
const pastSkip = await skip(ADMIN, PAST, '2020-01-09');
ok(!pastSkip?.error && (await notes()).length === 0, `#3 a past date taken out is not announced (${JSON.stringify(pastSkip)})`);
await asCommit(ADMIN2, () => db.query(`UPDATE events SET title = 'Studio night' WHERE id = $1`, [PAID]));
ok((await notes()).length === 0, '#3 a write that adds no date announces nothing');
const MOVE_3 = id(46);
const m3 = await move(ADMIN, PAID, '2099-12-24', '2099-12-26', { title: 'Studio night (Sat)', start_time: '15:00', end_time: '18:00', venue_name: 'Room 2, Queens', notes: 'Saturday, earlier', band_id: BAND_B, recurrence_rule: { frequency: 'daily' }, fee: 90 }, MOVE_3);
const n2 = await notes();
const mIt = n2.find((n) => n.user_id === INVITED);
ok(n2.length > 0 && n2.every((n) => n.type === 'event_update' && n.data?.event_id === MOVE_3 && n.data?.moved_from === '2099-12-24') && mIt?.title === 'Prova aggiornata',
  `#3 "Only this date" is announced as a change of the new date, not a cancellation (${JSON.stringify(n2.map((n) => [n.type, n.title]))}, ${JSON.stringify(m3)})`);
// Claude #297 round 5 #2: the edits go in the same step, and one notice per member lists them.
const m3row = (await db.query(`SELECT title, start_time::text AS s, end_time::text AS e, venue_name, notes, fee::numeric AS fee, band_id, is_recurring, recurrence_rule FROM events WHERE id = $1`, [MOVE_3])).rows[0];
ok(m3row?.title === 'Studio night (Sat)' && m3row?.s === '15:00:00' && m3row?.venue_name === 'Room 2, Queens' && m3row?.notes === 'Saturday, earlier' && Number(m3row?.fee) === 90,
  `round 5: the date's edits (title, times, place, notes, studio cost) saved with the move (${JSON.stringify(m3row)})`);
ok(m3row?.band_id === BAND_A && m3row?.is_recurring === false && m3row?.recurrence_rule === null, 'round 5: band, repeat and date are never taken from the edits');
const perMember = n2.filter((n) => n.user_id === OUTSIDER);
ok(perMember.length === 1 && JSON.stringify(perMember[0]?.data?.changes) === '["date","time","venue"]' && /new date, time, venue/.test(perMember[0]?.body ?? ''),
  `round 5: one notice per member, listing date, time and place (${JSON.stringify(perMember.map((n) => [n.body, n.data?.changes]))})`);
// Claude #297 round 5 #3: a draft series announces nothing.
await db.exec(`DELETE FROM notifications; UPDATE events SET status = 'draft' WHERE id = '${PAID}';`);
const draftSkip = await skip(ADMIN, PAID, '2100-01-07');
ok(!draftSkip?.error && (await notes()).length === 0, `round 5: deleting a date of a draft series tells nobody (${JSON.stringify(draftSkip)})`);
await db.exec(`UPDATE events SET status = 'confirmed' WHERE id = '${PAID}';`);

// ---- Codex #297 review of a765f6c0
// B1: a series linked to another band's setlist: no copy made in that band, no link.
const XB_SERIES = id(37), XB_SETLIST = id(38), MOVE_XB = id(47);
await db.exec(`
  INSERT INTO setlists (id, band_id, name, song_count) VALUES ('${XB_SETLIST}','${BAND_B}','Band B private set', 1);
  INSERT INTO setlist_songs (setlist_id, song_id, position) VALUES ('${XB_SETLIST}', gen_random_uuid(), 1);
  INSERT INTO events (id, band_id, title, event_date, is_recurring, recurrence_rule, event_type, status, setlist_id) VALUES
    ('${XB_SERIES}','${BAND_A}','Cross-band link','2099-12-02', true, '{"frequency":"weekly","interval":1}', 'rehearsal', 'confirmed', '${XB_SETLIST}');
`);
const bSetlistsBefore = (await db.query(`SELECT count(*)::int AS n FROM setlists WHERE band_id = $1`, [BAND_B])).rows[0].n;
const mxb = await move(ADMIN2, XB_SERIES, '2099-12-09', '2099-12-10', {}, MOVE_XB);
const xbCopy = (await db.query(`SELECT setlist_id FROM events WHERE id = $1`, [MOVE_XB])).rows[0];
const bSetlistsAfter = (await db.query(`SELECT count(*)::int AS n FROM setlists WHERE band_id = $1`, [BAND_B])).rows[0].n;
ok(mxb?.event_id === MOVE_XB && xbCopy && xbCopy.setlist_id === null && bSetlistsAfter === bSetlistsBefore && mxb?.setlist_id === null,
  `Codex B1: another band's setlist is not copied, and the one-off has no setlist (${JSON.stringify({ mxb, xbCopy, bSetlistsBefore, bSetlistsAfter })})`);
// B4: the deleted date is stored as #285's feed reads it: a 'YYYY-MM-DD' string in
// recurrence_rule.skip_dates (182: skip ? to_char(day, 'YYYY-MM-DD')).
const fmt = (await db.query(`SELECT recurrence_rule -> 'skip_dates' AS s,
    (SELECT bool_and(jsonb_typeof(x) = 'string' AND x #>> '{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') FROM jsonb_array_elements(recurrence_rule -> 'skip_dates') x) AS ok,
    (recurrence_rule -> 'skip_dates') ? to_char('2099-12-09'::date, 'YYYY-MM-DD') AS moved_key
  FROM events WHERE id = $1`, [XB_SERIES])).rows[0];
ok(fmt?.ok === true && fmt?.moved_key === true, `Codex B4: a moved date's entry is the key #285's feed matches (${JSON.stringify(fmt)})`);
await asCommit(ADMIN, () => db.query(`SELECT public.bw_skip_rehearsal_date($1, '2099-12-16'::date)`, [XB_SERIES])).catch(() => null);
const fmt2 = (await db.query(`SELECT (recurrence_rule -> 'skip_dates') ? '2099-12-16' AS k,
    (SELECT bool_and(jsonb_typeof(x) = 'string') FROM jsonb_array_elements(recurrence_rule -> 'skip_dates') x) AS s FROM events WHERE id = $1`, [XB_SERIES])).rows[0];
ok(fmt2?.k === true && fmt2?.s === true, `Codex B4: a deleted date's entry is the same key (${JSON.stringify(fmt2)})`);
// M2: no date to restore is refused, nothing restored.
const xbBefore = JSON.stringify((await db.query(`SELECT recurrence_rule -> 'skip_dates' AS s FROM events WHERE id = $1`, [XB_SERIES])).rows[0].s);
let m2 = 'restored';
try { await asCommit(ADMIN, () => db.query(`SELECT public.bw_restore_rehearsal_date($1, NULL)`, [XB_SERIES])); } catch (e) { m2 = `${e.code}/${e.hint}`; }
const xbAfter = JSON.stringify((await db.query(`SELECT recurrence_rule -> 'skip_dates' AS s FROM events WHERE id = $1`, [XB_SERIES])).rows[0].s);
ok(m2 === '22023/bw:not_a_date' && xbAfter === xbBefore, `Codex M2: restoring no date is refused (bw:not_a_date), nothing restored (${m2}, ${xbBefore} -> ${xbAfter})`);
// M3: a cadence edit replayed from an offline queue with a stale list does
// not cancel a date restored meanwhile; a plain write adds no date.
await asCommit(ADMIN, () => db.query(`SELECT public.bw_restore_rehearsal_date($1, '2099-12-16'::date)`, [XB_SERIES])).catch(() => null);
await asCommit(ADMIN2, () => db.query(`UPDATE events SET recurrence_rule = '{"frequency":"weekly","interval":2,"skip_dates":["2099-12-09","2099-12-16"]}'::jsonb WHERE id = $1`, [XB_SERIES]));
const m3s = (await db.query(`SELECT recurrence_rule AS r FROM events WHERE id = $1`, [XB_SERIES])).rows[0].r;
ok(m3s?.interval === 2 && JSON.stringify(m3s?.skip_dates) === '["2099-12-09"]', `Codex M3: a stale replay keeps the restored date on (${JSON.stringify(m3s)})`);
const PLAIN = id(39);
await db.exec(`INSERT INTO events (id, band_id, title, event_date, is_recurring, recurrence_rule, event_type, status) VALUES ('${PLAIN}','${BAND_A}','No dates off','2099-12-02', true, '{"frequency":"weekly"}', 'rehearsal', 'confirmed')`);
await asCommit(ADMIN, () => db.query(`UPDATE events SET recurrence_rule = '{"frequency":"weekly","skip_dates":["2099-12-09"]}'::jsonb WHERE id = $1`, [PLAIN]));
const plainRule = (await db.query(`SELECT recurrence_rule AS r FROM events WHERE id = $1`, [PLAIN])).rows[0].r;
ok(!plainRule?.skip_dates, `Codex M3: a plain write cannot delete a date, even on a series with none (${JSON.stringify(plainRule)})`);
const skipFlag = await as(ADMIN, async () => {
  await db.query(`SELECT public.bw_skip_rehearsal_date($1, '2099-12-23'::date)`, [PLAIN]);
  return (await db.query(`SELECT coalesce(current_setting('bw.skip_add', true), '') AS f`)).rows[0].f;
}).catch((e) => `error: ${e.message}`);
ok(skipFlag === '', `Codex M3: the skip flag is off again after the RPC (${JSON.stringify(skipFlag)})`);
// M1: availability on prod (095's function): a series' deleted first date is free.
const freeHere = async (day) => (await as(ADMIN, () => db.query(`SELECT free_count, total_count FROM public.bw_band_free_slots($1, $2::date, $2::date)`, [BAND_A, day]))).rows[0];
const f195 = await freeHere('2099-11-24');
const f195once = await freeHere('2099-11-25');
ok(f195?.total_count === 4 && f195?.free_count === 4, `Codex M1: a deleted first date is free in the heatmap (${JSON.stringify(f195)})`);
ok(f195once?.free_count === 3, `Codex M1: a real event still makes its lineup busy (${JSON.stringify(f195once)})`);
const fsDef = (await db.query(`SELECT pg_get_functiondef('public.bw_band_free_slots(uuid,date,date,time,time,integer,uuid)'::regprocedure) AS d`)).rows[0].d;
ok(process.env.BW_AFTER_178 ? /bw_date_hold_live/.test(fsDef) : !/bw_date_hold_live/.test(fsDef),
  process.env.BW_AFTER_178 ? 'Codex M1: after 178, 195 leaves 178\'s free slots as they are' : 'Codex M1: alone, 195 starts from 095 (no 178 objects)');
const fsAnon = (await db.query(`SELECT has_function_privilege('anon', 'public.bw_band_free_slots(uuid,date,date,time,time,integer,uuid)', 'EXECUTE') AS a`)).rows[0].a;
ok(fsAnon === false, 'Codex M1: anon still cannot call it');

// ---- Codex / Claude #297 r7 (review of f44c8207 / f94ec6cf)
await db.exec(`DELETE FROM notifications;`);
const who = (rows) => rows.map((n) => n.user_id).sort();
const evRule = async (ev) => (await db.query(`SELECT recurrence_rule AS r FROM events WHERE id = $1`, [ev])).rows[0]?.r;
// B1: a recurring quote (a tentative gig, nobody on its lineup).
const QUOTE_S = id(48), MOVE_Q = id(51);
await db.exec(`INSERT INTO events (id, band_id, title, event_date, is_recurring, recurrence_rule, event_type, status) VALUES
  ('${QUOTE_S}','${BAND_A}','Private wedding quote','2099-12-05', true, '{"frequency":"weekly"}', 'gig', 'tentative')`);
const qSkip = await skip(ADMIN, QUOTE_S, '2099-12-12');
const qMove = await move(ADMIN, QUOTE_S, '2099-12-12', '2099-12-13', {}, MOVE_Q);
const qCopies = (await db.query(`SELECT count(*)::int AS n FROM events WHERE id = $1`, [MOVE_Q])).rows[0].n;
ok(qSkip?.code === '22023' && qSkip?.hint === 'bw:is_quote' && !(await evRule(QUOTE_S))?.skip_dates,
  `r7 B1: "Delete this date" refuses a quote (bw:is_quote) (${JSON.stringify(qSkip)})`);
ok(qMove?.code === '22023' && qCopies === 0, `r7 B1: "Only this date" refuses a quote, nothing created (${JSON.stringify(qMove)})`);
ok((await notes()).length === 0, 'r7 B1: a refused quote date tells nobody');
// The notice itself, for a date added however it gets there: admins only.
const flagSkip = (ev, day) => asCommit(ADMIN, async () => {
  await db.query(`SELECT set_config('bw.skip_add', 'on', true)`);
  await db.query(`UPDATE events SET recurrence_rule = recurrence_rule || jsonb_build_object('skip_dates', jsonb_build_array($2::text)) WHERE id = $1`, [ev, day]);
});
await flagSkip(QUOTE_S, '2099-12-19');
const qNotes = await notes();
ok(JSON.stringify(who(qNotes)) === JSON.stringify([ADMIN2]),
  `r7 B1: with an empty lineup a quote's cancelled date reaches only the admins, never the band (${JSON.stringify(qNotes.map((n) => [n.user_id.slice(-2), n.title, n.body]))})`);
await db.exec(`DELETE FROM notifications; INSERT INTO event_members (event_id, user_id, status) VALUES ('${QUOTE_S}','${INVITED}','invited');`);
await flagSkip(QUOTE_S, '2099-12-26');
ok(!(await notes()).some((n) => n.user_id === INVITED || n.user_id === OUTSIDER), 'r7 B1: a non-admin on a quote\'s lineup does not get it either');
await db.exec(`DELETE FROM notifications;`);

// B3: the series moved from Monday to Tuesday by another admin; the old
// Monday open in a form is no longer a date of it.
const B3S = id(49);
await db.exec(`INSERT INTO events (id, band_id, title, event_date, is_recurring, recurrence_rule, event_type, status) VALUES
  ('${B3S}','${BAND_A}','Monday rehearsal','2099-12-07', true, '{"frequency":"weekly"}', 'rehearsal', 'confirmed')`);
await asCommit(ADMIN2, () => db.query(`UPDATE events SET event_date = '2099-12-08' WHERE id = $1`, [B3S]));
const b3 = await skip(ADMIN, B3S, '2099-12-14');
ok(b3?.code === '22023' && b3?.hint === 'bw:not_a_date' && !(await evRule(B3S))?.skip_dates && (await notes()).length === 0,
  `r7 B3: a Monday the series no longer has is refused (bw:not_a_date), nothing deleted or sent (${JSON.stringify(b3)})`);
const b3ok = await skip(ADMIN, B3S, '2099-12-15');
ok(!b3ok?.error && JSON.stringify((await evRule(B3S))?.skip_dates) === '["2099-12-15"]', `r7 B3: its Tuesday still can be (${JSON.stringify(b3ok)})`);
await db.exec(`DELETE FROM notifications;`);

// M2: "past" is where the admin is. A zone whose date differs from UTC now:
// behind (Pago Pago, UTC-11) before 11:00 UTC, else ahead (Kiritimati, UTC+14).
const zone = new Date().getUTCHours() < 11 ? 'Pacific/Pago_Pago' : 'Pacific/Kiritimati';
const days = (await db.query(`SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS local, to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS utc`, [zone])).rows[0];
const M2S = id(52);
if (days.local === days.utc) {
  console.log(`SKIP r7 M2: ${zone} has the UTC date right now`);
} else {
  await db.exec(`UPDATE profiles SET timezone = '${zone}' WHERE id = '${ADMIN}';`);
  const target = days.local < days.utc ? days.local : days.utc; // the admin's today, or the admin's yesterday
  await db.exec(`INSERT INTO events (id, band_id, title, event_date, is_recurring, recurrence_rule, event_type, status, start_time) VALUES
    ('${M2S}','${BAND_A}','Evening rehearsal','${target}', true, '{"frequency":"weekly"}', 'rehearsal', 'confirmed', '21:00')`);
  const m2skip = await skip(ADMIN, M2S, target);
  const m2n = (await notes()).filter((n) => n.data?.event_id === M2S).length;
  if (days.local < days.utc) {
    ok(!m2skip?.error && m2n > 0, `r7 M2: tonight's date deleted after UTC midnight (${zone}, ${target}) is announced (${m2n} notices)`);
  } else {
    ok(!m2skip?.error && m2n === 0, `r7 M2: yesterday where the admin is (${zone}, ${target}) is past, not announced (${m2n} notices)`);
  }
  await db.exec(`UPDATE profiles SET timezone = 'America/New_York' WHERE id = '${ADMIN}'; DELETE FROM notifications;`);
}
const tz = (await db.query(`SELECT
    public.bw_user_today('${id(99)}') = (now() AT TIME ZONE 'America/New_York')::date AS nobody,
    public.bw_user_today('${ADMIN}') = (now() AT TIME ZONE 'America/New_York')::date AS ny,
    public.bw_user_today('${id(96)}') = (now() AT TIME ZONE 'Europe/Rome')::date AS stored`).catch((e) => ({ rows: [{ error: e.message }] }))).rows[0];
await db.exec(`INSERT INTO profiles (id, timezone) VALUES ('${id(98)}', 'Mars/Olympus') ON CONFLICT (id) DO UPDATE SET timezone = 'Mars/Olympus'`);
const tzBad = (await db.query(`SELECT public.bw_user_today('${id(98)}') = (now() AT TIME ZONE 'America/New_York')::date AS bad`).catch((e) => ({ rows: [{ bad: e.message }] }))).rows[0].bad;
ok(tz?.nobody === true && tz?.ny === true && tz?.stored === true && tzBad === true, `r7 M2: today is the profile's zone, America/New_York without one or with an unknown one (${JSON.stringify({ ...tz, tzBad })})`);
// The move branch always notifies: a past date of the series moved to a future day.
const MOVE_PAST = id(55);
const mPast = await move(ADMIN, PAST, '2020-01-16', '2099-12-30', {}, MOVE_PAST);
const mPastN = (await notes()).filter((n) => n.type === 'event_update' && n.data?.event_id === MOVE_PAST).length;
ok(mPast?.event_id === MOVE_PAST && mPastN > 0, `r7 M2: a moved date is always announced, even from a past day (${mPastN} notices, ${JSON.stringify(mPast)})`);
await db.exec(`DELETE FROM notifications;`);

// ---- Codex #297 r8 BLOCKER: "today" is the device's zone (p_tz), not the
// profile's: every prod profile says Europe/Rome (004's default). The real
// case is a New York admin after 18:00 ET (already tomorrow in Rome); at
// other hours a pair whose dates always differ (UTC+14 / UTC-12) stands in.
const pairDays = async (stored, device) => (await db.query(`SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS s,
  to_char((now() AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS d, to_char((now() AT TIME ZONE $2)::date + 7, 'YYYY-MM-DD') AS d7`, [stored, device])).rows[0];
let [R8_STORED, R8_DEVICE] = ['Europe/Rome', 'America/New_York'];
let r8 = await pairDays(R8_STORED, R8_DEVICE);
if (!(r8.d < r8.s)) { [R8_STORED, R8_DEVICE] = ['Pacific/Kiritimati', 'Etc/GMT+12']; r8 = await pairDays(R8_STORED, R8_DEVICE); }
console.log(`info: r8 stored zone ${R8_STORED} (${r8.s}), device zone ${R8_DEVICE} (${r8.d})`);
await db.exec(`UPDATE profiles SET timezone = '${R8_STORED}' WHERE id = '${ADMIN}'; DELETE FROM notifications;`);
const [R8_SKIP, R8_MOVE, R8_MOVED, R8_BAD, R8_OLD] = [56, 57, 58, 59, 60].map(id);
await db.exec(`INSERT INTO events (id, band_id, title, event_date, is_recurring, recurrence_rule, event_type, status, start_time) VALUES
  ('${R8_SKIP}','${BAND_A}','Late rehearsal','${r8.d}', true, '{"frequency":"weekly"}', 'rehearsal', 'confirmed', '21:00'),
  ('${R8_MOVE}','${BAND_A}','Weekly rehearsal','${r8.d}', true, '{"frequency":"weekly"}', 'rehearsal', 'confirmed', '20:00');
  INSERT INTO event_members (event_id, user_id, status, fee, role, paid_at) VALUES
  ('${R8_SKIP}','${INVITED}','confirmed', 0, 'Bass', NULL), ('${R8_MOVE}','${INVITED}','confirmed', 0, 'Bass', NULL);`);
const r8call = (sql, params) => asCommit(ADMIN, () => db.query(sql, params)).then((r) => r.rows[0].r, (e) => ({ error: e.message, code: e.code, hint: e.hint }));
const r8Move = await r8call(`SELECT public.bw_move_rehearsal_date($1, $2::date, $3::date, '{}'::jsonb, $4::uuid, $5) AS r`, [R8_MOVE, r8.d7, r8.d, R8_MOVED, R8_DEVICE]);
ok(r8Move?.event_id === R8_MOVED, `r8: a ${R8_DEVICE} device moves a date to its today (${r8.d}; ${R8_STORED} is on ${r8.s}): accepted (${JSON.stringify(r8Move)})`);
const r8Bad = await r8call(`SELECT public.bw_move_rehearsal_date($1, $2::date, $3::date, '{}'::jsonb, $4::uuid, $5) AS r`, [R8_MOVE, r8.d, r8.d, R8_BAD, 'Mars/Olympus']);
ok(r8Bad?.code === '22023' && r8Bad?.hint === 'bw:date_past', `r8: an unknown p_tz is ignored (the profile's zone decides: date_past, no error of its own) (${JSON.stringify(r8Bad)})`);
const r8Inj = await r8call(`SELECT public.bw_move_rehearsal_date($1, $2::date, $3::date, '{}'::jsonb, $4::uuid, $5) AS r`, [R8_MOVE, r8.d, r8.d, R8_BAD, "UTC'; SELECT 1; --"]);
ok(r8Inj?.code === '22023' && r8Inj?.hint === 'bw:date_past', `r8: a p_tz that is not a zone name is ignored too (${JSON.stringify(r8Inj)})`);
// The zone must fit profiles.timezone (VARCHAR(50)), as the app's deviceTimeZone.
const r8Cap = (await db.query(`SELECT public.bw_known_tz('America/Argentina/ComodRivadavia') AS real32,
  public.bw_known_tz(repeat('A', 51)) AS long51,
  (SELECT count(*)::int FROM pg_timezone_names WHERE length(name) > 50) AS realOver50,
  (pg_get_functiondef('public.bw_known_tz(text)'::regprocedure) ~ 'length\\(p_tz\\) <= 50') AS cap50`).catch((e) => ({ rows: [{ error: e.message }] }))).rows[0];
ok(r8Cap?.real32 === 'America/Argentina/ComodRivadavia' && r8Cap?.long51 === null && r8Cap?.realover50 === 0 && r8Cap?.cap50 === true,
  `r8: a zone name is at most 50 characters, every real one fits (${JSON.stringify(r8Cap)})`);
await db.exec(`DELETE FROM notifications;`);
const r8Skip = await r8call(`SELECT public.bw_skip_rehearsal_date($1, $2::date, $3) AS r`, [R8_SKIP, r8.d, R8_DEVICE]);
const r8SkipN = (await notes()).filter((n) => n.data?.event_id === R8_SKIP && n.type !== 'event_update').length;
ok(!r8Skip?.error && r8SkipN > 0, `r8: deleting tonight's date (${r8.d} on the device) sends the notice (${r8SkipN} notices, ${JSON.stringify(r8Skip)})`);
await db.exec(`DELETE FROM notifications;`);
const r8Rs = await r8call(`SELECT public.bw_restore_rehearsal_date($1, $2::date, $3) AS r`, [R8_SKIP, r8.d, R8_DEVICE]);
const r8RsN = (await notes()).filter((n) => n.data?.event_id === R8_SKIP && n.data?.restored === true).length;
ok(!r8Rs?.error && r8RsN > 0, `r8: restoring tonight's date sends "back on" (${r8RsN} notices, ${JSON.stringify(r8Rs)})`);
await db.exec(`DELETE FROM notifications;`);
// The device zone lasts for the call's transaction only, and counts for the caller only.
const r8Scope = await as(ADMIN, async () => {
  await db.query(`SELECT public.bw_skip_rehearsal_date($1, $2::date, $3)`, [R8_SKIP, r8.d7, R8_DEVICE]);
  return (await db.query(`SELECT coalesce(current_setting('bw.user_tz', true), '') AS tz`)).rows[0].tz;
}).catch((e) => e.message);
await db.exec(`INSERT INTO profiles (id, timezone) VALUES ('${id(97)}', '${R8_STORED}')`);
await db.exec(`BEGIN; SELECT set_config('request.jwt.claims', '{"sub":"${ADMIN}","role":"authenticated"}', true), set_config('bw.user_tz', '${R8_DEVICE}', true);`);
const r8Who = (await db.query(`SELECT public.bw_user_today($1) = (now() AT TIME ZONE $3)::date AS caller,
  public.bw_user_today($2) = (now() AT TIME ZONE $4)::date AS other`, [ADMIN, id(97), R8_DEVICE, R8_STORED]).catch((e) => ({ rows: [{ error: e.message }] }))).rows[0];
await db.exec('ROLLBACK');
const r8Later = (await db.query(`SELECT coalesce(current_setting('bw.user_tz', true), '') AS tz`)).rows[0].tz;
ok(r8Scope === R8_DEVICE && r8Later === '' && r8Who?.caller === true && r8Who?.other === true,
  `r8: the device zone holds for the call's transaction, for the caller only (${JSON.stringify({ r8Scope, r8Later, ...r8Who })})`);
await db.exec(`DELETE FROM notifications;`);
// Older builds call without p_tz (positional or named): one function each, still answering.
const r8Named = await r8call(`SELECT public.bw_skip_rehearsal_date(p_event_id => $1, p_date => $2::date) AS r`, [R8_SKIP, r8.d7]);
const r8NamedRs = await r8call(`SELECT public.bw_restore_rehearsal_date(p_event_id => $1, p_date => $2::date) AS r`, [R8_SKIP, r8.d7]);
const r8NamedMv = await r8call(`SELECT public.bw_move_rehearsal_date(p_event_id => $1, p_date => $2::date, p_new_date => '2099-12-31'::date, p_fields => '{}'::jsonb, p_client_id => $3::uuid) AS r`, [R8_MOVE, r8.d, R8_OLD]);
ok(Array.isArray(r8Named?.skip_dates) && Array.isArray(r8NamedRs?.skip_dates) && r8NamedMv?.event_id === R8_OLD,
  `r8: old-shape calls without p_tz still work (${JSON.stringify({ r8Named, r8NamedRs, r8NamedMv })})`);
const r8Sigs = (await db.query(`SELECT proname, pg_get_function_identity_arguments(oid) AS a FROM pg_proc
  WHERE proname IN ('bw_skip_rehearsal_date', 'bw_restore_rehearsal_date', 'bw_move_rehearsal_date') ORDER BY 1`)).rows;
ok(r8Sigs.length === 3 && r8Sigs.every((r) => /p_tz text$/.test(r.a)), `r8: one signature each, ending in p_tz (${JSON.stringify(r8Sigs)})`);
const r8Anon = (await db.query(`SELECT has_function_privilege('anon', 'public.bw_skip_rehearsal_date(uuid, date, text)', 'EXECUTE')
  OR has_function_privilege('anon', 'public.bw_restore_rehearsal_date(uuid, date, text)', 'EXECUTE')
  OR has_function_privilege('anon', 'public.bw_move_rehearsal_date(uuid, date, date, jsonb, uuid, text)', 'EXECUTE') AS a`).catch(() => ({ rows: [{ a: null }] }))).rows[0].a;
ok(r8Anon === false, 'r8: anon still cannot call them');
await db.exec(`UPDATE profiles SET timezone = 'America/New_York' WHERE id = '${ADMIN}'; DELETE FROM notifications;`);

// Claude r6 #4: a date restored is announced as back on, to the same people.
const rsBack = await restore(ADMIN, PAID, '2100-01-07');
const back = await notes();
const bIt = back.find((n) => n.user_id === INVITED);
const bEn = back.find((n) => n.user_id === OUTSIDER);
const itBack = (await db.query(`SELECT public.bw_i18n_short_date('2100-01-07'::date, 'it') AS w`)).rows[0].w;
ok(!rsBack?.error && bEn?.type === 'event_update' && bEn?.title === 'Rehearsal back on' && /is back on/.test(bEn?.body ?? '') && bEn?.data?.restored === true && bEn?.data?.occurrence_date === '2100-01-07',
  `r6 #4: the English member reads "Rehearsal back on" for the restored date (${JSON.stringify(bEn && { t: bEn.title, b: bEn.body, d: bEn.data })})`);
ok(bIt?.title === 'Prova di nuovo in calendario' && bIt?.body?.includes(itBack) && /di nuovo in calendario/.test(bIt?.body ?? ''),
  `r6 #4: the Italian member reads it in Italian (${JSON.stringify(bIt && { t: bIt.title, b: bIt.body })})`);
ok(JSON.stringify(who(back)) === JSON.stringify([INVITED, OUTSIDER].sort()), `r6 #4: the lineup that heard of the cancel, not the admin who restored it (${who(back).map((u) => u.slice(-2)).join(',')})`);
await db.exec(`DELETE FROM notifications;`);
await restore(ADMIN, PAST, '2020-01-09');
ok((await notes()).length === 0, 'r6 #4: a past date restored is not announced');
await db.exec(`DELETE FROM event_members WHERE event_id = '${QUOTE_S}';`); // the empty lineup again
await restore(ADMIN, QUOTE_S, '2099-12-19');
ok(JSON.stringify(who(await notes())) === JSON.stringify([ADMIN2]), `r6 #4: a quote's date back on reaches only its admins (${who(await notes()).map((u) => u.slice(-2)).join(',')})`);
await db.exec(`DELETE FROM notifications;`);

// Claude r6 #5: intervals as the app reads them, 1-52 else 1.
const hd = (r, start, day) => db.query(`SELECT public.bw_rehearsal_series_has_date($1::jsonb, $2::date, $3::date) AS h`, [JSON.stringify(r), start, day])
  .then((x) => x.rows[0].h, (e) => `error: ${e.message}`);
ok(await hd({ frequency: 'weekly', interval: 60 }, '2099-01-01', '2099-01-08') === true, 'r6 #5: interval 60 is read as 1, as the app shows it');
ok(await hd({ frequency: 'weekly', interval: '99999999999' }, '2099-01-01', '2099-01-08') === true, 'r6 #5: a huge interval is 1, not an error');
ok(await hd({ frequency: 'weekly', interval: 0 }, '2099-01-01', '2099-01-08') === true, 'r6 #5: interval 0 is 1');
ok(await hd({ frequency: 'weekly', interval: 52 }, '2099-01-01', '2099-12-31') === true && await hd({ frequency: 'weekly', interval: 52 }, '2099-01-01', '2099-01-08') === false,
  'r6 #5: interval 52 is kept');
const CAP = id(53);
await db.exec(`INSERT INTO events (id, band_id, title, event_date, is_recurring, recurrence_rule, event_type, status) VALUES
  ('${CAP}','${BAND_A}','Odd interval','2099-11-02', true, '{"frequency":"weekly","interval":60,"skip_dates":["2099-11-30"]}', 'rehearsal', 'confirmed')`);
const capMove = await asCommit(ADMIN, () => db.query(`UPDATE events SET event_date = '2099-11-09' WHERE id = $1`, [CAP])).then(() => 'saved', (e) => e.message);
ok(capMove === 'saved' && JSON.stringify((await evRule(CAP))?.skip_dates) === '["2099-11-30"]',
  `r6 #5: the keep trigger reads interval 60 as weekly: a start a week on moves no deleted date (${capMove}, ${JSON.stringify((await evRule(CAP))?.skip_dates)})`);

// Claude r6 #6: the replay check looks only at the series' band.
const XB_EVENT = id(54);
await db.exec(`INSERT INTO events (id, band_id, title, event_date, event_type, status) VALUES ('${XB_EVENT}','${BAND_B}','Band B gig','2099-12-12','gig','confirmed')`);
const c6 = await move(ADMIN, PAID, '2100-01-21', '2100-01-22', {}, XB_EVENT);
const xbRow = (await db.query(`SELECT band_id, parent_event_id FROM events WHERE id = $1`, [XB_EVENT])).rows[0];
ok(!!c6?.error && !/belongs to another event/.test(c6.error) && xbRow?.band_id === BAND_B && xbRow?.parent_event_id === null && (await notes()).length === 0,
  `r6 #6: another band's event id is not looked up by the replay check (${JSON.stringify(c6)})`);

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
