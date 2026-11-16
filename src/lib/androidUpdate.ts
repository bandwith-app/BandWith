import { useEffect, useState, useSyncExternalStore } from 'react';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { onAppResume } from '@/lib/appResume';
import { t as tNow } from '@/lib/i18n';

/**
 * Android test builds come from GitHub releases (scripts/release-android.sh),
 * not from a store, so nothing updates them by themselves. A release build
 * looks for a newer `android-v<version>` release (at most every 6 hours, and
 * again when the app comes back to the front) and offers it: one tap
 * downloads the APK inside the app and opens Android's installer on it.
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
  /** Bytes, from the release asset: the download is checked against it. */
  size?: number;
}

interface GithubRelease {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string; browser_download_url?: string; size?: number }[];
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
    const asset = r.assets?.find((a) => a?.name === 'BandWith.apk');
    const apk = asset?.browser_download_url;
    if (!apk) continue;
    if (!best || compareVersions(m[1], best.version) > 0) {
      best = { version: m[1], url: apk };
      if (typeof asset.size === 'number' && asset.size > 0) best.size = asset.size;
    }
  }
  return best;
}

function readLatest(): AndroidUpdate | null {
  try {
    const v = JSON.parse(localStorage.getItem(LS_LATEST) || 'null');
    if (!v || typeof v.version !== 'string' || typeof v.url !== 'string') return null;
    return { version: v.version, url: v.url, ...(typeof v.size === 'number' && v.size > 0 ? { size: v.size } : {}) };
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

// ---------------------------------------------------------------------------
// Installing: the app's own plugin (android/app/src/main/java/com/bandwith/app/
// ApkUpdatePlugin.java) downloads the APK into app-private storage, checks it
// (BandWith, newer version code, same signing key) and opens the system
// installer on it. Android asks once whether BandWith may install apps; after
// that an update is Update → Install. If the plugin can't do it, the APK opens
// in the browser as before.

export type AndroidUpdateErrorCode =
  | 'DOWNLOAD_FAILED'
  | 'SIZE_MISMATCH'
  | 'BAD_APK'
  | 'WRONG_PACKAGE'
  | 'NOT_NEWER'
  | 'SIGNATURE_MISMATCH'
  | 'NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'BUSY'
  | 'INSTALLER_FAILED'
  | 'UNAVAILABLE';

export type AndroidInstallState =
  | { phase: 'idle' }
  | { phase: 'downloading'; version: string; percent: number | null }
  /** Waiting for the user to allow BandWith to install apps (Android 8+). */
  | { phase: 'permission'; version: string }
  /** The system installer is open. */
  | { phase: 'installing'; version: string }
  /** `browser`: the download was handed to the browser instead. */
  | { phase: 'error'; version: string; code: AndroidUpdateErrorCode; browser: boolean };

export type AndroidUpdateSource = 'toast' | 'settings';

export interface ApkUpdatePlugin {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  download(options: { url: string; version: string; size?: number }): Promise<{ versionCode: number; versionName: string; bytes: number }>;
  install(options: { version: string }): Promise<void>;
  addListener(
    event: 'downloadProgress',
    cb: (data: { version: string; percent: number; bytes: number; total: number }) => void,
  ): Promise<PluginListenerHandle>;
}

/** Failures a browser download can't fix: the same file would fail the same way. */
const NO_BROWSER_FALLBACK: AndroidUpdateErrorCode[] = ['NOT_NEWER', 'WRONG_PACKAGE', 'SIGNATURE_MISMATCH'];

const errorCode = (e: unknown): AndroidUpdateErrorCode => {
  const code = (e as { code?: unknown } | null)?.code;
  const known: AndroidUpdateErrorCode[] = [
    'DOWNLOAD_FAILED', 'SIZE_MISMATCH', 'BAD_APK', 'WRONG_PACKAGE', 'NOT_NEWER', 'SIGNATURE_MISMATCH',
    'NOT_ALLOWED', 'NOT_FOUND', 'BUSY', 'INSTALLER_FAILED',
  ];
  return typeof code === 'string' && (known as string[]).includes(code) ? (code as AndroidUpdateErrorCode) : 'UNAVAILABLE';
};

export interface AndroidUpdaterDeps {
  /** null when the native plugin isn't there (web, iOS, an older build). */
  plugin: () => ApkUpdatePlugin | null;
  openBrowser: (url: string) => Promise<void>;
}

/**
 * The install flow as a small state machine, shared by the toast and
 * Settings › About. `resumed()` runs when the app comes back to the front:
 * after the user allowed installs in Android's settings, it continues to the
 * installer; after the installer closes, the button is back.
 */
export function createAndroidUpdater(deps: AndroidUpdaterDeps) {
  let state: AndroidInstallState = { phase: 'idle' };
  let source: AndroidUpdateSource = 'settings';
  let current: AndroidUpdate | null = null;
  const listeners = new Set<() => void>();

  const set = (next: AndroidInstallState) => {
    state = next;
    listeners.forEach((l) => l());
  };

  const fail = async (update: AndroidUpdate, code: AndroidUpdateErrorCode) => {
    const browser = !NO_BROWSER_FALLBACK.includes(code);
    set({ phase: 'error', version: update.version, code, browser });
    if (browser) {
      try {
        await deps.openBrowser(update.url);
      } catch {
        /* nothing more to try */
      }
    }
  };

  const install = async (update: AndroidUpdate, plugin: ApkUpdatePlugin) => {
    try {
      const { allowed } = await plugin.canInstall();
      if (!allowed) {
        set({ phase: 'permission', version: update.version });
        return;
      }
      await plugin.install({ version: update.version });
      set({ phase: 'installing', version: update.version });
    } catch (e) {
      const code = errorCode(e);
      if (code === 'NOT_ALLOWED') set({ phase: 'permission', version: update.version });
      else await fail(update, code);
    }
  };

  return {
    getState: () => state,
    getSource: () => source,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Update tapped: download (with progress), then install. */
    async start(update: AndroidUpdate, from: AndroidUpdateSource) {
      if (state.phase === 'downloading') return;
      source = from;
      current = update;
      const plugin = deps.plugin();
      if (!plugin) {
        set({ phase: 'idle' });
        await deps.openBrowser(update.url);
        return;
      }
      set({ phase: 'downloading', version: update.version, percent: null });
      let handle: PluginListenerHandle | null = null;
      try {
        handle = await plugin.addListener('downloadProgress', (p) => {
          if (state.phase !== 'downloading' || p.version !== update.version) return;
          const percent = p.percent >= 0 ? Math.max(0, Math.min(100, Math.round(p.percent))) : null;
          if (percent !== state.percent) set({ phase: 'downloading', version: update.version, percent });
        });
      } catch {
        /* no progress, the download still works */
      }
      try {
        await plugin.download({ url: update.url, version: update.version, size: update.size });
      } catch (e) {
        await fail(update, errorCode(e));
        return;
      } finally {
        void handle?.remove();
      }
      await install(update, plugin);
    },

    /** "Allow" tapped: Android's "Install unknown apps" page for BandWith. */
    async allow() {
      const plugin = deps.plugin();
      if (state.phase !== 'permission' || !current || !plugin) return;
      try {
        await plugin.openInstallSettings();
      } catch (e) {
        await fail(current, errorCode(e));
      }
    },

    /** The app is in front again. */
    async resumed() {
      const plugin = deps.plugin();
      if (!current || !plugin) return;
      if (state.phase === 'installing') {
        set({ phase: 'idle' });
        return;
      }
      if (state.phase !== 'permission') return;
      try {
        const { allowed } = await plugin.canInstall();
        if (allowed) await install(current, plugin);
      } catch {
        /* still waiting */
      }
    },
  };
}

async function openInBrowser(url: string): Promise<void> {
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } catch {
    window.open(url, '_blank');
  }
}

let nativePlugin: ApkUpdatePlugin | null = null;
const updater = createAndroidUpdater({
  plugin: () => {
    if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('BwApkUpdate')) return null;
    nativePlugin ??= registerPlugin<ApkUpdatePlugin>('BwApkUpdate');
    return nativePlugin;
  },
  openBrowser: openInBrowser,
});

let resumeBound = false;
const bindResume = () => {
  if (resumeBound || Capacitor.getPlatform() !== 'android') return;
  resumeBound = true;
  onAppResume(() => void updater.resumed());
};

/** Downloads and installs the update inside the app (the browser if that can't work). */
export async function openAndroidUpdate(update: AndroidUpdate, from: AndroidUpdateSource = 'settings'): Promise<void> {
  bindResume();
  await updater.start(update, from);
}

/** Opens Android's setting that lets BandWith install apps. */
export async function allowAndroidInstalls(): Promise<void> {
  await updater.allow();
}

/** Where the update stands, and which button started it. */
export function useAndroidInstallState(): { state: AndroidInstallState; source: AndroidUpdateSource } {
  const state = useSyncExternalStore(updater.subscribe, updater.getState, updater.getState);
  return { state, source: updater.getSource() };
}

/** What to tell the user about the install, or null when there's nothing to say. */
export function androidInstallMessage(state: AndroidInstallState, t: (source: string, vars?: Record<string, string | number>) => string = tNow): string | null {
  switch (state.phase) {
    case 'idle':
      return null;
    case 'downloading':
      return state.percent === null ? t('Downloading the update…') : t('Downloading {percent}%', { percent: state.percent });
    case 'permission':
      return t('Android asks once before BandWith can install updates. Tap Allow, turn on “Allow from this source”, then come back.');
    case 'installing':
      return t('Tap Install to update BandWith.');
    case 'error':
      if (state.code === 'NOT_NEWER') return t('This download is not newer than your BandWith. Try again later.');
      if (state.code === 'SIGNATURE_MISMATCH' || state.code === 'WRONG_PACKAGE') {
        return t('This copy of BandWith can’t be updated. Uninstall it, then install BandWith from the release page once.');
      }
      return t('Couldn’t update inside the app. The download opens in your browser.');
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
        if (alive) setUpdate((prev) => (prev?.version === u?.version && prev?.url === u?.url && prev?.size === u?.size ? prev : u));
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
