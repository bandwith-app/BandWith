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

/**
 * The key a change replaced, kept for the gig day: a phone that missed the
 * change still links under it, and only signed states count there (#288).
 * Same prefix as the keys, so sign-out clears it too.
 */
const PREV_PREFIX = KEY_PREFIX + 'prev:';
export const PREV_KEY_MS = 36 * 3600_000;

export function previousStageKey(eventId: string): string | null {
  try {
    const kept = JSON.parse(localStorage.getItem(PREV_PREFIX + eventId) || 'null') as { key?: unknown; until?: unknown } | null;
    if (kept && typeof kept.key === 'string' && kept.key && typeof kept.until === 'number' && kept.until > Date.now())
      return kept.key;
  } catch {
    /* nothing kept */
  }
  return null;
}

/** A key fetch with no answer by then counts as offline (a venue with one bar of signal). */
export const KEY_FETCH_TIMEOUT_MS = 4_000;

/** Sign-out bumps it: an answer that arrives after the cache was cleared writes nothing. */
let keyEpoch = 0;
let keyAsks = 0;
/** The newest ask whose answer was kept, per gig: an older answer arriving later writes nothing. */
const keyKept = new Map<string, number>();

/** A window event (detail: the gig's id): its band key changed, Stage asks for it again (useStageBle). */
export const STAGE_KEY_EVENT = 'bw:stage-key';

function keepAnswer(eventId: string, data: unknown, ask: number, epoch: number, late: () => boolean) {
  if (epoch !== keyEpoch || ask < (keyKept.get(eventId) ?? 0)) return;
  keyKept.set(eventId, ask);
  const before = cachedKey(eventId);
  try {
    if (typeof data === 'string' && data) {
      localStorage.setItem(KEY_PREFIX + eventId, data);
      if (before && before !== data)
        localStorage.setItem(PREV_PREFIX + eventId, JSON.stringify({ key: before, until: Date.now() + PREV_KEY_MS }));
    } else {
      localStorage.removeItem(KEY_PREFIX + eventId);
      localStorage.removeItem(PREV_PREFIX + eventId);
    }
  } catch {
    /* kept for this session only */
  }
  // Answered after the caller stopped waiting: Stage takes it now (Codex on 642676fc).
  if (late() && typeof data === 'string' && data && data !== before && typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(STAGE_KEY_EVENT, { detail: eventId }));
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
  let timedOut = false;
  try {
    const call = Promise.resolve(supabase.rpc('bw_stage_key', { p_event_id: eventId })).then(
      (a: { data: unknown; error: unknown }) => {
        if (a && !a.error) keepAnswer(eventId, a.data, ask, epoch, () => timedOut);
        return a;
      },
      () => null,
    );
    answer = await Promise.race([
      call,
      new Promise<null>(
        (resolve) =>
          (timer = setTimeout(() => {
            timedOut = true;
            resolve(null);
          }, KEY_FETCH_TIMEOUT_MS)),
      ),
    ]);
  } catch {
    answer = null;
  } finally {
    clearTimeout(timer);
  }
  if (!answer || answer.error) return { key: cachedKey(eventId), denied: false };
  // A newer ask's answer was kept first: what's kept stands, not this older answer (Claude on #283).
  if (ask < (keyKept.get(eventId) ?? 0)) return { key: cachedKey(eventId), denied: false };
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
