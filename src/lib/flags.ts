/**
 * Feature flags (plan A0.1, migration 130). Generic, so later switches (the
 * paid tiers, payments) reuse it.
 *
 * - `platform_switches`: one row per key for everyone. Off = kill switch
 *   (wins over everything); on = turns a feature that is off by default on
 *   for every band that says nothing.
 * - `band_features`: per band, on or off.
 * - Neither says anything: the default here, in code.
 *
 * Both tables are written only with the service role (SQL / a small admin
 * script); the app reads them through `bw_band_features(band)`. The last
 * answer is kept per band on the device, so a flag holds offline.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export const FLAG_DEFAULTS = {
  /** Timer, pause and saved summary in rehearsal Live mode (A1b). */
  rehearsal_sessions: true,
  /** Notes in rehearsal Live mode and on the rehearsal's page (A2). */
  rehearsal_notes: true,
} as const satisfies Record<string, boolean>;

export type FlagKey = keyof typeof FLAG_DEFAULTS;

export interface FlagSnapshot {
  platform: Record<string, boolean>;
  band: Record<string, boolean>;
}

export function resolveFlag<K extends string>(
  key: K,
  snap: FlagSnapshot | null | undefined,
  defaults: Record<K, boolean> = FLAG_DEFAULTS as unknown as Record<K, boolean>,
): boolean {
  const platform = snap?.platform[key];
  if (platform === false) return false;
  const band = snap?.band[key];
  if (typeof band === 'boolean') return band;
  if (platform === true) return true;
  return defaults[key];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const bools = (v: unknown): Record<string, boolean> =>
  isObj(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, boolean] => typeof e[1] === 'boolean')) : {};

/** What `bw_band_features` returns (`{ platform, band }`), or null if unreadable. */
export const parseFlagSnapshot = (v: unknown): FlagSnapshot | null =>
  isObj(v) ? { platform: bools(v.platform), band: bools(v.band) } : null;

// ------------------------------------------------------------ fetching --

/** Ask the server again after this long (flags change rarely: little traffic). */
const TTL_MS = 10 * 60_000;
const storeKey = (bandId: string) => `bw-flags:${bandId}`;
const cache = new Map<string, { at: number; snap: FlagSnapshot }>();
const inflight = new Map<string, Promise<FlagSnapshot | null>>();

const readStored = (bandId: string): FlagSnapshot | null => {
  try {
    return parseFlagSnapshot(JSON.parse(localStorage.getItem(storeKey(bandId)) || 'null'));
  } catch {
    return null;
  }
};

/** The newest known flags for a band (memory, then the device), without asking the server. */
export const knownFlags = (bandId: string | null | undefined): FlagSnapshot | null =>
  !bandId ? null : cache.get(bandId)?.snap ?? readStored(bandId);

export async function fetchBandFlags(bandId: string): Promise<FlagSnapshot | null> {
  const hit = cache.get(bandId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.snap;
  const running = inflight.get(bandId);
  if (running) return running;
  const p = (async () => {
    try {
      const { data, error } = await supabase.rpc('bw_band_features', { p_band_id: bandId });
      const snap = error ? null : parseFlagSnapshot(data);
      if (!snap) return knownFlags(bandId);
      cache.set(bandId, { at: Date.now(), snap });
      try {
        localStorage.setItem(storeKey(bandId), JSON.stringify(snap));
      } catch {
        /* storage blocked: memory only */
      }
      return snap;
    } catch {
      return knownFlags(bandId);
    } finally {
      inflight.delete(bandId);
    }
  })();
  inflight.set(bandId, p);
  return p;
}

/** One flag for a band: the known value at once, refreshed from the server. */
export function useBandFlag(bandId: string | null | undefined, key: FlagKey): boolean {
  const [snap, setSnap] = useState<FlagSnapshot | null>(() => knownFlags(bandId));
  useEffect(() => {
    setSnap(knownFlags(bandId));
    if (!bandId) return;
    let alive = true;
    void fetchBandFlags(bandId).then((s) => {
      if (alive) setSnap(s);
    });
    return () => {
      alive = false;
    };
  }, [bandId]);
  return resolveFlag(key, snap);
}

/** Test helper. */
export const __resetFlagCache = () => {
  cache.clear();
  inflight.clear();
};
