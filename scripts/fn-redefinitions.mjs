#!/usr/bin/env node
// Functions that more than one of the release's migrations defines, in apply
// order (supabase/checks/release-sources.txt), with how each one defines it
// (scripts/sql-functions.mjs: static, dynamic, patched, declared; "?" = it
// can skip that definition). Reads a migration from this checkout when it is
// here, else from origin/<branch> (run `git fetch` first).
//
//   node scripts/fn-redefinitions.mjs            # the overlaps
//   node scripts/fn-redefinitions.mjs --check    # also: every overlap has a row in redefined_functions.sql
//
// Also lists the migrations whose file changed on their branch since the
// commit their proofs were checked at (release-sources.txt, 4th column): their
// markers in release_migrations.sql / redefined_functions.sql need checking again.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { definedFunctions } from './sql-functions.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sources = readFileSync(path.join(root, 'supabase/checks/release-sources.txt'), 'utf8')
  .split('\n')
  .filter((l) => /^\d{3}\s/.test(l))
  .map((l) => {
    const [n, pr, branch, verified] = l.trim().split(/\s+/);
    return { n, pr, branch, verified };
  });
const migDir = path.join(root, 'supabase/migrations');
const read = ({ n, branch }) => {
  const here = existsSync(migDir) && readdirSync(migDir).find((f) => f.startsWith(`${n}_`));
  if (here) return { sql: readFileSync(path.join(migDir, here), 'utf8'), from: 'checkout' };
  try {
    const list = execFileSync('git', ['-C', root, 'ls-tree', '--name-only', `origin/${branch}`, 'supabase/migrations/'], { encoding: 'utf8' });
    const f = list.split('\n').find((x) => path.basename(x).startsWith(`${n}_`));
    if (f) return { sql: execFileSync('git', ['-C', root, 'show', `origin/${branch}:${f}`], { encoding: 'utf8', maxBuffer: 1 << 26 }), from: `origin/${branch}`, file: f };
  } catch {
    /* branch not fetched */
  }
  return null;
};

const seen = new Map();
const missing = [];
for (const s of sources) {
  const got = read(s);
  if (!got) {
    missing.push(`${s.n} (${s.pr} ${s.branch})`);
    continue;
  }
  for (const [fn, d] of definedFunctions(got.sql)) seen.set(fn, [...(seen.get(fn) ?? []), { n: s.n, ...d }]);
}
const overlaps = [...seen].filter(([, defs]) => defs.length > 1).sort(([a], [b]) => a.localeCompare(b));
for (const [fn, defs] of overlaps) {
  console.log(`${fn}: ${defs.map((d) => `${d.n}${d.how === 'static' ? '' : ` (${d.how}${d.conditional ? '?' : ''})`}`).join(' → ')}`);
}
if (missing.length) console.warn(`not found (fetch, or not pushed yet): ${missing.join(', ')}`);

// Changed on its branch since its proofs were checked (only for files not merged yet).
const blob = (ref, f) => {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', `${ref}:${f}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};
const moved = [];
for (const s of sources) {
  const got = read(s);
  if (!got?.file || !s.verified) continue;
  if (blob(s.verified, got.file) !== blob(`origin/${s.branch}`, got.file)) moved.push(`${s.n} (${s.pr} ${s.branch}: checked at ${s.verified})`);
}
if (moved.length) console.warn(`changed since its proofs were checked, check the markers again: ${moved.join(', ')}`);

if (process.argv.includes('--check')) {
  const redef = readFileSync(path.join(root, 'supabase/checks/redefined_functions.sql'), 'utf8');
  const rows = new Set([...redef.matchAll(/^\s*\('(\w+)', '\d{3}', /gm)].map((m) => m[1]));
  const without = overlaps.filter(([fn]) => !rows.has(fn)).map(([fn]) => fn);
  if (without.length) {
    console.error(`no row in redefined_functions.sql: ${without.join(', ')}`);
    process.exit(1);
  }
  if (missing.length) process.exit(2);
}
