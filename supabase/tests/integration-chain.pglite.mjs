// The whole chain on one database (Codex, #278; docs/release-checklist.md,
// section 1 "PGlite integration run on main").
//
// Part 1: supabase/checks/release_migrations.sql and redefined_functions.sql
// run on the Supabase stubs (plain SQL a typo can break), and with none of
// the release every row is false.
//
// Part 2, one database:
//   1. the stubs (what Supabase has and PGlite doesn't), then every migration
//      of the checkout from 001 in order, but the release's
//      (supabase/checks/release-sources.txt) and 177. The pieces prod has
//      that no migration made come from supabase/tests/fixtures/replay-bridge.sql
//      (its header says how). 172 is already live: its row must be true here.
//   2. the release, in the order of release-sources.txt (= the checklist's
//      apply order, section 2), with the live pack switched off right after
//      173 (step 2). A migration on the checkout is read from it (merged:
//      main's file); one not merged yet from its PR's head:
//        default                     origin/<branch> (the branch tip)
//        BW_RELEASE_AT=verified      every PR at the SHA in the 4th column
//        BW_RELEASE_HEADS=273=5b569d4a,281=origin/fix/x
//                                    these PRs at these refs (main hands out
//                                    the frozen heads before the merge)
//      Each one read from a branch is named in a PENDING line (the runner
//      treats a failure then as a warning until all of the release is on
//      main); one read at an exact SHA (frozen heads) in a PINNED line, which
//      a strict run (BW_PGLITE_STRICT=1) accepts. A head whose file differs from the verified SHA's prints a WARN.
//   3. every row of release_migrations.sql true but 177 (false: not in the
//      release) and every row of redefined_functions.sql ok. A false row
//      prints its source PR and its proof.
//
//   cp <repo>/supabase/tests/integration-chain.pglite.mjs . && node integration-chain.pglite.mjs <repo>
//   BW_RELEASE_AT=verified node integration-chain.pglite.mjs <repo>
//   BW_CHAIN_MAIN_ONLY=1 node integration-chain.pglite.mjs <repo>   # stop after step 1 (bridge work)
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO = process.argv[2];
if (!REPO) {
  console.log('usage: node integration-chain.pglite.mjs <repo>');
  process.exit(2);
}
const read = (p) => readFileSync(`${REPO}/${p}`, 'utf8');
const RELEASE = read('supabase/checks/release_migrations.sql');
const REDEF = read('supabase/checks/redefined_functions.sql');
const BRIDGE = read('supabase/tests/fixtures/replay-bridge.sql');
const sources = read('supabase/checks/release-sources.txt')
  .split('\n')
  .filter((l) => /^\d{3}\s/.test(l))
  .map((l) => l.trim().split(/\s+/))
  .map(([n, pr, branch, verified]) => ({ n, pr, branch, verified }));
const NOT_IN_RELEASE = new Set(['177']);
const ALREADY_LIVE = ['172'];

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) fails++;
  console.log(cond ? 'ok  ' : 'FAIL', msg);
};
const done = () => {
  console.log(fails ? `${fails} FAILED` : 'ALL OK');
  process.exit(fails ? 1 : 0);
};
process.on('unhandledRejection', (e) => {
  console.log('ERROR', e?.message ?? e);
  process.exit(2);
});
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });

// What a Supabase database has that PGlite doesn't (signatures only where
// that is enough): roles, auth, storage, vault, pg_cron, pg_net, realtime.
const STUBS = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE supabase_auth_admin NOLOGIN; CREATE ROLE supabase_storage_admin NOLOGIN; CREATE ROLE authenticator NOLOGIN;
CREATE ROLE supabase_realtime_admin NOLOGIN; CREATE ROLE supabase_admin NOLOGIN;
CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA vault; CREATE SCHEMA cron; CREATE SCHEMA net; CREATE SCHEMA extensions; CREATE SCHEMA realtime;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, phone text, raw_user_meta_data jsonb DEFAULT '{}',
  raw_app_meta_data jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz,
  banned_until timestamptz, last_sign_in_at timestamptz, email_confirmed_at timestamptz, is_anonymous boolean DEFAULT false);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', 'anon') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}') $$;
CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$ SELECT auth.jwt() ->> 'email' $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[],
  owner uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb,
  version text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), last_accessed_at timestamptz,
  archived_at timestamptz, is_delete_marker boolean DEFAULT false);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
  $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
CREATE FUNCTION storage.filename(name text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text, description text);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret, description FROM vault.secrets;
CREATE FUNCTION vault.create_secret(s text, n text DEFAULT NULL, d text DEFAULT NULL) RETURNS uuid LANGUAGE sql AS
  $$ INSERT INTO vault.secrets (name, secret, description) VALUES (n, s, d) RETURNING id $$;
CREATE FUNCTION vault.update_secret(i uuid, s text DEFAULT NULL, n text DEFAULT NULL, d text DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $$ UPDATE vault.secrets SET secret = coalesce(s, secret) WHERE id = i $$;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
     ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS
  $$ WITH d AS (DELETE FROM cron.job WHERE jobname = job_name RETURNING 1) SELECT count(*) > 0 FROM d $$;
CREATE TABLE net.calls (id bigserial PRIMARY KEY, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}',
  timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id $$;
CREATE TABLE realtime.messages (id bigserial PRIMARY KEY, topic text, extension text, payload jsonb, event text, private boolean,
  created_at timestamptz DEFAULT now(), inserted_at timestamptz DEFAULT now());
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic', true) $$;
CREATE PUBLICATION supabase_realtime;
`;
// Extensions PGlite doesn't ship: their objects are in the stubs.
const stripExtensions = (s) =>
  s.replace(/^\s*CREATE EXTENSION[^;]*\b(pg_net|pg_cron|pg_graphql|pg_stat_statements|supabase_vault|pgjwt)\b[^;]*;/gim, '-- (extension: stubbed)');

const fresh = async () => {
  const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  await db.exec(STUBS);
  return db;
};
const rows = async (db, sql) => (await db.query(sql)).rows;

// ── The bridge ───────────────────────────────────────────────────────────────
export function parseBridge(text) {
  const order = (text.match(/^-- @order (.+)$/m)?.[1] ?? '').trim().split(/\s+/).filter(Boolean);
  const skip = new Set([...text.matchAll(/^-- @skip (\S+)/gm)].map((m) => m[1]));
  const subs = [...text.matchAll(/^-- @sub (\S+) (.+?) => (.+)$/gm)].map((m) => ({ file: m[1], from: m[2], to: m[3] }));
  const before = new Map();
  for (const m of text.matchAll(/^-- @before (\S+)\n([\s\S]*?)(?=^-- @|(?![\s\S]))/gm)) before.set(m[1], (before.get(m[1]) ?? '') + m[2]);
  return { order, skip, subs, before };
}
const bridge = parseBridge(BRIDGE);
const mentioned = [...bridge.order, ...bridge.skip, ...bridge.subs.map((s) => s.file), ...bridge.before.keys()];

// ── Part 1: the check files run, and nothing of the release is there ────────
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
  ok(sources.every((s) => listed.has(s.n)), `release_migrations.sql has a row for every migration of release-sources.txt (missing: ${sources.filter((s) => !listed.has(s.n)).map((s) => s.n).join(', ') || 'none'})`);
  ok(rel.length > 0 && rel.every((r) => r.applied === false), `stubs only: no migration reads as in (${rel.filter((r) => r.applied).map((r) => r.migration).join(', ') || 'none'})`);
  ok(red.length > 0 && red.every((r) => r.ok === false), `stubs only: no redefined function reads as ok (${red.filter((r) => r.ok).map((r) => r.function).join(', ') || 'none'})`);
  ok(rel.every((r) => /^#\d+$/.test(r.source ?? '') || ALREADY_LIVE.includes(r.migration) || NOT_IN_RELEASE.has(r.migration)), 'every row names its source PR');
}

// ── Part 2, step 1: 001 → latest of the checkout, but the release ───────────
const releaseNs = new Set(sources.map((s) => s.n));
const files = readdirSync(`${REPO}/supabase/migrations`).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
const missingFromBridge = mentioned.filter((f) => !files.includes(f));
ok(!missingFromBridge.length, `the bridge names only files on the checkout (${missingFromBridge.join(', ') || 'all there'})`);
const mainSeq = [...bridge.order, ...files.filter((f) => !bridge.order.includes(f))]
  .filter((f) => !bridge.skip.has(f))
  .filter((f) => !releaseNs.has(f.slice(0, 3)) && !NOT_IN_RELEASE.has(f.slice(0, 3)));

const db = await fresh();
const run = async (label, sql, file) => {
  let text = stripExtensions(sql);
  for (const s of bridge.subs.filter((x) => x.file === file)) {
    if (!text.includes(s.from)) throw new Error(`bridge @sub: "${s.from}" is not in ${file} any more`);
    text = text.replace(s.from, s.to);
  }
  try {
    if (file && bridge.before.has(file)) await db.exec(bridge.before.get(file));
    await db.exec(text);
    return true;
  } catch (e) {
    ok(false, `${label}: ${e.message}`);
    try {
      await db.exec('ROLLBACK');
    } catch {}
    return false;
  }
};
let replayed = 0;
for (const f of mainSeq) {
  if (!(await run(`replay ${f}`, readFileSync(`${REPO}/supabase/migrations/${f}`, 'utf8'), f))) done();
  replayed++;
}
ok(true, `replayed ${replayed} migrations from 001 (bridge: ${bridge.skip.size} skipped, ${bridge.subs.length} replacements, ${bridge.before.size} blocks)`);
{
  const rel = await rows(db, RELEASE);
  for (const n of ALREADY_LIVE) ok(rel.find((r) => r.migration === n)?.applied === true, `${n} is already live after the replay`);
  const early = rel.filter((r) => r.applied && releaseNs.has(r.migration)).map((r) => r.migration);
  ok(!early.length, `before the release, none of its rows reads as in (${early.join(', ') || 'none'})`);
}
if (process.env.BW_CHAIN_MAIN_ONLY === '1') done();

// ── Part 2, step 2: the release, in order ───────────────────────────────────
const heads = new Map(
  (process.env.BW_RELEASE_HEADS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split('='))
    .map(([pr, ref]) => [pr.replace(/^#/, ''), ref]),
);
const AT_VERIFIED = process.env.BW_RELEASE_AT === 'verified';
const onCheckout = new Map(files.map((f) => [f.slice(0, 3), f]));
const fileAt = (ref, n) => {
  try {
    const f = git('ls-tree', '--name-only', ref, 'supabase/migrations/').split('\n').find((x) => x.startsWith(`supabase/migrations/${n}_`));
    return f ? { path: f, sql: git('show', `${ref}:${f}`), blob: git('rev-parse', `${ref}:${f}`).trim() } : null;
  } catch {
    return null;
  }
};
const pending = [];
const pinned = [];
// An exact commit (a SHA that resolves to itself), not a branch that moves.
const isPin = (ref) => {
  if (!/^[0-9a-f]{7,40}$/.test(ref)) return false;
  try {
    return git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`).trim().startsWith(ref);
  } catch {
    return false;
  }
};
const plan = [];
for (const s of sources) {
  if (onCheckout.has(s.n)) {
    plan.push({ ...s, from: 'checkout', sql: readFileSync(`${REPO}/supabase/migrations/${onCheckout.get(s.n)}`, 'utf8') });
    continue;
  }
  const pr = s.pr.replace(/^#/, '');
  const ref = heads.get(pr) ?? (AT_VERIFIED ? s.verified : `origin/${s.branch}`);
  const got = fileAt(ref, s.n);
  if (!got) {
    ok(false, `${s.n} (${s.pr}): no supabase/migrations/${s.n}_*.sql at ${ref}`);
    continue;
  }
  (isPin(ref) ? pinned : pending).push(s.n);
  if (s.verified && ref !== s.verified) {
    const v = fileAt(s.verified, s.n);
    if (!v) console.log(`WARN ${s.n}: its verified SHA ${s.verified} is not reachable here; its proofs were checked on a file not compared`);
    else if (v.blob !== got.blob) console.log(`WARN ${s.n}: ${ref} differs from ${s.verified}, where its proofs were checked`);
  }
  plan.push({ ...s, from: ref, sql: got.sql });
}
if (pending.length) console.log(`PENDING ${pending.join(' ')}`);
if (pinned.length) console.log(`PINNED ${pinned.join(' ')}`);
if (plan.length !== sources.length) done();

// Every earlier code version of a release migration (git log of its file on
// the ref it was read from; comments and spacing ignored) must read as NOT
// in: its row tells the final version from each earlier one (Claude review
// #278). Each is applied on a clone of the database as it is right before
// that migration. One that doesn't apply there is listed, not counted.
// BW_CHAIN_HISTORY=0 skips this.
const HISTORY = process.env.BW_CHAIN_HISTORY !== '0';
const code = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
// Markers match the live body with its comments (pg_get_functiondef keeps
// them), so versions are told apart the same way: the raw text, spacing aside.
const rawKey = (sql) => sql.replace(/\s+/g, ' ').trim();
// This migration's markers that sit only in comment lines of its file.
const commentMarkers = (n, sql) =>
  [...RELEASE.matchAll(/^\s*\('(\d{3})', '\w+', '((?:[^']|'')*)'\)/gm)]
    .filter((m) => m[1] === n)
    .map((m) => m[2].replace(/''/g, "'"))
    .filter((t) => sql.includes(t) && !sql.split('\n').some((l) => l.replace(/--.*$/, '').includes(t)));
const earlierVersions = (s) => {
  const ref = s.from === 'checkout' ? 'HEAD' : s.from;
  const headCode = code(s.sql);
  const marks = commentMarkers(s.n, s.sql);
  const seen = new Set([rawKey(s.sql)]);
  const out = [];
  let commits = [];
  try {
    commits = git('log', '--format=%H', ref, '--', `supabase/migrations/${s.n}_*`).split('\n').filter(Boolean);
  } catch {}
  for (const c of commits) {
    const got = fileAt(c, s.n);
    if (!got) continue;
    const k = rawKey(got.sql);
    if (seen.has(k)) continue;
    seen.add(k);
    // Same code, other comments: the same live behaviour. Counted only when it
    // lacks a marker the final version carries in a comment.
    if (code(got.sql) === headCode && marks.every((t) => got.sql.includes(t))) continue;
    out.push({ commit: c.slice(0, 8), sql: got.sql });
  }
  return out;
};
// 170 (frozen) and 198 go in as one transaction (checklist step 3): their own
// BEGIN;/COMMIT; dropped, the pair wrapped once, like the sed there.
export const oneTransaction = (...sqls) =>
  `BEGIN;\n${sqls.map((x) => x.replace(/^BEGIN;$/gm, '').replace(/^COMMIT;$/gm, '')).join('\n')}\nCOMMIT;\n`;
const together = new Map([['170', '198']]);
const joined = new Set();
const rowOf = async (d, n) => (await rows(d, RELEASE)).find((r) => r.migration === n);
let earlierChecked = 0;
const notApplied = [];
const sameAsHead = [];
// What a version leaves live in public: function definitions, columns,
// policies, triggers and indexes. Equal to the head's = indistinguishable.
export const SCHEMA_SQL = `
  SELECT 'f ' || pg_get_functiondef(p.oid) AS x FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
  UNION ALL SELECT 'c ' || table_name || '.' || column_name || ' ' || data_type || ' ' || coalesce(column_default, '') || ' ' || is_nullable
    FROM information_schema.columns WHERE table_schema = 'public'
  UNION ALL SELECT 'p ' || tablename || '.' || policyname || ' ' || cmd || ' ' || permissive || ' ' || roles::text || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    FROM pg_policies WHERE schemaname = 'public'
  UNION ALL SELECT 't ' || pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid
    WHERE r.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
  UNION ALL SELECT 'i ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
  ORDER BY 1`;
const schemaOf = async (d) => (await d.query(SCHEMA_SQL)).rows.map((r) => r.x).join('\n');
// BW_CHAIN_PICK=1: also propose markers (PICK lines) that tell the final
// version from every earlier one still reading as in; main re-runs it on the
// frozen heads before the merge.
const PICK = process.env.BW_CHAIN_PICK === '1';
const bodies = async (d) => {
  const m = new Map();
  for (const r of (await d.query(`SELECT proname::text n, prosrc FROM pg_proc WHERE pronamespace = 'public'::regnamespace`)).rows) m.set(r.n, [...(m.get(r.n) ?? []), r.prosrc]);
  return m;
};
const has = (m, f, line) => (m.get(f) ?? []).some((b) => b.includes(line));
const picks = [];

// The database right before the release, for the combined RLS pass (it must
// fail there).
const preRelease = await db.clone();
for (const s of plan) {
  if (HISTORY) {
    const versions = earlierVersions(s);
    if (versions.length) {
      const snap = await db.clone();
      const pick = PICK ? { n: s.n, before: await bodies(snap), head: null, passing: [] } : null;
      const h = await snap.clone();
      await h.exec(stripExtensions(s.sql));
      if (pick) pick.head = await bodies(h);
      const headSchema = await schemaOf(h);
      await h.close();
      for (const v of versions) {
        const c = await snap.clone();
        try {
          await c.exec(stripExtensions(v.sql));
        } catch (e) {
          notApplied.push(`${s.n}@${v.commit} (${String(e.message).slice(0, 60)})`);
          await c.close();
          continue;
        }
        // Same live database as the head (a guard-only or comment-only round:
        // the DO block skips, the bodies it makes are the head's): no check
        // can tell them apart, and none needs to. Reported, not counted.
        if ((await schemaOf(c)) === headSchema) {
          sameAsHead.push(`${s.n}@${v.commit}`);
          await c.close();
          continue;
        }
        const r = await rowOf(c, s.n);
        earlierChecked++;
        ok(r?.applied === false, `${s.n} at ${v.commit} (an earlier version) reads as not in${r?.applied ? `: its row is true (${r.proof})` : ''}`);
        if (pick && r?.applied) pick.passing.push({ commit: v.commit, bodies: await bodies(c) });
        await c.close();
      }
      await snap.close();
      if (pick?.passing.length) picks.push(pick);
    }
  }
  if (joined.has(s.n)) continue;
  const mate = together.has(s.n) ? plan.find((x) => x.n === together.get(s.n)) : null;
  if (mate) joined.add(mate.n);
  const label = mate ? `${s.n} + ${mate.n} in one transaction` : s.n;
  if (!(await run(`apply ${label} (${s.pr}, ${s.from})`, mate ? oneTransaction(s.sql, mate.sql) : s.sql, null))) break;
  console.log(`ok   applied ${label} (${s.pr}, ${s.from === 'checkout' ? 'main' : s.from}${mate ? ` + ${mate.from === 'checkout' ? 'main' : mate.from}` : ''})`);
  // Step 2 of the checklist: the live pack off before 170 starts its invites.
  if (s.n === '173') await db.exec(`UPDATE public.app_flags SET enabled = false, updated_at = now() WHERE key = 'live_pack'`);
}

if (HISTORY) {
  console.log(`ok   ${earlierChecked} earlier versions checked`);
  if (sameAsHead.length) console.log(`     same live database as the head, not distinguishable (not counted): ${sameAsHead.join(', ')}`);
  if (notApplied.length) console.log(`     not applicable where they would run (not counted): ${notApplied.join('; ')}`);
}
if (picks.length) {
  const final = await bodies(db);
  for (const p of picks) {
    // Lines new in the final version of a function, still in its final live body.
    const cand = [];
    for (const [f, srcs] of p.head) {
      for (const line of new Set(srcs.flatMap((b) => b.split('\n')).map((l) => l.trim()))) {
        // Not in a function a later migration redefines (its body then changes after this one).
        if ((final.get(f) ?? []).join('\u0000') !== srcs.join('\u0000')) continue;
        if (line.length < 16 || line.startsWith('--') || has(p.before, f, line) || !has(final, f, line)) continue;
        const kills = new Set(p.passing.filter((v) => !has(v.bodies, f, line)).map((v) => v.commit));
        if (kills.size) cand.push({ f, line, kills });
      }
    }
    // A line that says what changed: 30–140 characters, with a call or a name in it.
    const specific = (l) => (l.length >= 30 && l.length <= 140 ? 2 : 0) + (/\w+\(|\bpublic\.|_\w+/.test(l) ? 1 : 0) + Math.min(l.length, 140) / 1000;
    const left = new Set(p.passing.map((v) => v.commit));
    while (left.size) {
      const best = cand.map((c) => ({ c, k: [...c.kills].filter((x) => left.has(x)).length })).sort((a, b) => b.k - a.k || specific(b.c.line) - specific(a.c.line))[0];
      if (!best?.k) break;
      console.log(`PICK ${p.n} ${best.c.f} | ${best.c.line}   (rules out ${[...best.c.kills].filter((x) => left.has(x)).join(' ')})`);
      for (const x of best.c.kills) left.delete(x);
    }
    if (left.size) console.log(`PICK ${p.n} no body line tells these apart (needs an object proof): ${[...left].join(' ')}`);
  }
}

// ── Part 2, step 3: the release proves itself ────────────────────────────────
// The markers, read from the check file, to say which one a false row misses.
const markers = [...(RELEASE.match(/marker\(m, f, txt\) AS \(VALUES\n([\s\S]*?)\n\),/)?.[1] ?? '').matchAll(/^\s*\('(\d{3})', '(\w+)', '((?:[^']|'')*)'\)/gm)].map(
  (m) => ({ n: m[1], fn: m[2], txt: m[3].replace(/''/g, "'") }),
);
for (const r of await rows(db, RELEASE)) {
  if (NOT_IN_RELEASE.has(r.migration)) {
    ok(r.applied === false, `${r.migration} is not in the release and reads as not in`);
    continue;
  }
  ok(r.applied === true, `${r.migration} is in (proof from ${r.source ?? 'already live'}: ${r.proof})`);
  if (r.applied) continue;
  for (const k of markers.filter((x) => x.n === r.migration)) {
    const src = (await db.query(`SELECT prosrc FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = $1`, [k.fn])).rows.map((x) => x.prosrc);
    if (!src.length) console.log(`     function ${k.fn} is missing`);
    else if (!src.some((x) => x.includes(k.txt))) console.log(`     ${k.fn}'s live body lacks: ${k.txt}`);
  }
}
for (const r of await rows(db, REDEF)) ok(r.ok === true, `${r.function}: ${r.final_migration}'s body is live (replaces ${r.replaces})`);

// ── Part 3: combined RLS pass on the one database (Codex review #278, B4) ────
// Each suite of a release PR (security_audit_access #281, chat_participants_guard
// #289, date_on_hold #294) checks its own migration on its own database, so a
// later migration could undo a policy unseen. Here one fixture runs on the
// database the whole release built: a band with an admin, a member, a former
// member (their chat rows kept, as 175 keeps them), an outsider, a gig, a quote
// on hold with its chat. Every check must hold after the release; the ones the
// release brings (r: true) must fail right before it, so the pass can tell.
export const rlsPass = async (d) => {
  const id = (n) => `00000000-0000-0000-0000-0000000c${String(n).padStart(4, '0')}`;
  const [BAND, ADMIN, MEM, EXM, OUT, GIG, QE, Q, BANDCHAT, QCHAT] = [1, 2, 3, 4, 5, 10, 11, 12, 20, 21].map(id);
  const claims = (uid) => JSON.stringify({ sub: uid, role: 'authenticated', email: `${uid.slice(-4)}@example.invalid` });
  const as = async (uid, sql) => {
    try {
      await d.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '${claims(uid)}', true);`);
      const r = await d.query(sql);
      await d.exec('COMMIT');
      return { rows: r.rows, n: r.affectedRows ?? r.rows.length };
    } catch (e) {
      await d.exec('ROLLBACK');
      return { error: e.message, rows: [], n: 0 };
    }
  };
  const server = async (sql) => {
    try {
      await d.exec(`BEGIN; SELECT set_config('request.jwt.claims', '${claims(ADMIN)}', true); ${sql}; COMMIT;`);
      return null;
    } catch (e) {
      await d.exec('ROLLBACK');
      return e.message;
    }
  };
  const out = [];
  const check = (r, name, cond, why = '') => out.push({ r, name, ok: !!cond, why });
  const seedErr = await server(`
    INSERT INTO auth.users (id, email) VALUES ${[ADMIN, MEM, EXM, OUT].map((u) => `('${u}', '${u.slice(-4)}@example.invalid')`).join(', ')} ON CONFLICT DO NOTHING;
    INSERT INTO public.profiles (id, email, full_name) VALUES ('${ADMIN}', 'a@example.invalid', 'Ana Admin'), ('${MEM}', 'm@example.invalid', 'Marta Drums'),
      ('${EXM}', 'x@example.invalid', 'Ex Member'), ('${OUT}', 'o@example.invalid', 'Otto Outside') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.bands (id, name, created_by) VALUES ('${BAND}', 'Hudson Horns', '${ADMIN}');
    INSERT INTO public.band_members (band_id, user_id, role) VALUES ('${BAND}', '${ADMIN}', 'admin'), ('${BAND}', '${MEM}', 'member'), ('${BAND}', '${EXM}', 'member')
      ON CONFLICT (band_id, user_id) DO NOTHING;
    INSERT INTO public.events (id, band_id, title, status, event_type, created_by, event_date, start_time, venue_name, venue_city)
      VALUES ('${GIG}', '${BAND}', 'Rooftop gig', 'confirmed', 'gig', '${ADMIN}', current_date + 7, '20:00', 'Rooftop', 'Brooklyn');
    INSERT INTO public.event_members (event_id, user_id, status, fee) VALUES ('${GIG}', '${MEM}', 'confirmed', 250), ('${GIG}', '${EXM}', 'confirmed', 250);
    INSERT INTO public.chats (id, type, name, band_id, created_by) VALUES ('${BANDCHAT}', 'band', 'Hudson Horns', '${BAND}', '${ADMIN}');
    INSERT INTO public.chat_participants (chat_id, user_id) VALUES ('${BANDCHAT}', '${ADMIN}'), ('${BANDCHAT}', '${MEM}'), ('${BANDCHAT}', '${EXM}');
    INSERT INTO public.messages (chat_id, sender_id, content) VALUES ('${BANDCHAT}', '${ADMIN}', 'Load-in at 6'), ('${BANDCHAT}', '${MEM}', 'See you there')`);
  check(false, 'fixture: band, gig and band chat seeded', !seedErr, seedErr ?? '');
  // The former member leaves; their band chat row stays (175 archives it; an
  // old build or an earlier delete trigger may have left it live).
  const leaveErr = await server(`
    UPDATE public.band_members SET is_active = false, left_at = now() WHERE band_id = '${BAND}' AND user_id = '${EXM}';
    INSERT INTO public.chat_participants (chat_id, user_id) SELECT '${BANDCHAT}', '${EXM}'
      WHERE NOT EXISTS (SELECT 1 FROM public.chat_participants WHERE chat_id = '${BANDCHAT}' AND user_id = '${EXM}')`);
  check(false, 'fixture: the former member left the band, their chat row kept', !leaveErr, leaveErr ?? '');
  // A quote on hold (178: the event of a sent quote, its musicians, its chat).
  const quoteErr = await server(`
    INSERT INTO public.events (id, band_id, title, status, event_type, created_by, event_date, start_time, end_time, venue_name, venue_city, fee, client_name, notes)
      VALUES ('${QE}', '${BAND}', 'Smith Wedding', 'tentative', 'gig', '${ADMIN}', current_date + 10, '20:00', '23:00', 'Blue Note', 'New York', 4200, 'Jane Smith', 'secret notes');
    INSERT INTO public.event_members (event_id, user_id, status, fee) VALUES ('${QE}', '${MEM}', 'pending', 300);
    INSERT INTO public.quotes (id, band_id, created_by, client_name, total, status, converted_to_event_id, quote_number)
      VALUES ('${Q}', '${BAND}', '${ADMIN}', 'Jane Smith', 4200, 'sent', '${QE}', 'Q-2026-0042');
    INSERT INTO public.quote_musicians (quote_id, user_id, name, fee) VALUES ('${Q}', '${MEM}', 'Marta Drums', 300);
    INSERT INTO public.chats (id, type, name, band_id, event_id, created_by) VALUES ('${QCHAT}', 'event', 'Smith Wedding', '${BAND}', '${QE}', '${ADMIN}');
    INSERT INTO public.chat_participants (chat_id, user_id) VALUES ('${QCHAT}', '${ADMIN}'), ('${QCHAT}', '${MEM}');
    INSERT INTO public.messages (chat_id, sender_id, content) VALUES ('${QCHAT}', '${ADMIN}', 'Jane wants a longer set')`);
  check(false, 'fixture: a quote on hold with its chat', !quoteErr, quoteErr ?? '');

  // 175 + #289 guard: a former member's kept row shows and opens nothing.
  let r = await as(EXM, `SELECT id FROM public.messages WHERE chat_id = '${BANDCHAT}'`);
  check(true, 'former member reads no band chat message', !r.error && r.rows.length === 0, r.error ?? `${r.rows.length} rows`);
  r = await as(EXM, `INSERT INTO public.messages (chat_id, sender_id, content) VALUES ('${BANDCHAT}', '${EXM}', 'still here?')`);
  check(true, 'former member cannot write in the band chat', !!r.error || r.n === 0, r.error ?? `${r.n} rows`);
  r = await as(EXM, `SELECT user_id FROM public.chat_participants WHERE chat_id = '${BANDCHAT}'`);
  check(true, 'former member sees no band chat roster', !r.error && r.rows.length === 0, r.error ?? `${r.rows.length} rows`);
  r = await as(MEM, `SELECT user_id FROM public.chat_participants WHERE chat_id = '${BANDCHAT}'`);
  check(true, "active member's roster has no former member", !r.error && r.rows.length > 0 && !r.rows.some((x) => x.user_id === EXM), r.error ?? JSON.stringify(r.rows.map((x) => x.user_id.slice(-4))));
  r = await as(MEM, `SELECT id FROM public.messages WHERE chat_id = '${BANDCHAT}' AND sender_id IN ('${ADMIN}', '${MEM}')`);
  check(false, 'active member reads the band chat', !r.error && r.rows.length === 2, r.error ?? `${r.rows.length} rows`);
  r = await as(OUT, `SELECT id FROM public.messages WHERE chat_id IN ('${BANDCHAT}', '${QCHAT}')`);
  check(false, 'outsider reads no message', !r.error && r.rows.length === 0, r.error ?? `${r.rows.length} rows`);
  r = await d.query(`SELECT public.bw_chat_recipient_ids('${BANDCHAT}', '${ADMIN}') AS ids`).catch((e) => ({ error: e.message, rows: [] }));
  const ids = r.rows[0]?.ids ?? [];
  check(true, 'push recipients: active members only', !r.error && ids.includes(MEM) && !ids.includes(EXM) && !ids.includes(ADMIN), r.error ?? JSON.stringify(ids.map((x) => x.slice(-4))));
  r = await as(EXM, `SELECT public.get_user_chats('${EXM}') AS j`);
  check(true, "former member's chat list hides the band chat", !r.error && !JSON.stringify(r.rows).includes(BANDCHAT), r.error ?? 'listed');
  r = await d.query(`SELECT tablename::text t, cmd, permissive, roles::text roles FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('chat_participants', 'messages')`);
  const restrictive = (t, cmd) => r.rows.some((x) => x.t === t && x.cmd === cmd && x.permissive === 'RESTRICTIVE' && x.roles === '{authenticated}');
  check(true, 'RESTRICTIVE guards: chat_participants SELECT/UPDATE/DELETE, messages SELECT', ['SELECT', 'UPDATE', 'DELETE'].every((c) => restrictive('chat_participants', c)) && restrictive('messages', 'SELECT'));

  // 178: a quote on hold is the admins' until it is a gig; members see the hold only.
  r = await as(MEM, `SELECT title FROM public.events WHERE id = '${QE}'`);
  check(true, 'member cannot read the quote event', !r.error && r.rows.length === 0, r.error ?? JSON.stringify(r.rows));
  r = await as(MEM, `SELECT user_id FROM public.event_members WHERE event_id = '${QE}'`);
  check(true, 'member: not even their own lineup row of the quote', !r.error && r.rows.length === 0, r.error ?? `${r.rows.length} rows`);
  r = await as(MEM, `SELECT id FROM public.messages WHERE chat_id = '${QCHAT}'`);
  check(true, 'member reads no message of the quote chat', !r.error && r.rows.length === 0, r.error ?? `${r.rows.length} rows`);
  r = await as(MEM, `SELECT title FROM public.events WHERE id = '${GIG}'`);
  check(false, 'member still reads the confirmed gig', !r.error && r.rows.length === 1, r.error ?? `${r.rows.length} rows`);
  r = await as(ADMIN, `SELECT (SELECT count(*)::int FROM public.events WHERE id = '${QE}') e, (SELECT count(*)::int FROM public.messages WHERE chat_id = '${QCHAT}') m`);
  check(false, 'admin reads the quote and its chat', !r.error && r.rows[0]?.e === 1 && r.rows[0]?.m === 1, r.error ?? JSON.stringify(r.rows[0]));
  r = await as(MEM, `SELECT * FROM public.bw_my_date_holds()`);
  const hold = r.rows.find((x) => x.event_id === QE);
  check(true, 'member sees the hold, without title, client, fee or notes', !r.error && !!hold && !/Smith|Jane|4200|secret/.test(JSON.stringify(hold)), r.error ?? JSON.stringify(hold ?? null));
  r = await as(OUT, `SELECT * FROM public.bw_my_date_holds()`);
  check(true, 'outsider gets no hold', !r.error && r.rows.length === 0, r.error ?? `${r.rows.length} rows`);
  return out;
};
const after = await rlsPass(db);
for (const c of after) ok(c.ok, `combined RLS: ${c.name}${c.ok ? '' : ` (${c.why})`}`);
const before = await rlsPass(preRelease);
const unchanged = before.filter((c) => c.r && c.ok).map((c) => c.name);
ok(!unchanged.length, `combined RLS: right before the release, every check the release brings fails (${unchanged.join('; ') || 'all do'})`);
for (const c of before.filter((x) => !x.r && !x.ok)) ok(false, `combined RLS before the release: ${c.name} (${c.why})`);
done();
