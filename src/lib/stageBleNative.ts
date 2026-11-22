/**
 * Stage mode over Bluetooth: native plumbing.
 * - StageBle: the app's own plugin, leader side (ios/App/App/StageBlePlugin.swift,
 *   android/app/src/main/java/com/bandwith/app/StageBlePlugin.java).
 * - Members use @capacitor-community/bluetooth-le (central), see useStageBle.
 * - The gig's key (migration 087) and the setlist (the live pack,
 *   livePackStore.ts) are fetched while online and kept on the device, so
 *   Bluetooth still works when the venue has no internet.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { supabase, isDemoMode } from './supabase';
import { removeAllPackFiles } from './livePackFiles';

export type StageBleState = 'on' | 'off' | 'unauthorized' | 'unsupported' | 'unknown';

interface StageBlePlugin {
  /**
   * `clockUuid` + `key`: also serve the clock characteristic (stageBleSync.ts):
   * the plugin answers every read itself with its clock, signed with the key.
   * `liveUuid`: the live characteristic (read + notify, filled in B3).
   */
  start(options: {
    serviceUuid: string;
    characteristicUuid: string;
    value: string;
    notify: string;
    clockUuid?: string;
    liveUuid?: string;
    key?: string;
  }): Promise<{ state: StageBleState }>;
  update(options: { value: string; notify: string }): Promise<void>;
  /** Live characteristic: the value reads get, and a notice for its subscribers ('' = none). */
  updateLive(options: { value: string; notify: string }): Promise<void>;
  /** The plugin's own clock (monotonic, ms). */
  now(): Promise<{ now: number }>;
  /** The app's clock minus the plugin's: clock reads then carry the app's clock. */
  setClock(options: { offset: number }): Promise<void>;
  stop(): Promise<void>;
  addListener(
    event: 'stateChange',
    cb: (data: { state: StageBleState; subscribers: number }) => void,
  ): Promise<PluginListenerHandle>;
}

export const StageBle = registerPlugin<StageBlePlugin>('StageBle');

/** Bluetooth sync runs only in the native apps (no demo, no web). */
export const stageBleAvailable = () => Capacitor.isNativePlatform() && !isDemoMode;

const KEY_PREFIX = 'bw-stage-key:';

const cachedKey = (eventId: string): string | null => {
  try {
    return localStorage.getItem(KEY_PREFIX + eventId);
  } catch {
    return null;
  }
};

/** A key fetch with no answer by then counts as offline (a venue with one bar of signal). */
export const KEY_FETCH_TIMEOUT_MS = 4_000;

/** Sign-out bumps it: an answer that arrives after the cache was cleared writes nothing. */
let keyEpoch = 0;
let keyAsks = 0;
/** The newest ask whose answer was kept, per gig: an older answer arriving later writes nothing. */
const keyKept = new Map<string, number>();

function keepAnswer(eventId: string, data: unknown, ask: number, epoch: number) {
  if (epoch !== keyEpoch || ask < (keyKept.get(eventId) ?? 0)) return;
  keyKept.set(eventId, ask);
  try {
    if (typeof data === 'string' && data) localStorage.setItem(KEY_PREFIX + eventId, data);
    else localStorage.removeItem(KEY_PREFIX + eventId);
  } catch {
    /* kept for this session only */
  }
}

/**
 * The gig's Bluetooth key: asked for whenever online (it changes when someone
 * may no longer see the gig, migration 191) and kept; the kept copy offline
 * (no answer in KEY_FETCH_TIMEOUT_MS; an answer that comes later is still
 * kept). A no from the server deletes it (`denied`: the caller drops any copy
 * of its own too). Null for people outside the band, or offline before the
 * first fetch.
 */
export async function fetchStageKey(eventId: string): Promise<{ key: string | null; denied: boolean }> {
  const ask = ++keyAsks;
  const epoch = keyEpoch;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let answer: { data: unknown; error: unknown } | null;
  try {
    const call = Promise.resolve(supabase.rpc('bw_stage_key', { p_event_id: eventId })).then(
      (a: { data: unknown; error: unknown }) => {
        if (a && !a.error) keepAnswer(eventId, a.data, ask, epoch);
        return a;
      },
      () => null,
    );
    answer = await Promise.race([
      call,
      new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), KEY_FETCH_TIMEOUT_MS))),
    ]);
  } catch {
    answer = null;
  } finally {
    clearTimeout(timer);
  }
  if (!answer || answer.error) return { key: cachedKey(eventId), denied: false };
  const key = typeof answer.data === 'string' && answer.data ? answer.data : null;
  return { key, denied: key === null };
}

export async function stageKey(eventId: string): Promise<string | null> {
  return (await fetchStageKey(eventId)).key;
}

/** Fetch the key ahead of the gig (event detail open), so it's there offline (and a changed one replaces it). */
export function prefetchStageKey(eventId?: string) {
  if (!eventId || !stageBleAvailable()) return;
  void stageKey(eventId);
}

/** The old copy of a setlist (until 11-21); moved into the live pack (livePackStore.ts). */
const SETLIST_PREFIX = 'bw-setlist-songs:';

/**
 * Sign-out: the gigs' Bluetooth keys kept on this phone go too, with any
 * old setlist copy and my files kept for live mode. (The live packs
 * themselves are in the offline store, which sign-out clears.)
 */
export function clearStageCache() {
  keyEpoch++;
  keyKept.clear();
  void removeAllPackFiles().catch(() => undefined);
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(SETLIST_PREFIX) || k.startsWith(KEY_PREFIX))) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage not available */
  }
}
