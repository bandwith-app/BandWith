#!/usr/bin/env node
// Runs every supabase/tests/*.pglite.mjs suite against PGlite (CI job
// "PGlite suites", .github/workflows/ci.yml; main, 11-22).
//
//   npm ci --prefix supabase/tests/pglite-runner
//   node supabase/tests/pglite-runner/run.mjs [<repo>] [suite.pglite.mjs …]
//
// Each suite is copied next to this folder's node_modules (PGlite 0.5.15,
// pinned in package-lock.json) and run with the arguments of its own usage
// line (lib.mjs). <repo> is this checkout.
//
// Release migrations not merged yet (supabase/checks/release-sources.txt):
// an argument file not on the checkout is read from origin/<branch>, and a
// suite that reads one with git show is "pending". A pending suite's failure
// is a warning (the branch may still change), not a failure. Once every
// migration of release-sources.txt is on the checkout the run is strict:
// a failure, a SKIP line or a pending read fails it. BW_PGLITE_STRICT=1 or 0
// forces it either way. CI checks out every branch (fetch-depth: 0) so the
// git show reads resolve.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { branchReads, isStrict, usageArgs, verdict } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(process.argv[2] ?? join(HERE, '../../..'));
const ONLY = new Set(process.argv.slice(3));
const GH = !!process.env.GITHUB_ACTIONS;
const TESTS = join(REPO, 'supabase/tests');
const MIGRATIONS = join(REPO, 'supabase/migrations');

const sourcesFile = join(REPO, 'supabase/checks/release-sources.txt');
const sources = new Map(
  (existsSync(sourcesFile) ? readFileSync(sourcesFile, 'utf8') : '')
    .split('\n')
    .filter((l) => /^\d{3}\s/.test(l))
    .map((l) => l.trim().split(/\s+/))
    .map(([n, pr, branch]) => [n, { pr, branch }]),
);
const onCheckout = new Map(
  readdirSync(MIGRATIONS)
    .map((f) => [f.match(/^(\d{3})_.*\.sql$/)?.[1], f])
    .filter(([n]) => n),
);
const strict = isStrict([...sources.keys()], [...onCheckout.keys()], process.env);

const tmp = mkdtempSync(join(tmpdir(), 'bw-pglite-'));
/** A release migration not merged yet, from its branch head; null if unreachable. */
function fromBranch(n) {
  const s = sources.get(n);
  if (!s) return null;
  try {
    const ref = `origin/${s.branch}`;
    const file = execFileSync('git', ['ls-tree', '--name-only', ref, 'supabase/migrations/'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .find((f) => f.startsWith(`supabase/migrations/${n}_`));
    if (!file) return null;
    const out = join(tmp, file.split('/').pop());
    writeFileSync(out, execFileSync('git', ['show', `${ref}:${file}`], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }));
    return out;
  } catch {
    return null;
  }
}

const runDir = join(HERE, '.run');
mkdirSync(runDir, { recursive: true });
const allSuites = readdirSync(TESTS).filter((f) => f.endsWith('.pglite.mjs'));
// A suite named on the command line that isn't there (a typo) must not end as
// "0 suites, exit 0": nothing runs, exit 1, strict or not (Codex 11-22).
const unknown = [...ONLY].filter((f) => !allSuites.includes(f));
if (unknown.length) {
  for (const f of unknown) console.error(`no such suite: ${f} (in supabase/tests/: ${allSuites.length} *.pglite.mjs files)`);
  process.exit(1);
}
const suites = allSuites.filter((f) => !ONLY.size || ONLY.has(f)).sort();

const results = [];
for (const name of suites) {
  const src = readFileSync(join(TESTS, name), 'utf8');
  const pending = new Set(branchReads(src).filter((n) => sources.has(n) && !onCheckout.has(n)));
  let args;
  let missing = '';
  try {
    args = usageArgs(src, name).map((a) => {
      if (a.kind === 'repo') return REPO;
      const n = a.kind === 'migration' ? a.n : a.path.match(/(?:^|\/)(\d{3})_[^/]*\.sql$/)?.[1];
      const here = a.kind === 'path' ? join(REPO, a.path) : onCheckout.has(n) ? join(MIGRATIONS, onCheckout.get(n)) : null;
      if (here && existsSync(here)) return here;
      const branchFile = n ? fromBranch(n) : null;
      if (branchFile) {
        pending.add(n);
        return branchFile;
      }
      missing ||= a.kind === 'path' ? a.path : `migration ${n}`;
      return '/nonexistent';
    });
  } catch (e) {
    results.push({ name, status: 'fail', why: e.message, out: '' });
    continue;
  }
  if (missing) {
    const r = { name, status: strict ? 'fail' : 'warn', why: `not run: ${missing} is neither on the checkout nor on a reachable release branch`, out: '' };
    results.push(r);
    continue;
  }
  const copy = join(runDir, name);
  copyFileSync(join(TESTS, name), copy);
  const started = Date.now();
  const p = spawnSync(process.execPath, [copy, ...args], { cwd: HERE, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 256 << 20, env: process.env });
  const out = `${p.stdout ?? ''}${p.stderr ?? ''}${p.error ? `\nERROR ${p.error.message}` : ''}`;
  const v = verdict({ code: p.status ?? 1, out }, { pending: [...pending], strict });
  results.push({ name, ...v, out, secs: Math.round((Date.now() - started) / 1000), pending: [...pending] });
}

const icon = { pass: 'ok  ', warn: 'WARN', fail: 'FAIL' };
for (const r of results) {
  if (GH) console.log(`::group::${icon[r.status]} ${r.name}${r.secs != null ? ` (${r.secs}s)` : ''}`);
  else console.log(`\n▶ ${icon[r.status]} ${r.name}${r.secs != null ? ` (${r.secs}s)` : ''}`);
  if (r.pending?.length) console.log(`(reads ${r.pending.join(', ')} from its branch: not merged yet)`);
  if (r.out) console.log(r.out.trimEnd());
  if (r.why) console.log(`→ ${r.why}`);
  if (GH) console.log('::endgroup::');
  if (GH && r.status !== 'pass') console.log(`::${r.status === 'fail' ? 'error' : 'warning'} title=${r.name}::${r.why}`);
}
const count = (s) => results.filter((r) => r.status === s).length;
console.log(`\n${results.length} suites: ${count('pass')} pass, ${count('warn')} warn, ${count('fail')} fail (${strict ? 'strict' : 'not strict: release branches still open'})`);
if (!results.length) console.log('no supabase/tests/*.pglite.mjs suite found');
process.exit(count('fail') ? 1 : 0);
