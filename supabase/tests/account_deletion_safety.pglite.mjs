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
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE public.band_members (band_id uuid REFERENCES public.bands(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE, role text, is_active boolean DEFAULT true);
CREATE TABLE public.events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, created_by uuid);
-- Chats as 002 + 024 left them: sender_id SET NULL on a NOT NULL column.
CREATE TYPE public.chat_type AS ENUM ('direct', 'group', 'band', 'event');
CREATE TABLE public.chats (id uuid PRIMARY KEY, type public.chat_type NOT NULL, band_id uuid REFERENCES public.bands(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL);
CREATE TABLE public.chat_participants (chat_id uuid REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE);
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid REFERENCES public.chats(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL CONSTRAINT messages_sender_id_fkey REFERENCES public.profiles(id) ON DELETE SET NULL,
  content text, metadata jsonb DEFAULT '{}'::jsonb, attachments jsonb DEFAULT '[]'::jsonb, deleted boolean DEFAULT false,
  reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL, created_at timestamptz DEFAULT now());
-- Songs and suggestions as 108 created them (created_by ON DELETE CASCADE).
CREATE TABLE public.songs (id uuid PRIMARY KEY, band_id uuid REFERENCES public.bands(id) ON DELETE CASCADE, title text);
CREATE TABLE public.song_suggestions (id uuid PRIMARY KEY, band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  song_id uuid REFERENCES public.songs(id) ON DELETE SET NULL, status text NOT NULL DEFAULT 'pending',
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL);
-- As 038 created them.
CREATE TABLE public.rehearsal_polls (id uuid PRIMARY KEY, band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, title text);
CREATE TABLE public.rehearsal_poll_options (id uuid PRIMARY KEY, poll_id uuid NOT NULL REFERENCES public.rehearsal_polls(id) ON DELETE CASCADE);
CREATE TABLE public.rehearsal_poll_votes (poll_id uuid NOT NULL REFERENCES public.rehearsal_polls(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES public.rehearsal_poll_options(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);

INSERT INTO auth.users VALUES ('${ADMIN1}'), ('${ADMIN2}'), ('${MEM}');
INSERT INTO profiles VALUES ('${ADMIN1}'), ('${ADMIN2}'), ('${MEM}');
INSERT INTO bands VALUES ('${BAND}', 'Hudson Horns'), ('${SOLO}', 'Solo project');
INSERT INTO band_members VALUES ('${BAND}','${ADMIN1}','admin',true), ('${BAND}','${ADMIN2}','admin',true),
  ('${BAND}','${MEM}','member',true), ('${SOLO}','${ADMIN1}','admin',true);
INSERT INTO rehearsal_polls VALUES ('${POLL}', '${BAND}', '${ADMIN1}', 'Thursday or Friday?');
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
ok(rb?.ok === false && (rb.bands ?? []).includes('Brass trio'), `B2: the second admin is refused: the first is leaving (${JSON.stringify(rb)})`);
ok((await q(`SELECT 1 FROM account_deletions_pending WHERE user_id = '${B}'`)).rows?.length === 0, 'B2: and nothing pending for them');
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
const [M1, M2, M3, M4, M5, M6, M7] = [51, 52, 53, 54, 55, 56, 57].map(id);
await x(`INSERT INTO auth.users VALUES ('${F}'), ('${G}'); INSERT INTO profiles VALUES ('${F}'), ('${G}');
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
  INSERT INTO songs VALUES ('${S1}','${FB}','Minor Swing');
  INSERT INTO song_suggestions VALUES ('${SG1}','${FB}','${S1}','accepted','${F}','${G}'), ('${SG2}','${FB}','${S1}','pending','${F}',NULL)`);
await reset();
ok((await begin(F))?.ok === true, 'former member: deletion can begin');
d = await prepare(F);
ok(!d.error, `former member: prepare goes through (${d.error ?? 'ok'})`);
// A message sent in the second between prepare and Auth deleting the user.
await x(`INSERT INTO messages (id, chat_id, sender_id, content) VALUES ('${M7}','${BC}','${F}','one more')`);
d = await x(`DELETE FROM auth.users WHERE id = '${F}'`);
ok(!d.error, `former member: Auth can delete the account (${d.error ?? 'ok'})`);
const msg = async (m) => (await qq(`SELECT sender_id, content, metadata FROM messages WHERE id = '${m}'`)).rows[0] ?? null;
let m1 = await msg(M1), m3 = await msg(M3), m7 = await msg(M7);
ok(m1?.content === 'See you at 8' && m1.sender_id === null, `the band chat message stays, without author (${JSON.stringify(m1)})`);
ok(m3?.content === 'Running late' && m3.sender_id === null && !JSON.stringify(m3.metadata).includes(F), `the event chat message stays, author and metadata gone (${JSON.stringify(m3)})`);
ok(m7?.sender_id === null, `a message sent after prepare doesn't stop Auth and stays anonymous (${JSON.stringify(m7)})`);
ok(JSON.stringify(m1?.metadata) === JSON.stringify({ client: 'ios', mentions: [G] }), `other people in its metadata stay (${JSON.stringify(m1?.metadata)})`);
const m2 = await msg(M2);
ok(m2 && !JSON.stringify(m2.metadata).includes(F) && m2.metadata.client === 'web' && Array.isArray(m2.metadata.mentions),
  `mentions of the person are stripped from other messages (${JSON.stringify(m2?.metadata)})`);
ok((await msg(M6)) === null, 'a message they had deleted goes for good');
ok((await msg(M4)) === null, 'their direct messages go');
ok((await msg(M5))?.content === 'ok', "the other person's direct messages stay");
const sg = (await qq(`SELECT id, created_by FROM song_suggestions ORDER BY id`)).rows;
ok(sg.length === 2 && sg.every((r) => r.created_by === null), `their song suggestions stay with the band, without author (${JSON.stringify(sg)})`);
const fkn = (await qq(`SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'public.song_suggestions'::regclass AND contype = 'f'
  AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.song_suggestions'::regclass AND attname = 'created_by')]`)).rows;
ok(fkn.length === 1 && fkn[0].conname === 'song_suggestions_created_by_fkey' && fkn[0].confdeltype === 'n',
  `same FK name (older builds embed author via it), now SET NULL (${JSON.stringify(fkn)})`);
d = await q(`UPDATE messages SET sender_id = NULL WHERE id = '${M5}'`);
ok(!!d.error, `nobody else can make a message anonymous (${d.error ?? 'nulled'})`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
