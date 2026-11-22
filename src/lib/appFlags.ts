/**
 * Remote kill switches for a release (migration 173, docs/flags.md). Every
 * new feature has a key here with its built-in default (ON). The server
 * table `app_flags` turns a feature OFF for everyone, or for installs older
 * than `min_app_version`. (Per-band rollout of a feature is the other flag
 * system, src/lib/flags.ts with platform_switches / band_features, 130.)
 *
 * - Read at start, on every resume, back online and every 10 minutes while
 *   the app is in front: a flag turned off reaches open apps quickly.
 * - The last answer is kept on the device, so a gig with no signal uses the
 *   last known value.
 * - Fails OPEN: no table, no row, no answer and nothing cached → the
 *   built-in default, so the app behaves exactly like it does without flags.
 */
import { useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';
import { compareVersions } from '@/lib/androidUpdate';
import { currentPlatform, installedVersion, type Platform } from '@/lib/minVersion';
import { onAppResume } from '@/lib/appResume';

/** The keys and their built-in default. A new feature adds its key here and in docs/flags.md. */
export const APP_FLAG_DEFAULTS = {
  /** Offline live pack: downloads ahead of time, consent sheet, ready rows, Settings › Offline & live. */
  live_pack: true,
  /** Voice part colours, legend, Highlight my part, Who sings what, the Voice row of the chord editor. */
  voice_parts: true,
  /** Follow the tempo (the playhead) on Stage. */
  follow_tempo: true,
  /** Count-in before a song on Stage. */
  count_in: true,
  /** Click / playhead clock over Bluetooth on Stage. */
  ble_live: true,
} as const satisfies Record<string, boolean>;

export type AppFlagKey = keyof typeof APP_FLAG_DEFAULTS;

export interface AppFlagRow {
  enabled: boolean;
  minAppVersion: string | null;
}

export interface AppFlagsCache {
  flags: Record<string, AppFlagRow>;
  /** This install's version when the flags were saved (iOS build, Android name, web stamp). */
  version: string | null;
}

export const APP_FLAGS_STORAGE_KEY = 'bandwith.app_flags.v1';
const REFRESH_EVERY_MS = 10 * 60 * 1000;
const VERSION_RE = /^\d+(\.\d+)*$/;

// ------------------------------------------------------------- parsing --

/** Rows from the server → the map kept on the device. Bad rows are dropped (they mean "default"). */
export function parseAppFlagRows(rows: unknown): Record<string, AppFlagRow> {
  const out: Record<string, AppFlagRow> = {};
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.key !== 'string' || typeof o.enabled !== 'boolean') continue;
    const min = typeof o.min_app_version === 'string' && o.min_app_version.trim() ? o.min_app_version.trim() : null;
    out[o.key] = { enabled: o.enabled, minAppVersion: min };
  }
  return out;
}

/**
 * The minimum version for this platform. `min_app_version` is one value for
 * every platform ("1.0.14") or one per platform
 * ("ios=202611230000;android=1.0.14;web=202611230000"); a platform not
 * listed has no minimum.
 */
export function minVersionFor(min: string | null, platform: Platform): string | null {
  if (!min) return null;
  if (!min.includes('=')) return VERSION_RE.test(min) ? min : null;
  for (const part of min.split(/[;,]/)) {
    const [p, v] = part.split('=').map((s) => s.trim());
    if (p?.toLowerCase() === platform && v && VERSION_RE.test(v)) return v;
  }
  return null;
}

/** On or off for this install. No row → the built-in default. */
export function appFlagValue(
  key: AppFlagKey,
  flags: Record<string, AppFlagRow> | null | undefined,
  platform: Platform,
  version: string | null,
): boolean {
  const row = flags?.[key];
  if (!row) return APP_FLAG_DEFAULTS[key];
  if (!row.enabled) return false;
  const min = minVersionFor(row.minAppVersion, platform);
  // An install whose version can't be read is not held back (fail open).
  if (min && version && VERSION_RE.test(version) && compareVersions(version, min) < 0) return false;
  return true;
}

/** "The table isn't there" (migration not applied yet), as PostgREST says it. */
export function isMissingTable(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  if (!e) return false;
  const code = String(e.code ?? '');
  return code === '42P01' || code === 'PGRST205' || /relation .* does not exist|could not find the table/i.test(String(e.message ?? ''));
}

// --------------------------------------------------------------- state --

function readCache(): AppFlagsCache | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(APP_FLAGS_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { flags?: unknown; version?: unknown };
    if (!v || typeof v !== 'object' || !v.flags || typeof v.flags !== 'object') return null;
    const flags: Record<string, AppFlagRow> = {};
    for (const [k, r] of Object.entries(v.flags as Record<string, unknown>)) {
      const row = r as Partial<AppFlagRow> | null;
      if (row && typeof row.enabled === 'boolean')
        flags[k] = { enabled: row.enabled, minAppVersion: typeof row.minAppVersion === 'string' ? row.minAppVersion : null };
    }
    return { flags, version: typeof v.version === 'string' ? v.version : null };
  } catch {
    return null;
  }
}

function writeCache(c: AppFlagsCache) {
  try {
    localStorage.setItem(APP_FLAGS_STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* storage blocked: the values still apply for this session */
  }
}

let state: AppFlagsCache = readCache() ?? { flags: {}, version: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** On or off now (sync, for code outside React). */
export function isFlagOn(key: AppFlagKey): boolean {
  try {
    return appFlagValue(key, state.flags, currentPlatform(), state.version);
  } catch {
    return APP_FLAG_DEFAULTS[key];
  }
}

/** On or off, kept current while the component is on screen. */
export function useFlag(key: AppFlagKey): boolean {
  return useSyncExternalStore(subscribe, () => isFlagOn(key), () => APP_FLAG_DEFAULTS[key]);
}

// ------------------------------------------------------------ fetching --

let inFlight: Promise<void> | null = null;

function apply(next: AppFlagsCache) {
  const changed = JSON.stringify(next) !== JSON.stringify(state);
  state = next;
  writeCache(next);
  if (changed) emit();
}

/** Ask the server again. Never throws; an error keeps what the device knows. */
export function refreshAppFlags(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const version = await installedVersion().catch(() => null);
      const { data, error } = await supabase.from('app_flags').select('key, enabled, min_app_version');
      if (!error) apply({ flags: parseAppFlagRows(data), version });
      // No table on the server: nothing is switched off.
      else if (isMissingTable(error)) apply({ flags: {}, version });
      // Offline, signed out, server down: keep the last answer (the version may be newer).
      else if (version && version !== state.version) apply({ ...state, version });
    } catch {
      /* network or client error: keep the last answer */
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

let started = false;

/** Start reading the flags (once, from the signed-in app). Returns a stop. */
export function startAppFlags(): () => void {
  if (started || typeof window === 'undefined') return () => {};
  started = true;
  void refreshAppFlags();
  const again = () => void refreshAppFlags();
  const offResume = onAppResume(again);
  window.addEventListener('online', again);
  const timer = window.setInterval(() => {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') again();
  }, REFRESH_EVERY_MS);
  return () => {
    started = false;
    offResume();
    window.removeEventListener('online', again);
    window.clearInterval(timer);
  };
}

/** Tests: start again from what the device keeps (or the given cache), as if the app had just opened. */
export function __resetAppFlagsForTest(cached?: AppFlagsCache | null) {
  state = (cached === undefined ? readCache() : cached) ?? { flags: {}, version: null };
  inFlight = null;
  emit();
}

/** Tests: turn flags on/off on this device until the next server answer. */
export function __setAppFlagsForTest(values: Partial<Record<AppFlagKey, boolean>>) {
  const flags = { ...state.flags };
  for (const [k, v] of Object.entries(values)) flags[k] = { enabled: !!v, minAppVersion: null };
  apply({ ...state, flags });
}
