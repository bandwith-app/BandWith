import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { onAppResume } from '@/lib/appResume';

/**
 * Android test builds come from GitHub releases (scripts/release-android.sh),
 * not from a store, so nothing updates them by themselves. A release build
 * looks for a newer `android-v<version>` release (at most every 6 hours, and
 * again when the app comes back to the front) and offers it: one tap
 * downloads the APK, Android installs it over the current version.
 *
 * Debug builds (version code 1, debug key) never offer it: a release-signed
 * APK can't install over them.
 */
export const ANDROID_APK_URL = 'https://github.com/bandwith-app/BandWith/releases/latest/download/BandWith.apk';
const RELEASES_API = 'https://api.github.com/repos/bandwith-app/BandWith/releases?per_page=20';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const LS_CHECKED = 'bw.androidUpdate.checkedAt';
const LS_LATEST = 'bw.androidUpdate.latest';

export interface AndroidUpdate {
  version: string;
  url: string;
}

interface GithubRelease {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string; browser_download_url?: string }[];
}

/** Compares dotted versions numerically: 1.0.10 > 1.0.9. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The newest published Android release in a GitHub releases list. */
export function newestAndroidRelease(list: GithubRelease[]): AndroidUpdate | null {
  let best: AndroidUpdate | null = null;
  for (const r of Array.isArray(list) ? list : []) {
    if (r?.draft || r?.prerelease) continue;
    const m = /^android-v(\d+(?:\.\d+)*)$/.exec(String(r?.tag_name ?? ''));
    if (!m) continue;
    const apk = r.assets?.find((a) => a?.name === 'BandWith.apk')?.browser_download_url;
    if (!apk) continue;
    if (!best || compareVersions(m[1], best.version) > 0) best = { version: m[1], url: apk };
  }
  return best;
}

function readLatest(): AndroidUpdate | null {
  try {
    const v = JSON.parse(localStorage.getItem(LS_LATEST) || 'null');
    return v && typeof v.version === 'string' && typeof v.url === 'string' ? v : null;
  } catch {
    return null;
  }
}

async function installedVersion(): Promise<{ version: string; build: string } | null> {
  if (Capacitor.getPlatform() !== 'android') return null;
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    return { version: info.version, build: info.build };
  } catch {
    return null;
  }
}

/** A newer Android release than the installed one, or null. */
export async function checkAndroidUpdate(force = false): Promise<AndroidUpdate | null> {
  const installed = await installedVersion();
  if (!installed || installed.build === '1') return null;

  let latest = readLatest();
  let checkedAt = 0;
  try {
    checkedAt = Number(localStorage.getItem(LS_CHECKED)) || 0;
  } catch {
    /* storage unavailable: just check */
  }
  if (force || !latest || Date.now() - checkedAt > CHECK_EVERY_MS) {
    try {
      const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
      if (res.ok) {
        latest = newestAndroidRelease(await res.json());
        try {
          localStorage.setItem(LS_CHECKED, String(Date.now()));
          localStorage.setItem(LS_LATEST, JSON.stringify(latest));
        } catch {
          /* not remembered: checks again next time */
        }
      }
    } catch {
      /* offline or rate-limited: keep what we knew */
    }
  }
  return latest && compareVersions(latest.version, installed.version) > 0 ? latest : null;
}

/** Downloads the update in the browser; Android then offers to install it. */
export async function openAndroidUpdate(update: AndroidUpdate): Promise<void> {
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url: update.url });
  } catch {
    window.open(update.url, '_blank');
  }
}

/** The pending Android update, checked on start and on every resume. */
export function useAndroidUpdate(): AndroidUpdate | null {
  const [update, setUpdate] = useState<AndroidUpdate | null>(null);
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    let alive = true;
    const check = () => {
      void checkAndroidUpdate().then((u) => {
        if (alive) setUpdate((prev) => (prev?.version === u?.version && prev?.url === u?.url ? prev : u));
      });
    };
    check();
    const off = onAppResume(check);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return update;
}
