/**
 * The minimum app version (paid plans P4, migration 162). The server keeps,
 * per platform, the oldest build that may still run (`app_versions`); below
 * it the app shows a full-screen "Update BandWith". Plans are enforced on the
 * server anyway, so this is about explaining, not about security.
 *
 * - iOS compares the build number (CFBundleVersion), Android the version
 *   name, the web the build stamp of this bundle (yyyymmddhhmm, UTC).
 * - Checked at start and on resume, at most every 6 hours.
 * - Offline, or no answer: never blocks. A block needs a fresh answer from
 *   the server in this session, so a gig with no signal is never stopped.
 */
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';
import { compareVersions } from '@/lib/androidUpdate';
import { onAppResume } from '@/lib/appResume';

export type GateStatus = 'ok' | 'soft' | 'blocked';
export type Platform = 'ios' | 'android' | 'web';

export interface AppVersionInfo {
  minVersion: string | null;
  latestVersion: string | null;
  storeUrl: string | null;
}

const VERSION_RE = /^\d+(\.\d+)*$/;
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function parseAppVersion(v: unknown): AppVersionInfo | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  return { minVersion: str(o.min_version), latestVersion: str(o.latest_version), storeUrl: str(o.store_url) };
}

/** ok, soft (a newer one exists) or blocked (below the minimum). */
export function versionGate(installed: string | null | undefined, info: AppVersionInfo | null | undefined): GateStatus {
  if (!installed || !VERSION_RE.test(installed) || !info) return 'ok';
  if (info.minVersion && VERSION_RE.test(info.minVersion) && compareVersions(installed, info.minVersion) < 0) return 'blocked';
  if (info.latestVersion && VERSION_RE.test(info.latestVersion) && compareVersions(installed, info.latestVersion) < 0) return 'soft';
  return 'ok';
}

/** yyyymmddhhmm in UTC: the web bundle's version. */
export const webBuildStamp = (d: Date): string =>
  [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()]
    .map((n, i) => String(n).padStart(i === 0 ? 4 : 2, '0'))
    .join('');

/** Stamped by vite.config.ts at build time. */
export const WEB_BUILD: string = import.meta.env.VITE_WEB_BUILD || '';

export const currentPlatform = (): Platform => {
  const p = Capacitor.getPlatform();
  return p === 'ios' || p === 'android' ? p : 'web';
};

/** What this install compares: the iOS build number, the Android version name, the web stamp. */
export async function installedVersion(platform: Platform = currentPlatform()): Promise<string | null> {
  if (platform === 'web') return WEB_BUILD || null;
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    return (platform === 'ios' ? info.build : info.version) || null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ checking --

const CHECK_EVERY_MS = 6 * 3_600_000;
let last: { at: number; info: AppVersionInfo | null; fresh: boolean } | null = null;

export async function fetchAppVersion(platform: Platform, force = false): Promise<{ info: AppVersionInfo | null; fresh: boolean }> {
  if (!force && last && Date.now() - last.at < CHECK_EVERY_MS) return last;
  try {
    const { data, error } = await supabase.rpc('bw_app_version', { p_platform: platform });
    if (error) return { info: last?.info ?? null, fresh: false };
    last = { at: Date.now(), info: parseAppVersion(data), fresh: true };
    return last;
  } catch {
    return { info: last?.info ?? null, fresh: false };
  }
}

export interface MinVersionState {
  status: GateStatus;
  platform: Platform;
  info: AppVersionInfo | null;
}

/** The gate for this install, checked at start and on resume. */
export function useMinVersion(): MinVersionState {
  const platform = currentPlatform();
  const [state, setState] = useState<MinVersionState>({ status: 'ok', platform, info: null });
  useEffect(() => {
    let alive = true;
    const check = async (force: boolean) => {
      const [installed, { info, fresh }] = await Promise.all([installedVersion(platform), fetchAppVersion(platform, force)]);
      if (!alive) return;
      const status = versionGate(installed, info);
      // Only a fresh answer may block (offline never blocks).
      setState({ status: status === 'blocked' && !fresh ? 'ok' : status, platform, info });
    };
    void check(false);
    const off = onAppResume(() => void check(false));
    return () => {
      alive = false;
      off();
    };
  }, [platform]);
  return state;
}

/** Test helper. */
export const __resetMinVersion = () => {
  last = null;
};
