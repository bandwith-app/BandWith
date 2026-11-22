// Local check of migration 180 (account deletion keeps what the band uses)
// without Docker: PGlite with stand-ins for auth.users, storage.objects and
// the rehearsal poll tables as created by 038 (created_by ON DELETE CASCADE).
// Failing first: with /dev/null as the migration, deleting the poll creator's
// account takes the band's poll and every vote with it.
//
//   mkdir -p /tmp/pg180 && cd /tmp/pg180 && npm init -y >/dev/null && npm i @electric-sql/pglite@0.5.15
//   cp <repo>/supabase/tests/account_deletion_safety.pglite.mjs . && node account_deletion_safety.pglite.mjs <repo>
//   node account_deletion_safety.pglite.mjs <repo> /dev/null    # before: FAILs expected
// The release guard below reads #281's 175 from the repo once merged, else
// from its branch head (git show origin/fix/security-audit:...).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

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
  title text, body text, data jsonb DEFAULT '{}'::jsonb, band_id uuid, created_at timestamptz DEFAULT now(), reference_type text);
-- pg_cron, pg_net and Vault as stand-ins (round 5: the job).
CREATE SCHEMA cron; CREATE TABLE cron.job (jobid serial, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_sched text, p_cmd text) RETURNS bigint LANGUAGE sql AS
  $f$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_sched, p_cmd) RETURNING jobid::bigint $f$;
CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $f$ DELETE FROM cron.job WHERE jobname = p_name RETURNING true $f$;
CREATE SCHEMA net; CREATE TABLE net.calls (url text, headers jsonb, body jsonb);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000)
  RETURNS bigint LANGUAGE sql AS $f$ INSERT INTO net.calls VALUES (url, headers, body) RETURNING 1::bigint $f$;
CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('bw_project_url', 'https://example.supabase.co'), ('bw_push_dispatch_secret', repeat('a', 64));
CREATE TABLE public.band_members (band_id uuid REFERENCES public.bands(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE, role text, is_active boolean DEFAULT true);
-- Events as 029 left them: a personal gig (no band) needs its creator.
CREATE TABLE public.events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, title text,
  CONSTRAINT events_personal_gig_creator_check CHECK (band_id IS NOT NULL OR created_by IS NOT NULL));
-- Chats as 002 + 024 left them: sender_id SET NULL on a NOT NULL column.
CREATE TYPE public.chat_type AS ENUM ('direct', 'group', 'band', 'event');
CREATE TABLE public.chats (id uuid PRIMARY KEY, type public.chat_type NOT NULL, band_id uuid REFERENCES public.bands(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, event_id uuid);
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
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL, kind text NOT NULL DEFAULT 'note', reviewed_at timestamptz,
  song_title text, proposed jsonb, message text, reason text);
CREATE FUNCTION public.bw_notify_song_suggestion_outcome(p_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
-- As 038 created them.
CREATE TABLE public.rehearsal_polls (id uuid PRIMARY KEY, band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, title text, vote_by date, vote_by_time time,
  invited_user_ids uuid[] NOT NULL DEFAULT '{}', status text DEFAULT 'open', notes text, created_at timestamptz DEFAULT now(), updated_at timestamptz);
-- The six NO ACTION foreign keys prod has (Claude round 5, 11-22).
CREATE TABLE public.band_invitations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid, invited_by uuid REFERENCES public.profiles(id));
CREATE TABLE public.contracts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_by uuid REFERENCES auth.users(id));
CREATE TABLE public.notification_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES public.profiles(id));
CREATE TABLE public.rehearsal_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, assigned_to uuid REFERENCES public.profiles(id));
CREATE TABLE public.task_templates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_by uuid REFERENCES auth.users(id));
CREATE TABLE public.transactions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_by uuid REFERENCES auth.users(id));
-- 001's onboarding invites: SET NULL on a NOT NULL inviter (prod, round 7).
CREATE TABLE public.member_invites (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL, email text NOT NULL, token text UNIQUE NOT NULL,
  status text DEFAULT 'pending');
CREATE TABLE public.rehearsal_poll_options (id uuid PRIMARY KEY, poll_id uuid NOT NULL REFERENCES public.rehearsal_polls(id) ON DELETE CASCADE);
-- A quote's musicians (Claude round 6, M1: upserts of rows that point at them).
CREATE TABLE public.quote_musicians (id uuid PRIMARY KEY, quote_id uuid, user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  fee numeric, UNIQUE (quote_id, user_id));
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
// Live by name (round 5): the display name server texts use, and the
// member joined / left notices (046) with their helpers.
const fnByName = (src, name) => {
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) return null;
  const tag = src.slice(start).match(/\bAS\s+(\$[A-Za-z_]*\$)/);
  if (!tag) return null;
  const bodyStart = start + tag.index + tag[0].length;
  const end = src.indexOf(tag[1], bodyStart);
  return end < 0 ? null : src.slice(start, end + tag[1].length) + ';';
};
const src046 = readFileSync(`${REPO}/supabase/migrations/046_server_notifications_and_push.sql`, 'utf8');
const src066 = readFileSync(`${REPO}/supabase/migrations/066_real_names.sql`, 'utf8');
const src108 = readFileSync(`${REPO}/supabase/migrations/108_song_suggestions.sql`, 'utf8');
// The suggestion texts and the reader's language, as 108 wrote them (round 6).
await db.exec([fnByName(src108, 'bw_song_suggestion_text'), fnByName(src108, 'bw_user_lang')].join('\n'));
await db.exec([fnByName(src046, 'bw_notify'), fnByName(src046, 'bw_active_band_member_ids'), fnByName(src066, 'bw_display_name'),
  fnByName(src046, 'bw_trg_band_member_changed'),
  `CREATE TRIGGER bw_band_member_changed_notify AFTER INSERT OR UPDATE OF is_active OR DELETE ON public.band_members
     FOR EACH ROW EXECUTE FUNCTION public.bw_trg_band_member_changed();`].join('\n'));
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
const slipIn = async (m, chat, text) => x(`UPDATE account_deletions_pending SET committed_at = NULL WHERE user_id = '${F}';
  INSERT INTO messages (id, chat_id, sender_id, content) VALUES ('${m}','${chat}','${F}','${text}');
  UPDATE account_deletions_pending SET committed_at = now() WHERE user_id = '${F}'`);
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
await x(`UPDATE account_deletions_pending SET started_at = now() - interval '20 minutes', committed_at = now() - interval '20 minutes' WHERE user_id = '${H}'`);
d = await q(`UPDATE band_members SET role = 'member' WHERE band_id = '${T6}' AND user_id = '${K}'`);
ok(!!d.error, `round 4: after prepare the hold doesn't lapse: the co-admin still can't step down (${d.error ?? 'stepped down'})`);
await x(`UPDATE band_members SET role = 'admin' WHERE band_id = '${T6}' AND user_id = '${K}'`);
d = await x(`INSERT INTO messages (id, chat_id, sender_id, content) VALUES ('${HM}','${HC}','${H}','still here?')`);
ok(!!d.error, `round 4: nor does the message refusal (${d.error ?? 'sent'})`);
await x(`DELETE FROM messages WHERE id = '${HM}'`);
// The retry: begin answers prepared and skips the band checks, prepare skips
// them too, and the account goes.
rb = await begin(H);
ok(rb?.ok === true && rb.committed === true, `round 4: the retry begins as prepared (${JSON.stringify(rb)})`);
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
const [SG5, N10] = [100, 140].map(id);
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
  INSERT INTO song_suggestions (id, band_id, status, created_by, kind, song_title) VALUES ('${SG5}', '${T8}', 'accepted', '${R}', 'new_song', 'Moanin');
  INSERT INTO notifications (id, user_id, type, title, body, data) VALUES
    ('${N1}', '${G2}', 'chat_message', 'Rosa Diaz', 'Doors at 7', '{"senderName":"Rosa Diaz","sender_id":"${R}","chat_id":"${RB}","content":"Doors at 7"}'),
    ('${N2}', '${G3}', 'chat_mention', 'Rosa Diaz mentioned you', '@Sam Lee bring the stand', '{"senderName":"Rosa Diaz","sender_id":"${R}","title":"Rosa Diaz mentioned you","chat_id":"${RB}"}'),
    ('${N3}', '${G2}', 'chat_message', 'Rosa Diaz', 'just between us', '{"senderName":"Rosa Diaz","chat_id":"${RD}"}'),
    ('${N4}', '${R}', 'chat_message', 'Gina Torres', 'sure', '{"senderName":"Gina Torres","chat_id":"${RD}"}'),
    ('${N5}', '${G2}', 'song_suggestion', 'Song suggested · Moanin', 'Rosa Diaz suggests adding it to the repertoire.', '{"by":"${R}","tag":"song-suggestion-${R}","suggestion_id":"${SG5}"}'),
    ('${N6}', '${G3}', 'chat_message', 'Gina Torres', 'ok', '{"senderName":"Gina Torres","sender_id":"${G2}","chat_id":"${RB}"}'),
    -- Round 6 (Codex B4): an old notice, no ids, of a message deleted since.
    ('${N10}', '${G3}', 'chat_message', 'Gina Torres', 'deleted since', '{"senderName":"Gina Torres","chat_id":"${RB}","content":"deleted since"}'),
    ('${N7}', '${G3}', 'chat_message', 'Rosa Diaz', 'Doors at 7', '{"sender_name":"Rosa Diaz","message_id":"${RM1}","chat_id":"${RB}"}'),
    ('${N8}', '${G3}', 'event_update', 'Lineup changed: Friday', 'Rosa Diaz took you off the lineup of Friday.', '{"kind":"lineup_removed","removed_by":"${R}"}'),
    ('${N9}', '${G2}', 'song_suggestion_reviewed', 'Suggestion accepted · Moanin', 'Rosa Diaz accepted your suggestion.', '{"suggestion_id":"${SG6}"}');
  INSERT INTO rehearsal_polls (id, band_id, created_by, title, invited_user_ids) VALUES
    ('${RP1}', '${T8}', '${R}', 'Room split', ARRAY['${R}','${G2}','${G3}']::uuid[]),
    ('${RP2}', '${T8}', '${G2}', 'Just Rosa', ARRAY['${R}']::uuid[]);
  UPDATE rehearsal_polls SET status = 'polling' WHERE id IN ('${RP1}', '${RP2}');
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
ok(n5 && !('by' in n5.data) && !String(n5.data.tag).includes(R) && n5.body === 'Ex membro propone di aggiungerlo al repertorio.',
  `B2: a song suggestion notification loses author id and name (${JSON.stringify(n5)})`);
let n9 = await note(N9);
ok(n9?.body === 'Ex membro ha accettato il tuo suggerimento.', `B2: and a review they made (${JSON.stringify(n9)})`);
ok(!(await note(N10)), 'round 6 (Codex B4): an old chat notice with no ids in a chat they were in goes (as 192)');
let n8 = await note(N8);
ok(n8 && !JSON.stringify(n8.data).includes(R), `B2: their id goes from other notifications (${JSON.stringify(n8)})`);
// Minor: a poll's invitees no longer count them (cost split). Round 5
// (Claude minor 3): the last one too; that poll closes, with no notice, and
// stays private to its creator (an empty list would show it to the band).
const inv = (await qq(`SELECT id, invited_user_ids, status FROM rehearsal_polls WHERE id IN ('${RP1}','${RP2}') ORDER BY id`)).rows;
ok(JSON.stringify(inv.map((r) => [r.invited_user_ids, r.status])) === JSON.stringify([[[G2, G3], 'polling'], [[G2], 'cancelled']]),
  `minor: out of the invitees, the last one too: that poll closes, still private (${JSON.stringify(inv)})`);
// Claude round 4: the hold's error is readable for older builds, code in the hint.
let held = {};
try { await db.query(`UPDATE band_members SET role = 'member' WHERE band_id = '${T8}' AND user_id = '${G2}'`); } catch (e) { held = { message: e.message, hint: e.hint, detail: e.detail }; }
const heldBy = (() => { try { return JSON.parse(held.detail ?? '{}').by; } catch { return null; } })();
ok(heldBy === 'admin', `round 5: the detail says an admin is deleting (${held.detail})`);
ok(held.message === 'An admin of this band is deleting their account. Try again in a few minutes.' && held.hint === 'account_deletion_in_progress',
  `the hold's error reads as English, the code is the hint (${JSON.stringify(held)})`);
// B1: a direct message that got in between prepare's steps and was made
// anonymous by them: the last step deletes it by chat.
await x(`UPDATE account_deletions_pending SET committed_at = NULL WHERE user_id = '${R}';
  INSERT INTO messages (id, chat_id, sender_id, content) VALUES ('${RM3}','${RD}','${R}','from the iPad');
  UPDATE account_deletions_pending SET committed_at = now() WHERE user_id = '${R}';
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

// ── Codex and Claude reviews #282, round 5 ────────────────────────────────
const [AA, BB, CC, EE, A2, B2u] = [101, 102, 103, 104, 105, 106].map(id);
const [T9, T10, QC, LD] = [111, 112, 113, 114].map(id);
const [QM1, QM2, QM3, QM4] = [121, 122, 123, 124].map(id);
const [Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8] = [131, 132, 133, 134, 135, 136, 137, 138].map(id);
const [QS1, QS2, Q9, Q10, EV1, EV2, EV3] = [141, 142, 143, 144, 145, 146, 147].map(id);
const setup5 = await x(`INSERT INTO auth.users VALUES ('${AA}'), ('${BB}'), ('${CC}'), ('${EE}'), ('${A2}'), ('${B2u}');
  INSERT INTO profiles (id, full_name, email, preferred_language) VALUES
    ('${AA}', 'Alex', 'alex.kim@example.com', 'en'), ('${BB}', 'Jordan Reyes', 'jordan@example.com', 'de'),
    ('${CC}', 'Alex', 'alex.park@example.com', 'en'), ('${EE}', NULL, 'pat@example.com', 'en'),
    ('${A2}', 'Morgan Lee', 'morgan@example.com', 'en'), ('${B2u}', 'Casey Fox', 'casey@example.com', 'en');
  INSERT INTO bands VALUES ('${T9}', 'Queens Quartet'), ('${T10}', 'Astoria Strings');
  INSERT INTO band_members VALUES ('${T9}','${AA}','admin',true), ('${T9}','${BB}','admin',true), ('${T9}','${CC}','member',true),
    ('${T10}','${A2}','admin',true), ('${T10}','${B2u}','admin',true);
  INSERT INTO chats VALUES ('${QC}', 'band', '${T9}', '${BB}', NULL), ('${LD}', 'direct', NULL, '${CC}', NULL);
  -- A direct chat CC started; AA's participant row is long gone (legacy).
  INSERT INTO chat_participants (chat_id, user_id) VALUES ('${QC}','${AA}'), ('${QC}','${BB}'), ('${QC}','${CC}'), ('${LD}','${CC}');
  INSERT INTO messages (id, chat_id, sender_id, content) VALUES
    ('${QM1}','${QC}','${AA}','Soundcheck moved to 5'), ('${QM2}','${QC}','${AA}','Load in at 4'),
    ('${QM3}','${QC}','${CC}','Bring the music stands'), ('${QM4}','${LD}','${AA}','call me');
  INSERT INTO notifications (id, user_id, type, title, body, data) VALUES
    -- Renamed since (Alexander, now Alex): found by its sender id.
    ('${Q1}', '${BB}', 'chat_message', 'Alexander', 'See you there', '{"senderName":"Alexander","sender_id":"${AA}","chat_id":"${QC}"}'),
    -- The other Alex.
    ('${Q2}', '${BB}', 'chat_message', 'Alex', 'Bring the music stands', '{"senderName":"Alex","sender_id":"${CC}","chat_id":"${QC}"}'),
    ('${Q3}', '${BB}', 'chat_message', 'Alex', 'Bring the music stands', '{"senderName":"Alex","chat_id":"${QC}","content":"Bring the music stands"}'),
    -- Old, no ids, one of AA's messages.
    ('${Q4}', '${BB}', 'chat_message', 'Alex', 'Soundcheck moved to 5', '{"senderName":"Alex","chat_id":"${QC}","content":"Soundcheck moved to 5"}'),
    ('${Q5}', '${BB}', 'chat_message', 'Alex', 'Load in at 4', '{"senderName":"Alex","message_id":"${QM2}","chat_id":"${QC}"}'),
    -- The legacy direct chat, both sides.
    ('${Q6}', '${CC}', 'chat_message', 'Alex', 'call me', '{"senderName":"Alex","chat_id":"${LD}","content":"call me"}'),
    ('${Q7}', '${AA}', 'chat_message', 'Alex', 'sure', '{"senderName":"Alex","sender_id":"${CC}","chat_id":"${LD}"}'),
    -- A member with no name: the server wrote the whole email.
    -- Round 6 (Codex B3): written when the email was another one.
    ('${Q8}', '${BB}', 'song_suggestion', 'Lyrics · Moanin', 'pat.old@example.com suggests a correction to the lyrics.', '{"by":"${EE}","tag":"song-suggestion-${EE}","suggestion_id":"${QS1}"}'),
    -- Round 6 (Codex B4): an old notice of a message deleted since ("Delete chat").
    ('${Q9}', '${BB}', 'chat_message', 'Alex', 'Wrong address, ignore', '{"senderName":"Alex","chat_id":"${QC}","content":"Wrong address, ignore"}'),
    -- Round 6 (Codex B3): a review AA made, under the name they had then.
    ('${Q10}', '${CC}', 'song_suggestion_reviewed', 'Suggestion not accepted · Moanin', 'Alexander: “Too long for the set”', '{"suggestion_id":"${QS2}"}');
  INSERT INTO song_suggestions (id, band_id, status, created_by, kind, song_title) VALUES ('${QS1}', '${T9}', 'pending', '${EE}', 'lyrics', 'Moanin');
  INSERT INTO song_suggestions (id, band_id, status, created_by, reviewed_by, kind, song_title, reason) VALUES
    ('${QS2}', '${T9}', 'rejected', '${CC}', '${AA}', 'lyrics', 'Moanin', 'Too long for the set');
  INSERT INTO events (id, band_id, created_by, title) VALUES ('${EV1}', '${T9}', '${BB}', 'Friday'), ('${EV3}', '${T9}', '${AA}', 'Saturday');
  -- Round 7: onboarding invites AA sent, in a band with another admin and in one without.
  INSERT INTO bands VALUES ('${id(156)}', 'Yonkers Jam');
  INSERT INTO band_members VALUES ('${id(156)}','${AA}','member',true), ('${id(156)}','${CC}','member',true);
  INSERT INTO member_invites (id, band_id, invited_by, email, token) VALUES
    ('${id(157)}', '${T9}', '${AA}', 'sam@example.com', 'tok-1'), ('${id(158)}', '${id(156)}', '${AA}', 'lee@example.com', 'tok-2');
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('avatars', '${AA}/me.png', '${AA}', '${AA}')`);
ok(!setup5.error, `round 5: setup (${setup5.error ?? 'ok'})`);
await reset();
await x(`DELETE FROM net.calls`);

// Claude blocker: begun only (nothing erased) and given up: the hold lapses.
ok((await begin(B2u))?.ok === true, 'round 5: B begins');
await x(`UPDATE account_deletions_pending SET started_at = now() - interval '16 minutes' WHERE user_id = '${B2u}'`);
d = await tryTx(`UPDATE band_members SET is_active = false WHERE band_id = '${T10}' AND user_id = '${A2}'`);
ok(!d.error, `round 5: after 15 minutes A can leave (${d.error ?? 'ok'})`);
let ra = await begin(A2);
ok(ra?.ok === true, `round 5: and A can delete their own account, not "in progress" (${JSON.stringify(ra)})`);
ok((await qq(`SELECT count(*)::int AS n FROM public.bw_account_deletions_due()`)).rows[0]?.n === 0, 'round 5: the job never takes a deletion that was not committed');
await reset();

// Codex B1: committed, then a file step fails (the photo) and the user gives up.
ok((await begin(AA))?.ok === true, 'round 5: deletion can begin');
d = await prepare(AA);
ok(!d.error, `round 5: prepare commits (${d.error ?? 'ok'})`);
ok((await qq(`SELECT committed_at IS NOT NULL AS c FROM account_deletions_pending WHERE user_id = '${AA}'`)).rows[0]?.c === true, 'round 5: committed_at set by prepare');
// Round 6 (Codex B1): once committed, another device writes nothing more.
const errAs = async (u, sql) => {
  await x(`SELECT set_config('test.uid', '${u ?? ''}', false)`);
  let e = null;
  try { await db.query(sql); } catch (err) { e = { message: err.message, hint: err.hint }; }
  await x(`SELECT set_config('test.uid', '', false)`);
  return e;
};
const refused = (e) => e?.message === 'Your account is being deleted.' && e?.hint === 'account_being_deleted';
let e6 = await errAs(AA, `INSERT INTO events (band_id, created_by, title) VALUES (NULL, '${AA}', 'Wedding (iPad)')`);
ok(refused(e6), `round 6 (B1): committed: a personal gig from another device is refused (${JSON.stringify(e6)})`);
e6 = await errAs(AA, `INSERT INTO events (band_id, created_by, title) VALUES ('${T9}', '${AA}', 'Band gig')`);
ok(refused(e6), `round 6 (B1): a band gig too (${JSON.stringify(e6)})`);
e6 = await errAs(AA, `UPDATE events SET title = 'Friday late' WHERE id = '${EV1}'`);
ok(refused(e6), `round 6 (B1): and an edit (${JSON.stringify(e6)})`);
e6 = await errAs(AA, `INSERT INTO chats VALUES (gen_random_uuid(), 'direct', NULL, '${AA}', NULL)`);
ok(refused(e6), `round 6 (B1): and the other tables with a creator (a chat) (${JSON.stringify(e6)})`);
e6 = await errAs(BB, `INSERT INTO events (band_id, created_by, title) VALUES (NULL, '${BB}', 'Solo set')`);
ok(e6 === null, `round 6 (B1): the others still write (${JSON.stringify(e6)})`);
await x(`DELETE FROM events WHERE created_by = '${BB}' AND band_id IS NULL`);
// Claude round 5 blocker: nobody points a new row at them either.
e6 = await errAs(BB, `INSERT INTO rehearsal_tasks (title, assigned_to) VALUES ('Bring the PA', '${AA}')`);
ok(e6?.hint === 'account_deletion_in_progress', `round 6 (Claude blocker): a task assigned to them is refused (${JSON.stringify(e6)})`);
ok(e6?.message === 'This person is deleting their account. Choose someone else.', `round 7: in words that fit (older builds show it as it is) (${JSON.stringify(e6)})`);
await x(`INSERT INTO rehearsal_tasks (id, title) VALUES ('${id(148)}', 'Print set lists')`);
e6 = await errAs(BB, `UPDATE rehearsal_tasks SET assigned_to = '${AA}' WHERE id = '${id(148)}'`);
ok(e6?.hint === 'account_deletion_in_progress', `round 6 (Claude blocker): and reassigning one to them (${JSON.stringify(e6)})`);
e6 = await errAs(BB, `UPDATE rehearsal_tasks SET title = 'Print the set lists' WHERE id = '${id(148)}'`);
ok(e6 === null, `round 6 (Claude blocker): other edits go through (${JSON.stringify(e6)})`);
// The server's own writes go through (push logs, a task from a server path);
// the last step clears them before Auth.
await x(`INSERT INTO rehearsal_tasks (id, title, assigned_to) VALUES ('${id(149)}', 'Tune the piano', '${AA}');
  INSERT INTO transactions (created_by) VALUES ('${AA}'); INSERT INTO notification_logs (user_id) VALUES ('${AA}')`);
// The catalog: every column that could stop Auth, and the tables blocked.
const authorCols = (await qq(`SELECT table_name, column_name, blocks FROM public.bw_account_deletion_author_columns()`)).rows;
console.log('     author columns:', authorCols.map((c) => `${c.table_name}.${c.column_name}${c.blocks ? ` (${c.blocks})` : ''}`).join(', '));
ok(authorCols.some((c) => c.table_name === 'events' && c.column_name === 'created_by' && c.blocks === 'check')
   && authorCols.some((c) => c.table_name === 'messages' && c.column_name === 'sender_id'),
  `round 6 (B1): the catalog finds the personal-gig check and the NOT NULL sender (${JSON.stringify(authorCols)})`);
ok(authorCols.some((c) => c.table_name === 'member_invites' && c.column_name === 'invited_by' && c.blocks === 'not_null'),
  'round 7: and the onboarding invites\' NOT NULL inviter (prod)');
const restrictCols = authorCols.filter((c) => c.blocks === 'restrict').map((c) => `${c.table_name}.${c.column_name}`);
ok(JSON.stringify(restrictCols) === JSON.stringify(['band_invitations.invited_by', 'contracts.created_by', 'notification_logs.user_id',
  'rehearsal_tasks.assigned_to', 'task_templates.created_by', 'transactions.created_by']),
  `round 6 (Claude blocker): the NO ACTION columns are prod's six (${JSON.stringify(restrictCols)})`);
const guarded = (await qq(`SELECT c.relname AS t FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
  WHERE tg.tgname = 'bw_deleting_account_writes'`)).rows.map((r) => r.t);
const unguarded = [...new Set(authorCols.map((c) => c.table_name))].filter((t) => t !== 'messages' && !guarded.includes(t));
ok(authorCols.length > 0 && unguarded.length === 0, `round 6 (B1): every one of those tables refuses the writes (${JSON.stringify({ guarded, unguarded })})`);
// Claude round 6 (M5): each with its own columns as the arguments, after
// the write (AFTER ... WHEN auth.uid() IS NOT NULL, M1).
const trigDefs = Object.fromEntries((await qq(`SELECT c.relname AS t, pg_get_triggerdef(tg.oid) AS def FROM pg_trigger tg
  JOIN pg_class c ON c.oid = tg.tgrelid WHERE tg.tgname = 'bw_deleting_account_writes'`)).rows.map((r) => [r.t, r.def]));
const wantArgs = {};
for (const c of authorCols) if (c.table_name !== 'messages') (wantArgs[c.table_name] ??= []).push(c.column_name);
wantArgs.rehearsal_polls = [...(wantArgs.rehearsal_polls ?? []), 'invited_user_ids'];
const badTrig = Object.entries(wantArgs).filter(([t, cols]) => {
  const def = trigDefs[t] ?? '';
  const args = (def.match(/bw_trg_deleting_account_writes\((.*)\)\s*$/)?.[1] ?? '').split(',').map((a) => a.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
  const ops = def.match(/AFTER (.*?) ON /)?.[1] ?? '';
  return !['INSERT', 'UPDATE', 'DELETE'].every((op) => ops.includes(op)) || !/WHEN \(+auth\.uid\(\) IS NOT NULL\)+/.test(def) || JSON.stringify(args) !== JSON.stringify([...cols].sort());
});
ok(Object.keys(wantArgs).length > 0 && badTrig.length === 0,
  `round 8 (Claude M5), round 9 (Codex B4: deletes too): every listed table but messages has the trigger, after the write, with its columns (${JSON.stringify(badTrig.map(([t]) => [t, trigDefs[t] ?? null]))})`);
// A gig created just before the commit (between prepare's steps), and a
// table with a check like it the migration doesn't know: the last step
// clears both, so Auth isn't stopped.
await x(`INSERT INTO events (id, band_id, created_by, title) VALUES ('${EV2}', NULL, '${AA}', 'Brunch set');
  CREATE TABLE public.test_owned (id serial PRIMARY KEY, owner uuid REFERENCES public.profiles(id) ON DELETE SET NULL, private boolean,
    CHECK (NOT private OR owner IS NOT NULL));
  INSERT INTO test_owned (owner, private) VALUES ('${AA}', true), ('${AA}', false), ('${BB}', true)`);
d = await q(`SELECT public.bw_account_deletion_finish('${AA}')`);
ok(!!d.error && /storage_not_ready/.test(d.error), `round 5: the photo still there: not ready, the account stays (${d.error ?? 'ok'})`);
await x(`UPDATE account_deletions_pending SET started_at = now() - interval '20 minutes', committed_at = now() - interval '20 minutes' WHERE user_id = '${AA}'`);
d = await q(`UPDATE band_members SET role = 'member' WHERE band_id = '${T9}' AND user_id = '${BB}'`);
ok(!!d.error, `round 5: the co-admin still can't step down (committed never lapses) (${d.error ?? 'stepped down'})`);
// The job: due rows only, leased (a second run gets nothing).
ok((await qq(`SELECT public.bw_finish_account_deletions_dispatch() AS r`)).rows[0]?.r === true, 'round 5: the job calls delete-account when one is due');
const call = (await qq(`SELECT url, headers, body FROM net.calls`)).rows;
ok(call.length === 1 && call[0].url === 'https://example.supabase.co/functions/v1/delete-account' && call[0].body.sweep === true
   && call[0].headers['x-bw-dispatch-secret'] === 'a'.repeat(64), `round 5: with the dispatch secret, as the push triggers (${JSON.stringify(call)})`);
let due = (await qq(`SELECT u::text AS u FROM public.bw_account_deletions_due() AS u`)).rows.map((r) => r.u);
ok(JSON.stringify(due) === JSON.stringify([AA]), `round 5: the job gets the committed deletion (${JSON.stringify(due)})`);
due = (await qq(`SELECT u::text AS u FROM public.bw_account_deletions_due() AS u`)).rows.map((r) => r.u);
ok(due.length === 0, `round 5: leased: a second run doesn't get it again (${JSON.stringify(due)})`);
await x(`DELETE FROM net.calls`);
ok((await qq(`SELECT public.bw_finish_account_deletions_dispatch() AS r`)).rows[0]?.r === false && (await qq(`SELECT 1 FROM net.calls`)).rows.length === 0,
  'round 5: no call while nothing is due');
// Round 6 (Claude): lease 4 minutes (the job runs every 5).
await x(`UPDATE account_deletions_pending SET started_at = now() - interval '270 seconds' WHERE user_id = '${AA}'`);
due = (await qq(`SELECT u::text AS u FROM public.bw_account_deletions_due() AS u`)).rows.map((r) => r.u);
ok(JSON.stringify(due) === JSON.stringify([AA]), `round 6 (Claude): a lease ends after 4 minutes, so the next run takes it (${JSON.stringify(due)})`);
await x(`DELETE FROM net.calls`);
// Round 6 (Claude): warnings, after an hour, and without the Vault entries.
const notices = async (sql) => { const out = []; try { await db.query(sql, [], { onNotice: (n) => out.push(n.message) }); } catch (e) { out.push(`ERROR ${e.message}`); } return out; };
await x(`UPDATE account_deletions_pending SET committed_at = now() - interval '2 hours', started_at = now() - interval '2 hours' WHERE user_id = '${AA}'`);
let nn = await notices(`SELECT public.bw_finish_account_deletions_dispatch()`);
ok(nn.some((m) => /older than 1 hour/.test(m)), `round 6 (Claude): a committed deletion older than an hour is a warning (${JSON.stringify(nn)})`);
await x(`DELETE FROM net.calls; DELETE FROM vault.decrypted_secrets WHERE name = 'bw_project_url'`);
nn = await notices(`SELECT public.bw_finish_account_deletions_dispatch()`);
ok(nn.some((m) => /Vault/.test(m)) && (await qq(`SELECT 1 FROM net.calls`)).rows.length === 0, `round 6 (Claude): due but no Vault entry: a warning, no call (${JSON.stringify(nn)})`);
await x(`INSERT INTO vault.decrypted_secrets VALUES ('bw_project_url', 'https://example.supabase.co');
  UPDATE account_deletions_pending SET committed_at = now() - interval '20 minutes', started_at = now() WHERE user_id = '${AA}'`);
const job = (await qq(`SELECT schedule, command FROM cron.job WHERE jobname = 'bw-finish-account-deletions'`)).rows;
ok(job.length === 1 && job[0].schedule === '*/5 * * * *' && /bw_finish_account_deletions_dispatch/.test(job[0].command), `round 5: scheduled every 5 minutes, once (${JSON.stringify(job)})`);
const g5 = (await qq(`SELECT has_function_privilege('authenticated', 'public.bw_account_deletions_due(integer)', 'EXECUTE') AS a,
  has_function_privilege('service_role', 'public.bw_account_deletions_due(integer)', 'EXECUTE') AS s,
  has_function_privilege('authenticated', 'public.bw_account_deletion_scrub(uuid)', 'EXECUTE') AS sa,
  has_function_privilege('service_role', 'public.bw_account_deletion_scrub(uuid)', 'EXECUTE') AS ss`)).rows[0] ?? {};
ok(g5.a === false && g5.s === true && g5.sa === false && g5.ss === true, `round 5: job and scrub are server only (${JSON.stringify(g5)})`);
// The retry (or the job): begin answers committed, the photo goes, the rest runs.
ra = await begin(AA);
ok(ra?.ok === true && ra.committed === true, `round 5: the retry resumes from committed, no band check (${JSON.stringify(ra)})`);
await x(`DELETE FROM storage.objects WHERE name = '${AA}/me.png'`); // the function, through the Storage API
d = await q(`SELECT public.bw_account_deletion_finish('${AA}')`);
ok(!d.error, `round 5: then the last step runs (${d.error ?? 'ok'})`);
const refs = (await qq(`SELECT (SELECT assigned_to FROM rehearsal_tasks WHERE id = '${id(149)}') AS task,
  (SELECT count(*)::int FROM transactions WHERE created_by = '${AA}') AS tx, (SELECT count(*)::int FROM notification_logs WHERE user_id = '${AA}') AS logs`)).rows[0] ?? {};
ok(refs.task === null && refs.tx === 0 && refs.logs === 0, `round 6 (Claude blocker): the last step clears what points at them after the commit (${JSON.stringify(refs)})`);
const invites = (await qq(`SELECT id, invited_by FROM member_invites WHERE id IN ('${id(157)}', '${id(158)}') ORDER BY id`)).rows;
ok(invites.length === 1 && invites[0].id === id(157) && invites[0].invited_by === BB,
  `round 7: an invite they sent passes to another admin of the band; with none left it goes (${JSON.stringify(invites)})`);
const gigs = (await qq(`SELECT id FROM events WHERE id IN ('${EV2}', '${EV3}') ORDER BY id`)).rows.map((r) => r.id);
ok(JSON.stringify(gigs) === JSON.stringify([EV3]), `round 6 (B1): the late personal gig goes, their band gig stays (${JSON.stringify(gigs)})`);
const owned = (await qq(`SELECT owner, private FROM test_owned ORDER BY id`)).rows;
ok(owned.length === 2 && owned[0].owner === AA && owned[0].private === false && owned[1].owner === BB,
  `round 6 (B1): a row its check would refuse without them goes, the rest waits for Auth (${JSON.stringify(owned)})`);

// Notifications (Codex B2, B3, Claude minors 1-2).
const note5 = async (n) => (await qq(`SELECT title, body, data FROM notifications WHERE id = '${n}'`)).rows[0] ?? null;
ok(!(await note5(Q6)) && !(await note5(Q7)), 'B2: a direct chat the other person started, their row gone: its notices go, both sides');
ok((await qq(`SELECT 1 FROM messages WHERE id = '${QM4}'`)).rows.length === 0, 'B2: and their message in it');
const q1 = await note5(Q1);
ok(q1?.title === 'Ehemaliges Mitglied' && q1.data.senderName === 'Ehemaliges Mitglied' && !('sender_id' in q1.data),
  `B3: renamed since: found by sender id, relabelled (${JSON.stringify(q1)})`);
const [q2, q3] = [await note5(Q2), await note5(Q3)];
ok(q2?.title === 'Alex' && q2.data.sender_id === CC, `B3: the other Alex keeps their name (${JSON.stringify([q2, q3])})`);
ok(!q3, `round 6 (B4): an old notice with no ids in a chat they were in goes, whoever sent it (as 192) (${JSON.stringify(q3)})`);
ok(!(await note5(Q9)), "round 6 (B4): also one whose message was deleted since (no text matching)");
const q10 = await note5(Q10);
ok(q10?.body === 'Former member: “Too long for the set”', `round 6 (B3): a review, rewritten from its text, whatever name it had (${JSON.stringify(q10)})`);
ok(!(await note5(Q4)), 'B3: an old notice with no ids matching their message goes (never relabelled by name)');
const q5 = await note5(Q5);
ok(q5?.title === 'Ehemaliges Mitglied', `B3: found by its message id (${JSON.stringify(q5)})`);
await x(`SELECT public.bw_account_deletion_notifications('${EE}')`);
const q8 = await note5(Q8);
ok(q8?.body === 'Ehemaliges Mitglied schlägt eine Korrektur am Songtext vor.' && !/@/.test(JSON.stringify(q8)),
  `round 6 (B3): an old email: the whole text rewritten in the reader's language, no email left (${JSON.stringify(q8)})`);

// Codex B4: Auth deletes the user; the band_members cascade writes member_left.
const before = (await qq(`SELECT now() AS t`)).rows[0].t;
d = await x(`DELETE FROM auth.users WHERE id = '${AA}'`);
ok(!d.error, `round 5: Auth deletes the account (${d.error ?? 'ok'})`);
const ev3 = (await qq(`SELECT band_id, created_by FROM events WHERE id = '${EV3}'`)).rows[0];
ok(ev3?.band_id === T9 && ev3.created_by === null, `round 7: a band gig they created stays with the band, no creator (029's check allows it) (${JSON.stringify(ev3)})`);
const left = (await qq(`SELECT user_id, title, data FROM notifications WHERE type = 'member_left' AND band_id = '${T9}' ORDER BY user_id`)).rows;
ok(left.length === 2 && left.every((l) => l.data.member_user_id === null)
   && left.find((l) => l.user_id === BB)?.data.member_name === 'Ehemaliges Mitglied'
   && left.find((l) => l.user_id === CC)?.data.member_name === 'Former member',
  `B4: member_left names a former member, in each one's language, no id (${JSON.stringify(left)})`);
const leak = (await qq(`SELECT id, type FROM notifications WHERE user_id IS DISTINCT FROM '${AA}'
  AND (data::text LIKE '%${AA}%' OR coalesce(title, '') LIKE '%${AA}%' OR coalesce(body, '') LIKE '%${AA}%')`)).rows;
ok(leak.length === 0, `B4: no notification carries their id after the deletion (${JSON.stringify(leak)})`);
// One written after Auth (another cascade, a late push): the final scrub.
await x(`INSERT INTO notifications (user_id, type, title, body, data) VALUES ('${BB}', 'event_update', 'Lineup', 'x', '{"removed_by":"${AA}"}')`);
d = await q(`SELECT public.bw_account_deletion_scrub('${AA}')`);
ok(!d.error && (await qq(`SELECT 1 FROM notifications WHERE data::text LIKE '%${AA}%' AND user_id IS DISTINCT FROM '${AA}'`)).rows.length === 0,
  `B4: the final scrub after Auth clears it (${d.error ?? 'ok'})`);
d = await tryTx(`UPDATE band_members SET is_active = false WHERE band_id = '${T9}' AND user_id = '${BB}'`);
ok(!d.error, `round 5: once it is done, the others are free (${d.error ?? 'ok'})`);
void before;
await reset();

// ── Codex review #282 (d468b10b), round 6: B2 ─────────────────────────────
// A co-admin joins a band that goes with the account, between begin and prepare.
const [DD, JJ, DE, T11, T12] = [151, 152, 153, 154, 155].map(id);
const setup6 = await x(`INSERT INTO auth.users VALUES ('${DD}'), ('${JJ}'), ('${DE}');
  INSERT INTO profiles (id, full_name, email, preferred_language) VALUES
    ('${DD}', 'Dana Diaz', 'dana@example.com', 'en'), ('${JJ}', 'Jamie Jones', 'jamie@example.com', 'en'), ('${DE}', 'Drew Ellis', 'drew@example.com', 'en');
  INSERT INTO bands VALUES ('${T11}', 'Bronx Duo'), ('${T12}', 'Harlem Trio');
  INSERT INTO band_members VALUES ('${T11}','${DD}','admin',true), ('${T12}','${DE}','admin',true);
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('song-files', '${T11}/song/set.pdf', '${DD}', '${DD}')`);
ok(!setup6.error, `round 6: setup (${setup6.error ?? 'ok'})`);
const b6 = await begin(DD);
ok(b6?.ok === true && (b6.band_ids ?? []).includes(T11), `round 6 (B2): begin notes the solo band (${JSON.stringify(b6)})`);
let j6 = null;
try { await db.query(`INSERT INTO band_members VALUES ('${T11}','${JJ}','admin',true)`); } catch (e) { j6 = { message: e.message, hint: e.hint }; }
ok(j6?.hint === 'account_deletion_in_progress', `round 6 (B2): joining a band that goes with a deletion is refused, same hint (${JSON.stringify(j6)})`);
ok(j6?.message === 'This band is being deleted. You can’t join it.', `round 7: in words that fit (${JSON.stringify(j6)})`);
// One that got in all the same (before this check existed): prepare looks again.
await x(`ALTER TABLE band_members DISABLE TRIGGER bw_band_admin_deletion_guard;
  INSERT INTO band_members VALUES ('${T11}','${JJ}','admin',true);
  ALTER TABLE band_members ENABLE TRIGGER bw_band_admin_deletion_guard`);
d = await prepare(DD);
ok(!d.error, `round 6 (B2): prepare goes through (${d.error ?? 'ok'})`);
const kept = (await qq(`SELECT (SELECT count(*)::int FROM bands WHERE id = '${T11}') AS band,
  (SELECT array_agg(user_id::text ORDER BY user_id) FROM band_members WHERE band_id = '${T11}') AS members,
  (SELECT count(*)::int FROM storage.objects WHERE name = '${T11}/song/set.pdf') AS files,
  (SELECT band_ids FROM account_deletions_pending WHERE user_id = '${DD}') AS noted`)).rows[0] ?? {};
ok(kept.band === 1 && kept.files === 1 && JSON.stringify(kept.members) === JSON.stringify([DD, JJ].sort()),
  `round 6 (B2): the band stays, with the co-admin and its files (${JSON.stringify(kept)})`);
ok(Array.isArray(kept.noted) && !kept.noted.includes(T11), `round 6 (B2): and it is no longer noted as going (${JSON.stringify(kept.noted)})`);
d = await x(`DELETE FROM storage.objects WHERE owner = '${DD}' AND bucket_id <> 'song-files'`);
d = await q(`SELECT public.bw_account_deletion_finish('${DD}')`);
ok(!d.error, `round 6 (B2): the last step runs (${d.error ?? 'ok'})`);
d = await x(`DELETE FROM auth.users WHERE id = '${DD}'`);
ok(!d.error && (await qq(`SELECT 1 FROM bands WHERE id = '${T11}'`)).rows.length === 1, `round 6 (B2): Auth deletes the account, the band goes on (${d.error ?? 'ok'})`);
// A begin that lapsed holds nothing: joining is fine again.
ok((await begin(DE))?.ok === true, 'round 6 (B2): another solo admin begins');
await x(`UPDATE account_deletions_pending SET started_at = now() - interval '16 minutes' WHERE user_id = '${DE}'`);
d = await tryTx(`INSERT INTO band_members VALUES ('${T12}','${JJ}','member',true)`);
ok(!d.error, `round 6 (B2): after 15 minutes the band takes new members (${d.error ?? 'ok'})`);
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

// Release guard (apply order 175 → 180): #281's 175 from its real head,
// its receipt functions taken by name, then 180 again. 180's copies must
// keep 175's fixes: a stale participant row moves no receipt, and (both)
// a message without sender still counts as unread.
const P175 = 'supabase/migrations/175_security_audit_access.sql';
let src175 = null;
try {
  src175 = existsSync(`${REPO}/${P175}`) ? readFileSync(`${REPO}/${P175}`, 'utf8')
    : execFileSync('git', ['-C', REPO, 'show', `origin/fix/security-audit:${P175}`], { encoding: 'utf8' });
} catch { src175 = null; }
const f175 = src175 && ['bw_chat_scope_ok_for', 'bw_mark_chats_delivered', 'bw_mark_chat_read'].map((n) => fnByName(src175, n));
if (!src175) {
  // Neither merged nor on the remote (e.g. CI without the branch): skip,
  // don't fail. Main makes this required once everything is merged.
  console.log(`SKIP guard: ${P175} not in the repo and origin/fix/security-audit not found`);
} else {
  ok(f175.every(Boolean), "guard: 175's receipt functions found by name");
}
if (f175 && f175.every(Boolean)) {
  // 175's bw_chat_scope_ok (built in a DO block there) as a stand-in: the
  // rule refuses the rows listed in test_stale175.
  d = await x(`CREATE TABLE test_stale175 (chat_id uuid, user_id uuid);
    CREATE OR REPLACE FUNCTION public.bw_chat_scope_ok(p_type text, p_band_id uuid, p_event_id uuid, p_user_id uuid) RETURNS boolean
      LANGUAGE sql STABLE AS $f$ SELECT NOT EXISTS (SELECT 1 FROM test_stale175 s JOIN chats c ON c.id = s.chat_id
        WHERE s.user_id = p_user_id AND c.type::text = p_type AND c.band_id IS NOT DISTINCT FROM p_band_id) $f$;
    ${f175.join('\n')}`);
  ok(!d.error, `guard: 175 loaded (${d.error ?? 'ok'})`);
  d = await x(readFileSync(MIG, 'utf8'));
  ok(!d.error, `guard: then 180 (${d.error ?? 'ok'})`);
  const [GC, GM1, GM2, GM3] = [87, 88, 89, 90].map(id);
  await x(`INSERT INTO chats VALUES ('${GC}', 'band', '${T8}', '${G2}', NULL);
    INSERT INTO chat_participants (chat_id, user_id) VALUES ('${GC}','${G2}'), ('${GC}','${G3}');
    INSERT INTO messages (id, chat_id, sender_id, content, created_at) VALUES ('${GM1}','${GC}','${G2}','set list is up', now() + interval '2 minutes');
    INSERT INTO test_stale175 VALUES ('${GC}', '${G3}')`);
  rr = await as(G3, `SELECT public.bw_mark_chat_read('${GC}') AS r`);
  ok(rr.rows?.[0]?.r === false, `guard: after 180, a stale participant gets false from mark read (${rr.error ?? JSON.stringify(rr.rows)})`);
  rr = await as(G3, `SELECT public.bw_mark_chats_delivered() AS r`);
  ok(rr.rows?.[0]?.r === 0, `guard: and 0 from mark delivered (${rr.error ?? JSON.stringify(rr.rows)})`);
  await x(`DELETE FROM test_stale175`);
  rr = await as(G3, `SELECT public.bw_mark_chat_read('${GC}') AS r`);
  ok(rr.rows?.[0]?.r === true, `guard: an allowed participant still marks read (${rr.error ?? JSON.stringify(rr.rows)})`);
  // A former member's message (sender NULL) after that read: still unread.
  await x(`INSERT INTO messages (id, chat_id, sender_id, content, created_at) VALUES ('${GM2}','${GC}',NULL,'(from a former member)', now() + interval '5 minutes')`);
  rr = await as(G3, `SELECT public.bw_mark_chat_read('${GC}') AS r`);
  ok(rr.rows?.[0]?.r === true, `guard: a message without sender still counts as unread (${rr.error ?? JSON.stringify(rr.rows)})`);
  await x(`INSERT INTO messages (id, chat_id, sender_id, content, created_at) VALUES ('${GM3}','${GC}',NULL,'(again)', now() + interval '10 minutes')`);
  rr = await as(G3, `SELECT public.bw_mark_chats_delivered() AS r`);
  ok(rr.rows?.[0]?.r >= 1, `guard: and as undelivered (${rr.error ?? JSON.stringify(rr.rows)})`);
}


// ── Codex and Claude reviews #282, round 8 (of 19db3f54) ───────────────────
const [X1, XB, ZB, ZC, BB2, WB, OC, QMX, QX] = [201, 202, 203, 204, 206, 207, 208, 209, 210].map(id);
const [P1, P2, P3, NZ1, NZ2, NZ3, NO1, NO2] = [211, 212, 213, 214, 215, 216, 217, 218].map(id);
d = await x(`INSERT INTO auth.users VALUES ('${X1}'), ('${BB2}');
  INSERT INTO profiles (id, full_name, email, preferred_language) VALUES ('${X1}', 'Riley Chen', 'riley@example.com', 'en'),
    ('${BB2}', 'Sam Ortiz', 'sam@example.com', 'en');
  INSERT INTO bands VALUES ('${XB}', 'Riley Solo'), ('${ZB}', 'Bronx Brass'), ('${WB}', 'Harlem Horns');
  INSERT INTO band_members VALUES ('${XB}','${X1}','admin',true), ('${ZB}','${BB2}','admin',true), ('${WB}','${BB2}','admin',true);
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES
    ('song-files', '${XB}/song/chart.pdf', '${X1}', '${X1}'), ('song-files', '${XB}/song/v2/take.m4a', '${X1}', '${X1}');
  INSERT INTO quote_musicians VALUES ('${QMX}', '${QX}', '${X1}', 250)`);
ok(!d.error, `round 8: setup (${d.error ?? 'ok'})`);
// Codex r6 (180:696): a band begin noted, deleted another way before
// prepare, stays noted: its files are cleaned by its path.
let r8b = await begin(X1);
ok(r8b?.ok === true && JSON.stringify(r8b.band_ids) === JSON.stringify([XB]), `round 8: begin notes the solo band (${JSON.stringify(r8b)})`);
await x(`DELETE FROM bands WHERE id = '${XB}'`);
d = await prepare(X1);
let r8n = (await qq(`SELECT band_ids, committed_at IS NOT NULL AS c FROM account_deletions_pending WHERE user_id = '${X1}'`)).rows[0];
ok(!d.error && r8n?.c === true && JSON.stringify(r8n.band_ids) === JSON.stringify([XB]),
  `round 8 (Codex 180:696): a band begin noted and deleted before prepare is kept for its files (${d.error ?? JSON.stringify(r8n)})`);
console.log('     (a band begin noted that someone joined stays and is not noted: "round 6 (Codex B2)" tests above)');
d = await prepare(X1);
r8n = (await qq(`SELECT band_ids FROM account_deletions_pending WHERE user_id = '${X1}'`)).rows[0];
ok(!d.error && JSON.stringify(r8n?.band_ids) === JSON.stringify([XB]), `round 8: a retry keeps it (${d.error ?? JSON.stringify(r8n)})`);
// Codex r6 (account-deletion.ts:109): names at any depth, from storage.objects.
const deep = `${X1}/${Array.from({ length: 70 }, (_, i) => `d${i}`).join('/')}/take.m4a`;
await x(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id) VALUES ('personal-files', '${deep}', '${X1}', '${X1}'),
  ('personal-files', '${X1}/a.m4a', '${X1}', '${X1}'), ('personal-files', 'ab_c/x.m4a', NULL, NULL), ('personal-files', 'abXc/y.m4a', NULL, NULL)`);
const names8 = async (b, p, after = null, lim = 1000) =>
  q(`SELECT n FROM public.bw_account_storage_names('${b}', '${p}', ${after ? `'${after}'` : 'NULL'}, ${lim}) AS n`);
let nm = await names8('personal-files', X1);
ok(!nm.error && nm.rows.map((r) => r.n).includes(deep) && nm.rows.length === 2, `round 8 (Codex): a file 70 folders deep is listed (${nm.error ?? nm.rows.length})`);
nm = await names8('personal-files', X1, null, 1);
const firstName = nm.rows?.[0]?.n;
const nm2 = await names8('personal-files', X1, firstName, 1);
ok(nm.rows?.length === 1 && nm2.rows?.length === 1 && nm2.rows[0].n > firstName, `round 8: in pages, after the last name (${JSON.stringify([nm.rows, nm2.rows])})`);
nm = await names8('song-files', XB);
ok(nm.rows?.length === 2, `round 8: the deleted band's files, by its path (${nm.error ?? JSON.stringify(nm.rows)})`);
nm = await names8('personal-files', 'ab_c');
ok(JSON.stringify(nm.rows?.map((r) => r.n)) === JSON.stringify(['ab_c/x.m4a']), `round 8: the prefix is literal (_ is not a wildcard) (${JSON.stringify(nm)})`);
nm = await names8('personal-files', '');
ok(!!nm.error, `round 8: an empty prefix (the whole bucket) is refused (${nm.error ?? 'listed'})`);
const g8 = (await qq(`SELECT has_function_privilege('authenticated', 'public.bw_account_storage_names(text, text, text, integer)', 'EXECUTE') AS a,
  has_function_privilege('anon', 'public.bw_account_storage_names(text, text, text, integer)', 'EXECUTE') AS n,
  has_function_privilege('service_role', 'public.bw_account_storage_names(text, text, text, integer)', 'EXECUTE') AS s`)).rows[0] ?? {};
ok(g8.a === false && g8.n === false && g8.s === true, `round 8: the listing is server only (${JSON.stringify(g8)})`);
await x(`DELETE FROM storage.objects WHERE bucket_id = 'personal-files' AND name LIKE '${X1}/%'`); // the function, through the Storage API
// Claude r6 (M1): an upsert of a row that already points at them passes.
e6 = await errAs(BB2, `INSERT INTO quote_musicians VALUES ('${QMX}', '${QX}', '${X1}', 300) ON CONFLICT (id) DO UPDATE SET fee = EXCLUDED.fee`);
ok(e6 === null && (await qq(`SELECT fee::int AS f FROM quote_musicians WHERE id = '${QMX}'`)).rows[0]?.f === 300,
  `round 8 (Claude M1): an upsert (DO UPDATE) of a row that already points at them goes through (${JSON.stringify(e6)})`);
e6 = await errAs(BB2, `INSERT INTO quote_musicians VALUES ('${QMX}', '${QX}', '${X1}', 400) ON CONFLICT DO NOTHING`);
ok(e6 === null, `round 8 (Claude M1): and DO NOTHING (${JSON.stringify(e6)})`);
e6 = await errAs(BB2, `INSERT INTO quote_musicians VALUES (gen_random_uuid(), '${id(219)}', '${X1}', 100)`);
ok(e6?.hint === 'account_deletion_in_progress', `round 8 (Claude M1): a new row pointing at them is still refused (${JSON.stringify(e6)})`);
e6 = await errAs(X1, `INSERT INTO quote_musicians VALUES ('${QMX}', '${QX}', '${X1}', 500) ON CONFLICT (id) DO UPDATE SET fee = EXCLUDED.fee`);
ok(refused(e6), `round 8 (Claude M1): their own upsert is still refused (${JSON.stringify(e6)})`);
// Codex r6 (180:725): poll invitee lists. After the commit nobody adds them...
e6 = await errAs(BB2, `INSERT INTO rehearsal_polls (id, band_id, created_by, title, invited_user_ids) VALUES ('${P2}', '${WB}', '${BB2}', 'Sunday?', ARRAY['${BB2}', '${X1}']::uuid[])`);
ok(e6?.hint === 'account_deletion_in_progress', `round 8 (Codex 180:725): a new poll inviting them is refused (${JSON.stringify(e6)})`);
e6 = await errAs(BB2, `INSERT INTO rehearsal_polls (id, band_id, created_by, title, invited_user_ids) VALUES ('${P3}', '${WB}', '${BB2}', 'Monday?', ARRAY['${BB2}']::uuid[])`);
ok(e6 === null, `round 8: a poll without them goes through (${JSON.stringify(e6)})`);
e6 = await errAs(BB2, `UPDATE rehearsal_polls SET invited_user_ids = ARRAY['${BB2}', '${X1}']::uuid[] WHERE id = '${P3}'`);
ok(e6?.hint === 'account_deletion_in_progress', `round 8 (Codex 180:725): adding them to one is refused (${JSON.stringify(e6)})`);
e6 = await errAs(BB2, `UPDATE rehearsal_polls SET title = 'Monday at 7?' WHERE id = '${P3}'`);
ok(e6 === null, `round 8: other edits go through (${JSON.stringify(e6)})`);
// ...and a server write that did is undone by the last step.
await x(`INSERT INTO rehearsal_polls (id, band_id, created_by, title, invited_user_ids) VALUES ('${P1}', '${WB}', '${BB2}', 'Saturday?', ARRAY['${BB2}', '${X1}']::uuid[])`);
// Codex r6 (180:1142): a chat deleted by cascade takes its notices.
d = await x(`INSERT INTO chats VALUES ('${ZC}', 'band', '${ZB}', '${BB2}', NULL);
  INSERT INTO messages (chat_id, sender_id, content) VALUES ('${ZC}', '${BB2}', 'Gig moved to 9');
  INSERT INTO notifications (id, user_id, type, title, body, data) VALUES
    ('${NZ1}', '${BB2}', 'chat_message', 'Sam', 'Gig moved to 9', '{"chat_id":"${ZC}"}'),
    ('${NZ2}', '${BB2}', 'chat_mention', 'Sam', 'Gig moved to 9', '{"chatId":"${ZC}"}'),
    ('${NZ3}', '${BB2}', 'band_update', 'Bronx Brass', 'Band deleted', '{"chat_id":"${ZC}"}');
  DELETE FROM bands WHERE id = '${ZB}'`);
const nz = (await qq(`SELECT id::text AS id FROM notifications WHERE id IN ('${NZ1}', '${NZ2}', '${NZ3}') ORDER BY id`)).rows.map((r) => r.id);
ok(!d.error && JSON.stringify(nz) === JSON.stringify([NZ3]), `round 8 (Codex 180:1142): a band's chat deleted by cascade takes its chat notices, only those (${d.error ?? JSON.stringify(nz)})`);
// Claude r6 (M4): a NO ACTION column a check needs, and a row a guard
// won't let change: the last step deletes the first, logs and skips the
// second, and runs to the end.
d = await x(`INSERT INTO notifications (id, user_id, type, title, body, data) VALUES
    ('${NO1}', '${BB2}', 'chat_message', 'Sam', 'old', '{"chat_id":"${id(299)}"}'),
    ('${NO2}', '${BB2}', 'chat_message', 'Sam', 'odd', '{"chat_id":"not-a-uuid"}');
  CREATE TABLE public.test_signed (id serial PRIMARY KEY, signer uuid REFERENCES public.profiles(id), signed boolean,
    CHECK (NOT signed OR signer IS NOT NULL));
  INSERT INTO test_signed (signer, signed) VALUES ('${X1}', true), ('${X1}', false);
  CREATE TABLE public.test_locked (id serial PRIMARY KEY, owner uuid REFERENCES public.profiles(id));
  CREATE FUNCTION public.test_locked_guard() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'locked row'; END $f$;
  CREATE TRIGGER test_locked_guard BEFORE UPDATE ON public.test_locked FOR EACH ROW EXECUTE FUNCTION public.test_locked_guard();
  INSERT INTO test_locked (owner) VALUES ('${X1}')`);
ok(!d.error, `round 8: fixtures for the last step (${d.error ?? 'ok'})`);
const ac8 = (await qq(`SELECT blocks, on_delete FROM public.bw_account_deletion_author_columns() WHERE table_name = 'test_signed'`)).rows[0];
ok(ac8?.blocks === 'check' && ac8?.on_delete === 'restrict', `round 8 (Claude M4): a NO ACTION column with a check is a check first (${JSON.stringify(ac8)})`);
nn = await notices(`SELECT public.bw_account_deletion_finish('${X1}')`);
ok(!nn.some((m) => /^ERROR/.test(m)), `round 8 (Claude M4): the last step runs to the end (${JSON.stringify(nn)})`);
ok(nn.some((m) => /test_locked\.owner row skipped: locked row/.test(m)), `round 8 (Claude M4): the row it can't change is logged and skipped (${JSON.stringify(nn)})`);
const ts = (await qq(`SELECT signed, signer FROM test_signed ORDER BY id`)).rows;
ok(ts.length === 1 && ts[0].signed === false && ts[0].signer === null, `round 8 (Claude M4): the row the check needs them for goes, the other is cleared (${JSON.stringify(ts)})`);
const p1 = (await qq(`SELECT invited_user_ids::text[] AS i FROM rehearsal_polls WHERE id = '${P1}'`)).rows[0];
ok(JSON.stringify(p1?.i) === JSON.stringify([BB2]), `round 8 (Codex 180:725): the last step takes them off a poll a server write added them to (${JSON.stringify(p1)})`);
const no = (await qq(`SELECT id::text AS id FROM notifications WHERE id IN ('${NO1}', '${NO2}') ORDER BY id`)).rows.map((r) => r.id);
ok(JSON.stringify(no) === JSON.stringify([NO2]), `round 8 (Codex 180:1142): the last step removes chat notices whose chat is gone (${JSON.stringify(no)})`);
await x(`DROP TABLE test_locked; DROP TABLE test_signed`);
// Claude r6 nits: an index for the committed lookups; lapsed begun rows go.
const ix = (await qq(`SELECT indexdef FROM pg_indexes WHERE indexname = 'account_deletions_pending_committed'`)).rows[0];
ok(/WHERE \(committed_at IS NOT NULL\)/.test(ix?.indexdef ?? ''), `round 8 (Claude nit): a partial index on committed rows (${JSON.stringify(ix)})`);
await x(`INSERT INTO account_deletions_pending (user_id, started_at) VALUES ('${BB2}', now() - interval '20 minutes')`);
await notices(`SELECT public.bw_finish_account_deletions_dispatch()`);
ok((await qq(`SELECT 1 FROM account_deletions_pending WHERE user_id = '${BB2}'`)).rows.length === 0
   && (await qq(`SELECT 1 FROM account_deletions_pending WHERE user_id = '${X1}'`)).rows.length === 1,
  'round 8 (Claude nit): the job drops a begun deletion that lapsed, never a committed one');
await x(`DELETE FROM net.calls`);
// 192 guard (#291, applied after 180): its purge on messages and this
// trigger on chats, together: a cascade leaves no notice and nothing errors.
const P192 = 'supabase/migrations/192_chat_notification_purge.sql';
let loaded192 = false;
let src192 = null;
try {
  src192 = existsSync(`${REPO}/${P192}`) ? readFileSync(`${REPO}/${P192}`, 'utf8')
    : execFileSync('git', ['-C', REPO, 'show', `origin/fix/chat-audit:${P192}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch { src192 = null; }
if (!src192) {
  console.log(`SKIP 192 guard: ${P192} not in the repo and origin/fix/chat-audit not found`);
} else {
  d = await x(src192.split('\n').filter((l) => !/^\s*(BEGIN|COMMIT);\s*$/.test(l)).join('\n'));
  loaded192 = !d.error;
  if (d.error) {
    console.log(`SKIP 192 guard: 192 did not load on the stand-ins (${d.error})`);
  } else {
    const [GB, GCH, GM, GN1, GN2] = [221, 222, 223, 224, 225].map(id);
    d = await x(`INSERT INTO bands VALUES ('${GB}', 'Brooklyn Big Band'); INSERT INTO band_members VALUES ('${GB}','${BB2}','admin',true);
      INSERT INTO chats VALUES ('${GCH}', 'band', '${GB}', '${BB2}', NULL);
      INSERT INTO messages (id, chat_id, sender_id, content) VALUES ('${GM}', '${GCH}', '${BB2}', 'Soundcheck at 6');
      INSERT INTO notifications (id, user_id, type, title, body, data) VALUES
        ('${GN1}', '${BB2}', 'chat_message', 'Sam', 'Soundcheck at 6', '{"chat_id":"${GCH}","message_id":"${GM}"}'),
        ('${GN2}', '${BB2}', 'chat_mention', 'Sam', 'Soundcheck at 6', '{"chatId":"${GCH}"}')`);
    const del = await x(`DELETE FROM bands WHERE id = '${GB}'`);
    const left = (await qq(`SELECT count(*)::int AS n FROM notifications WHERE id IN ('${GN1}', '${GN2}')`)).rows[0]?.n;
    ok(!d.error && !del.error && left === 0, `192 guard: with 192's purge, a band deleted by cascade leaves no chat notice and nothing errors (${d.error ?? del.error ?? left})`);
  }
}


// ── Codex and Claude reviews #282, round 9 (of 85393e10) ───────────────────
// X1 is committed (round 8, never deleted from Auth); BB2 lives.
const NOPROF = id(297);
const P4 = id(231), P5 = id(232), P6 = id(233), NR9 = [234, 235, 236, 237, 238].map(id);
// Codex B2: a notification from a sender being deleted, or gone, is never
// written (checked in the insert, after #291's 192 when it loaded).
const noteIns = async (nid, data) => x(`INSERT INTO notifications (id, user_id, type, title, body, data)
  VALUES ('${nid}', '${BB2}', 'chat_message', 'x', 'call me', '${JSON.stringify(data)}'::jsonb)`);
const stored = async (nid) => (await qq(`SELECT 1 FROM notifications WHERE id = '${nid}'`)).rows.length === 1;
let ins = [await noteIns(NR9[0], { chat_id: ZC, sender_id: X1 }), await noteIns(NR9[1], { chatId: ZC, senderId: NOPROF }),
  await noteIns(NR9[2], { suggestion_id: id(239), by: X1 }), await noteIns(NR9[3], { chat_id: ZC, sender_id: BB2 }),
  await noteIns(NR9[4], { member_name: 'Former member' })];
ok(ins.every((r) => !r.error), `round 9: the inserts themselves never fail (${JSON.stringify(ins.map((r) => r.error ?? 'ok'))})`);
ok(!(await stored(NR9[0])) && !(await stored(NR9[1])) && !(await stored(NR9[2])),
  `round 9 (Codex B2${loaded192 ? ', with 192' : ''}): a notice from a sender being deleted, a sender gone, or a deleting suggestion actor is not written`);
ok((await stored(NR9[3])) && (await stored(NR9[4])), `round 9 (Codex B2): the others' notices, and notices with no actor, are`);
// Codex B4: their other device deletes nothing.
e6 = await errAs(X1, `DELETE FROM rehearsal_polls WHERE id = '${P3}'`);
ok(refused(e6) && (await qq(`SELECT 1 FROM rehearsal_polls WHERE id = '${P3}'`)).rows.length === 1,
  `round 9 (Codex B4): once committed, their other device can't delete a band's poll (${JSON.stringify(e6)})`);
e6 = await errAs(BB2, `DELETE FROM rehearsal_polls WHERE id = '${P3}'`);
ok(e6 === null, `round 9 (Codex B4): the band still can (${JSON.stringify(e6)})`);
// Claude 1: archived objects and delete markers are not files left.
d = await x(`ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS archived_at timestamptz, ADD COLUMN IF NOT EXISTS is_delete_marker boolean,
    ADD COLUMN IF NOT EXISTS version text;
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id, archived_at, is_delete_marker, version) VALUES
    ('personal-files', '${X1}/old.m4a', NULL, NULL, now(), false, 'v-old'), ('avatars', '${X1}/me.png', NULL, NULL, NULL, true, 'v-marker'),
    ('personal-files', '${X1}/live.m4a', NULL, NULL, NULL, false, 'v-live-1'), ('personal-files', '${X1}/live.m4a', NULL, NULL, now(), false, 'v-live-0')`);
const rel9 = (await q(`SELECT public.bw_account_storage_release('${X1}') AS r`)).rows?.[0]?.r;
nm = await names8('personal-files', X1);
const nmAv = await names8('avatars', X1);
ok(!d.error && rel9?.personal_left === 1, `round 9 (Claude 1): archived rows and delete markers don't count (${d.error ?? JSON.stringify(rel9)})`);
// Round 11 (Claude r10 F6): Storage's remove by name deletes only the
// current row, so names are the files (live rows); every old version and
// marker is listed by version, to purge by version. A name with only
// archived rows is never removed by name.
const vers = async (b, p, an = null, av = null, lim = 1000) =>
  q(`SELECT name, version FROM public.bw_account_storage_versions('${b}', '${p}', ${an ? `'${an}'` : 'NULL'}, ${av ? `'${av}'` : 'NULL'}, ${lim})`);
const vPf = await vers('personal-files', X1), vAv = await vers('avatars', X1);
ok(!nm.error && JSON.stringify(nm.rows.map((r) => r.n)) === JSON.stringify([`${X1}/live.m4a`]) && !nmAv.error && nmAv.rows.length === 0,
  `round 11 (Claude r10 F6): names to remove by name are the live files only (${nm.error ?? nmAv.error ?? JSON.stringify({ nm: nm.rows, nmAv: nmAv.rows })})`);
ok(!vPf.error && !vAv.error
   && JSON.stringify(vPf.rows.map((r) => [r.name, r.version])) === JSON.stringify([[`${X1}/live.m4a`, 'v-live-0'], [`${X1}/old.m4a`, 'v-old']])
   && JSON.stringify(vAv.rows.map((r) => [r.name, r.version])) === JSON.stringify([[`${X1}/me.png`, 'v-marker']]),
  `round 11 (Claude r10 F6): their archived versions and delete markers are listed by version for the purge (${vPf.error ?? vAv.error ?? JSON.stringify({ vPf: vPf.rows, vAv: vAv.rows })})`);
const vPage = await vers('personal-files', X1, `${X1}/live.m4a`, 'v-live-0', 1);
ok(!vPage.error && JSON.stringify(vPage.rows.map((r) => r.version)) === JSON.stringify(['v-old']), `round 11: keyset pages by (name, version) (${vPage.error ?? JSON.stringify(vPage.rows)})`);
const vEmpty = await q(`SELECT * FROM public.bw_account_storage_versions('personal-files', '')`);
ok(!!vEmpty.error, 'round 11: an empty prefix (the whole bucket) is refused');
await x(`DELETE FROM storage.objects WHERE name = '${X1}/live.m4a'`);
d = await q(`SELECT public.bw_account_deletion_finish('${X1}')`);
ok(!d.error, `round 9 (Claude 1): so the last step isn't stuck on them (${d.error ?? 'ok'})`);
await x(`DELETE FROM storage.objects WHERE name IN ('${X1}/old.m4a', '${X1}/me.png'); ALTER TABLE storage.objects DROP COLUMN archived_at, DROP COLUMN is_delete_marker, DROP COLUMN version`);
const vNone = await q(`SELECT * FROM public.bw_account_storage_versions('personal-files', '${X1}')`);
ok(!vNone.error && vNone.rows.length === 0, `round 11: no versions on a setup without them (${vNone.error ?? vNone.rows.length})`);
// Claude 4: one statement per column first.
d = await x(`CREATE TABLE public.test_bulk (id serial PRIMARY KEY, owner uuid REFERENCES public.profiles(id));
  CREATE TABLE public.test_bulk_statements (n int); INSERT INTO test_bulk_statements VALUES (0);
  CREATE FUNCTION public.test_bulk_count() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN UPDATE test_bulk_statements SET n = n + 1; RETURN NULL; END $f$;
  CREATE TRIGGER test_bulk_count AFTER UPDATE ON public.test_bulk FOR EACH STATEMENT EXECUTE FUNCTION public.test_bulk_count();
  INSERT INTO test_bulk (owner) VALUES ('${X1}'), ('${X1}'), ('${X1}'), ('${X1}')`);
d = d.error ? d : await q(`SELECT public.bw_account_deletion_release_refs('${X1}')`);
const bulk = (await qq(`SELECT (SELECT n FROM test_bulk_statements) AS n, (SELECT count(*)::int FROM test_bulk WHERE owner IS NOT NULL) AS left`)).rows[0];
ok(!d.error && bulk?.n === 1 && bulk?.left === 0, `round 9 (Claude 4): a NO ACTION column is cleared in one statement, not row by row (${d.error ?? JSON.stringify(bulk)})`);
await x(`DROP TABLE test_bulk; DROP TABLE test_bulk_statements`);
// Claude 6: their own push logs go, not kept with no user.
await x(`INSERT INTO notification_logs (user_id) VALUES ('${X1}'), ('${X1}'), ('${BB2}')`);
const logsBefore = (await qq(`SELECT count(*)::int AS n FROM notification_logs WHERE user_id IS NULL`)).rows[0]?.n;
d = await q(`SELECT public.bw_account_deletion_release_refs('${X1}')`);
const logs9 = (await qq(`SELECT (SELECT count(*)::int FROM notification_logs WHERE user_id IS NULL) AS nulls,
  (SELECT count(*)::int FROM notification_logs WHERE user_id = '${X1}') AS theirs, (SELECT count(*)::int FROM notification_logs WHERE user_id = '${BB2}') AS others`)).rows[0];
ok(!d.error && logs9?.nulls === logsBefore && logs9?.theirs === 0 && logs9?.others === 1,
  `round 9 (Claude 6): their notification logs are deleted, not left without a user (${d.error ?? JSON.stringify({ logsBefore, logs9 })})`);
// Claude 7a: a NO ACTION events.created_by is cleared, not skipped.
const evFk = (await qq(`SELECT conname FROM pg_constraint WHERE conrelid = 'public.events'::regclass AND contype = 'f'`)).rows[0]?.conname;
d = await x(`ALTER TABLE events DROP CONSTRAINT ${evFk}; ALTER TABLE events ADD CONSTRAINT ${evFk} FOREIGN KEY (created_by) REFERENCES public.profiles(id);
  INSERT INTO events (id, band_id, created_by, title) VALUES ('${id(240)}', '${WB}', '${X1}', 'Harlem brunch')`);
d = d.error ? d : await q(`SELECT public.bw_account_deletion_release_refs('${X1}')`);
const ev9 = (await qq(`SELECT created_by FROM events WHERE id = '${id(240)}'`)).rows[0];
ok(!d.error && ev9 && ev9.created_by === null, `round 9 (Claude 7): a NO ACTION events.created_by is cleared for Auth (${d.error ?? JSON.stringify(ev9)})`);
await x(`DELETE FROM events WHERE id = '${id(240)}'; ALTER TABLE events DROP CONSTRAINT ${evFk};
  ALTER TABLE events ADD CONSTRAINT ${evFk} FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL`);
// Claude 7b: a poll whose only invitee goes never becomes {NULL}.
d = await x(`INSERT INTO rehearsal_polls (id, band_id, created_by, title, invited_user_ids, status) VALUES
  ('${P4}', '${WB}', NULL, 'Tuesday?', ARRAY['${X1}']::uuid[], 'polling')`);
d = d.error ? d : await q(`SELECT public.bw_account_deletion_polls('${X1}')`);
const p4 = (await qq(`SELECT invited_user_ids::text[] AS i, status FROM rehearsal_polls WHERE id = '${P4}'`)).rows[0];
ok(!d.error && JSON.stringify(p4?.i) === JSON.stringify([BB2]) && p4.status === 'cancelled',
  `round 9 (Claude 7): its creator gone too, it goes to the band's admins, closed, never {NULL} (${d.error ?? JSON.stringify(p4)})`);
// Claude 5: a stale save can't write a deleted account back.
d = await x(`INSERT INTO rehearsal_polls (id, band_id, created_by, title, invited_user_ids) VALUES
    ('${P5}', '${WB}', '${BB2}', 'Wednesday?', ARRAY['${BB2}', '${NOPROF}', NULL]::uuid[]),
    ('${P6}', '${WB}', '${BB2}', 'Thursday?', ARRAY['${NOPROF}']::uuid[])`);
let p56 = (await qq(`SELECT id::text AS id, invited_user_ids::text[] AS i FROM rehearsal_polls WHERE id IN ('${P5}', '${P6}') ORDER BY id`)).rows;
ok(!d.error && JSON.stringify(p56.map((r) => r.i)) === JSON.stringify([[BB2], [BB2]]),
  `round 9 (Claude 5): only invitees with an account are kept; none left: the creator (${d.error ?? JSON.stringify(p56)})`);
e6 = await errAs(BB2, `UPDATE rehearsal_polls SET invited_user_ids = ARRAY['${BB2}', '${NOPROF}']::uuid[] WHERE id = '${P5}'`);
p56 = (await qq(`SELECT invited_user_ids::text[] AS i FROM rehearsal_polls WHERE id = '${P5}'`)).rows[0];
ok(e6 === null && JSON.stringify(p56?.i) === JSON.stringify([BB2]), `round 9 (Claude 5): a stale save drops the deleted account (${JSON.stringify({ e6, p56 })})`);

// ── Claude review #282, round 10 (of d8f5861b) ──────────────────────────────
// Y1's deletion is committed too; band NB has Y1 as its only admin.
const Y1 = id(241), NB = id(242), P7 = id(243), P7B = id(244), P8 = id(245), P9 = id(246);
d = await x(`INSERT INTO auth.users VALUES ('${Y1}'); INSERT INTO profiles (id) VALUES ('${Y1}');
  INSERT INTO bands VALUES ('${NB}', 'Hoboken Trio'); INSERT INTO band_members VALUES ('${NB}','${Y1}','admin',true), ('${NB}','${X1}','member',true);
  INSERT INTO account_deletions_pending (user_id, started_at, committed_at) VALUES ('${Y1}', now(), now())`);
ok(!d.error, `round 10: set-up (${d.error ?? 'ok'})`);
// Claude r9 3, r10 F4: no live creator, no live admin: deleted, never '{}'
// (the whole band, 098), never a committed creator, never kept with a
// deleted id.
d = await x(`INSERT INTO rehearsal_polls (id, band_id, created_by, title, invited_user_ids, status) VALUES
  ('${P7}', '${NB}', '${Y1}', 'Friday?', ARRAY['${X1}']::uuid[], 'polling'),
  ('${P7B}', '${NB}', NULL, 'Saturday?', ARRAY['${X1}']::uuid[], 'polling')`);
d = d.error ? d : await q(`SELECT public.bw_account_deletion_polls('${X1}')`);
const p7 = (await qq(`SELECT id::text AS id, invited_user_ids::text[] AS i, status FROM rehearsal_polls WHERE id IN ('${P7}', '${P7B}') ORDER BY id`)).rows;
ok(!d.error && p7.length === 0,
  `round 11 (Claude r10 F4): with nobody live, the poll is deleted, never '{}', a committed creator or a deleted id (${d.error ?? JSON.stringify(p7)})`);
d = await x(`INSERT INTO rehearsal_polls (id, band_id, created_by, title, invited_user_ids, status) VALUES
  ('${P8}', '${NB}', '${Y1}', 'Sunday?', ARRAY['${NOPROF}']::uuid[], 'polling')`);
const p8 = (await qq(`SELECT invited_user_ids::text[] AS i, status FROM rehearsal_polls WHERE id = '${P8}'`)).rows[0];
ok(!d.error && !p8, `round 11 (Claude r10 F4): an insert listing only gone accounts, nobody live: not stored, never '{}' (${d.error ?? JSON.stringify(p8)})`);
// '{NULL}' is never stored: with someone live it goes to them, else not at all.
const [P10, P11, P12, OP10] = [247, 248, 249, 250].map(id);
d = await x(`INSERT INTO rehearsal_polls (id, band_id, created_by, title, invited_user_ids, status) VALUES
  ('${P11}', '${WB}', '${BB2}', 'Tuesday?', ARRAY[NULL]::uuid[], 'polling'),
  ('${P12}', '${NB}', '${Y1}', 'Wednesday?', ARRAY[NULL]::uuid[], 'polling')`);
const p1112 = (await qq(`SELECT id::text AS id, invited_user_ids::text[] AS i FROM rehearsal_polls WHERE id IN ('${P11}', '${P12}') ORDER BY id`)).rows;
ok(!d.error && JSON.stringify(p1112) === JSON.stringify([{ id: P11, i: [BB2] }]),
  `round 11 (Claude r10 F4): '{NULL}' is never stored: its creator, else not kept (${d.error ?? JSON.stringify(p1112)})`);
// An update leaving nobody live deletes the poll, votes and options with it.
d = await x(`INSERT INTO rehearsal_polls (id, band_id, created_by, title, invited_user_ids, status) VALUES
    ('${P10}', '${NB}', '${Y1}', 'Thursday?', '{}', 'polling');
  INSERT INTO rehearsal_poll_options (id, poll_id) VALUES ('${OP10}', '${P10}');
  INSERT INTO rehearsal_poll_votes (poll_id, option_id, user_id) VALUES ('${P10}', '${OP10}', '${Y1}')`);
const upd = d.error ? d : await x(`UPDATE rehearsal_polls SET invited_user_ids = ARRAY[NULL, '${NOPROF}']::uuid[] WHERE id = '${P10}'`);
const p10 = (await qq(`SELECT (SELECT count(*)::int FROM rehearsal_polls WHERE id = '${P10}') AS polls,
  (SELECT count(*)::int FROM rehearsal_poll_votes WHERE poll_id = '${P10}') AS votes`)).rows[0];
ok(!d.error && !upd.error && p10?.polls === 0 && p10?.votes === 0,
  `round 11 (Claude r10 F4): an update leaving nobody live deletes the poll and its votes, never '{NULL}' (${d.error ?? upd.error ?? JSON.stringify(p10)})`);
const nulls = (await qq(`SELECT count(*)::int AS n FROM rehearsal_polls WHERE array_position(invited_user_ids, NULL) IS NOT NULL`)).rows[0]?.n;
ok(nulls === 0, `round 11 (Claude r10 F4): no poll anywhere holds a NULL invitee (${nulls})`);
// A co-admin's stale save on a poll whose creator is committed: no
// "Choose someone else", the band's live admins get it.
d = await x(`INSERT INTO rehearsal_polls (id, band_id, created_by, title, invited_user_ids, status) VALUES
  ('${P9}', '${WB}', '${Y1}', 'Monday?', ARRAY['${BB2}', '${NOPROF}']::uuid[], 'polling')`);
e6 = d.error ? { message: d.error } : await errAs(BB2, `UPDATE rehearsal_polls SET invited_user_ids = ARRAY['${NOPROF}']::uuid[] WHERE id = '${P9}'`);
const p9 = (await qq(`SELECT invited_user_ids::text[] AS i FROM rehearsal_polls WHERE id = '${P9}'`)).rows[0];
ok(e6 === null && JSON.stringify(p9?.i) === JSON.stringify([BB2]),
  `round 10 (Claude r9 3): a co-admin's stale save never gets the committed creator back ("Choose someone else") (${JSON.stringify({ e6, p9 })})`);
await x(`DELETE FROM rehearsal_polls WHERE id IN ('${P7}', '${P7B}', '${P8}', '${P9}', '${P10}', '${P11}', '${P12}'); DELETE FROM account_deletions_pending WHERE user_id = '${Y1}';
  DELETE FROM band_members WHERE band_id = '${NB}'; DELETE FROM bands WHERE id = '${NB}'`);

// Cross-PR (#297's 195 revokes EXECUTE on bw_poll_vote_deadline from
// authenticated): 180 running after it must not grant it back.
await x(`REVOKE EXECUTE ON FUNCTION public.bw_poll_vote_deadline(uuid) FROM authenticated`);
d = await x(readFileSync(MIG, 'utf8'));
const dlg = (await qq(`SELECT has_function_privilege('authenticated', 'public.bw_poll_vote_deadline(uuid)', 'EXECUTE') AS a`)).rows[0];
ok(!d.error && dlg?.a === false, `180 again after 195: the deadline stays revoked from clients (${d.error ?? JSON.stringify(dlg)})`);

// Cross-PR (#295's 197, Claude review round 5): 180's withdraw returns only
// the files no other song uses once 197's bw_song_files_left_unused exists
// (either apply order), and all of them without it.
const [SB1, SS1, SS2, SG7, SG8] = [141, 142, 143, 144, 145].map(id);
const shared = `sb://song-files/${T9}/songs/shared.m4a`;
const own = (n) => `sb://song-files/${T9}/suggestions/${CC}/${n}.pdf`;
await x(`INSERT INTO songs (id, band_id, title, status, audio_url, chart_url) VALUES
    ('${SB1}', '${T9}', 'Take Five', 'active', '${shared}', NULL),
    ('${SS1}', '${T9}', 'Blue Rondo', 'suggested', '${shared}', '${own('a')}'),
    ('${SS2}', '${T9}', 'Strange Meadow Lark', 'suggested', '${shared}', '${own('b')}');
  INSERT INTO song_suggestions (id, band_id, song_id, status, created_by, kind) VALUES
    ('${SG7}', '${T9}', '${SS1}', 'pending', '${CC}', 'new_song'), ('${SG8}', '${T9}', '${SS2}', 'pending', '${CC}', 'new_song')`);
let wd = await as(CC, `SELECT public.bw_withdraw_song_suggestion('${SG7}') AS r`);
ok(JSON.stringify(wd.rows?.[0]?.r?.files) === JSON.stringify([shared, own('a')]), `withdraw without 197: both files, as before (${wd.error ?? JSON.stringify(wd.rows?.[0]?.r)})`);
const P197 = 'supabase/migrations/197_song_files_adopted.sql';
let src197 = null;
try {
  src197 = existsSync(`${REPO}/${P197}`) ? readFileSync(`${REPO}/${P197}`, 'utf8')
    : execFileSync('git', ['-C', REPO, 'show', `origin/fix/songs-audit:${P197}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch { src197 = null; }
// Helpers come and go between 197's rounds (json_needle → json_paths):
// load the ones there, require the ones withdraw's path needs.
// 197 round 10 builds some from the catalog (DO $do$ … EXECUTE format):
// those load as their whole DO block.
const fn197 = (src, name) => {
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) return null;
  const doAt = src.lastIndexOf('DO $do$', start);
  if (doAt >= 0 && doAt > src.lastIndexOf('$do$;', start)) {
    const end = src.indexOf('$do$;', start);
    return end < 0 ? null : src.slice(doAt, end + '$do$;'.length);
  }
  return fnByName(src, name);
};
const names197 = ['bw_song_file_ref', 'bw_song_file_json_needle', 'bw_song_file_json_paths', 'bw_song_file_in_suggestion',
  'bw_song_file_stored', 'bw_song_file_copy_ours',
  'bw_song_file_in_use', 'bw_song_file_lock_key', 'bw_song_file_band_key', 'bw_song_files_claim_for', 'bw_song_files_left_unused'];
const need197 = ['bw_song_file_ref', 'bw_song_file_in_use', 'bw_song_files_claim_for', 'bw_song_files_left_unused'];
const f197 = src197 && need197.every((n) => fn197(src197, n)) ? names197.map((n) => fn197(src197, n)).filter(Boolean) : null;
if (!src197) {
  console.log(`SKIP 197 guard: ${P197} not in the repo and origin/fix/songs-audit not found`);
} else {
  ok(!!f197, "197 guard: 197's file functions found by name");
}
if (f197) {
  d = await x(`ALTER TABLE song_suggestions ADD COLUMN IF NOT EXISTS proposed jsonb NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS original jsonb NOT NULL DEFAULT '{}', ADD COLUMN IF NOT EXISTS applied jsonb,
      ADD COLUMN IF NOT EXISTS message text, ADD COLUMN IF NOT EXISTS reason text;
    CREATE TABLE IF NOT EXISTS public.song_file_removals (path text PRIMARY KEY, band_id uuid NOT NULL, claimed_by uuid, claimed_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS public.song_file_adoptions (from_path text, state text, deleting_at timestamptz);
    ALTER TABLE public.song_file_adoptions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
      ADD COLUMN IF NOT EXISTS band_id uuid, ADD COLUMN IF NOT EXISTS song_id uuid, ADD COLUMN IF NOT EXISTS field text,
      ADD COLUMN IF NOT EXISTS to_path text, ADD COLUMN IF NOT EXISTS claimed_by uuid, ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
      ADD COLUMN IF NOT EXISTS deleting_by uuid, ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
    CREATE OR REPLACE FUNCTION public.bw_is_band_admin(p_band uuid, p_uid uuid DEFAULT auth.uid()) RETURNS boolean LANGUAGE sql STABLE AS
      $f$ SELECT EXISTS (SELECT 1 FROM band_members WHERE band_id = p_band AND user_id = p_uid AND role = 'admin') $f$;
    CREATE OR REPLACE FUNCTION public.bw_my_band_ids() RETURNS text[] LANGUAGE sql STABLE AS
      $f$ SELECT coalesce(array_agg(band_id::text), '{}') FROM band_members WHERE user_id = auth.uid() $f$;
    ${f197.join('\n')}`);
  ok(!d.error, `197 guard: 197's functions loaded (${d.error ?? 'ok'})`);
  d = await x(readFileSync(MIG, 'utf8'));
  ok(!d.error, `197 guard: then 180 (${d.error ?? 'ok'})`);
  // 197 round 10 returns only files that are in Storage (bw_song_file_stored).
  await x(`INSERT INTO storage.objects (bucket_id, name) VALUES
    ('song-files', '${shared.slice('sb://song-files/'.length)}'), ('song-files', '${own('b').slice('sb://song-files/'.length)}')`);
  wd = await as(CC, `SELECT public.bw_withdraw_song_suggestion('${SG8}') AS r`);
  const files = wd.rows?.[0]?.r?.files;
  ok(Array.isArray(files) && !files.includes(shared) && files.includes(own('b')),
    `197 guard: withdraw never returns a file another song uses (${wd.error ?? JSON.stringify(wd.rows?.[0]?.r)})`);
  ok((await qq(`SELECT 1 FROM songs WHERE id = '${SS2}'`)).rows.length === 0, '197 guard: the suggested song is deleted');
  ok((await qq(`SELECT path FROM song_file_removals`)).rows.map((r) => r.path).join() === `${T9}/suggestions/${CC}/b.pdf`,
    '197 guard: and what it returns is claimed, as 197 does');
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
