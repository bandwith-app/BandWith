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
import { clearSignedMemoryCache, setSignedMemoryUser } from './stageSignedMemory';
import { clearSignCaches, generateSigner, isPublicKey, pairMatches, type StageKeyPair, type StageSigner, type StageVerifyAnswer } from './stageSign';

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
 * Bumped on sign-out and when another account signs in: a key fetch started
 * before must not write its answer back (or hand it to Stage). Synchronous on
 * purpose: the auth library's getSession refreshes an expired token, which
 * offline can hang or come back empty.
 */
let cacheGeneration = 0;
let cacheUser: string | null = null;
/** Whose keys this phone keeps (kept across restarts): another account signing in deletes them. */
const OWNER_KEY = 'bw-stage-owner';
/**
 * The signed-in account (AuthContext): another one than before drops fetches
 * in flight, and deletes the keys kept for the last one (Codex on #288).
 */
export function setStageCacheUser(id: string | null | undefined) {
  if (!id) return;
  if (cacheUser && cacheUser !== id) cacheGeneration++;
  let owner: string | null = null;
  try {
    owner = localStorage.getItem(OWNER_KEY);
  } catch {
    /* storage not available */
  }
  if (owner !== id) {
    if (owner) {
      cacheGeneration++;
      removeKeptKeys();
    }
    try {
      localStorage.setItem(OWNER_KEY, id);
    } catch {
      /* storage not available */
    }
  }
  cacheUser = id;
  setSignedMemoryUser(id);
}
/** The kept Bluetooth keys of every gig, and the imported ones in memory. */
function removeKeptKeys() {
  clearSignCaches();
  clearSignedMemoryCache();
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage not available */
  }
}
const tagFetch = () => cacheGeneration;
const stillOurs = (tag: number) => tag === cacheGeneration;

let keyAsks = 0;
/** The newest ask whose answer was kept, per gig: an older answer arriving later writes nothing. */
const keyKept = new Map<string, number>();

/** A window event (detail: the gig's id): its band key changed, Stage asks for it again (useStageBle). */
export const STAGE_KEY_EVENT = 'bw:stage-key';

/**
 * The gig's Bluetooth key: asked for whenever online (it changes when someone
 * may no longer see the gig, migration 191) and kept; the kept copy offline
 * (no answer in KEY_FETCH_TIMEOUT_MS; an answer that comes later is still
 * kept, unless the account changed meanwhile). A no from the server deletes
 * it and every other key kept for the gig (`denied`: the caller drops any
 * copy of its own too). Null for people
 * outside the band, or offline before the first fetch.
 */
export async function fetchStageKey(eventId: string): Promise<{ key: string | null; denied: boolean }> {
  const tag = tagFetch();
  const n = ++keyAsks;
  const keepAnswer = (data: unknown, late: () => boolean) => {
    // Signed out (or another account) meanwhile, or a newer answer already kept: nothing written.
    if (!stillOurs(tag) || n < (keyKept.get(eventId) ?? 0)) return;
    keyKept.set(eventId, n);
    const before = cachedKey(eventId);
    try {
      if (typeof data === 'string' && data) {
        localStorage.setItem(KEY_PREFIX + eventId, data);
        // The key it replaced, kept for the gig day (previousStageKey).
        if (before && before !== data)
          localStorage.setItem(PREV_PREFIX + eventId, JSON.stringify({ key: before, until: Date.now() + PREV_KEY_MS }));
      }
    } catch {
      /* kept for this session only */
    }
    // The server's no: every key kept for the gig goes, the public and the private one too (Claude round 8 on #288).
    if (!(typeof data === 'string' && data)) forgetStageKeys(eventId);
    // Answered after the caller stopped waiting: Stage takes it now (Codex on 642676fc).
    if (late() && typeof data === 'string' && data && data !== before && typeof window !== 'undefined')
      window.dispatchEvent(new CustomEvent(STAGE_KEY_EVENT, { detail: eventId }));
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let answer: { data: unknown; error: unknown } | null;
  let timedOut = false;
  try {
    const call = Promise.resolve(supabase.rpc('bw_stage_key', { p_event_id: eventId })).then(
      (a: { data: unknown; error: unknown }) => {
        if (a && !a.error) keepAnswer(a.data, () => timedOut);
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
  if (!stillOurs(tag)) return { key: null, denied: false };
  if (!answer || answer.error) return { key: cachedKey(eventId), denied: false };
  // A newer ask's answer was kept first: what's kept stands, not this older answer (Claude on #283).
  if (n < (keyKept.get(eventId) ?? 0)) return { key: cachedKey(eventId), denied: false };
  const key = typeof answer.data === 'string' && answer.data ? answer.data : null;
  return { key, denied: key === null };
}

export async function stageKey(eventId: string): Promise<string | null> {
  return (await fetchStageKey(eventId)).key;
}

const SIGNER_PREFIX = KEY_PREFIX + 'signer:';
const VERIFY_PREFIX = KEY_PREFIX + 'verify:';
/** Kept per account and gig: never handed to another account (none known yet: nothing kept). */
const mine = (prefix: string, eventId: string) => (cacheUser ? `${prefix}${cacheUser}:${eventId}` : null);
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const keep = (k: string | null, v: string) => {
  if (!k) return;
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
const asVerify = (v: unknown): StageVerifyAnswer | null => {
  const o = v as { public?: unknown; version?: unknown } | null;
  const version = asVersion(o?.version);
  if (!o || !version) return null;
  if (isPublicKey(o.public)) return { public: o.public, version };
  // Rotated, no new pair yet ("pending"): only past the first version.
  return o.public === null && version > 1 ? { public: null, version } : null;
};
const kept = <T>(k: string | null, as: (v: unknown) => T | null): T | null => {
  if (!k) return null;
  try {
    return as(JSON.parse(read(k) ?? 'null'));
  } catch {
    return null;
  }
};
/**
 * Kept only if not older than what's kept (by version; at one version a key
 * beats "pending"): two fetches that overlap land in any order, and the
 * older answer never replaces the newer one (Codex on #288). The kept one
 * is returned when it wins.
 */
const keepNewest = <T extends { public: string | null; version: number }>(k: string | null, v: T, as: (x: unknown) => T | null): T => {
  const had = kept(k, as);
  if (had && (had.version > v.version || (had.version === v.version && had.public !== null && v.public === null))) return had;
  keep(k, JSON.stringify(v));
  return v;
};
const forget = (k: string | null) => {
  if (!k) return;
  try {
    localStorage.removeItem(k);
  } catch {
    /* storage not available */
  }
};

/**
 * The key a change replaced, kept for the gig day: a phone that missed the
 * change still links under it, and only signed states count there (#288).
 * Same prefix as the keys, so sign-out clears it too. (Kept by #283's key
 * fetch; nothing kept until it's in.)
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
/** Gigs whose server said this account isn't an admin of the band (any more): the leader is told (Claude on #288). */
const refusedSigner = new Set<string>();
/** The server's last answer for this gig's pair was its no: no longer an admin. Not set offline. */
export const signerRefused = (eventId: string) => refusedSigner.has(eventId);

export async function stageSigner(eventId: string): Promise<StageSigner | null> {
  const key = mine(SIGNER_PREFIX, eventId);
  const tag = tagFetch();
  let data = await ask('bw_stage_signer', { p_event_id: eventId });
  // Signed out (or another account) meanwhile: nothing is kept, nothing returned.
  if (!stillOurs(tag)) return null;
  if (data === OFFLINE) return kept(key, asSigner);
  let signer = asSigner(data);
  // None yet, or a stored one that doesn't work (its private key doesn't sign
  // for its public one): make one; a broken one is replaced by naming it.
  const broken = signer && !(await pairMatches(signer)) ? signer.public : null;
  if (!stillOurs(tag)) return null;
  if (!signer || broken) {
    // The server has no working pair for this account (none yet, rotated, or
    // not an admin): the kept one goes now, and is never a fallback below,
    // even if making a new one fails or times out (Codex on #288).
    forget(key);
    let fresh: StageKeyPair;
    try {
      fresh = await generateSigner();
    } catch {
      // No WebCrypto (or it failed): this phone leads with the band key, as an older app does (Claude on #288).
      return null;
    }
    if (!stillOurs(tag)) return null;
    data = await ask('bw_stage_set_signer', {
      p_event_id: eventId,
      p_public: fresh.public,
      p_private: fresh.private,
      ...(broken ? { p_replace_public: broken } : {}),
    });
    if (!stillOurs(tag)) return null;
    if (data === OFFLINE) return null;
    // The server's no: this account isn't an admin of the gig's band.
    if (data === null) refusedSigner.add(eventId);
    signer = asSigner(data);
    // Still the broken one (someone else's call won meanwhile with it): not used.
    if (signer && broken && signer.public === broken) signer = null;
  }
  if (!signer) {
    // Not an admin of the gig's band (any more): no private key stays on the phone.
    forget(key);
    return null;
  }
  // Signed out (or another account) while the pair was checked: nothing is kept.
  if (!stillOurs(tag)) return null;
  refusedSigner.delete(eventId);
  const newest = keepNewest(key, signer, asSigner);
  keepNewest(mine(VERIFY_PREFIX, eventId), { public: newest.public, version: newest.version }, asVerify);
  return newest;
}

/** Per gig, the newest public-key ask whose answer was taken: an older one answering later changes nothing. */
const verifyKept = new Map<string, number>();
let verifyAsks = 0;

/**
 * Members: the gig's public key and its version, to check the leader's
 * signature: fetched first, the kept copy offline. `server`: the server
 * answered; false: offline (no answer in time, an error), the answer is the
 * kept copy. The server's answers (190): a key, "pending" (rotated), "no pair
 * yet" (version 0: answer null, nothing kept goes), or its no (SQL NULL:
 * `denied`, this account may no longer see the gig, and every key kept for
 * it goes: the band key, the public key, the private key; Codex on #288).
 */
export async function fetchVerifyKey(eventId: string): Promise<{ answer: StageVerifyAnswer | null; server: boolean; denied: boolean }> {
  const key = mine(VERIFY_PREFIX, eventId);
  const tag = tagFetch();
  const n = ++verifyAsks;
  const data = await ask('bw_stage_verify_key', { p_event_id: eventId });
  if (!stillOurs(tag)) return { answer: null, server: false, denied: false };
  if (data === OFFLINE) return { answer: kept(key, asVerify), server: false, denied: false };
  // Overtaken by a later ask's answer: what that one kept stands.
  if (n < (verifyKept.get(eventId) ?? 0)) return { answer: kept(key, asVerify), server: true, denied: false };
  verifyKept.set(eventId, n);
  if (data === null) {
    forgetStageKeys(eventId);
    return { answer: null, server: true, denied: true };
  }
  const verify = asVerify(data);
  if (!verify) {
    // No pair made yet (version 0), or nothing usable: no key to check with, nothing else changes.
    forget(key);
    return { answer: null, server: true, denied: false };
  }
  return { answer: keepNewest(key, verify, asVerify), server: true, denied: false };
}

/** The same, the answer only. Null before any admin made the pair (or for a gig the server no longer shows this account). */
export async function stageVerifyKey(eventId: string): Promise<StageVerifyAnswer | null> {
  return (await fetchVerifyKey(eventId)).answer;
}

/** This account lost the gig (the server said no to a phone holding its key): every key kept for it goes. */
export function forgetStageKeys(eventId: string) {
  forget(KEY_PREFIX + eventId);
  forget(PREV_PREFIX + eventId);
  forget(mine(VERIFY_PREFIX, eventId));
  forget(mine(SIGNER_PREFIX, eventId));
}

/** The public key kept on this phone (no network): Stage starts with it, then asks the server. */
export const keptVerifyKey = (eventId: string) => kept(mine(VERIFY_PREFIX, eventId), asVerify);

/**
 * Fetch the keys ahead of the gig (event detail open), so they're there
 * offline. Admins make the gig's signing key pair here if it has none, so
 * members who open the gig after them get its public key.
 */
export function prefetchStageKey(eventId?: string, isAdmin = false) {
  if (!eventId || !stageBleAvailable()) return;
  // Every time: a changed band key (191) or a pair rotated since (an admin who stopped being one) is picked up here.
  void stageKey(eventId);
  if (isAdmin) void stageSigner(eventId);
  else {
    void stageVerifyKey(eventId);
    // A private key kept from when this account was an admin: the server is asked, and its no
    // deletes it (stageSigner). Never on the role shown alone: it may not be loaded yet, and
    // offline the pair stays (Claude round 8 on #288).
    if (kept(mine(SIGNER_PREFIX, eventId), asSigner)) void stageSigner(eventId);
  }
}

/** The old copy of a setlist (until 11-21); moved into the live pack (livePackStore.ts). */
const SETLIST_PREFIX = 'bw-setlist-songs:';

/**
 * Sign-out (the button, or a session that ended by itself: expired or
 * revoked, or none at start-up): fetches in flight are dropped, the gigs'
 * Bluetooth keys kept on this phone go (private ones included), with any old
 * setlist copy and my files kept for live mode. (The live packs themselves
 * are in the offline store, which sign-out clears.)
 */
export function clearStageCache() {
  cacheGeneration++;
  keyKept.clear();
  refusedSigner.clear();
  cacheUser = null;
  setSignedMemoryUser(null);
  void removeAllPackFiles().catch(() => undefined);
  removeKeptKeys();
  try {
    localStorage.removeItem(OWNER_KEY);
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SETLIST_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage not available */
  }
}
