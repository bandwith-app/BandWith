/**
 * Stage mode over Bluetooth: the bytes on the air (no React, no plugins, so
 * it can be tested). See also src/lib/stageLive.ts (the same StageLiveState
 * travels over the internet) and migration 087 (the per-gig key).
 *
 * The admin's phone is a Bluetooth peripheral with one service and one
 * characteristic. Readers get the full state; subscribers are notified with
 * just the 4-byte seq and then read, so no message ever depends on the
 * negotiated MTU.
 *
 * Full state (all integers big-endian):
 *   [0]      format version (1)
 *   [1..4]   seq (Lamport clock)
 *   [5]      sender id length L (≤ 16), then L ASCII bytes
 *   4 bytes  fingerprint of the setlist's songs (row ids, sorted)
 *   1 byte   current song, as an index into the sorted ids (255 = none)
 *   1 byte   n, then n indexes into the sorted ids: the leader's order
 *   optional: 1 byte m, then m indexes: songs struck off for tonight (sent
 *            only when there are some, so older apps keep reading the rest)
 *
 * Version 2 refers to the songs by their sorted ids, not the saved order,
 * and always sends the order: a reorder the leader saves online then still
 * reaches members who are offline with the old saved order (version 1
 * rejected every state after it). Only a song added or removed is a
 * different setlist.
 *   8 bytes  HMAC-SHA256(key, everything before), truncated
 *
 * The service UUID is derived from the gig's key, so a member's app only
 * finds its own gig's leader, and the HMAC means only someone holding the
 * key (an active band member, migration 087) can publish an accepted state.
 *
 * Version 4 (audit #1): signed by the leader (ECDSA P-256, 64 bytes r‖s,
 * the gig's key pair, migration 190) instead of the band key, so a member
 * can't pose as the leader. It is served on a characteristic of its own
 * (STAGE_BLE_SIGNED_CHARACTERISTIC) next to version 2, which stays for apps
 * from before it. Its body differs from version 2 in two places:
 *   [1..2]   the pair's version (it goes up when an admin stops being one):
 *            newer than this phone's means its public key is out of date
 *   [3..6]   when it was signed (seconds since 2024-01-01 UTC): the leader
 *            signs again every minute, and members don't follow one signed
 *            more than SIGNED_FRESH_MS away from their clock (a recording
 *            replayed later, out of the leader's range)
 *   struck-off songs as a bitmap over the sorted ids (ceil(songs / 8)
 *            bytes, only when there are some), so the biggest setlist still
 *            fits one Bluetooth value (512 bytes) with the signature
 * A version 4 state with seq 0 is the leader's "here, leading nothing yet":
 * members note the admins' signature and follow nothing.
 */
import type { StageLiveState } from './stageLive';
import { SIGNATURE_BYTES, signBytes, verifyBytes } from './stageSign';

export const STAGE_BLE_VERSION = 2;
/** Characteristic carrying the state (same for every gig). */
export const STAGE_BLE_CHARACTERISTIC = 'b7d50001-5b1e-4c6a-9b3d-6e0a2f7c1d42';
/** The leader-signed state (version 4). */
export const STAGE_BLE_SIGNED_VERSION = 4;
export const STAGE_BLE_SIGNED_CHARACTERISTIC = 'b7d50004-5b1e-4c6a-9b3d-6e0a2f7c1d42';
const SERVICE_SUFFIX = '-5b1e-4c6a-9b3d-6e0a2f7c1d42';
const NONE = 255;
const MAX_SONGS = 254;
const MAC_BYTES = 8;
/** The most a Bluetooth characteristic value can hold. */
export const MAX_VALUE_BYTES = 512;
/** A signed state further than this from the member's clock (either way) is not followed. */
export const SIGNED_FRESH_MS = 10 * 60_000;
/**
 * A signed state whose pair is newer than this phone's by at most this many
 * versions means "this phone's key is out of date" (each admin who stops
 * being one adds one); further ahead, it's made up.
 */
export const STALE_VERSION_MAX = 16;
const SIGNED_EPOCH_MS = Date.UTC(2024, 0, 1);
const SIGNED_HEAD = 7;

const enc = new TextEncoder();
/** WebCrypto wants ArrayBuffer-backed views; ours always are. */
const bs = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>;

export const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};

export const fromBase64 = (b64: string) => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

const hmacKey = (keyB64: string) =>
  crypto.subtle.importKey('raw', bs(fromBase64(keyB64)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

const hmac = async (keyB64: string, data: Uint8Array) =>
  new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(keyB64), bs(data)));

/** The gig's Bluetooth service UUID, derived from its key. */
export async function stageServiceUuid(keyB64: string): Promise<string> {
  const tag = (await hmac(keyB64, enc.encode('bandwith-stage-service'))).slice(0, 4);
  return `${hex(tag)}${SERVICE_SUFFIX}`;
}

/** The setlist's row ids in a fixed order, whatever order they are saved in. */
const sortedIds = (ids: string[]) => [...ids].sort();

/** 4 bytes identifying the setlist's songs (row ids, in any order). */
export async function setlistFingerprint(savedIds: string[]): Promise<Uint8Array> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bs(enc.encode(sortedIds(savedIds).join(',')))));
  return digest.slice(0, 4);
}

/** Notification value: just the seq (subscribers then read the full state). */
export const seqBytes = (seq: number) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, seq >>> 0);
  return out;
};

/**
 * Bytes for `state`, or null when it can't be sent (too many songs, a song
 * the saved setlist doesn't have, or a sender id that isn't short ASCII).
 */
export async function encodeStageState(
  state: StageLiveState,
  savedIds: string[],
  keyB64: string,
): Promise<Uint8Array | null> {
  const body = await stateBody(state, savedIds, STAGE_BLE_VERSION);
  if (!body || body.length + MAC_BYTES > MAX_VALUE_BYTES) return null;
  const mac = (await hmac(keyB64, body)).slice(0, MAC_BYTES);
  const out = new Uint8Array(body.length + MAC_BYTES);
  out.set(body);
  out.set(mac, body.length);
  return out;
}

/** The same state signed by the leader (version 4) with pair `keyVersion`, or null when it can't be sent. */
export async function encodeSignedState(
  state: StageLiveState,
  savedIds: string[],
  signKey: string,
  keyVersion = 1,
  signedAtMs: number = Date.now(),
): Promise<Uint8Array | null> {
  const body = await stateBody(state, savedIds, STAGE_BLE_SIGNED_VERSION, keyVersion, signedAtMs);
  if (!body || body.length + SIGNATURE_BYTES > MAX_VALUE_BYTES) return null;
  const sig = await signBytes(signKey, body);
  const out = new Uint8Array(body.length + sig.length);
  out.set(body);
  out.set(sig, body.length);
  return out;
}

async function stateBody(state: StageLiveState, savedIds: string[], version: number, keyVersion = 1, signedAtMs = 0): Promise<Uint8Array | null> {
  if (savedIds.length > MAX_SONGS || !/^[\x20-\x7e]{1,16}$/.test(state.from)) return null;
  const signed = version === STAGE_BLE_SIGNED_VERSION;
  if (signed && (!Number.isInteger(keyVersion) || keyVersion < 1 || keyVersion > 0xffff)) return null;
  const index = new Map(sortedIds(savedIds).map((id, i) => [id, i]));
  const current = state.songId === null ? NONE : index.get(state.songId);
  if (current === undefined) return null;
  // No live order: the leader's saved order, which a member offline may not have.
  const order: number[] = [];
  for (const id of state.order ?? savedIds) {
    const i = index.get(id);
    if (i === undefined) return null;
    order.push(i);
  }
  const skipped: number[] = [];
  for (const id of state.skipped ?? []) {
    const i = index.get(id);
    if (i !== undefined) skipped.push(i);
  }
  const from = enc.encode(state.from);
  const fp = await setlistFingerprint(savedIds);
  const bitmap = Math.ceil(savedIds.length / 8);
  const tail = !skipped.length ? 0 : signed ? bitmap : 1 + skipped.length;
  const head = signed ? SIGNED_HEAD : 1;
  const body = new Uint8Array(head + 4 + 1 + from.length + 4 + 1 + 1 + order.length + tail);
  const view = new DataView(body.buffer);
  let o = 0;
  body[o++] = version;
  if (signed) {
    view.setUint16(o, keyVersion);
    o += 2;
    view.setUint32(o, Math.max(0, Math.floor((signedAtMs - SIGNED_EPOCH_MS) / 1000)) >>> 0);
    o += 4;
  }
  view.setUint32(o, state.seq >>> 0);
  o += 4;
  body[o++] = from.length;
  body.set(from, o);
  o += from.length;
  body.set(fp, o);
  o += 4;
  body[o++] = current;
  body[o++] = order.length;
  body.set(order, o);
  o += order.length;
  if (skipped.length && signed) {
    for (const i of skipped) body[o + (i >> 3)] |= 1 << (i & 7);
  } else if (skipped.length) {
    body[o++] = skipped.length;
    body.set(skipped, o);
  }
  return body;
}

export type DecodeResult =
  | { ok: true; state: StageLiveState }
  | { ok: false; reason: 'format' | 'auth' }
  /** A real state for a setlist this phone doesn't have: its seq and sender still tell which leader is newest. */
  | { ok: false; reason: 'setlist'; seq: number; from: string }
  /** Signed with a newer pair than this phone's public key: it needs the new one (internet). */
  | { ok: false; reason: 'stale' }
  /** Signed, but too long ago (or ahead) to follow: maybe a recording. Not the leader's fault: not distrusted. */
  | { ok: false; reason: 'expired' };

/** Checks and reads a state; `savedIds` is this phone's saved setlist (any order). */
export async function decodeStageState(bytes: Uint8Array, savedIds: string[], keyB64: string): Promise<DecodeResult> {
  if (bytes.length < 1 + 4 + 1 + 4 + 1 + 1 + MAC_BYTES || bytes[0] !== STAGE_BLE_VERSION) return { ok: false, reason: 'format' };
  const body = bytes.slice(0, bytes.length - MAC_BYTES);
  const mac = bytes.slice(bytes.length - MAC_BYTES);
  const expected = (await hmac(keyB64, body)).slice(0, MAC_BYTES);
  let diff = 0;
  for (let i = 0; i < MAC_BYTES; i++) diff |= mac[i] ^ expected[i];
  if (diff !== 0) return { ok: false, reason: 'auth' };
  return parseBody(body, savedIds);
}

/** Checks and reads a leader-signed state (version 4) with the gig's public key, version `keyVersion`. */
export async function decodeSignedState(
  bytes: Uint8Array,
  savedIds: string[],
  publicKey: string,
  keyVersion = 1,
  nowMs: number = Date.now(),
): Promise<DecodeResult> {
  if (bytes.length < SIGNED_HEAD + 4 + 1 + 4 + 1 + 1 + SIGNATURE_BYTES || bytes[0] !== STAGE_BLE_SIGNED_VERSION) return { ok: false, reason: 'format' };
  const theirs = (bytes[1] << 8) | bytes[2];
  const body = bytes.slice(0, bytes.length - SIGNATURE_BYTES);
  // The signature first, with this phone's key: only then is the version worth anything.
  if (!(await verifyBytes(publicKey, body, bytes.slice(bytes.length - SIGNATURE_BYTES)))) {
    // A few versions newer: this phone's key may be out of date (an admin stopped being one), not a forgery as far as it can tell.
    return theirs > keyVersion && theirs - keyVersion <= STALE_VERSION_MAX ? { ok: false, reason: 'stale' } : { ok: false, reason: 'auth' };
  }
  // Checked with this phone's pair, so its version is this phone's: anything else (older, or "newer" under the old pair) is refused.
  if (theirs !== keyVersion) return { ok: false, reason: 'auth' };
  const signedAt = SIGNED_EPOCH_MS + new DataView(body.buffer, body.byteOffset + 3, 4).getUint32(0) * 1000;
  if (Math.abs(nowMs - signedAt) > SIGNED_FRESH_MS) return { ok: false, reason: 'expired' };
  return parseBody(body, savedIds);
}

async function parseBody(body: Uint8Array, savedIds: string[]): Promise<DecodeResult> {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const signed = body[0] === STAGE_BLE_SIGNED_VERSION;
  let o = signed ? SIGNED_HEAD : 1;
  const seq = view.getUint32(o);
  o += 4;
  const fromLen = body[o++];
  if (fromLen < 1 || fromLen > 16 || o + fromLen + 4 + 2 > body.length) return { ok: false, reason: 'format' };
  const from = new TextDecoder().decode(body.slice(o, o + fromLen));
  o += fromLen;
  const fp = body.slice(o, o + 4);
  o += 4;
  const current = body[o++];
  const n = body[o++];
  if (o + n > body.length) return { ok: false, reason: 'format' };
  // Struck-off songs: an optional last section (m, then m indexes; signed: a bitmap).
  const tailAt = o + n;
  const hasTail = tailAt < body.length;
  const m = hasTail && !signed ? body[tailAt] : 0;
  if (hasTail && !signed && tailAt + 1 + m !== body.length) return { ok: false, reason: 'format' };
  const mine = await setlistFingerprint(savedIds);
  if (hex(fp) !== hex(mine)) return { ok: false, reason: 'setlist', seq, from };
  const ids = sortedIds(savedIds);
  if (hasTail && signed && body.length - tailAt !== Math.ceil(ids.length / 8)) return { ok: false, reason: 'format' };
  if (current !== NONE && current >= ids.length) return { ok: false, reason: 'format' };
  const order: string[] = [];
  for (let i = 0; i < n; i++) {
    const idx = body[o + i];
    if (idx >= ids.length) return { ok: false, reason: 'format' };
    order.push(ids[idx]);
  }
  const skipped: string[] = [];
  if (hasTail && signed) {
    for (let i = 0; i < ids.length; i++) if (body[tailAt + (i >> 3)] & (1 << (i & 7))) skipped.push(ids[i]);
  }
  for (let i = 0; i < m; i++) {
    const idx = body[tailAt + 1 + i];
    if (idx >= ids.length) return { ok: false, reason: 'format' };
    skipped.push(ids[idx]);
  }
  return {
    ok: true,
    state: { seq, from, songId: current === NONE ? null : ids[current], order: n > 0 ? order : null, ...(skipped.length ? { skipped } : {}) },
  };
}
