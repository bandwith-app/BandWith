/**
 * The release gate (scripts/emulator-gate.mjs): nothing ships (web deploy,
 * Android release) unless the emulator check passed on that exact commit,
 * with every Maestro flow passed and the Duo postures signed off.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkMarker } from './emulator-gate.mjs';

const SCRIPTS = path.resolve(__dirname);
const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

function marker(over: Record<string, unknown> = {}) {
  return {
    sha: SHA,
    date: '2026-11-16T15:00:00Z',
    status: 'passed',
    maestro: '2.12.1',
    devices: [
      { id: 'iphone', name: 'BW Check iPhone', platform: 'ios' },
      { id: 'android', name: 'BW_Check_API36', platform: 'android' },
    ],
    flows: [
      { device: 'iphone', flow: 'smoke', status: 'passed' },
      { device: 'android', flow: 'smoke', status: 'passed' },
    ],
    screenshots: '/tmp/shots',
    duo: { ok: true, date: '2026-11-16T15:10:00Z' },
    ...over,
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bw-gate-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, data: unknown) =>
  writeFileSync(path.join(dir, `${name}.json`), typeof data === 'string' ? data : JSON.stringify(data));

describe('checkMarker', () => {
  it('refuses a commit with no emulator run', () => {
    const r = checkMarker({ dirs: [dir], sha: SHA });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no emulator check/i);
  });

  it('refuses when only another commit was checked (stale)', () => {
    write(OTHER, marker({ sha: OTHER }));
    expect(checkMarker({ dirs: [dir], sha: SHA }).ok).toBe(false);
  });

  it('refuses a marker whose recorded sha is not the commit', () => {
    write(SHA, marker({ sha: OTHER }));
    const r = checkMarker({ dirs: [dir], sha: SHA });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/commit/i);
  });

  it('refuses a run with a failed flow', () => {
    write(SHA, marker({ flows: [...marker().flows, { device: 'ipad', flow: 'back-chains', status: 'failed' }] }));
    const r = checkMarker({ dirs: [dir], sha: SHA });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/back-chains.*ipad|ipad.*back-chains/);
  });

  it('refuses a run that did not pass overall, or ran no flows', () => {
    write(SHA, marker({ status: 'failed' }));
    expect(checkMarker({ dirs: [dir], sha: SHA }).ok).toBe(false);
    write(SHA, marker({ flows: [] }));
    expect(checkMarker({ dirs: [dir], sha: SHA }).ok).toBe(false);
  });

  it('refuses until the Duo postures are signed off', () => {
    write(SHA, marker({ duo: { ok: false } }));
    const r = checkMarker({ dirs: [dir], sha: SHA });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/duo/i);
  });

  it('refuses a marker it cannot read', () => {
    write(SHA, '{ not json');
    expect(checkMarker({ dirs: [dir], sha: SHA }).ok).toBe(false);
  });

  it('accepts a passing run on this commit with the Duo signed off', () => {
    write(SHA, marker());
    expect(checkMarker({ dirs: [dir], sha: SHA })).toMatchObject({ ok: true });
  });

  it('finds the marker in any of the given folders (another worktree)', () => {
    const other = path.join(dir, 'main-clone');
    mkdirSync(other);
    writeFileSync(path.join(other, `${SHA}.json`), JSON.stringify(marker()));
    expect(checkMarker({ dirs: [path.join(dir, 'missing'), other], sha: SHA }).ok).toBe(true);
  });
});

/** A throwaway git repo with this repo's scripts/ and one commit. */
function repo() {
  const root = mkdtempSync(path.join(tmpdir(), 'bw-gate-repo-'));
  cpSync(SCRIPTS, path.join(root, 'scripts'), { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
  git('init', '-q');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x');
  const sha = git('rev-parse', 'HEAD');
  // A gh with no credentials (CI, another machine): every call fails. The
  // gate must answer first, whatever gh says (review #278 round 5).
  const noAuthGh = path.join(root, 'gh-no-auth');
  writeFileSync(noAuthGh, '#!/usr/bin/env bash\necho "gh auth login required" >&2\nexit 4\n', { mode: 0o755 });
  const run = (script: string, args: string[]) =>
    spawnSync('bash', [path.join(root, 'scripts', script), ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, BW_EMULATOR_CHECK_DIR: path.join(root, '.emulator-check'), GH_TOKEN: '', GH: noAuthGh, PATH: process.env.PATH },
    });
  const pass = () => {
    mkdirSync(path.join(root, '.emulator-check'), { recursive: true });
    writeFileSync(path.join(root, '.emulator-check', `${sha}.json`), JSON.stringify(marker({ sha })));
  };
  return { root, sha, run, pass };
}

describe('scripts/deploy-web.sh', () => {
  it('refuses to deploy a commit without a passing emulator check', () => {
    const r = repo();
    const out = r.run('deploy-web.sh', ['--dry-run']);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/emulator check/i);
    expect(out.stdout).not.toMatch(/vercel/);
    rmSync(r.root, { recursive: true, force: true });
  });

  it('deploys a commit that passed', () => {
    const r = repo();
    r.pass();
    const out = r.run('deploy-web.sh', ['--dry-run']);
    expect(out.status).toBe(0);
    expect(out.stdout).toMatch(/vercel@latest deploy --prod --yes/);
    rmSync(r.root, { recursive: true, force: true });
  });

  it('--skip-emulator-check needs a reason, warns, and records it', () => {
    const r = repo();
    expect(r.run('deploy-web.sh', ['--dry-run', '--skip-emulator-check']).status).not.toBe(0);
    const out = r.run('deploy-web.sh', ['--dry-run', '--skip-emulator-check', 'hotfix for a typo']);
    expect(out.status).toBe(0);
    expect(out.stderr).toMatch(/WARNING/);
    expect(out.stdout).toMatch(/hotfix for a typo/);
    rmSync(r.root, { recursive: true, force: true });
  });
});

describe('scripts/release-android.sh --publish', () => {
  it('refuses before building when the commit has no passing emulator check', () => {
    const r = repo();
    const out = r.run('release-android.sh', ['9.9.9', '--publish']);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/emulator check/i);
    rmSync(r.root, { recursive: true, force: true });
  });

  it('refuses a commit whose run had a failed flow', () => {
    const r = repo();
    mkdirSync(path.join(r.root, '.emulator-check'));
    writeFileSync(
      path.join(r.root, '.emulator-check', `${r.sha}.json`),
      JSON.stringify(marker({ sha: r.sha, status: 'failed', flows: [{ device: 'android', flow: 'smoke', status: 'failed' }] })),
    );
    const out = r.run('release-android.sh', ['9.9.9', '--publish']);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/emulator check/i);
    rmSync(r.root, { recursive: true, force: true });
  });

  it('--skip-emulator-check "<reason>" warns and puts the reason in the release notes', () => {
    const r = repo();
    const out = r.run('release-android.sh', ['9.9.9', '--publish', '--skip-emulator-check', 'emulators down, hotfix']);
    // It goes past the gate (and stops later: no google-services.json here).
    expect(out.stderr).toMatch(/WARNING/);
    expect(out.stderr).not.toMatch(/no emulator check/i);
    const notes = readFileSync(path.join(r.root, 'dist-android', 'release-notes.md'), 'utf8');
    expect(notes).toMatch(/emulators down, hotfix/);
    rmSync(r.root, { recursive: true, force: true });
  });

  // Staged rollout (docs/release-checklist.md): a prerelease reaches only the
  // testers who get its link; the in-app updater and releases/latest skip it.
  it('--prerelease without --publish is refused', () => {
    const r = repo();
    const out = r.run('release-android.sh', ['9.9.9', '--prerelease']);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/--prerelease needs --publish/);
    rmSync(r.root, { recursive: true, force: true });
  });

  it('--publish --prerelease goes through the same emulator gate', () => {
    const r = repo();
    const out = r.run('release-android.sh', ['9.9.9', '--publish', '--prerelease']);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/emulator check/i);
    expect(out.stderr).not.toMatch(/usage:/);
    rmSync(r.root, { recursive: true, force: true });
  });

  it('marks the GitHub release as a prerelease, never as latest', () => {
    const src = readFileSync(path.join(SCRIPTS, 'release-android.sh'), 'utf8');
    const create = src.slice(src.indexOf('release create "$TAG"'));
    expect(create).toMatch(/"\$\{RELEASE_FLAGS\[@\]\}"/);
    expect(src).toMatch(/RELEASE_FLAGS=\(--prerelease --latest=false\)/);
  });

  it('a build without --publish needs no emulator check', () => {
    const r = repo();
    const out = r.run('release-android.sh', ['9.9.9']);
    expect(out.stderr).not.toMatch(/emulator check/i);
    rmSync(r.root, { recursive: true, force: true });
  });
});

describe('scripts/emulator-check.sh', () => {
  // 1.0.6 gate: on SwiftShader, with both iOS simulators running alongside,
  // the Android WebView stalled while typing ("BandWith isn't responding")
  // and keyboard-create-account's probe never answered.
  it('boots the check emulator on the Mac GPU, not software rendering', () => {
    const src = readFileSync(path.join(SCRIPTS, 'emulator-check.sh'), 'utf8');
    const boot = src.slice(src.indexOf('boot_avd() {'), src.indexOf('wait_avd() {'));
    expect(boot).toMatch(/-gpu "\$\{BW_AVD_GPU:-host\}"/);
    expect(boot).not.toMatch(/swiftshader/);
  });
});
