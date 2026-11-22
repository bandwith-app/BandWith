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
//      main). A head whose file differs from the verified SHA's prints a WARN.
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
  pending.push(s.n);
  if (s.verified && ref !== s.verified) {
    const v = fileAt(s.verified, s.n);
    if (!v) console.log(`WARN ${s.n}: its verified SHA ${s.verified} is not reachable here; its proofs were checked on a file not compared`);
    else if (v.blob !== got.blob) console.log(`WARN ${s.n}: ${ref} differs from ${s.verified}, where its proofs were checked`);
  }
  plan.push({ ...s, from: ref, sql: got.sql });
}
if (pending.length) console.log(`PENDING ${pending.join(' ')}`);
if (plan.length !== sources.length) done();

// Every earlier code version of a release migration (git log of its file on
// the ref it was read from; comments and spacing ignored) must read as NOT
// in: its row tells the final version from each earlier one (Claude review
// #278). Each is applied on a clone of the database as it is right before
// that migration. One that doesn't apply there is listed, not counted.
// BW_CHAIN_HISTORY=0 skips this.
const HISTORY = process.env.BW_CHAIN_HISTORY !== '0';
const code = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const earlierVersions = (s) => {
  const ref = s.from === 'checkout' ? 'HEAD' : s.from;
  const head = code(s.sql);
  const seen = new Set([head]);
  const out = [];
  let commits = [];
  try {
    commits = git('log', '--format=%H', ref, '--', `supabase/migrations/${s.n}_*`).split('\n').filter(Boolean);
  } catch {}
  for (const c of commits) {
    const got = fileAt(c, s.n);
    if (!got) continue;
    const k = code(got.sql);
    if (seen.has(k)) continue;
    seen.add(k);
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

for (const s of plan) {
  if (HISTORY) {
    const versions = earlierVersions(s);
    if (versions.length) {
      const snap = await db.clone();
      const pick = PICK ? { n: s.n, before: await bodies(snap), head: null, passing: [] } : null;
      if (pick) {
        const h = await snap.clone();
        await h.exec(stripExtensions(s.sql));
        pick.head = await bodies(h);
        await h.close();
      }
      for (const v of versions) {
        const c = await snap.clone();
        try {
          await c.exec(stripExtensions(v.sql));
        } catch (e) {
          notApplied.push(`${s.n}@${v.commit} (${String(e.message).slice(0, 60)})`);
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
done();
