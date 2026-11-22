/**
 * scripts/android-latest-flag.sh: a stable Android release becomes "latest"
 * (the fixed link and the in-app updater) only when it is the highest version.
 */
import { describe, expect, it } from 'vitest';

// Runs the real script. The app's tsconfig has no Node types, hence the loose import.
type ExecFileSync = (file: string, args: string[], opts?: { env?: Record<string, string>; stdio?: 'pipe' }) => { toString(): string };
const NODE_CHILD_PROCESS = 'node:child_process';
const { execFileSync } = (await import(/* @vite-ignore */ NODE_CHILD_PROCESS)) as { execFileSync: ExecFileSync };
const { process } = globalThis as unknown as { process: { cwd(): string } };
const SCRIPT = `${process.cwd()}/scripts/android-latest-flag.sh`;
const flag = (...args: string[]) => execFileSync('bash', [SCRIPT, ...args]).toString().trim();
const NODE_FS = 'node:fs';
const NODE_OS = 'node:os';
const fs = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (p: string, e: 'utf8') => string;
  writeFileSync: (p: string, d: string, o?: { mode: number }) => void;
  mkdtempSync: (p: string) => string;
};
const os = (await import(/* @vite-ignore */ NODE_OS)) as { tmpdir: () => string };
const env = (globalThis as unknown as { process: { env: Record<string, string> } }).process.env;
/** --lookup with a stand-in for gh: prints `out` and exits with `code`. */
const lookup = (version: string, out: string, code: number) => {
  const dir = fs.mkdtempSync(`${os.tmpdir()}/fake-gh-`);
  const gh = `${dir}/gh`;
  fs.writeFileSync(gh, `#!/usr/bin/env bash\necho ${JSON.stringify(out)} >&2\n[ ${code} -eq 0 ] && echo ${JSON.stringify(out)}\nexit ${code}\n`, { mode: 0o755 });
  return execFileSync('bash', [SCRIPT, '--lookup', version], { env: { ...env, GH: gh }, stdio: 'pipe' }).toString().trim();
};

describe('Android "latest" flag', () => {
  it('a higher version becomes latest', () => {
    expect(flag('1.0.14', '1.0.13')).toBe('--latest');
    expect(flag('1.0.14', 'android-v1.0.13')).toBe('--latest');
    expect(flag('1.0.10', '1.0.9')).toBe('--latest');
    expect(flag('1.1.0', '1.0.99')).toBe('--latest');
  });

  it('a lower version never takes the fixed link back', () => {
    expect(flag('1.0.13.1', '1.0.14')).toBe('--latest=false');
    expect(flag('1.0.9', '1.0.10')).toBe('--latest=false');
  });

  it('no current latest: latest; the same version: left alone', () => {
    expect(flag('1.0.1')).toBe('--latest');
    expect(flag('1.0.1', '')).toBe('--latest');
    expect(flag('1.0.14', '1.0.14')).toBe('--latest=false');
  });

  it('--lookup reads the current latest release, and fails closed on any other error (round 4)', () => {
    expect(lookup('1.0.14', 'android-v1.0.13', 0)).toBe('--latest');
    expect(lookup('1.0.13.1', 'android-v1.0.14', 0)).toBe('--latest=false');
    // No release at all yet: the first one is latest.
    expect(lookup('1.0.1', 'release not found', 1)).toBe('--latest');
    // Network or auth trouble: no guess, the script stops.
    expect(() => lookup('1.0.14', 'HTTP 502: Bad Gateway', 1)).toThrow();
    expect(() => lookup('1.0.14', '', 0)).toThrow();
  });

  it('release-android.sh looks it up again right before publishing, and prints a promote command that asks too (round 4)', () => {
    const sh = fs.readFileSync(`${process.cwd()}/scripts/release-android.sh`, 'utf8');
    const built = sh.indexOf('Built dist-android/BandWith.apk');
    const create = sh.indexOf('gh release create');
    const recheck = sh.indexOf('android-latest-flag.sh --lookup', built);
    expect(recheck).toBeGreaterThan(built);
    expect(recheck).toBeLessThan(create);
    expect(sh).not.toMatch(/--prerelease=false --latest"/);
    expect(sh).not.toMatch(/2>\/dev\/null \|\| true\)"/);
  });

  it('release-android.sh asks it instead of always passing --latest', async () => {
    const sh = fs.readFileSync(`${process.cwd()}/scripts/release-android.sh`, 'utf8');
    expect(sh).not.toMatch(/RELEASE_FLAGS=\(--latest\)/);
    expect(sh).toMatch(/scripts\/android-latest-flag\.sh --lookup "\$VERSION"/);
  });
});
