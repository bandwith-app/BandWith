import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { parseAppVersion, versionGate, webBuildStamp } from '../minVersion';

describe('minimum version: the gate', () => {
  const info = (min: string | null, latest: string | null = null) => ({ minVersion: min, latestVersion: latest, storeUrl: null });

  it('nothing written for the platform: ok', () => {
    expect(versionGate('1.0.3', null)).toBe('ok');
    expect(versionGate('1.0.3', info(null))).toBe('ok');
  });

  it('installed version unknown: never blocks', () => {
    expect(versionGate(null, info('9.9.9'))).toBe('ok');
  });

  it('below the minimum: blocked', () => {
    expect(versionGate('1.0.8', info('1.0.9'))).toBe('blocked');
    expect(versionGate('1.0.8', info('1.1'))).toBe('blocked');
    expect(versionGate('202611172157', info('202612150900'))).toBe('blocked');
  });

  it('at or above the minimum: ok, or soft when a newer one exists', () => {
    expect(versionGate('1.0.9', info('1.0.9'))).toBe('ok');
    expect(versionGate('1.0.9', info('1.0.8', '1.1.0'))).toBe('soft');
    expect(versionGate('1.1.0', info('1.0.8', '1.1.0'))).toBe('ok');
  });

  it('garbage from the server never blocks', () => {
    expect(versionGate('1.0.8', info('abc'))).toBe('ok');
  });
});

describe('minimum version: what the server sends (bw_app_version)', () => {
  it('parses it', () => {
    expect(parseAppVersion({ min_version: '1.0.9', latest_version: '1.1.0', store_url: 'https://x' })).toEqual({
      minVersion: '1.0.9',
      latestVersion: '1.1.0',
      storeUrl: 'https://x',
    });
  });

  it('nothing or anything else: null', () => {
    expect(parseAppVersion(null)).toBeNull();
    expect(parseAppVersion('x')).toBeNull();
  });
});

describe('minimum version: the web build stamp', () => {
  it('is the build time as yyyymmddhhmm (UTC)', () => {
    expect(webBuildStamp(new Date('2026-12-14T09:05:00Z'))).toBe('202612140905');
  });
});
