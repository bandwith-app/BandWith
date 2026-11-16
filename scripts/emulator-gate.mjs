#!/usr/bin/env node
/**
 * Release gate: has this commit passed the emulator check?
 *
 * scripts/emulator-check.sh writes .emulator-check/<full commit sha>.json
 * after every Maestro flow passed on the iOS simulators and the Android
 * emulator; `scripts/emulator-check.sh --duo-ok` adds the Duo postures
 * (checked by hand). Releases (scripts/release-android.sh --publish,
 * scripts/deploy-web.sh) call this first and stop unless the marker is there,
 * names this exact commit, passed every flow, and has the Duo signed off.
 *
 *   node scripts/emulator-gate.mjs            # checks HEAD; exit 0 = OK
 *   node scripts/emulator-gate.mjs --sha <sha>
 *
 * Markers are looked up in $BW_EMULATOR_CHECK_DIR if set, otherwise in this
 * checkout's .emulator-check/ and the main clone's (a release often runs from
 * another worktree than the check).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @param {{ dirs: string[], sha: string }} opts
 * @returns {{ ok: boolean, reason: string, file?: string, marker?: any }}
 */
export function checkMarker({ dirs, sha }) {
  if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, reason: `not a full commit sha: ${sha}` };
  const file = dirs.map((d) => path.join(d, `${sha}.json`)).find((f) => existsSync(f));
  const how = 'Run scripts/emulator-check.sh on this commit (then --duo-ok after the Duo postures).';
  if (!file) return { ok: false, reason: `No emulator check for ${sha.slice(0, 12)}. ${how}` };
  let m;
  try {
    m = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { ok: false, file, reason: `The emulator check marker ${file} is unreadable (${e.message}). ${how}` };
  }
  if (m.sha !== sha) {
    return { ok: false, file, reason: `The emulator check marker ${file} is for commit ${String(m.sha).slice(0, 12)}, not ${sha.slice(0, 12)}. ${how}` };
  }
  const flows = Array.isArray(m.flows) ? m.flows : [];
  if (!flows.length) return { ok: false, file, reason: `The emulator check of ${sha.slice(0, 12)} ran no flows. ${how}` };
  const failed = flows.filter((f) => f.status !== 'passed');
  if (failed.length) {
    const list = failed.map((f) => `${f.flow} on ${f.device} (${f.status})`).join(', ');
    return { ok: false, file, reason: `The emulator check of ${sha.slice(0, 12)} has failed flows: ${list}. ${how}` };
  }
  if (m.status !== 'passed') return { ok: false, file, reason: `The emulator check of ${sha.slice(0, 12)} did not pass (${m.status}). ${how}` };
  if (!m.duo || m.duo.ok !== true) {
    return {
      ok: false,
      file,
      reason: `The Duo postures of ${sha.slice(0, 12)} are not signed off: check them, then run scripts/emulator-check.sh --duo-ok.`,
    };
  }
  return { ok: true, file, marker: m, reason: `Emulator check passed on ${sha.slice(0, 12)} (${m.date}, ${flows.length} flow runs, Duo signed off).` };
}

/** Where markers live: $BW_EMULATOR_CHECK_DIR, else this checkout's and the main clone's .emulator-check/. */
export function markerDirs(cwd = process.cwd()) {
  if (process.env.BW_EMULATOR_CHECK_DIR) return [process.env.BW_EMULATOR_CHECK_DIR];
  const git = (...a) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  const top = git('rev-parse', '--show-toplevel');
  const common = path.resolve(cwd, git('rev-parse', '--git-common-dir'));
  const main = path.dirname(common);
  return [...new Set([path.join(top, '.emulator-check'), path.join(main, '.emulator-check')])];
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const i = process.argv.indexOf('--sha');
  let sha;
  try {
    sha = i > 0 ? process.argv[i + 1] : execFileSync('git', ['rev-parse', 'HEAD']).toString().trim();
  } catch {
    console.error('emulator gate: not a git checkout.');
    process.exit(2);
  }
  const r = checkMarker({ dirs: markerDirs(), sha });
  if (r.ok) {
    console.log(r.reason);
    process.exit(0);
  }
  console.error(`Refused: ${r.reason}`);
  process.exit(1);
}
