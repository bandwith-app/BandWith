// The release, applied in order, proves itself (docs/release-checklist.md,
// section 1 "PGlite integration run on main"; main, 11-22).
//
// Part 1, always: supabase/checks/release_migrations.sql and
// redefined_functions.sql run (they are plain SQL a typo can break) and, on
// a database with none of the release, every row is false.
//
// Part 2, with a base: supabase/tests/fixtures/base_schema.sql (a schema-only
// dump of prod, see fixtures/README.md) is loaded on the Supabase stubs
// below, then every migration of supabase/checks/release-sources.txt in that
// order: the file on the checkout, else origin/<branch> (named in a PENDING
// line: the runner treats a failure then as a warning). After the last one
// every row of release_migrations.sql must be true (177 is not in the
// release) and every row of redefined_functions.sql ok. Each false row is
// printed with its source PR. No base: SKIP (exit 0; a strict CI run fails).
//
//   cp <repo>/supabase/tests/release_integration.pglite.mjs . && node release_integration.pglite.mjs <repo>
//   node release_integration.pglite.mjs <repo> /dev/null    # base only, no migrations: FAILs expected
//   BW_RELEASE_ONLY=173,174 node release_integration.pglite.mjs <repo>   # only these (their rows true)
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO = process.argv[2];
const NO_MIGRATIONS = process.argv[3] === '/dev/null';
const ONLY = process.env.BW_RELEASE_ONLY ? new Set(process.env.BW_RELEASE_ONLY.split(',').map((s) => s.trim())) : null;
const BASE = `${REPO}/supabase/tests/fixtures/base_schema.sql`;
const read = (p) => readFileSync(`${REPO}/${p}`, 'utf8');
const RELEASE = read('supabase/checks/release_migrations.sql');
const REDEF = read('supabase/checks/redefined_functions.sql');
const sources = read('supabase/checks/release-sources.txt')
  .split('\n')
  .filter((l) => /^\d{3}\s/.test(l))
  .map((l) => l.trim().split(/\s+/))
  .map(([n, pr, branch]) => ({ n, pr, branch }));

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) fails++;
  console.log(cond ? 'ok  ' : 'FAIL', msg);
};
process.on('unhandledRejection', (e) => {
  console.log('ERROR', e?.message ?? e);
  process.exit(2);
});

// What a Supabase database has that PGlite doesn't: roles, auth, storage,
// pg_cron and pg_net (signatures only), the realtime publication.
const STUBS = `
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE ROLE supabase_auth_admin NOLOGIN; CREATE ROLE supabase_storage_admin NOLOGIN; CREATE ROLE authenticator NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, phone text,
  raw_user_meta_data jsonb DEFAULT '{}', raw_app_meta_data jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(), deleted_at timestamptz, banned_until timestamptz, last_sign_in_at timestamptz,
  email_confirmed_at timestamptz, is_anonymous boolean DEFAULT false);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $f$ SELECT nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $f$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $f$ SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'role' $f$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $f$ SELECT coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb $f$;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text,
  owner uuid, metadata jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
  $f$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $f$;
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (jobid bigserial PRIMARY KEY, schedule text, command text, jobname text UNIQUE, active boolean DEFAULT true);
CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
  $f$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
      ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $f$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS
  $f$ WITH d AS (DELETE FROM cron.job WHERE jobname = job_name RETURNING 1) SELECT count(*) > 0 FROM d $f$;
CREATE SCHEMA IF NOT EXISTS net;
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}',
  headers jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $f$ SELECT 1::bigint $f$;
DO $$ BEGIN CREATE PUBLICATION supabase_realtime; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

const fresh = async () => {
  const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  await db.exec(STUBS);
  return db;
};
const rows = async (db, sql) => (await db.query(sql)).rows;

// ── Part 1: the check files run, and nothing of the release is there ───────
{
  const db = await fresh();
  let rel = [];
  let red = [];
  try {
    rel = await rows(db, RELEASE);
    ok(true, `release_migrations.sql runs (${rel.length} rows)`);
  } catch (e) {
    ok(false, `release_migrations.sql runs: ${e.message}`);
  }
  try {
    red = await rows(db, REDEF);
    ok(true, `redefined_functions.sql runs (${red.length} rows)`);
  } catch (e) {
    ok(false, `redefined_functions.sql runs: ${e.message}`);
  }
  const listed = new Set(rel.map((r) => r.migration));
  ok(sources.every((s) => listed.has(s.n)), 'release_migrations.sql has a row for every migration of release-sources.txt');
  ok(rel.length > 0 && rel.every((r) => r.applied === false), `stubs only: no migration of the release reads as in (${rel.filter((r) => r.applied).map((r) => r.migration).join(', ') || 'none'})`);
  ok(red.length > 0 && red.every((r) => r.ok === false), `stubs only: no redefined function reads as ok (${red.filter((r) => r.ok).map((r) => r.function).join(', ') || 'none'})`);
  ok(rel.every((r) => /^#\d+$/.test(r.source ?? '') || r.migration === '172' || r.migration === '177'), 'every row names its source PR');
}

// ── Part 2: base + the release in order ──────────────────────────────────────
if (!existsSync(BASE)) {
  console.log('SKIP integration: no supabase/tests/fixtures/base_schema.sql (a schema-only dump of prod; fixtures/README.md)');
  if (!ONLY) {
    console.log(fails ? `${fails} FAILED` : 'part 1 OK');
    process.exit(fails ? 1 : 0);
  }
}
const db = await fresh();
if (existsSync(BASE)) await db.exec(readFileSync(BASE, 'utf8'));

const onCheckout = new Map(readdirSync(`${REPO}/supabase/migrations`).map((f) => [f.slice(0, 3), f]));
const pending = [];
const sqlOf = ({ n, branch }) => {
  if (onCheckout.has(n)) return readFileSync(`${REPO}/supabase/migrations/${onCheckout.get(n)}`, 'utf8');
  const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  try {
    const file = git('ls-tree', '--name-only', `origin/${branch}`, 'supabase/migrations/').split('\n').find((f) => f.startsWith(`supabase/migrations/${n}_`));
    if (!file) return null;
    pending.push(n);
    return git('show', `origin/${branch}:${file}`);
  } catch {
    return null;
  }
};
const chosen = sources.filter((s) => !ONLY || ONLY.has(s.n));
const missing = [];
const loaded = [];
for (const s of chosen) {
  const sql = sqlOf(s);
  if (sql == null) missing.push(`${s.n} (${s.pr} ${s.branch})`);
  else loaded.push({ ...s, sql });
}
if (pending.length) console.log(`PENDING ${pending.join(' ')}`);
if (missing.length) {
  console.log(`SKIP integration: not on the checkout nor on a reachable branch: ${missing.join(', ')}`);
  console.log(fails ? `${fails} FAILED` : 'part 1 OK');
  process.exit(fails ? 1 : 0);
}
if (!NO_MIGRATIONS) {
  // 170 needs the live pack off before it starts its invites (checklist step 2).
  for (const s of loaded) {
    try {
      await db.exec(s.sql);
      console.log(`ok   applied ${s.n} (${s.pr}${onCheckout.has(s.n) ? '' : `, from origin/${s.branch}`})`);
      if (s.n === '173') await db.exec(`UPDATE public.app_flags SET enabled = false, updated_at = now() WHERE key = 'live_pack'`);
    } catch (e) {
      ok(false, `apply ${s.n} (${s.pr}): ${e.message}`);
      break;
    }
  }
}
const want = new Set(loaded.map((s) => s.n));
const rel = await rows(db, RELEASE);
for (const r of rel.filter((r) => want.has(r.migration))) ok(r.applied === true, `${r.migration} is in (proof from ${r.source ?? '?'}: ${r.proof})`);
if (!ONLY) {
  for (const r of await rows(db, REDEF)) ok(r.ok === true, `${r.function}: ${r.final_migration}'s body is live (replaces ${r.replaces})`);
}
console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
