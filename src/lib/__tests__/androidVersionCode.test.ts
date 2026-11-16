/**
 * scripts/android-version-code.sh: the versionCode of each Android release
 * (scripts/release-android.sh). Android installs an update only over a
 * lower or equal code, and the in-app updater requires a strictly higher one.
 */
import { describe, expect, it } from 'vitest';

// Runs the real script. The app's tsconfig has no Node types, hence the loose import.
type ExecFileSync = (file: string, args: string[], options?: { stdio?: 'pipe' }) => { toString(): string };
const NODE_CHILD_PROCESS = 'node:child_process';
const { execFileSync } = (await import(/* @vite-ignore */ NODE_CHILD_PROCESS)) as { execFileSync: ExecFileSync };
const { process } = globalThis as unknown as { process: { cwd(): string } };
const SCRIPT = `${process.cwd()}/scripts/android-version-code.sh`; // vitest runs from the repo root
const code = (unix?: number) => Number(execFileSync('bash', [SCRIPT, ...(unix === undefined ? [] : [String(unix)])]).toString().trim());
const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

// The highest code published with the old hour-based yymmddhh scheme
// (android-v1.0.1 and android-v1.0.2, both 2026-11-15 20:xx UTC).
const HIGHEST_PUBLISHED = 26111520;

describe('Android versionCode', () => {
  it('starts above every code published before', () => {
    expect(code(at('2026-01-01T00:00:00Z'))).toBe(30000000);
    expect(code(at('2026-11-15T20:32:02Z'))).toBeGreaterThan(HIGHEST_PUBLISHED);
    expect(code()).toBeGreaterThan(HIGHEST_PUBLISHED);
  });

  it('goes up every minute, so two releases in one hour differ', () => {
    const first = code(at('2026-11-15T20:15:50Z'));
    const second = code(at('2026-11-15T20:32:02Z'));
    expect(second - first).toBe(17);
    expect(code(at('2026-11-15T20:16:00Z'))).toBe(first + 1);
    expect(code(at('2026-11-15T20:16:59Z'))).toBe(first + 1);
  });

  it('stays below Google’s limit for a very long time', () => {
    expect(code(at('2999-12-31T23:59:00Z'))).toBeLessThan(2100000000);
  });

  it('refuses a bad time', () => {
    expect(() => execFileSync('bash', [SCRIPT, 'soon'], { stdio: 'pipe' })).toThrow();
    expect(() => execFileSync('bash', [SCRIPT, String(at('2025-12-31T23:59:00Z'))], { stdio: 'pipe' })).toThrow();
  });
});
