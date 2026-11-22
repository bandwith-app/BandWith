/**
 * scripts/android-version-code.sh: the versionCode of each Android release
 * (scripts/release-android.sh). Android installs an update only over a
 * lower code, and the in-app updater offers the higher version name, so the
 * code must follow the version: a hotfix 1.0.13.1 published after 1.0.14
 * must have a LOWER code than 1.0.14 (review #278 round 6). The code
 * encodes the version: 40000000 + major·1000000 + minor·10000 + patch·100 + build.
 */
import { describe, expect, it } from 'vitest';

// Runs the real script. The app's tsconfig has no Node types, hence the loose import.
type ExecFileSync = (file: string, args: string[], options?: { stdio?: 'pipe' }) => { toString(): string };
const NODE_CHILD_PROCESS = 'node:child_process';
const { execFileSync } = (await import(/* @vite-ignore */ NODE_CHILD_PROCESS)) as { execFileSync: ExecFileSync };
const { process } = globalThis as unknown as { process: { cwd(): string } };
const SCRIPT = `${process.cwd()}/scripts/android-version-code.sh`; // vitest runs from the repo root
const code = (...args: string[]) => Number(execFileSync('bash', [SCRIPT, ...args]).toString().trim());
const refuses = (...args: string[]) => expect(() => execFileSync('bash', [SCRIPT, ...args], { stdio: 'pipe' })).toThrow();
const at = (iso: string) => String(Math.floor(Date.parse(iso) / 1000));

// The highest code published with the minute-based scheme so far
// (android-v1.0.13, 2026-11-21); that scheme stays below 40000000 until 2045.
const HIGHEST_PUBLISHED = 30467513;

describe('Android versionCode', () => {
  it('encodes the version', () => {
    expect(code('1.0.14')).toBe(41001400);
    expect(code('1.0.14.1')).toBe(41001401);
    expect(code('2.3.4.5')).toBe(42030405);
  });

  it('follows the version order: a hotfix of an older line is always below the newer release', () => {
    const order = ['1.0.14', '1.0.14.1', '1.0.14.2', '1.0.15', '1.0.15.1', '1.0.16', '1.1.0', '1.1.0.1', '1.2.0', '2.0.0'];
    const codes = order.map((v) => code(v));
    expect([...codes].sort((a, b) => a - b)).toEqual(codes);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('starts above every code published before, and stays below Google’s limit', () => {
    expect(code('1.0.14')).toBeGreaterThan(HIGHEST_PUBLISHED);
    expect(code('1.0.14')).toBeGreaterThan(code('--minute-based', at('2045-01-01T00:00:00Z')));
    expect(code('2059.99.99.99')).toBeLessThan(2100000000);
  });

  it('refuses a version it cannot encode', () => {
    for (const v of ['soon', '1', '1.0.100', '1.100.0', '1.0.0.100', '2060.0.0', '1.0.14-beta', '']) refuses(v);
  });

  it('accepts only the canonical form: one version, one code, one tag (review #278, Claude)', () => {
    // Each of these names a version that has a canonical spelling (or none), so two tags could share a code.
    for (const v of ['1.0.14.0', '1.00.14', '01.0.14', '1.0.014', '1.1', '1.0']) refuses(v);
    expect(code('1.1.0')).toBe(41010000);
    expect(code('1.0.14.1')).toBe(41001401);
  });

  it('release-android.sh refuses a non-canonical version before anything else', () => {
    const sh = execFileSync('cat', [`${process.cwd()}/scripts/release-android.sh`]).toString();
    // Since 82d29c7d the tag comes from --tag (one android-v stripped, version validated).
    const versionCheck = sh.indexOf('TAG="$(scripts/android-version-code.sh --tag "$VERSION")" || exit 1');
    expect(versionCheck).toBeGreaterThan(-1);
    expect(sh).not.toContain('TAG="android-v$VERSION"');
    // Nothing reads the version or the tag before it is checked.
    const firstUse = sh.search(/\$\{?(TAG|VERSION)\b(?![^\n]*--tag)/);
    expect(firstUse === -1 || firstUse > versionCheck, `first use at ${firstUse}`).toBe(true);
    expect(sh).not.toMatch(/\[\[ "\$VERSION" =~ \^\[0-9\]\+\(\\\.\[0-9\]\+\)\{1,3\}\$ \]\]/);
  });

  it('the old minute-based code is still there for releases from before (scripts/android-promote-check.sh)', () => {
    expect(code('--minute-based', at('2026-01-01T00:00:00Z'))).toBe(30000000);
    expect(code('--minute-based', at('2026-11-15T20:16:00Z')) - code('--minute-based', at('2026-11-15T20:15:50Z'))).toBe(1);
    refuses('--minute-based', 'soon');
  });
});

// Every Android release published so far (gh api, 11-22): minute-based codes,
// each at most the minute-based code of its publish time (it was built before).
const PUBLISHED: [string, string][] = [
  ['1.0.1', '2026-11-15T20:15:50Z'], ['1.0.2', '2026-11-15T20:32:02Z'], ['1.0.3', '2026-11-16T14:41:18Z'],
  ['1.0.4', '2026-11-16T17:58:35Z'], ['1.0.5', '2026-11-16T21:18:30Z'], ['1.0.6', '2026-11-17T07:50:27Z'],
  ['1.0.7', '2026-11-17T21:12:55Z'], ['1.0.8', '2026-11-18T02:49:49Z'], ['1.0.9', '2026-11-19T14:10:58Z'],
  ['1.0.10', '2026-11-20T15:55:53Z'], ['1.0.11', '2026-11-20T18:28:03Z'], ['1.0.12', '2026-11-20T22:06:48Z'],
  ['1.0.13', '2026-11-21T15:54:13Z'],
];

describe('Android versionCode, Codex round (review #278)', () => {
  it('refuses any version below 1.0.14: a fix for 1.0.13 ships as 1.0.14, never as 1.0.12.x or 1.0.13.x', () => {
    for (const v of ['1.0.13', '1.0.13.1', '1.0.12.5', '1.0.0', '0.9.99', '1.0.9']) refuses(v);
    expect(code('1.0.14')).toBe(41001400);
  });

  it('every new code is above every published code, and the codes keep the version order', () => {
    const published = Math.max(HIGHEST_PUBLISHED, ...PUBLISHED.map(([, t]) => code('--minute-based', at(t))));
    const versions = ['1.0.14', '1.0.14.1', '1.0.15', '1.0.99.99', '1.1.0', '1.10.0', '2.0.0', '10.0.0', '2059.99.99.99'];
    const codes = versions.map((v) => code(v));
    for (const c of codes) expect(c).toBeGreaterThan(published);
    for (let i = 1; i < codes.length; i++) expect(codes[i], versions[i]).toBeGreaterThan(codes[i - 1]);
  });
});
