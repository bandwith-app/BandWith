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
    expect(code('1.0.13.1')).toBe(41001301);
    expect(code('2.3.4.5')).toBe(42030405);
  });

  it('follows the version order: a hotfix of an older line is always below the newer release', () => {
    const order = ['1.0.13', '1.0.13.1', '1.0.13.2', '1.0.14', '1.0.14.1', '1.0.15', '1.1', '1.1.0.1', '1.2.0', '2.0.0'];
    const codes = order.map((v) => code(v));
    expect([...codes].sort((a, b) => a - b)).toEqual(codes);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('starts above every code published before, and stays below Google’s limit', () => {
    expect(code('1.0.14')).toBeGreaterThan(HIGHEST_PUBLISHED);
    expect(code('1.0.0')).toBeGreaterThan(code('--minute-based', at('2045-01-01T00:00:00Z')));
    expect(code('2059.99.99.99')).toBeLessThan(2100000000);
  });

  it('refuses a version it cannot encode', () => {
    for (const v of ['soon', '1', '1.0.100', '1.100.0', '1.0.0.100', '2060.0.0', '1.0.14-beta', '']) refuses(v);
  });

  it('the old minute-based code is still there for releases from before (scripts/android-promote-check.sh)', () => {
    expect(code('--minute-based', at('2026-01-01T00:00:00Z'))).toBe(30000000);
    expect(code('--minute-based', at('2026-11-15T20:16:00Z')) - code('--minute-based', at('2026-11-15T20:15:50Z'))).toBe(1);
    refuses('--minute-based', 'soon');
  });
});
