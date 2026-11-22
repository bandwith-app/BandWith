// Local check of migration 180 (account deletion keeps what the band uses)
// without Docker: PGlite with stand-ins for auth.users, storage.objects and
// the rehearsal poll tables as created by 038 (created_by ON DELETE CASCADE).
// Failing first: with /dev/null as the migration, deleting the poll creator's
// account takes the band's poll and every vote with it.
//
//   mkdir -p /tmp/pg180 && cd /tmp/pg180 && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/account_deletion_safety.pglite.mjs . && node account_deletion_safety.pglite.mjs <repo>
//   node account_deletion_safety.pglite.mjs <repo> /dev/null    # before: FAILs expected
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const REPO = process.argv[2];
const MIG = process.argv[3] ?? `${REPO}/supabase/migrations/180_account_deletion_safety.sql`;
const db = new PGlite();
process.on('unhandledRejection', (e) => { console.log('ERROR', e.message); process.exit(2); });
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [BAND, ADMIN1, ADMIN2, MEM] = [1, 2, 3, 4].map(id);
const [POLL, OPT] = [10, 11].map(id);
const SOLO = id(20), DUO = id(21);

await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text,
  owner uuid REFERENCES auth.users(id), owner_id text);
CREATE TABLE public.bands (id uuid PRIMARY KEY, name text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, timezone text,
  full_name text, email text, preferred_language text);
-- auth.uid() as the request's user (test.uid).
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, reference_id uuid, read boolean DEFAULT false,
  title text, body text, data jsonb DEFAULT '{}'::jsonb, band_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.band_members (band_id uuid REFERENCES public.bands(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE, role text, is_active boolean DEFAULT true);
CREATE TABLE public.events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, created_by uuid);
-- Chats as 002 + 024 left them: sender_id SET NULL on a NOT NULL column.
CREATE TYPE public.chat_type AS ENUM ('direct', 'group', 'band', 'event');
CREATE TABLE public.chats (id uuid PRIMARY KEY, type public.chat_type NOT NULL, band_id uuid REFERENCES public.bands(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL);
CREATE TABLE public.chat_participants (chat_id uuid REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE, last_read_at timestamptz, last_delivered_at timestamptz);
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid REFERENCES public.chats(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL CONSTRAINT messages_sender_id_fkey REFERENCES public.profiles(id) ON DELETE SET NULL,
  content text, metadata jsonb DEFAULT '{}'::jsonb, attachments jsonb DEFAULT '[]'::jsonb, deleted boolean DEFAULT false,
  reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL, created_at timestamptz DEFAULT now());
-- Songs and suggestions as 108 created them (created_by ON DELETE CASCADE).
CREATE TABLE public.songs (id uuid PRIMARY KEY, band_id uuid REFERENCES public.bands(id) ON DELETE CASCADE, title text,
  status text DEFAULT 'active', audio_url text, chart_url text);
CREATE TABLE public.song_suggestions (id uuid PRIMARY KEY, band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  song_id uuid REFERENCES public.songs(id) ON DELETE SET NULL, status text NOT NULL DEFAULT 'pending',
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, kind text NOT NULL DEFAULT 'note', reviewed_at timestamptz);
CREATE FUNCTION public.bw_notify_song_suggestion_outcome(p_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
-- As 038 created them.
CREATE TABLE public.rehearsal_polls (id uuid PRIMARY KEY, band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, title text, vote_by date, vote_by_time time,
  invited_user_ids uuid[] NOT NULL DEFAULT '{}', status text DEFAULT 'open', notes text, created_at timestamptz DEFAULT now(), updated_at timestamptz);
CREATE TABLE public.rehearsal_poll_options (id uuid PRIMARY KEY, poll_id uuid NOT NULL REFERENCES public.rehearsal_polls(id) ON DELETE CASCADE);
CREATE TABLE public.rehearsal_poll_votes (poll_id uuid NOT NULL REFERENCES public.rehearsal_polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES public.rehearsal_poll_options(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);

INSERT INTO auth.users VALUES ('${ADMIN1}'), ('${ADMIN2}'), ('${MEM}');
INSERT INTO profiles VALUES ('${ADMIN1}'), ('${ADMIN2}'), ('${MEM}');
INSERT INTO bands VALUES ('${BAND}', 'Hudson Horns'), ('${SOLO}', 'Solo project');
INSERT INTO band_members VALUES ('${BAND}','${ADMIN1}','admin',true), ('${BAND}','${ADMIN2}','admin',true),
  ('${BAND}','${MEM}','member',true), ('${SOLO}','${ADMIN1}','admin',true);
INSERT INTO rehearsal_polls VALUES ('${POLL}', '${BAND}', '${ADMIN1}', 'Thursday or Friday?', '2026-11-20', '18:00');
UPDATE profiles SET timezone = 'America/New_York' WHERE id = '${ADMIN1}';
INSERT INTO rehearsal_poll_options VALUES ('${OPT}', '${POLL}');
INSERT INTO rehearsal_poll_votes VALUES ('${POLL}', '${OPT}', '${ADMIN2}'), ('${POLL}', '${OPT}', '${MEM}'), ('${POLL}', '${OPT}', '${ADMIN1}');
INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
  ('song-files', '${BAND}/song/chart.pdf', '${ADMIN1}', '${ADMIN1}'),
  ('quotes', 'quotes/${BAND}/Q-1.pdf', '${ADMIN1}', '${ADMIN1}'),
  ('personal-files', '${ADMIN1}/song/my-take.m4a', '${ADMIN1}', '${ADMIN1}'),
  ('song-files', '${BAND}/song/other.pdf', '${MEM}', '${MEM}');
`);

const lines = (file, from, to) => readFileSync(`${REPO}/supabase/migrations/${file}`, 'utf8').split('\n').slice(from - 1, to).join('\n');
await db.exec(lines('045_account_deletion.sql', 18, 38)); // bw_account_deletion_blockers as live
await db.exec(lines('050_chat_and_profile_privacy.sql', 63, 80)); // messages: sender_id can't change
await db.exec(readFileSync(`${REPO}/supabase/migrations/059_account_deletion_personal_data.sql`, 'utf8')); // prepare as live
// Live definitions that compare an author or sender with a user (Codex round 3).
await db.exec(lines('049_chat_participants_and_receipts.sql', 36, 90)); // mark delivered / read
await db.exec(lines('122_chat_delivered_by_push.sql', 18, 44));
await db.exec(lines('117_poll_vote_deadline.sql', 23, 53)); // vote deadline in the creator's time zone
await db.exec(`REVOKE ALL ON FUNCTION public.bw_poll_vote_deadline(uuid) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.bw_poll_vote_deadline(uuid) TO authenticated;`); // 117 lines 65, 67
await db.exec(lines('108_song_suggestions.sql', 339, 384)); // a suggested song moved on or deleted
await db.exec(lines('108_song_suggestions.sql', 519, 553)); // the author withdraws
await db.exec(lines('123_rehearsal_proposal_decline_expiry.sql', 95, 157)); // proposals lapse (Codex round 4)
await db.exec(readFileSync(MIG, 'utf8'));
await db.exec(readFileSync(MIG, 'utf8')); // idempotent
ok(true, 'migration runs twice');
// Statements whose failure is reported by the checks that follow (and that
// must not stop the run when the migration is missing).
const x = async (sql) => { try { await db.exec(sql); return {}; } catch (e) { return { error: e.message }; } };
const qq = async (sql) => { try { return await db.query(sql); } catch (e) { return { rows: [], error: e.message }; } };

// Storage release (the function runs it before any data is deleted).
const rel = async () => {
  try { return (await db.query(`SELECT public.bw_account_storage_release('${ADMIN1}') AS r`)).rows[0].r; }
  catch (e) { return { error: e.message }; }
};
let r = await rel();
ok(r.personal_left === 1, `reports the personal file still there (${JSON.stringify(r)})`);
ok(r.released === 2, `releases the two band files the person uploaded (${r.released})`);
const owners = (await qq(`SELECT bucket_id, name, owner FROM storage.objects ORDER BY name`)).rows;
ok(owners.filter((o) => o.bucket_id !== 'personal-files' && o.owner === ADMIN1).length === 0, 'no band file still owned by the account');
ok(owners.find((o) => o.name.endsWith('other.pdf')).owner === MEM, "another member's file untouched");
ok(owners.length === 4, 'no file deleted by the release');
await x(`DELETE FROM storage.objects WHERE bucket_id = 'personal-files'`); // what the function does via the Storage API
r = await rel();
ok(r.personal_left === 0, 'ready once the personal files are gone');
const grants = (await db.query(`SELECT has_function_privilege('authenticated', 'public.bw_account_storage_release(uuid)', 'EXECUTE') AS a,
  has_function_privilege('service_role', 'public.bw_account_storage_release(uuid)', 'EXECUTE') AS s`).catch(() => ({ rows: [{}] }))).rows[0];
ok(grants.a === false && grants.s === true, `server only (${JSON.stringify(grants)})`);

// ── Codex review #282 ──────────────────────────────────────────────────────
const q = async (sql) => { try { return { rows: (await db.query(sql)).rows }; } catch (e) { return { error: e.message }; } };
// Several statements, rolled back: only whether it errors.
const tryTx = async (sql) => { try { await db.exec(`BEGIN; ${sql}; ROLLBACK;`); return {}; } catch (e) { await db.exec('ROLLBACK').catch(() => {}); return { error: e.message }; } };
// The profile photo is personal: never released, and it holds the deletion.
await x(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('avatars', '${ADMIN1}/me.png', '${ADMIN1}', '${ADMIN1}')`);
r = await rel();
ok(r.personal_left === 1, `a profile photo still there holds the deletion (${JSON.stringify(r)})`);
const av = (await qq(`SELECT owner FROM storage.objects WHERE bucket_id = 'avatars'`)).rows[0];
ok(av?.owner === ADMIN1, 'and is not released (it must be removed, not left public)');
await x(`DELETE FROM storage.objects WHERE bucket_id = 'avatars'`);
ok((await rel()).personal_left === 0, 'ready once the photo is gone');

// The band check holds while personal files are removed.
let b = await q(`SELECT public.bw_account_deletion_begin('${ADMIN1}') AS r`);
ok(b.rows?.[0]?.r?.ok === true, `deletion can begin: another admin stays (${b.error ?? JSON.stringify(b.rows?.[0]?.r)})`);
ok(JSON.stringify(b.rows?.[0]?.r?.band_ids) === JSON.stringify([SOLO]), 'the solo band is noted for cleanup');
let d = await q(`UPDATE band_members SET role = 'member' WHERE band_id = '${BAND}' AND user_id = '${ADMIN2}'`);
ok(!!d.error, `the other admin can't step down meanwhile (${d.error ?? 'stepped down'})`);
d = await q(`DELETE FROM band_members WHERE band_id = '${BAND}' AND user_id = '${ADMIN2}'`);
ok(!!d.error, "nor be removed");
d = await q(`UPDATE band_members SET is_active = false WHERE band_id = '${BAND}' AND user_id = '${ADMIN2}'`);
ok(!!d.error, "nor leave");
await x(`UPDATE band_members SET role = 'admin' WHERE band_id = '${BAND}' AND user_id = '${MEM}'`);
d = await q(`UPDATE band_members SET role = 'member' WHERE band_id = '${BAND}' AND user_id = '${ADMIN2}'`);
ok(!d.error, `with a third admin, stepping down is fine (${d.error ?? 'ok'})`);
await x(`UPDATE band_members SET role = 'admin' WHERE band_id = '${BAND}' AND user_id = '${ADMIN2}';
  UPDATE band_members SET role = 'member' WHERE band_id = '${BAND}' AND user_id = '${MEM}'`);
await x(`UPDATE account_deletions_pending SET started_at = now() - interval '20 minutes'`);
d = await q(`UPDATE band_members SET role = 'admin' WHERE band_id = '${BAND}' AND user_id = '${ADMIN2}'`);
d = await tryTx(`UPDATE band_members SET role = 'member' WHERE band_id = '${BAND}' AND user_id = '${ADMIN2}'`);
ok(!d.error, `an old pending deletion no longer holds anyone (${d.error ?? 'ok'})`);
// A retry after the solo band is gone still knows it.
await x(`DELETE FROM bands WHERE id = '${SOLO}'`);
b = await q(`SELECT public.bw_account_deletion_begin('${ADMIN1}') AS r`);
ok(JSON.stringify(b.rows?.[0]?.r?.band_ids) === JSON.stringify([SOLO]), `a retry still cleans the band already deleted (${JSON.stringify(b.rows?.[0]?.r?.band_ids)})`);
// Blocked: the other admin left earlier and members remain.
await x(`DELETE FROM account_deletions_pending; UPDATE band_members SET role = 'member' WHERE band_id = '${BAND}' AND user_id = '${ADMIN2}'`);
b = await q(`SELECT public.bw_account_deletion_begin('${ADMIN1}') AS r`);
ok(b.rows?.[0]?.r?.ok === false && b.rows[0].r.bands?.[0] === 'Hudson Horns', `last admin with members: refused (${JSON.stringify(b.rows?.[0]?.r)})`);
ok((await qq(`SELECT count(*)::int AS n FROM account_deletions_pending`)).rows[0]?.n === 0, 'and nothing pending');
await x(`UPDATE band_members SET role = 'admin' WHERE band_id = '${BAND}' AND user_id = '${ADMIN2}'`);
b = await q(`SELECT public.bw_account_deletion_begin('${ADMIN1}') AS r`);
d = await tryTx(`DELETE FROM bands WHERE id = '${BAND}'`);
ok(!d.error, `deleting the whole band is never held (${d.error ?? 'ok'})`);
// A member leaves after the deletion began (before prepare): prepare deletes
// that band too, and notes it, so its files are cleaned.
await x(`DELETE FROM account_deletions_pending; INSERT INTO bands VALUES ('${DUO}', 'Duo');
  INSERT INTO band_members VALUES ('${DUO}','${ADMIN1}','member',true), ('${DUO}','${MEM}','admin',true)`);
b = await q(`SELECT public.bw_account_deletion_begin('${ADMIN1}') AS r`);
ok(b.rows?.[0]?.r?.ok === true, `begin with a duo band someone else runs (${b.error ?? JSON.stringify(b.rows?.[0]?.r)})`);
d = await q(`UPDATE band_members SET is_active = false WHERE band_id = '${DUO}' AND user_id = '${MEM}'`);
ok(!d.error, `before prepare, the other member can still leave (${d.error ?? 'ok'})`);
d = await q(`SELECT public.bw_prepare_account_deletion('${ADMIN1}')`);
const noted = (await qq(`SELECT band_ids FROM account_deletions_pending WHERE user_id = '${ADMIN1}'`)).rows[0]?.band_ids ?? [];
ok(!d.error && noted.includes(DUO), `prepare notes every band it deletes (${d.error ?? JSON.stringify(noted)})`);
ok((await qq(`SELECT count(*)::int AS n FROM bands WHERE id = '${BAND}'`)).rows[0].n === 1, 'the band that goes on stays');
const g2 = (await db.query(`SELECT has_function_privilege('authenticated', 'public.bw_account_deletion_begin(uuid)', 'EXECUTE') AS a,
  has_table_privilege('authenticated', 'public.account_deletions_pending', 'SELECT') AS t`).catch(() => ({ rows: [{}] }))).rows[0];
ok(g2.a === false && g2.t === false, `server only (${JSON.stringify(g2)})`);

// Deleting the poll creator's account (02 #8 / 04 #8).
let blocked = null;
try { await db.exec(`BEGIN; DELETE FROM auth.users WHERE id = '${ADMIN1}'; ROLLBACK;`); } catch (e) { blocked = e.message; await db.exec('ROLLBACK').catch(() => {}); }
ok(!blocked, `no Storage object blocks the deletion (${blocked ?? 'ok'})`);
// Whatever is still owned goes first (so the poll check below stands on its own).
await x(`DELETE FROM storage.objects WHERE owner = '${ADMIN1}'; DELETE FROM auth.users WHERE id = '${ADMIN1}'`);
const poll = (await qq(`SELECT created_by FROM rehearsal_polls WHERE id = '${POLL}'`)).rows;
ok(poll.length === 1 && poll[0].created_by === null, `the band's poll stays, without author (${JSON.stringify(poll)})`);
// Round 3 (MINOR): its vote-by deadline stays in the creator's time zone,
// not the UTC-12 fallback (a closed New York poll would reopen).
const dl = (await qq(`SELECT public.bw_poll_vote_deadline('${POLL}') = timestamptz '2026-11-20 23:00:00+00' AS same, public.bw_poll_vote_deadline('${POLL}')::text AS at`)).rows[0];
ok(dl?.same === true, `the poll's vote deadline keeps the creator's time zone (${JSON.stringify(dl)})`);
const votes = (await qq(`SELECT user_id FROM rehearsal_poll_votes`)).rows.map((v) => v.user_id).sort();
ok(votes.length === 2 && votes.includes(ADMIN2) && votes.includes(MEM), `the others' votes stay (${votes.length})`);

// ── Codex review #282, round 2 ─────────────────────────────────────────────
// Everything that can refuse is decided before anything is erased: once a
// deletion has begun, no band change may make prepare (or Auth) refuse.
const begin = async (u) => (await q(`SELECT public.bw_account_deletion_begin('${u}') AS r`)).rows?.[0]?.r ?? null;
const prepare = async (u) => q(`SELECT public.bw_prepare_account_deletion('${u}')`);
const [A, B, C, M] = [5, 6, 7, 8].map(id);
const [T1, T2, T3, T4] = [31, 32, 33, 34].map(id);
await x(`INSERT INTO auth.users VALUES ('${A}'), ('${B}'), ('${C}'), ('${M}');
  INSERT INTO profiles VALUES ('${A}'), ('${B}'), ('${C}'), ('${M}');
  INSERT INTO bands VALUES ('${T1}', 'Two admins'), ('${T2}', 'Brass trio'), ('${T3}', 'Solo set'), ('${T4}', 'Big band')`);
const reset = () => x(`DELETE FROM account_deletions_pending`);

// B1: two admins, nobody else. A begins, B is demoted: B stays an active
// member, so A would be the last admin of a band with members.
await reset();
await x(`INSERT INTO band_members VALUES ('${T1}','${A}','admin',true), ('${T1}','${B}','admin',true)`);
ok((await begin(A))?.ok === true, 'B1: A can begin (B is admin)');
d = await q(`UPDATE band_members SET role = 'member' WHERE band_id = '${T1}' AND user_id = '${B}'`);
ok(!!d.error, `B1: the co-admin can't be demoted while A's deletion is pending (${d.error ?? 'demoted'})`);
await x(`UPDATE band_members SET role = 'admin' WHERE band_id = '${T1}' AND user_id = '${B}'`);
// B1 (second half): after prepare the band is no longer A's to delete. If B
// left now, the band would be left with nobody and its files public.
d = await prepare(A);
ok(!d.error, `B1: prepare goes through (${d.error ?? 'ok'})`);
d = await q(`UPDATE band_members SET is_active = false WHERE band_id = '${T1}' AND user_id = '${B}'`);
ok(!!d.error, `B1: after prepare, the last other member can't leave (${d.error ?? 'left'})`);
d = await q(`DELETE FROM band_members WHERE band_id = '${T1}' AND user_id = '${B}'`);
ok(!!d.error, `B1: nor be removed (${d.error ?? 'removed'})`);
await reset();
await x(`DELETE FROM band_members WHERE band_id = '${T1}'`);

// B2: two admins and a member. Both admins ask to delete: the second must be
// refused before any of their files go (each counted the other as staying).
await reset();
await x(`INSERT INTO band_members VALUES ('${T2}','${A}','admin',true), ('${T2}','${B}','admin',true), ('${T2}','${M}','member',true)`);
ok((await begin(A))?.ok === true, 'B2: the first admin can begin');
let rb = await begin(B);
// Round 4: the first admin is mid-deletion, so the second waits
// (deletion_in_progress), rather than being told to name another admin.
ok(rb?.ok === false && rb.code === 'deletion_in_progress', `B2: the second admin waits: the first is leaving (${JSON.stringify(rb)})`);
ok((await q(`SELECT 1 FROM account_deletions_pending WHERE user_id = '${B}'`)).rows?.length === 0, 'B2: and nothing pending for them');
// Once the first admin's account is gone, it is a plain last admin.
await reset();
await x(`DELETE FROM band_members WHERE band_id = '${T2}' AND user_id = '${A}'`);
rb = await begin(B);
ok(rb?.ok === false && (rb.bands ?? []).includes('Brass trio'), `B2: then the second admin is the last admin (${JSON.stringify(rb)})`);
await reset();
await x(`DELETE FROM band_members WHERE band_id = '${T2}'`);

// B3: a solo band. While its admin's files go, someone accepts an old invite.
await reset();
await x(`INSERT INTO band_members VALUES ('${T3}','${A}','admin',true)`);
rb = await begin(A);
ok(rb?.ok === true && (rb.band_ids ?? []).includes(T3), `B3: the solo band is noted (${JSON.stringify(rb)})`);
d = await q(`INSERT INTO band_members VALUES ('${T3}','${M}','member',true)`);
ok(!!d.error, `B3: nobody can join the band being deleted (${d.error ?? 'joined'})`);
await x(`DELETE FROM band_members WHERE band_id = '${T3}' AND user_id = '${M}'`);
await x(`INSERT INTO band_members VALUES ('${T3}','${C}','member',false)`); // an old, inactive membership
d = await q(`UPDATE band_members SET is_active = true WHERE band_id = '${T3}' AND user_id = '${C}'`);
ok(!!d.error, `B3: nor come back (${d.error ?? 'reactivated'})`);
d = await prepare(A);
ok(!d.error, `B3: prepare still goes through (${d.error ?? 'ok'})`);
await reset();

// B4: three admins and a member, A deleting. Two co-admins stepping down at
// the same time each saw the other still admin. The guard now takes advisory
// locks (begin: the deletion lock; a change in a band with a pending
// deletion: that band's lock), so the second one waits and then sees the
// first. PGlite has one connection, so the locks themselves are what is
// checked; sequentially the second one is refused.
await x(`INSERT INTO band_members VALUES ('${T4}','${A}','admin',true), ('${T4}','${B}','admin',true),
  ('${T4}','${C}','admin',true), ('${T4}','${M}','member',true)`);
const advisory = `(SELECT count(*)::int FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid())`;
let lk = await q(`SELECT 1`);
try {
  await db.exec('BEGIN');
  lk = await q(`SELECT (public.bw_account_deletion_begin('${A}')->>'ok')::boolean AS ok, ${advisory} AS n`);
  await db.exec('COMMIT');
} catch (e) { await db.exec('ROLLBACK'); lk = { error: e.message }; }
ok(lk.rows?.[0]?.ok === true && lk.rows[0].n > 0, `B4: begin holds the deletion lock (${lk.error ?? JSON.stringify(lk.rows?.[0])})`);
try {
  await db.exec('BEGIN');
  await db.exec(`UPDATE band_members SET role = 'member' WHERE band_id = '${T4}' AND user_id = '${B}'`);
  lk = await q(`SELECT ${advisory} AS n`);
  await db.exec('ROLLBACK');
} catch (e) { await db.exec('ROLLBACK'); lk = { error: e.message }; }
ok(lk.rows?.[0]?.n > 0, `B4: a step-down there holds the band's lock until it commits (${lk.error ?? JSON.stringify(lk.rows?.[0])})`);
ok(!(await q(`UPDATE band_members SET role = 'member' WHERE band_id = '${T4}' AND user_id = '${B}'`)).error, 'B4: one co-admin can step down');
ok(!!(await q(`UPDATE band_members SET role = 'member' WHERE band_id = '${T4}' AND user_id = '${C}'`)).error, 'B4: then not the other');
await reset();
await x(`DELETE FROM band_members WHERE band_id = '${T4}'`);

// ── Owner decision 11-22: band chat history stays, as a former member ──────
const [F, G] = [40, 41].map(id);
const FB = id(42), BC = id(43), EC = id(44), DM = id(45), S1 = id(46), SG1 = id(47), SG2 = id(48);
const S2 = id(60), S3 = id(61), SG3 = id(62), SG4 = id(63), M8 = id(58), M9 = id(59);
const [M1, M2, M3, M4, M5, M6, M7] = [51, 52, 53, 54, 55, 56, 57].map(id);
const setupFM = await x(`INSERT INTO auth.users VALUES ('${F}'), ('${G}'); INSERT INTO profiles VALUES ('${F}'), ('${G}');
  INSERT INTO bands VALUES ('${FB}', 'Hoboken Hot Club');
  INSERT INTO band_members VALUES ('${FB}','${G}','admin',true), ('${FB}','${F}','member',true);
  INSERT INTO chats VALUES ('${BC}','band','${FB}','${G}'), ('${EC}','event','${FB}','${G}'), ('${DM}','direct',NULL,'${F}');
  INSERT INTO chat_participants VALUES ('${BC}','${F}'),('${BC}','${G}'),('${EC}','${F}'),('${EC}','${G}'),('${DM}','${F}'),('${DM}','${G}');
  INSERT INTO messages (id, chat_id, sender_id, content, metadata, deleted, reply_to_id) VALUES
    ('${M1}','${BC}','${F}','See you at 8', '{"client":"ios","mentions":["${G}"]}', false, NULL),
    ('${M2}','${BC}','${G}','@Fran bring the cables', '{"mentions":["${F}"],"mentioned":{"id":"${F}","name":"Fran"},"client":"web"}', false, '${M1}'),
    ('${M3}','${EC}','${F}','Running late', '{"by":"${F}"}', false, NULL),
    ('${M4}','${DM}','${F}','just between us', '{}', false, NULL),
    ('${M5}','${DM}','${G}','ok', '{}', false, NULL),
    ('${M6}','${BC}','${F}','oops', '{}', true, NULL);
  INSERT INTO songs VALUES ('${S1}','${FB}','Minor Swing','active'), ('${S2}','${FB}','Nuages','suggested'), ('${S3}','${FB}','Djangology','suggested');
  INSERT INTO song_suggestions VALUES ('${SG1}','${FB}','${S1}','accepted','${F}','${G}','lyrics'), ('${SG2}','${FB}','${S1}','pending','${F}',NULL,'note'),
    ('${SG3}','${FB}','${S2}','pending','${F}',NULL,'new_song'), ('${SG4}','${FB}','${S3}','pending','${F}',NULL,'new_song');
  UPDATE chat_participants SET last_read_at = '2000-01-01', last_delivered_at = '2000-01-01' WHERE user_id = '${G}'`);
ok(!setupFM.error, `former member: setup (${setupFM.error ?? 'ok'})`);
await reset();
ok((await begin(F))?.ok === true, 'former member: deletion can begin');
d = await prepare(F);
ok(!d.error, `former member: prepare goes through (${d.error ?? 'ok'})`);
// Round 3 B2: after prepare, the person can't send anything (another
// device): a direct message would outlive the deletion with no sender.
d = await x(`INSERT INTO messages (id, chat_id, sender_id, content) VALUES ('${M8}','${DM}','${F}','sent from the iPad')`);
ok(!!d.error, `after prepare, a new message from them is refused (${d.error ?? 'sent'})`);
// One that got in anyway (it started before prepare committed): the last
// step before Auth goes over their messages again.
const slipIn = async (m, chat, text) => x(`UPDATE account_deletions_pending SET prepared_at = NULL WHERE user_id = '${F}';
  INSERT INTO messages (id, chat_id, sender_id, content) VALUES ('${m}','${chat}','${F}','${text}');
  UPDATE account_deletions_pending SET prepared_at = now() WHERE user_id = '${F}'`);
await slipIn(M8, DM, 'sent from the iPad');
await slipIn(M7, BC, 'one more');
d = await q(`SELECT public.bw_account_deletion_finish('${F}')`);
ok(!d.error, `the last step runs (${d.error ?? 'ok'})`);
ok((await qq(`SELECT 1 FROM messages WHERE id = '${M8}'`)).rows.length === 0, 'a direct message that slipped in after prepare is deleted');
// And one in the second between that step and Auth: Auth still goes through.
await slipIn(M9, BC, 'last word');
d = await x(`DELETE FROM auth.users WHERE id = '${F}'`);
ok(!d.error, `former member: Auth can delete the account (${d.error ?? 'ok'})`);
const msg = async (m) => (await qq(`SELECT sender_id, content, metadata FROM messages WHERE id = '${m}'`)).rows[0] ?? null;
let m1 = await msg(M1), m3 = await msg(M3), m7 = await msg(M7), m9 = await msg(M9);
ok(m1?.content === 'See you at 8' && m1.sender_id === null, `the band chat message stays, without author (${JSON.stringify(m1)})`);
ok(m3?.content === 'Running late' && m3.sender_id === null && !JSON.stringify(m3.metadata).includes(F), `the event chat message stays, author and metadata gone (${JSON.stringify(m3)})`);
ok(m7?.sender_id === null && m9?.sender_id === null, `band messages that slipped in stay anonymous and don't stop Auth (${JSON.stringify([m7, m9])})`);
ok(JSON.stringify(m1?.metadata) === JSON.stringify({ client: 'ios', mentions: [G] }), `other people in its metadata stay (${JSON.stringify(m1?.metadata)})`);
const m2 = await msg(M2);
ok(m2 && !JSON.stringify(m2.metadata).includes(F) && m2.metadata.client === 'web' && Array.isArray(m2.metadata.mentions),
  `mentions of the person are stripped from other messages (${JSON.stringify(m2?.metadata)})`);
ok((await msg(M6)) === null, 'a message they had deleted goes for good');
ok((await msg(M4)) === null, 'their direct messages go');
ok((await msg(M5))?.content === 'ok', "the other person's direct messages stay");
const sg = (await qq(`SELECT id, created_by FROM song_suggestions ORDER BY id`)).rows;
ok(sg.length === 4 && sg.every((r) => r.created_by === null), `their song suggestions stay with the band, without author (${JSON.stringify(sg)})`);
const fkn = (await qq(`SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'public.song_suggestions'::regclass AND contype = 'f'
  AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.song_suggestions'::regclass AND attname = 'created_by')]`)).rows;
ok(fkn.length === 1 && fkn[0].conname === 'song_suggestions_created_by_fkey' && fkn[0].confdeltype === 'n',
  `same FK name (older builds embed author via it), now SET NULL (${JSON.stringify(fkn)})`);
d = await q(`UPDATE messages SET sender_id = NULL WHERE id = '${M5}'`);
ok(!!d.error, `nobody else can make a message anonymous (${d.error ?? 'nulled'})`);

// ── Codex review #282, round 3 ─────────────────────────────────────────────
// B1: an author check against NULL is NULL, so "not yours" was skipped.
const as = async (u, sql) => { await x(`SELECT set_config('test.uid', '${u ?? ''}', false)`); const r = await q(sql); await x(`SELECT set_config('test.uid', '', false)`); return r; };
const withdraw = await as(M, `SELECT public.bw_withdraw_song_suggestion('${SG3}') AS r`);
ok(!!withdraw.error, `B1: nobody can withdraw a former member's suggestion (${withdraw.error ?? JSON.stringify(withdraw.rows)})`);
ok((await qq(`SELECT 1 FROM songs WHERE id = '${S2}'`)).rows.length === 1, "B1: and the suggested song isn't deleted");
// An admin deleting a former member's suggested song rejects it (the author
// check skipped the row, so it ended up "withdrawn").
await x(`SELECT set_config('test.uid', '${G}', false); DELETE FROM songs WHERE id = '${S3}'; SELECT set_config('test.uid', '', false)`);
const sg4 = (await qq(`SELECT status FROM song_suggestions WHERE id = '${SG4}'`)).rows[0];
ok(sg4?.status === 'rejected', `B1: an admin deleting the song rejects the suggestion (${JSON.stringify(sg4)})`);
await x(`SELECT set_config('test.uid', '', false)`);
// MINOR: a former member's message is unread for the others, and opening
// the chat marks it read (sender_id <> me was NULL, so it never counted).
await x(`SELECT set_config('test.uid', '${G}', false)`);
const read = await q(`SELECT public.bw_mark_chat_read('${BC}') AS r`);
const delivered = await q(`SELECT public.bw_mark_chats_delivered() AS r`);
await x(`SELECT set_config('test.uid', '', false)`);
ok(read.rows?.[0]?.r === true, `opening the chat marks a former member's message read (${read.error ?? JSON.stringify(read.rows)})`);
ok(delivered.rows?.[0]?.r > 0, `and delivered (${delivered.error ?? JSON.stringify(delivered.rows)})`);
await x(`UPDATE chat_participants SET last_delivered_at = '2000-01-01' WHERE user_id = '${G}' AND chat_id = '${EC}'`);
const pushed = await q(`SELECT public.bw_mark_chat_delivered_by_push('${EC}', ARRAY['${G}']::uuid[]) AS r`);
ok(pushed.rows?.[0]?.r === 1, `delivered by push too (${pushed.error ?? JSON.stringify(pushed.rows)})`);

// B4: prepare takes the guard's locks (deletion lock shared, then the
// bands' locks), so a co-admin leaving at the same time is ordered with it.
const [T5, U1, U2] = [35, 36, 37].map(id);
await x(`INSERT INTO auth.users VALUES ('${U1}'), ('${U2}'); INSERT INTO profiles VALUES ('${U1}'), ('${U2}');
  INSERT INTO bands VALUES ('${T5}', 'Last two'); INSERT INTO band_members VALUES ('${T5}','${U1}','admin',true), ('${T5}','${U2}','admin',true)`);
await reset();
ok((await begin(U1))?.ok === true, 'B4: deletion can begin');
try {
  await db.exec('BEGIN');
  await db.exec(`SELECT public.bw_prepare_account_deletion('${U1}')`);
  lk = await q(`SELECT count(*) FILTER (WHERE mode = 'ShareLock')::int AS shared, count(*) FILTER (WHERE mode = 'ExclusiveLock')::int AS band
    FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`);
  await db.exec('ROLLBACK');
} catch (e) { await db.exec('ROLLBACK').catch(() => {}); lk = { error: e.message }; }
ok(lk.rows?.[0]?.shared >= 1 && lk.rows[0].band >= 1, `B4: prepare holds the deletion lock and the band's lock (${lk.error ?? JSON.stringify(lk.rows?.[0])})`);
await reset();

// Codex r3 B4, the other order: the co-admin's leave commits first, then
// prepare (it waited on the band's locks) sees the band alone, deletes it
// and notes it, so its files are cleaned.
const [T7, U3, U4] = [39, 69, 70].map(id);
await x(`INSERT INTO auth.users VALUES ('${U3}'), ('${U4}'); INSERT INTO profiles VALUES ('${U3}'), ('${U4}');
  INSERT INTO bands VALUES ('${T7}', 'Last two, again'); INSERT INTO band_members VALUES ('${T7}','${U3}','admin',true), ('${T7}','${U4}','admin',true)`);
await reset();
ok((await begin(U3))?.ok === true, 'B4: deletion can begin (second band)');
d = await q(`UPDATE band_members SET is_active = false WHERE band_id = '${T7}' AND user_id = '${U4}'`);
ok(!d.error, `B4: before prepare the co-admin can still leave (${d.error ?? 'ok'})`);
d = await prepare(U3);
const t7 = (await qq(`SELECT (SELECT count(*)::int FROM bands WHERE id = '${T7}') AS left, band_ids FROM account_deletions_pending WHERE user_id = '${U3}'`)).rows[0];
ok(!d.error && t7?.left === 0 && (t7.band_ids ?? []).includes(T7), `B4: then prepare deletes the band and notes it for its files (${d.error ?? JSON.stringify(t7)})`);
await reset();

// ── Claude review #282, round 4 ────────────────────────────────────────────
// Prepare ran, then the attempt failed (Auth down). Part of the account is
// already gone. Hours later the hold must still be there, and the retry must
// finish the job.
const [T6, H, K, N] = [38, 64, 65, 66].map(id);
const HC = id(67), HM = id(68);
await x(`INSERT INTO auth.users VALUES ('${H}'), ('${K}'), ('${N}'); INSERT INTO profiles VALUES ('${H}'), ('${K}'), ('${N}');
  INSERT INTO bands VALUES ('${T6}', 'Night shift');
  INSERT INTO band_members VALUES ('${T6}','${H}','admin',true), ('${T6}','${K}','admin',true), ('${T6}','${N}','member',true);
  INSERT INTO chats VALUES ('${HC}', 'band', '${T6}', '${K}')`);
await reset();
ok((await begin(H))?.ok === true, 'round 4: deletion can begin');
d = await prepare(H);
ok(!d.error, `round 4: prepare goes through (${d.error ?? 'ok'})`);
// The attempt stops here. 20 minutes later:
await x(`UPDATE account_deletions_pending SET started_at = now() - interval '20 minutes', prepared_at = now() - interval '20 minutes' WHERE user_id = '${H}'`);
d = await q(`UPDATE band_members SET role = 'member' WHERE band_id = '${T6}' AND user_id = '${K}'`);
ok(!!d.error, `round 4: after prepare the hold doesn't lapse: the co-admin still can't step down (${d.error ?? 'stepped down'})`);
await x(`UPDATE band_members SET role = 'admin' WHERE band_id = '${T6}' AND user_id = '${K}'`);
d = await x(`INSERT INTO messages (id, chat_id, sender_id, content) VALUES ('${HM}','${HC}','${H}','still here?')`);
ok(!!d.error, `round 4: nor does the message refusal (${d.error ?? 'sent'})`);
await x(`DELETE FROM messages WHERE id = '${HM}'`);
// The retry: begin answers prepared and skips the band checks, prepare skips
// them too, and the account goes.
rb = await begin(H);
ok(rb?.ok === true && rb.prepared === true, `round 4: the retry begins as prepared (${JSON.stringify(rb)})`);
d = await prepare(H);
ok(!d.error, `round 4: prepare runs again (${d.error ?? 'ok'})`);
d = await q(`SELECT public.bw_account_deletion_finish('${H}')`);
ok(!d.error, `round 4: the last step runs (${d.error ?? 'ok'})`);
d = await x(`DELETE FROM auth.users WHERE id = '${H}'`);
ok(!d.error, `round 4: and the account goes (${d.error ?? 'ok'})`);
const t6 = (await qq(`SELECT user_id, role FROM band_members WHERE band_id = '${T6}' ORDER BY user_id`)).rows;
ok(JSON.stringify(t6) === JSON.stringify([{ user_id: K, role: 'admin' }, { user_id: N, role: 'member' }]), `round 4: the band goes on with its admin (${JSON.stringify(t6)})`);
// A pending deletion that never reached prepare still lapses after 15 minutes.
await reset();
await x(`INSERT INTO band_members VALUES ('${T6}','${H}','member',true)`).catch(() => {});
await x(`INSERT INTO account_deletions_pending (user_id, started_at) VALUES ('${K}', now() - interval '20 minutes')`);
d = await q(`UPDATE band_members SET role = 'member' WHERE band_id = '${T6}' AND user_id = '${K}'`);
ok(!d.error, `round 4: an unprepared pending deletion still lapses (${d.error ?? 'ok'})`);
await reset();

// ── Codex review #282, round 4 ─────────────────────────────────────────────
const [T8, R, G2, G3] = [71, 72, 73, 74].map(id);
const [RB, RD, RM1, RM2, RM3, SG6, RP1, RP2, RP3] = [75, 76, 77, 78, 79, 80, 81, 82, 83].map(id);
const [N1, N2, N3, N4, N5, N6, N7, N8, N9] = [91, 92, 93, 94, 95, 96, 97, 98, 99].map(id);
const setupR = await x(`INSERT INTO auth.users VALUES ('${R}'), ('${G2}'), ('${G3}');
  INSERT INTO profiles (id, full_name, email, preferred_language, timezone) VALUES
    ('${R}', 'Rosa Diaz', 'rosa@example.com', 'en', 'America/New_York'),
    ('${G2}', 'Gina Torres', 'gina@example.com', 'it', NULL), ('${G3}', 'Sam Lee', 'sam@example.com', 'en', NULL);
  INSERT INTO bands VALUES ('${T8}', 'Brooklyn Brass');
  INSERT INTO band_members VALUES ('${T8}','${R}','admin',true), ('${T8}','${G2}','admin',true), ('${T8}','${G3}','member',true);
  INSERT INTO chats VALUES ('${RB}', 'band', '${T8}', '${G2}'), ('${RD}', 'direct', NULL, '${R}');
  INSERT INTO chat_participants (chat_id, user_id) VALUES ('${RB}','${R}'), ('${RB}','${G2}'), ('${RB}','${G3}'), ('${RD}','${R}'), ('${RD}','${G2}');
  INSERT INTO messages (id, chat_id, sender_id, content) VALUES ('${RM1}','${RB}','${R}','Doors at 7'), ('${RM2}','${RB}','${G2}','ok');
  INSERT INTO song_suggestions (id, band_id, status, created_by, reviewed_by, kind) VALUES ('${SG6}', '${T8}', 'accepted', '${G2}', '${R}', 'note');
  INSERT INTO notifications (id, user_id, type, title, body, data) VALUES
    ('${N1}', '${G2}', 'chat_message', 'Rosa Diaz', 'Doors at 7', '{"senderName":"Rosa Diaz","chat_id":"${RB}","content":"Doors at 7"}'),
    ('${N2}', '${G3}', 'chat_mention', 'Rosa Diaz mentioned you', '@Sam Lee bring the stand', '{"senderName":"Rosa Diaz","title":"Rosa Diaz mentioned you","chat_id":"${RB}"}'),
    ('${N3}', '${G2}', 'chat_message', 'Rosa Diaz', 'just between us', '{"senderName":"Rosa Diaz","chat_id":"${RD}"}'),
    ('${N4}', '${R}', 'chat_message', 'Gina Torres', 'sure', '{"senderName":"Gina Torres","chat_id":"${RD}"}'),
    ('${N5}', '${G2}', 'song_suggestion', 'Song suggested · Moanin', 'Rosa Diaz suggests adding it to the repertoire.', '{"by":"${R}","tag":"song-suggestion-${R}","suggestion_id":"${SG6}"}'),
    ('${N6}', '${G3}', 'chat_message', 'Gina Torres', 'ok', '{"senderName":"Gina Torres","chat_id":"${RB}"}'),
    ('${N7}', '${G3}', 'chat_message', 'Rosa Diaz', 'Doors at 7', '{"sender_name":"Rosa Diaz","message_id":"${RM1}","chat_id":"${RB}"}'),
    ('${N8}', '${G3}', 'event_update', 'Lineup changed: Friday', 'Rosa Diaz took you off the lineup of Friday.', '{"kind":"lineup_removed","removed_by":"${R}"}'),
    ('${N9}', '${G2}', 'song_suggestion_reviewed', 'Suggestion accepted · Moanin', 'Rosa Diaz accepted your suggestion.', '{"suggestion_id":"${SG6}"}');
  INSERT INTO rehearsal_polls (id, band_id, created_by, title, invited_user_ids) VALUES
    ('${RP1}', '${T8}', '${R}', 'Room split', ARRAY['${R}','${G2}','${G3}']::uuid[]),
    ('${RP2}', '${T8}', '${G2}', 'Just Rosa', ARRAY['${R}']::uuid[]);
  INSERT INTO rehearsal_polls (id, band_id, created_by, title, status, notes, created_at) VALUES
    ('${RP3}', '${T8}', '${R}', 'Proposal', 'proposed', '[Preferred Days: Tue]', '2026-11-16 15:00+00');
  GRANT USAGE ON SCHEMA storage, auth, public TO authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE POLICY t_any ON storage.objects FOR ALL TO authenticated USING (true) WITH CHECK (true)`);
ok(!setupR.error, `round 4: setup (${setupR.error ?? 'ok'})`);
const upload = async (u, path) => {
  await x(`SELECT set_config('test.uid', '${u}', false)`);
  const r = await x(`SET ROLE authenticated; INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('personal-files', '${path}', '${u}', '${u}')`);
  await x(`RESET ROLE; SELECT set_config('test.uid', '', false)`);
  return r;
};
await reset();
ok((await begin(R))?.ok === true, 'round 4: deletion can begin');
// B3: from begin on, the person can't upload (another device).
d = await upload(R, `${R}/late-take.m4a`);
ok(!!d.error, `B3: no upload while their deletion holds (${d.error ?? 'uploaded'})`);
d = await upload(G2, `${G2}/take.m4a`);
ok(!d.error, `B3: the others still can (${d.error ?? 'ok'})`);
await x(`DELETE FROM storage.objects WHERE name = '${G2}/take.m4a'`);

d = await prepare(R);
ok(!d.error, `round 4: prepare goes through (${d.error ?? 'ok'})`);
const note = async (n) => (await qq(`SELECT title, body, data FROM notifications WHERE id = '${n}'`)).rows[0] ?? null;
// B2 (owner's rule): direct chat notifications go, on both sides.
ok(!(await note(N3)) && !(await note(N4)), 'B2: notifications about their direct chat go, on both sides');
let n1 = await note(N1);
ok(n1?.title === 'Ex membro' && n1.data.senderName === 'Ex membro' && n1.body === 'Doors at 7',
  `B2: a band chat notification shows a former member, in the recipient's language, text kept (${JSON.stringify(n1)})`);
let n2 = await note(N2);
ok(n2?.title === 'Former member mentioned you' && n2.data.title === 'Former member mentioned you', `B2: and a mention (${JSON.stringify(n2)})`);
let n7 = await note(N7);
ok(n7?.title === 'Former member' && n7.data.sender_name === 'Former member', `B2: found by its message too (${JSON.stringify(n7)})`);
let n6 = await note(N6);
ok(n6?.title === 'Gina Torres' && n6.data.senderName === 'Gina Torres', `B2: other senders' notifications stay (${JSON.stringify(n6)})`);
let n5 = await note(N5);
ok(n5 && !('by' in n5.data) && !String(n5.data.tag).includes(R) && n5.body === 'Ex membro suggests adding it to the repertoire.',
  `B2: a song suggestion notification loses author id and name (${JSON.stringify(n5)})`);
let n9 = await note(N9);
ok(n9?.body === 'Ex membro accepted your suggestion.', `B2: and a review they made (${JSON.stringify(n9)})`);
let n8 = await note(N8);
ok(n8 && !JSON.stringify(n8.data).includes(R), `B2: their id goes from other notifications (${JSON.stringify(n8)})`);
// Minor: a poll's invitees no longer count them (cost split), but never the last one.
const inv = (await qq(`SELECT id, invited_user_ids FROM rehearsal_polls WHERE id IN ('${RP1}','${RP2}') ORDER BY id`)).rows;
ok(JSON.stringify(inv.map((r) => r.invited_user_ids)) === JSON.stringify([[G2, G3], [R]]), `minor: out of the invitees, unless the last (${JSON.stringify(inv)})`);
// Claude round 4: the hold's error is readable for older builds, code in the hint.
let held = {};
try { await db.query(`UPDATE band_members SET role = 'member' WHERE band_id = '${T8}' AND user_id = '${G2}'`); } catch (e) { held = { message: e.message, hint: e.hint }; }
ok(held.message === 'A bandmate is deleting their account. Try again in a few minutes.' && held.hint === 'account_deletion_in_progress',
  `the hold's error reads as English, the code is the hint (${JSON.stringify(held)})`);
// B1: a direct message that got in between prepare's steps and was made
// anonymous by them: the last step deletes it by chat.
await x(`UPDATE account_deletions_pending SET prepared_at = NULL WHERE user_id = '${R}';
  INSERT INTO messages (id, chat_id, sender_id, content) VALUES ('${RM3}','${RD}','${R}','from the iPad');
  UPDATE account_deletions_pending SET prepared_at = now() WHERE user_id = '${R}';
  SELECT set_config('bw.account_deletion_uid', '${R}', false);
  UPDATE messages SET sender_id = NULL WHERE id = '${RM3}';
  SELECT set_config('bw.account_deletion_uid', '', false)`);
ok((await qq(`SELECT sender_id FROM messages WHERE id = '${RM3}'`)).rows[0]?.sender_id === null, 'B1: (the slipped direct message is anonymous)');
const defs = (await qq(`SELECT pg_get_functiondef('public.bw_trg_messages_deleting_sender'::regproc) AS t,
  pg_get_functiondef('public.bw_account_deletion_messages'::regproc) AS m`)).rows[0] ?? {};
ok(/FOR SHARE/.test(defs.t ?? '') && (defs.m ?? '').indexOf('UPDATE public.account_deletions_pending') > 0
   && (defs.m ?? '').indexOf('UPDATE public.account_deletions_pending') < (defs.m ?? '').indexOf('DELETE FROM public.messages'),
  'B1: a message being sent waits for prepare (FOR SHARE), and prepare blocks before it deletes');
// B3: a file that got in before the block stops the last step until it is gone.
await x(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('personal-files', '${R}/before-block.m4a', '${R}', '${R}'),
  ('song-files', '${T8}/late-chart.pdf', '${R}', '${R}')`);
d = await q(`SELECT public.bw_account_deletion_finish('${R}')`);
ok(!!d.error && /storage_not_ready/.test(d.error), `B3: the last step stops while a personal file is there (${d.error ?? 'ok'})`);
await x(`DELETE FROM storage.objects WHERE name = '${R}/before-block.m4a'`); // the function, through the Storage API
d = await q(`SELECT public.bw_account_deletion_finish('${R}')`);
ok(!d.error, `B3: then it runs (${d.error ?? 'ok'})`);
ok((await qq(`SELECT owner FROM storage.objects WHERE name = '${T8}/late-chart.pdf'`)).rows[0]?.owner === null, 'B3: a band file they uploaded late stays with the band, released');
ok((await qq(`SELECT 1 FROM messages WHERE id = '${RM3}'`)).rows.length === 0, 'B1: the anonymous direct message is deleted by chat');
ok((await qq(`SELECT 1 FROM messages WHERE id = '${RM1}'`)).rows.length === 1, 'B1: the band message stays');
d = await x(`DELETE FROM auth.users WHERE id = '${R}'`);
ok(!d.error, `round 4: Auth can delete the account (${d.error ?? 'ok'})`);
// Minor: the expiry job reads the poll's copy of the creator's time zone.
// (RP4: a creator already gone, whatever happened above.)
const RP4 = id(84);
await x(`INSERT INTO rehearsal_polls (id, band_id, created_by, title, status, notes, created_at, creator_timezone) VALUES
  ('${RP4}', '${T8}', NULL, 'Proposal', 'proposed', '[Preferred Days: Tue]', '2026-11-16 15:00+00', 'America/New_York')`);
d = await q(`SELECT public.bw_expire_rehearsal_proposals() AS n`);
const rp4 = (await qq(`SELECT status FROM rehearsal_polls WHERE id = '${RP4}'`)).rows[0];
ok(!d.error && rp4?.status === 'expired', `minor: a proposal without creator lapses in the creator's time zone (${d.error ?? JSON.stringify(rp4)})`);
const rp3 = (await qq(`SELECT status, created_by, creator_timezone FROM rehearsal_polls WHERE id = '${RP3}'`)).rows[0];
ok(!d.error && rp3?.status === 'expired', `minor: a deleted creator's Monday proposal for Tuesday lapses in their time zone (${d.error ?? JSON.stringify(rp3)})`);
await reset();

// Cross-PR (#281's 175): read and delivery receipts refuse a stale
// participant row when 175's bw_chat_scope_ok_for exists, and work without it.
const [RM4, RM5] = [85, 86].map(id);
await x(`INSERT INTO messages (id, chat_id, sender_id, content) VALUES ('${RM4}','${RB}','${G2}','soundcheck at 6')`);
let rr = await as(G3, `SELECT public.bw_mark_chat_read('${RB}') AS r`);
ok(rr.rows?.[0]?.r === true, `receipts without 175: a participant marks the chat read (${rr.error ?? JSON.stringify(rr.rows)})`);
// 175's helper, as a stand-in: the rule refuses the rows listed in test_stale.
await x(`CREATE TABLE test_stale (chat_id uuid, user_id uuid);
  CREATE FUNCTION public.bw_chat_scope_ok_for(p_chat_id uuid, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $f$ SELECT NOT EXISTS (SELECT 1 FROM test_stale s WHERE s.chat_id = p_chat_id AND s.user_id = p_user_id) $f$;
  INSERT INTO test_stale VALUES ('${RB}', '${G3}');
  INSERT INTO messages (id, chat_id, sender_id, content, created_at) VALUES ('${RM5}','${RB}','${G2}','bring the mutes', now() + interval '1 minute')`);
rr = await as(G3, `SELECT public.bw_mark_chat_read('${RB}') AS r`);
ok(rr.rows?.[0]?.r === false, `with 175: a stale participant row doesn't mark read or say there's news (${rr.error ?? JSON.stringify(rr.rows)})`);
rr = await as(G3, `SELECT public.bw_mark_chats_delivered() AS r`);
ok(rr.rows?.[0]?.r === 0, `with 175: nor delivered (${rr.error ?? JSON.stringify(rr.rows)})`);
await x(`DELETE FROM test_stale`);
rr = await as(G3, `SELECT public.bw_mark_chat_read('${RB}') AS r`);
ok(rr.rows?.[0]?.r === true, `with 175: a participant the rule allows still does (${rr.error ?? JSON.stringify(rr.rows)})`);
await x(`DROP FUNCTION public.bw_chat_scope_ok_for(uuid, uuid); DROP TABLE test_stale`);

// Cross-PR (#297's 195 revokes EXECUTE on bw_poll_vote_deadline from
// authenticated): 180 running after it must not grant it back.
await x(`REVOKE EXECUTE ON FUNCTION public.bw_poll_vote_deadline(uuid) FROM authenticated`);
d = await x(readFileSync(MIG, 'utf8'));
const dlg = (await qq(`SELECT has_function_privilege('authenticated', 'public.bw_poll_vote_deadline(uuid)', 'EXECUTE') AS a`)).rows[0];
ok(!d.error && dlg?.a === false, `180 again after 195: the deadline stays revoked from clients (${d.error ?? JSON.stringify(dlg)})`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
