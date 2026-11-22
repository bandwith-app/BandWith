/**
 * Review #277 round 5: a sign-out that fails clears local storage and
 * reloads (IdentityHub). The device's privacy choices must survive that:
 * a missing crash-report key means "on" (the default of a new install), so
 * losing an opt-out would turn reports back on without asking.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearStorageKeepingPrivacyChoices } from '../privacyChoices';
import { CRASH_REPORTS_KEY } from '../crashReports';
import { ANALYTICS_CONSENT_KEY, ANALYTICS_CONSENT_VERSION_KEY } from '../appAnalytics';

const NODE_FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (p: string, e: 'utf8') => string;
  readdirSync: (p: string, o: { recursive: true }) => string[];
};
const { process } = globalThis as unknown as { process: { cwd(): string } };

beforeEach(() => localStorage.clear());

describe('privacy choices survive a storage clear', () => {
  it('keeps the crash report switch and the analytics answer, clears the rest', () => {
    localStorage.setItem(CRASH_REPORTS_KEY, 'off');
    localStorage.setItem(ANALYTICS_CONSENT_KEY, 'denied');
    localStorage.setItem(ANALYTICS_CONSENT_VERSION_KEY, '2');
    localStorage.setItem('sb-auth-token', 'x');
    clearStorageKeepingPrivacyChoices();
    expect(localStorage.getItem(CRASH_REPORTS_KEY)).toBe('off');
    expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe('denied');
    expect(localStorage.getItem(ANALYTICS_CONSENT_VERSION_KEY)).toBe('2');
    expect(localStorage.getItem('sb-auth-token')).toBeNull();
  });

  it('nothing to keep: just clears', () => {
    localStorage.setItem('sb-auth-token', 'x');
    clearStorageKeepingPrivacyChoices();
    expect(localStorage.length).toBe(0);
  });

  it('no bare localStorage.clear() in the app (it would lose an opt-out)', () => {
    const root = `${process.cwd()}/src`;
    const files = fs
      .readdirSync(root, { recursive: true })
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__') && !f.endsWith('privacyChoices.ts'));
    const bare = files.filter((f) => /localStorage\.clear\(\)/.test(fs.readFileSync(`${root}/${f}`, 'utf8')));
    expect(bare).toEqual([]);
  });
});
