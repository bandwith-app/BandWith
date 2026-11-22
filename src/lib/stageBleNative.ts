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
import { generateSigner, isPublicKey, type StageSigner } from './stageSign';

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
const asSigner = (v: unknown): StageSigner | null => {
  const o = v as { public?: unknown; private?: unknown } | null;
  return o && isPublicKey(o.public) && typeof o.private === 'string' && o.private ? { public: o.public, private: o.private } : null;
};

/**
 * Admins: the gig's signing key pair (migration 190), from the device or
 * fetched; the first admin who needs one makes it (the server keeps the
 * first one stored). Null for members, or offline before the first fetch.
 */
export async function stageSigner(eventId: string): Promise<StageSigner | null> {
  try {
    const kept = asSigner(JSON.parse(read(SIGNER_PREFIX + eventId) ?? 'null'));
    if (kept) return kept;
  } catch {
    /* fetched again */
  }
  try {
    let { data, error } = await supabase.rpc('bw_stage_signer', { p_event_id: eventId });
    if (error) return null;
    let signer = asSigner(data);
    if (!signer) {
      const fresh = await generateSigner();
      ({ data, error } = await supabase.rpc('bw_stage_set_signer', { p_event_id: eventId, p_public: fresh.public, p_private: fresh.private }));
      if (error) return null;
      signer = asSigner(data);
    }
    if (!signer) return null;
    keep(SIGNER_PREFIX + eventId, JSON.stringify(signer));
    keep(VERIFY_PREFIX + eventId, signer.public);
    return signer;
  } catch {
    return null;
  }
}

/**
 * Members: the gig's public key, to check the leader's signature. Null
 * before any admin made the key pair, or offline before the first fetch.
 */
export async function stageVerifyKey(eventId: string): Promise<string | null> {
  const kept = read(VERIFY_PREFIX + eventId);
  if (isPublicKey(kept)) return kept;
  try {
    const { data, error } = await supabase.rpc('bw_stage_verify_key', { p_event_id: eventId });
    if (error || !isPublicKey(data)) return null;
    keep(VERIFY_PREFIX + eventId, data);
    return data;
  } catch {
    return null;
  }
}

/**
 * Fetch the keys ahead of the gig (event detail open), so they're there
 * offline. Admins make the gig's signing key pair here if it has none, so
 * members who open the gig after them get its public key.
 */
export function prefetchStageKey(eventId?: string, isAdmin = false) {
  if (!eventId || !stageBleAvailable()) return;
  if (!cachedKey(eventId)) void stageKey(eventId);
  if (isAdmin) void stageSigner(eventId);
  else if (!isPublicKey(read(VERIFY_PREFIX + eventId))) void stageVerifyKey(eventId);
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
