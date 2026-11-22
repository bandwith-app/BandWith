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
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sender_id uuid);
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
await db.exec(readFileSync(MIG, 'utf8'));
await db.exec(readFileSync(MIG, 'utf8')); // idempotent
ok(true, 'migration runs twice');

// Storage release (the function runs it before any data is deleted).
const rel = async () => {
  try { return (await db.query(`SELECT public.bw_account_storage_release('${ADMIN1}') AS r`)).rows[0].r; }
  catch (e) { return { error: e.message }; }
};
let r = await rel();
ok(r.personal_left === 1, `reports the personal file still there (${JSON.stringify(r)})`);
ok(r.released === 2, `releases the two band files the person uploaded (${r.released})`);
const owners = (await db.query(`SELECT bucket_id, name, owner FROM storage.objects ORDER BY name`)).rows;
ok(owners.filter((o) => o.bucket_id !== 'personal-files' && o.owner === ADMIN1).length === 0, 'no band file still owned by the account');
ok(owners.find((o) => o.name.endsWith('other.pdf')).owner === MEM, "another member's file untouched");
ok(owners.length === 4, 'no file deleted by the release');
await db.exec(`DELETE FROM storage.objects WHERE bucket_id = 'personal-files'`); // what the function does via the Storage API
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
await db.exec(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('avatars', '${ADMIN1}/me.png', '${ADMIN1}', '${ADMIN1}')`);
r = await rel();
ok(r.personal_left === 1, `a profile photo still there holds the deletion (${JSON.stringify(r)})`);
const av = (await db.query(`SELECT owner FROM storage.objects WHERE bucket_id = 'avatars'`)).rows[0];
ok(av?.owner === ADMIN1, 'and is not released (it must be removed, not left public)');
await db.exec(`DELETE FROM storage.objects WHERE bucket_id = 'avatars'`);
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
await db.exec(`UPDATE band_members SET role = 'admin' WHERE band_id = '${BAND}' AND user_id = '${MEM}'`);
d = await q(`UPDATE band_members SET role = 'member' WHERE band_id = '${BAND}' AND user_id = '${ADMIN2}'`);
ok(!d.error, `with a third admin, stepping down is fine (${d.error ?? 'ok'})`);
await db.exec(`UPDATE band_members SET role = 'admin' WHERE band_id = '${BAND}' AND user_id = '${ADMIN2}';
  UPDATE band_members SET role = 'member' WHERE band_id = '${BAND}' AND user_id = '${MEM}'`);
await db.exec(`UPDATE account_deletions_pending SET started_at = now() - interval '20 minutes'`);
d = await q(`UPDATE band_members SET role = 'admin' WHERE band_id = '${BAND}' AND user_id = '${ADMIN2}'`);
d = await tryTx(`UPDATE band_members SET role = 'member' WHERE band_id = '${BAND}' AND user_id = '${ADMIN2}'`);
ok(!d.error, `an old pending deletion no longer holds anyone (${d.error ?? 'ok'})`);
// A retry after the solo band is gone still knows it.
await db.exec(`DELETE FROM bands WHERE id = '${SOLO}'`);
b = await q(`SELECT public.bw_account_deletion_begin('${ADMIN1}') AS r`);
ok(JSON.stringify(b.rows?.[0]?.r?.band_ids) === JSON.stringify([SOLO]), `a retry still cleans the band already deleted (${JSON.stringify(b.rows?.[0]?.r?.band_ids)})`);
// Blocked: the other admin left earlier and members remain.
await db.exec(`DELETE FROM account_deletions_pending; UPDATE band_members SET role = 'member' WHERE band_id = '${BAND}' AND user_id = '${ADMIN2}'`);
b = await q(`SELECT public.bw_account_deletion_begin('${ADMIN1}') AS r`);
ok(b.rows?.[0]?.r?.ok === false && b.rows[0].r.bands?.[0] === 'Hudson Horns', `last admin with members: refused (${JSON.stringify(b.rows?.[0]?.r)})`);
ok((await db.query(`SELECT count(*)::int AS n FROM account_deletions_pending`)).rows[0].n === 0, 'and nothing pending');
await db.exec(`UPDATE band_members SET role = 'admin' WHERE band_id = '${BAND}' AND user_id = '${ADMIN2}'`);
b = await q(`SELECT public.bw_account_deletion_begin('${ADMIN1}') AS r`);
d = await tryTx(`DELETE FROM bands WHERE id = '${BAND}'`);
ok(!d.error, `deleting the whole band is never held (${d.error ?? 'ok'})`);
// A member leaves after the deletion began: prepare deletes that band too,
// and notes it, so its files are cleaned.
await db.exec(`INSERT INTO bands VALUES ('${DUO}', 'Duo'); INSERT INTO band_members VALUES ('${DUO}','${ADMIN1}','admin',true), ('${DUO}','${MEM}','member',true)`);
b = await q(`SELECT public.bw_account_deletion_begin('${ADMIN1}') AS r`);
await db.exec(`UPDATE band_members SET is_active = false WHERE band_id = '${DUO}' AND user_id = '${MEM}'`);
d = await q(`SELECT public.bw_prepare_account_deletion('${ADMIN1}')`);
const noted = (await db.query(`SELECT band_ids FROM account_deletions_pending WHERE user_id = '${ADMIN1}'`)).rows[0]?.band_ids ?? [];
ok(!d.error && noted.includes(DUO), `prepare notes every band it deletes (${d.error ?? JSON.stringify(noted)})`);
ok((await db.query(`SELECT count(*)::int AS n FROM bands WHERE id = '${BAND}'`)).rows[0].n === 1, 'the band that goes on stays');
const g2 = (await db.query(`SELECT has_function_privilege('authenticated', 'public.bw_account_deletion_begin(uuid)', 'EXECUTE') AS a,
  has_table_privilege('authenticated', 'public.account_deletions_pending', 'SELECT') AS t`).catch(() => ({ rows: [{}] }))).rows[0];
ok(g2.a === false && g2.t === false, `server only (${JSON.stringify(g2)})`);

// Deleting the poll creator's account (02 #8 / 04 #8).
let blocked = null;
try { await db.exec(`BEGIN; DELETE FROM auth.users WHERE id = '${ADMIN1}'; ROLLBACK;`); } catch (e) { blocked = e.message; await db.exec('ROLLBACK'); }
ok(!blocked, `no Storage object blocks the deletion (${blocked ?? 'ok'})`);
// Whatever is still owned goes first (so the poll check below stands on its own).
await db.exec(`DELETE FROM storage.objects WHERE owner = '${ADMIN1}'; DELETE FROM auth.users WHERE id = '${ADMIN1}'`);
const poll = (await db.query(`SELECT created_by FROM rehearsal_polls WHERE id = '${POLL}'`)).rows;
ok(poll.length === 1 && poll[0].created_by === null, `the band's poll stays, without author (${JSON.stringify(poll)})`);
const votes = (await db.query(`SELECT user_id FROM rehearsal_poll_votes`)).rows.map((v) => v.user_id).sort();
ok(votes.length === 2 && votes.includes(ADMIN2) && votes.includes(MEM), `the others' votes stay (${votes.length})`);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
