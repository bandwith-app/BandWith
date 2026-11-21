/**
 * The repository is public: signing keys and service configs must never be
 * committable by accident (a `git add -A` in a hurry). The Apple Sign-In .p8
 * once lived in the history; Android keystores were not ignored at all.
 * Each path below must be matched by a .gitignore rule.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

const MUST_BE_IGNORED = [
  '.env',
  '.env.local',
  'AuthKey_ABC123.p8',
  'certs/dist.p12',
  'certs/key.pem',
  'android/app/google-services.json',
  'ios/App/App/GoogleService-Info.plist',
  'android/app/release.keystore',
  'android/app/upload.jks',
  'bandwith-release.keystore',
  'android/keystore.properties',
  'android/key.properties',
  'supabase/.temp/project-ref',
];

/** true when a .gitignore rule matches the path (tracked or not). */
function ignored(file: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '--no-index', '-q', file], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('secret files are git-ignored', () => {
  it.each(MUST_BE_IGNORED)('%s', (file) => {
    expect(ignored(file)).toBe(true);
  });
});
