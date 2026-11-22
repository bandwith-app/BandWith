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

/** Releases as [tag, prerelease, draft, published, recorded code, has BandWith.apk (default true)], printed in gh --jq's order (…, apk, code). */
const check = (lines: string[][], args: string[], ghExit = 0) => {
  const dir = fs.mkdtempSync(`${os.tmpdir()}/fake-gh-`);
  const withApk = lines.map((l) => [...l.slice(0, 4), l[5] ?? 'true', l[4]]);
  fs.writeFileSync(`${dir}/out.tsv`, withApk.map((l) => l.join('\t')).join('\n') + '\n');
  fs.writeFileSync(
    `${dir}/gh`,
    `#!/usr/bin/env bash\n[ ${ghExit} -eq 0 ] || { echo "HTTP 401: Bad credentials" >&2; exit ${ghExit}; }\ncat "${dir}/out.tsv"\n`,
    { mode: 0o755 },
  );
  return spawnSync('bash', [SCRIPT, ...args], { env: { ...process.env, GH: `${dir}/gh` }, encoding: 'utf8' });
};

// 1.0.14's code is scripts/android-version-code.sh 1.0.14 (versions encode their code).
const pilot = ['android-v1.0.14', 'true', 'false', at('2026-11-23T10:00:00Z'), '41001400'];
const stable13 = ['android-v1.0.13', 'false', 'false', at('2026-11-21T16:34:13Z'), '30467513'];

describe('promote check', () => {
  it('a pilot above every published release may be promoted', () => {
    const r = check([pilot, stable13], ['1.0.14']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/OK: android-v1\.0\.14 \(code 41001400\).*android-v1\.0\.13, code 30467513/);
  });

  it('a hotfix published during the pilot (a higher code) stops the promotion: rebuild', () => {
    const hotfix = ['android-v1.0.14.1', 'false', 'false', at('2026-11-24T09:00:00Z'), '41001401'];
    const r = check([pilot, hotfix, stable13], ['1.0.14']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not above android-v1\.0\.14\.1 \(41001401\)/);
    expect(r.stderr).toMatch(/Rebuild/);
  });

  it('an old release without a recorded code counts with its publish time (never below its real code)', () => {
    const old = ['android-v1.0.12', 'false', 'false', at('2026-11-24T09:00:00Z'), ''];
    const r = check([pilot, old, stable13], ['1.0.14']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/highest android-v1\.0\.12, code 3047/);
  });

  it('every release ever published counts, prereleases included (pilot phones installed them); only drafts do not (Codex, #278)', () => {
    const otherPilot = ['android-v1.0.15', 'true', 'false', at('2026-11-25T09:00:00Z'), '41001500'];
    const draft = ['android-v1.0.16', 'false', 'true', at('2026-11-25T10:00:00Z'), '41001600'];
    const r = check([pilot, otherPilot, stable13], ['1.0.14']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not above android-v1\.0\.15 \(41001500\)/);
    expect(check([pilot, draft, stable13], ['1.0.14']).status).toBe(0);
  });

  it('fails closed: GitHub unreachable or no auth means no promotion', () => {
    const r = check([pilot, stable13], ['1.0.14'], 4);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not promoting on a guess/);
    expect(r.stdout).toBe('');
  });

  it('refuses an unknown tag, an already promoted one, and a candidate with no code unless --code', () => {
    expect(check([stable13], ['1.0.14']).stderr).toMatch(/not found/);
    const stable14 = ['android-v1.0.14', 'false', 'false', at('2026-11-23T10:00:00Z'), '41001400'];
    expect(check([stable14, stable13], ['1.0.14']).stderr).toMatch(/not a prerelease/);
    const noCode = [...pilot.slice(0, 4), ''];
    expect(check([noCode, stable13], ['1.0.14']).stderr).toMatch(/--code/);
    expect(check([noCode, stable13], ['1.0.14', '--code', '41001400']).status).toBe(0);
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
    const r = check([pilot, stable13], ['1.0.14', '--code', '41001499']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/recorded/);
    expect(check([pilot, stable13], ['1.0.14', '--code', '41001400']).status).toBe(0);
  });

  it('an old release without a recorded code counts with its minute-based code', () => {
    const sh = fs.readFileSync(`${process.cwd()}/scripts/android-promote-check.sh`, 'utf8');
    expect(sh).toMatch(/android-version-code\.sh" --minute-based "\$published"/);
  });
});

describe('promote check, Codex round (review #278)', () => {
  it('refuses a prerelease without its BandWith.apk (withdrawn or never uploaded)', () => {
    const r = check([[...pilot, 'false'], stable13], ['1.0.14']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no BandWith\.apk/);
    expect(r.stdout).toBe('');
  });

  it('reads the assets from GitHub, not only the notes', () => {
    const sh = fs.readFileSync(`${process.cwd()}/scripts/android-promote-check.sh`, 'utf8');
    expect(sh).toMatch(/\.assets/);
    expect(sh).toMatch(/BandWith\.apk/);
  });

  it('a withdrawn stable release still counts: phones may have installed it', () => {
    const withdrawn = ['android-v1.0.14.1', 'false', 'false', at('2026-11-24T09:00:00Z'), '41001401', 'false'];
    const next = ['android-v1.0.15', 'true', 'false', at('2026-11-25T09:00:00Z'), '41001400', 'true'];
    expect(check([next, withdrawn, stable13], ['1.0.15']).status).toBe(1);
  });
});

describe('promote check, Claude review (#278): the code is the version\'s', () => {
  it('a recorded code other than android-version-code.sh <version> is refused (another build)', () => {
    const minute = ['android-v1.0.14', 'true', 'false', at('2026-11-23T10:00:00Z'), '30470040'];
    const r = check([minute, stable13], ['1.0.14']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/41001400/);
  });

  it('below 1.0.14, a non-canonical spelling or a doubled prefix is refused before GitHub is asked', () => {
    for (const v of ['1.0.13.2', '1.0.13', '1.00.14', '1.0.14.0', '1.0', 'android-vandroid-v1.0.14', 'v1.0.14']) {
      const r = check([pilot, stable13], [v], 4); // GitHub "down": only a refusal before asking passes
      expect(r.status, v).toBe(1);
      expect(r.stderr, v).not.toMatch(/not promoting on a guess/);
    }
  });

  it('accepts the tag spelling once: android-v1.0.14 is 1.0.14', () => {
    const r = check([pilot, stable13], ['android-v1.0.14']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/OK: android-v1\.0\.14 /);
  });
});

describe('one spelling for the tag (Codex, #278): android-version-code.sh --tag', () => {
  const tag = (v: string) => spawnSync('bash', [`${process.cwd()}/scripts/android-version-code.sh`, '--tag', v], { env: process.env, encoding: 'utf8' });
  it('normalises a single android-v, never android-vandroid-v…', () => {
    expect(tag('1.0.14').stdout.trim()).toBe('android-v1.0.14');
    expect(tag('android-v1.0.14.1').stdout.trim()).toBe('android-v1.0.14.1');
    for (const v of ['android-vandroid-v1.0.14', 'vandroid-v1.0.14', '1.0.13', '1.0.14.0']) {
      const r = tag(v);
      expect(r.status, v).toBe(1);
      expect(r.stdout, v).toBe('');
    }
  });

  it('release-android.sh takes its tag and version from it', () => {
    const sh = fs.readFileSync(`${process.cwd()}/scripts/release-android.sh`, 'utf8');
    expect(sh).toMatch(/TAG="\$\(scripts\/android-version-code\.sh --tag "\$VERSION"\)"/);
    expect(sh).toMatch(/VERSION="\$\{TAG#android-v\}"/);
    expect(sh).not.toMatch(/TAG="android-v\$VERSION"/);
  });

  it('release-android.sh refuses a doubled prefix before anything else runs', () => {
    const r = spawnSync('bash', [`${process.cwd()}/scripts/release-android.sh`, 'android-vandroid-v1.0.14'], { env: process.env, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stdout).not.toMatch(/Built|gradle/i);
  });
});

describe('the header example fits the version scheme (Claude review of 8a83933e)', () => {
  it('names no version the scheme refuses (below 1.0.14)', async () => {
    const { readFileSync } = (await import(/* @vite-ignore */ 'node:fs')) as { readFileSync: (p: string, e: 'utf8') => string };
    const proc = (globalThis as unknown as { process: { cwd(): string } }).process;
    const head = readFileSync(`${proc.cwd()}/scripts/android-promote-check.sh`, 'utf8').split('\n').filter((l) => l.startsWith('#')).join('\n');
    for (const [, v] of head.matchAll(/\b(\d+\.\d+\.\d+(?:\.\d+)?)\b/g)) {
      const [a, b, c] = v.split('.').map(Number);
      expect(a > 1 || b > 0 || c >= 14, v).toBe(true);
    }
  });
});
