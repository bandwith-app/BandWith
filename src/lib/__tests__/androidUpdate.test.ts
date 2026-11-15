import { describe, expect, it } from 'vitest';
import { compareVersions, newestAndroidRelease } from '../androidUpdate';

const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  assets: [{ name: 'BandWith.apk', browser_download_url: `https://example.test/${tag}/BandWith.apk` }],
  ...extra,
});

describe('androidUpdate', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.1')).toBe(-1);
  });

  it('picks the newest published Android release with an APK', () => {
    const latest = newestAndroidRelease([
      rel('android-v1.0.2', { draft: true }),
      rel('android-v1.0.3', { prerelease: true }),
      rel('v2.0.0'),
      rel('android-v1.0.10'),
      rel('android-v1.0.9'),
      { tag_name: 'android-v1.0.11', draft: false, prerelease: false, assets: [] },
    ]);
    expect(latest).toEqual({ version: '1.0.10', url: 'https://example.test/android-v1.0.10/BandWith.apk' });
  });

  it('copes with an empty or odd answer', () => {
    expect(newestAndroidRelease([])).toBeNull();
    expect(newestAndroidRelease({ message: 'rate limited' } as never)).toBeNull();
  });
});
