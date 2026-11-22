/**
 * scripts/android-promote-check.sh: a prerelease is promoted to everyone only
 * when its versionCode is above every published stable release (review #278
 * round 5: a hotfix 1.0.13.1 during the 1.0.14 pilot was built later, so
 * promoting the 1.0.14 APK would be refused by every phone that took it).
 */
import { describe, expect, it } from 'vitest';

// Runs the real script. The app's tsconfig has no Node types, hence the loose imports.
type Spawn = (
  file: string,
  args: string[],
  opts: { env: Record<string, string>; encoding: 'utf8' },
) => { status: number | null; stdout: string; stderr: string };
const NODE_CHILD_PROCESS = 'node:child_process';
const { spawnSync } = (await import(/* @vite-ignore */ NODE_CHILD_PROCESS)) as { spawnSync: Spawn };
const fs = (await import(/* @vite-ignore */ 'node:fs')) as {
  readFileSync: (p: string, e: 'utf8') => string;
  writeFileSync: (p: string, d: string, o?: { mode: number }) => void;
  mkdtempSync: (p: string) => string;
};
const os = (await import(/* @vite-ignore */ 'node:os')) as { tmpdir: () => string };
const { process } = globalThis as unknown as { process: { cwd(): string; env: Record<string, string> } };
const SCRIPT = `${process.cwd()}/scripts/android-promote-check.sh`;
const at = (iso: string) => String(Math.floor(Date.parse(iso) / 1000));

/** Release lines as gh --jq prints them: tag, prerelease, draft, published, recorded code. */
const check = (lines: string[][], args: string[], ghExit = 0) => {
  const dir = fs.mkdtempSync(`${os.tmpdir()}/fake-gh-`);
  fs.writeFileSync(`${dir}/out.tsv`, lines.map((l) => l.join('\t')).join('\n') + '\n');
  fs.writeFileSync(
    `${dir}/gh`,
    `#!/usr/bin/env bash\n[ ${ghExit} -eq 0 ] || { echo "HTTP 401: Bad credentials" >&2; exit ${ghExit}; }\ncat "${dir}/out.tsv"\n`,
    { mode: 0o755 },
  );
  return spawnSync('bash', [SCRIPT, ...args], { env: { ...process.env, GH: `${dir}/gh` }, encoding: 'utf8' });
};

const pilot = ['android-v1.0.14', 'true', 'false', at('2026-11-23T10:00:00Z'), '30470040'];
const stable13 = ['android-v1.0.13', 'false', 'false', at('2026-11-21T16:34:13Z'), '30467513'];

describe('promote check', () => {
  it('a pilot above every published release may be promoted', () => {
    const r = check([pilot, stable13], ['1.0.14']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/OK: android-v1\.0\.14 \(code 30470040\).*android-v1\.0\.13, code 30467513/);
  });

  it('a hotfix published during the pilot (a higher code) stops the promotion: rebuild', () => {
    const hotfix = ['android-v1.0.13.1', 'false', 'false', at('2026-11-24T09:00:00Z'), '30471400'];
    const r = check([pilot, hotfix, stable13], ['1.0.14']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not above android-v1\.0\.13\.1 \(30471400\)/);
    expect(r.stderr).toMatch(/Rebuild/);
  });

  it('an old release without a recorded code counts with its publish time (never below its real code)', () => {
    const old = ['android-v1.0.13.1', 'false', 'false', at('2026-11-24T09:00:00Z'), ''];
    const r = check([pilot, old, stable13], ['1.0.14']);
    expect(r.status).toBe(1);
  });

  it('other prereleases and drafts do not count', () => {
    const otherPilot = ['android-v1.0.15', 'true', 'false', at('2026-11-25T09:00:00Z'), '30479000'];
    const draft = ['android-v1.0.16', 'false', 'true', at('2026-11-25T10:00:00Z'), '30479100'];
    expect(check([pilot, otherPilot, draft, stable13], ['1.0.14']).status).toBe(0);
  });

  it('fails closed: GitHub unreachable or no auth means no promotion', () => {
    const r = check([pilot, stable13], ['1.0.14'], 4);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not promoting on a guess/);
    expect(r.stdout).toBe('');
  });

  it('refuses an unknown tag, an already promoted one, and a candidate with no code unless --code', () => {
    expect(check([stable13], ['1.0.14']).stderr).toMatch(/not found/);
    expect(check([stable13], ['1.0.13']).stderr).toMatch(/not a prerelease/);
    const noCode = [...pilot.slice(0, 4), ''];
    expect(check([noCode, stable13], ['1.0.14']).stderr).toMatch(/--code/);
    expect(check([noCode, stable13], ['1.0.14', '--code', '30470040']).status).toBe(0);
    expect(check([noCode, stable13], ['1.0.14', '--code', '30467000']).status).toBe(1);
  });

  it('release-android.sh records the versionCode in the notes before publishing', () => {
    const sh = fs.readFileSync(`${process.cwd()}/scripts/release-android.sh`, 'utf8');
    const record = sh.indexOf("<!-- versionCode: %s -->");
    expect(record).toBeGreaterThan(-1);
    expect(record).toBeLessThan(sh.indexOf('release create "$TAG"'));
    expect(sh).toMatch(/scripts\/android-promote-check\.sh \$VERSION && gh release edit/);
  });
});

describe('promote check, round 6 (review #278)', () => {
  it('--code must match the code recorded for the prerelease (a newer local rebuild is not that APK)', () => {
    const r = check([pilot, stable13], ['1.0.14', '--code', '30470999']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/recorded/);
    expect(check([pilot, stable13], ['1.0.14', '--code', '30470040']).status).toBe(0);
  });

  it('an old release without a recorded code counts with its minute-based code', () => {
    const sh = fs.readFileSync(`${process.cwd()}/scripts/android-promote-check.sh`, 'utf8');
    expect(sh).toMatch(/android-version-code\.sh" --minute-based "\$published"/);
  });
});
