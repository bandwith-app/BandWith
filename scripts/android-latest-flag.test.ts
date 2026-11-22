/**
 * scripts/android-latest-flag.sh: a stable Android release becomes "latest"
 * (the fixed link and the in-app updater) only when it is the highest version.
 */
import { describe, expect, it } from 'vitest';

// Runs the real script. The app's tsconfig has no Node types, hence the loose import.
type ExecFileSync = (file: string, args: string[]) => { toString(): string };
const NODE_CHILD_PROCESS = 'node:child_process';
const { execFileSync } = (await import(/* @vite-ignore */ NODE_CHILD_PROCESS)) as { execFileSync: ExecFileSync };
const { process } = globalThis as unknown as { process: { cwd(): string } };
const SCRIPT = `${process.cwd()}/scripts/android-latest-flag.sh`;
const flag = (...args: string[]) => execFileSync('bash', [SCRIPT, ...args]).toString().trim();

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

  it('release-android.sh asks it instead of always passing --latest', async () => {
    const NODE_FS = 'node:fs';
    const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync: (p: string, e: 'utf8') => string };
    const sh = readFileSync(`${process.cwd()}/scripts/release-android.sh`, 'utf8');
    expect(sh).not.toMatch(/RELEASE_FLAGS=\(--latest\)/);
    expect(sh).toMatch(/scripts\/android-latest-flag\.sh "\$VERSION"/);
  });
});
