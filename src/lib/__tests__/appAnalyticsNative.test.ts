/**
 * The native side of app analytics: before the user says yes, Firebase must
 * not collect anything, and the apps never ask for any advertising ID or
 * ad attribution signal (src/lib/appAnalytics.ts).
 */
import { describe, it, expect } from 'vitest';

// Reads the real native config. The app's tsconfig has no Node types, hence the loose import.
const NODE_FS = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as { readFileSync: (path: string, enc: 'utf8') => string };
const { process } = globalThis as unknown as { process: { cwd(): string } };
const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, 'utf8'); // vitest runs from the repo root
const manifest = read('android/app/src/main/AndroidManifest.xml');
const plist = read('ios/App/App/Info.plist');
const podfile = read('ios/App/Podfile');

const metaFalse = (name: string) =>
  new RegExp(`<meta-data\\s+android:name="${name}"\\s+android:value="false"\\s*/>`).test(manifest);
const plistFalse = (key: string) => new RegExp(`<key>${key}</key>\\s*<false\\s*/>`).test(plist);

describe('Android', () => {
  it('starts with collection off and every consent type denied', () => {
    for (const name of [
      'firebase_analytics_collection_enabled',
      'google_analytics_adid_collection_enabled',
      'google_analytics_default_allow_analytics_storage',
      'google_analytics_default_allow_ad_storage',
      'google_analytics_default_allow_ad_user_data',
      'google_analytics_default_allow_ad_personalization_signals',
      // Crashlytics too: only with the same consent (src/lib/crashReports.ts).
      'firebase_crashlytics_collection_enabled',
    ]) {
      expect(metaFalse(name), name).toBe(true);
    }
  });

  it('removes every advertising and attribution permission the SDK would add', () => {
    for (const perm of [
      'com.google.android.gms.permission.AD_ID',
      'android.permission.ACCESS_ADSERVICES_AD_ID',
      'android.permission.ACCESS_ADSERVICES_ATTRIBUTION',
      'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
    ]) {
      expect(manifest, perm).toMatch(new RegExp(`android:name="${perm.replace(/\./g, '\\.')}"\\s+tools:node="remove"`));
    }
  });
});

describe('iOS', () => {
  it('starts with collection off and every consent type denied', () => {
    for (const key of [
      'FIREBASE_ANALYTICS_COLLECTION_ENABLED',
      'GOOGLE_ANALYTICS_DEFAULT_ALLOW_ANALYTICS_STORAGE',
      'GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_STORAGE',
      'GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_USER_DATA',
      'GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS',
      'FirebaseCrashlyticsCollectionEnabled',
    ]) {
      expect(plistFalse(key), key).toBe(true);
    }
  });

  it('uses the Firebase Analytics build without IDFA support', () => {
    expect(podfile).toMatch(/CapacitorFirebaseAnalytics\/AnalyticsWithoutAdIdSupport/);
  });
});
