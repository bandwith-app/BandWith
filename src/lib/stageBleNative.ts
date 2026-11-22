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
import { generateSigner, isPublicKey, type StageSigner, type StageVerifyKey } from './stageSign';

export type StageBleState = 'on' | 'off' | 'unauthorized' | 'unsupported' | 'unknown';

interface StageBlePlugin {
  /**
   * `clockUuid` + `signKey` (the gig's private key, PKCS#8 base64): also serve
   * the clock characteristic (stageBleSync.ts): the plugin answers every read
   * itself with its clock, signed by the leader.
   * `signedUuid`: the leader-signed state (read + notify, version 4).
   * `liveUuid`: the live characteristic (read + notify, filled in B3).
   */
  start(options: {
    serviceUuid: string;
    characteristicUuid: string;
    value: string;
    notify: string;
    clockUuid?: string;
    liveUuid?: string;
    signedUuid?: string;
    signKey?: string;
  }): Promise<{ state: StageBleState }>;
  update(options: { value: string; notify: string }): Promise<void>;
  /** The leader-signed state: the value reads get, and a notice for its subscribers ('' = none). */
  updateSigned(options: { value: string; notify: string }): Promise<void>;
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
 * The gig's Bluetooth key: from the device, or fetched (and kept) when
 * online. Null for people outside the band, or offline before the first fetch.
 */
export async function stageKey(eventId: string): Promise<string | null> {
  const cached = cachedKey(eventId);
  if (cached) return cached;
  try {
    const { data, error } = await supabase.rpc('bw_stage_key', { p_event_id: eventId });
    if (error || typeof data !== 'string' || !data) return null;
    try {
      localStorage.setItem(KEY_PREFIX + eventId, data);
    } catch {
      /* kept for this session only */
    }
    return data;
  } catch {
    return null;
  }
}

const SIGNER_PREFIX = KEY_PREFIX + 'signer:';
const VERIFY_PREFIX = KEY_PREFIX + 'verify:';
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const keep = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* kept for this session only */
  }
};
const asVersion = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 0xffff ? v : null);
const asSigner = (v: unknown): StageSigner | null => {
  const o = v as { public?: unknown; private?: unknown; version?: unknown } | null;
  const version = asVersion(o?.version);
  return o && isPublicKey(o.public) && typeof o.private === 'string' && o.private && version
    ? { public: o.public, private: o.private, version }
    : null;
};
const asVerify = (v: unknown): StageVerifyKey | null => {
  const o = v as { public?: unknown; version?: unknown } | null;
  const version = asVersion(o?.version);
  return o && isPublicKey(o.public) && version ? { public: o.public, version } : null;
};
const kept = <T>(k: string, as: (v: unknown) => T | null): T | null => {
  try {
    return as(JSON.parse(read(k) ?? 'null'));
  } catch {
    return null;
  }
};
const forget = (k: string) => {
  try {
    localStorage.removeItem(k);
  } catch {
    /* storage not available */
  }
};

/** A key fetch with no answer by then counts as offline (a venue with one bar of signal). */
export const KEY_FETCH_TIMEOUT_MS = 4_000;
const OFFLINE = Symbol('offline');
/**
 * The server's answer, or OFFLINE (no network, no answer in time, or an
 * error): the server first, so a rotated pair or a lost admin role counts
 * as soon as the phone is online; the kept copy only when it isn't.
 */
async function ask(fn: string, args: Record<string, string>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await Promise.race([
      Promise.resolve(supabase.rpc(fn, args)),
      new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), KEY_FETCH_TIMEOUT_MS))),
    ]);
    if (!answer || answer.error) return OFFLINE;
    return answer.data;
  } catch {
    return OFFLINE;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Admins: the gig's signing key pair (migration 190), fetched first and kept
 * for offline; the first admin who needs one makes it (the server keeps the
 * first one stored). Null for members, and the kept copy goes when the
 * server says no (an admin no longer); the kept copy offline.
 */
export async function stageSigner(eventId: string): Promise<StageSigner | null> {
  const key = SIGNER_PREFIX + eventId;
  let data = await ask('bw_stage_signer', { p_event_id: eventId });
  if (data === OFFLINE) return kept(key, asSigner);
  let signer = asSigner(data);
  if (!signer) {
    const fresh = await generateSigner();
    data = await ask('bw_stage_set_signer', { p_event_id: eventId, p_public: fresh.public, p_private: fresh.private });
    if (data === OFFLINE) return kept(key, asSigner);
    signer = asSigner(data);
  }
  if (!signer) {
    // Not an admin of the gig's band (any more): no private key stays on the phone.
    forget(key);
    return null;
  }
  keep(key, JSON.stringify(signer));
  keep(VERIFY_PREFIX + eventId, JSON.stringify({ public: signer.public, version: signer.version }));
  return signer;
}

/**
 * Members: the gig's public key and its version, to check the leader's
 * signature: fetched first, the kept copy offline. Null before any admin
 * made the pair (or for a gig the server no longer shows this account).
 */
export async function stageVerifyKey(eventId: string): Promise<StageVerifyKey | null> {
  const key = VERIFY_PREFIX + eventId;
  const data = await ask('bw_stage_verify_key', { p_event_id: eventId });
  if (data === OFFLINE) return kept(key, asVerify);
  const verify = asVerify(data);
  if (!verify) {
    forget(key);
    return null;
  }
  keep(key, JSON.stringify(verify));
  return verify;
}

/** The public key kept on this phone (no network): Stage starts with it, then asks the server. */
export const keptVerifyKey = (eventId: string) => kept(VERIFY_PREFIX + eventId, asVerify);

/**
 * Fetch the keys ahead of the gig (event detail open), so they're there
 * offline. Admins make the gig's signing key pair here if it has none, so
 * members who open the gig after them get its public key.
 */
export function prefetchStageKey(eventId?: string, isAdmin = false) {
  if (!eventId || !stageBleAvailable()) return;
  if (!cachedKey(eventId)) void stageKey(eventId);
  // Every time: a pair rotated since (an admin who stopped being one) is picked up here.
  if (isAdmin) void stageSigner(eventId);
  else void stageVerifyKey(eventId);
}

/** The old copy of a setlist (until 11-21); moved into the live pack (livePackStore.ts). */
const SETLIST_PREFIX = 'bw-setlist-songs:';

/**
 * Sign-out: the gigs' Bluetooth keys kept on this phone go too, with any
 * old setlist copy and my files kept for live mode. (The live packs
 * themselves are in the offline store, which sign-out clears.)
 */
export function clearStageCache() {
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
