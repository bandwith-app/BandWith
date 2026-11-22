import { describe, expect, it } from 'vitest';
import { generateSigner, signBytes, verifyBytes, SIGNATURE_BYTES } from '../stageSign';
import {
  STAGE_BLE_CHARACTERISTIC,
  STAGE_BLE_SIGNED_CHARACTERISTIC,
  STAGE_BLE_SIGNED_VERSION,
  decodeSignedState,
  decodeStageState,
  encodeSignedState,
  encodeStageState,
  toBase64,
} from '../stageBle';
import { decodeClock, encodeClock } from '../stageBleSync';

// jsdom has no WebCrypto; the app runs where it does (WKWebView, Android WebView).
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const HMAC_KEY = toBase64(new Uint8Array(32).map((_, i) => i * 7));
const IDS = ['a1', 'b2', 'c3'];
const state = { seq: 41, from: 'lead', songId: 'b2', order: ['c3', 'a1', 'b2'], skipped: ['a1'] };

describe('the leader signs, members only check (audit #1)', () => {
  it("the leader's signed state is read back by a member holding the public key", async () => {
    const leader = await generateSigner();
    const bytes = (await encodeSignedState(state, IDS, leader.private))!;
    expect(bytes[0]).toBe(STAGE_BLE_SIGNED_VERSION);
    expect(await decodeSignedState(bytes, IDS, leader.public)).toEqual({ ok: true, state });
  });

  it('a member holding only what members get (the band key and the public key) cannot make a state other members accept', async () => {
    const leader = await generateSigner();
    // Everything a member's app has: the shared band key and the leader's public key.
    const forgedWithBandKey = (await encodeStageState({ ...state, songId: 'c3' }, IDS, HMAC_KEY))!;
    expect((await decodeSignedState(forgedWithBandKey, IDS, leader.public)).ok).toBe(false);
    // A key pair of its own: signed, but not by the leader.
    const mine = await generateSigner();
    const forgedWithOwnKey = (await encodeSignedState({ ...state, songId: 'c3' }, IDS, mine.private))!;
    expect(await decodeSignedState(forgedWithOwnKey, IDS, leader.public)).toEqual({ ok: false, reason: 'auth' });
    // A real signed state, edited.
    const real = (await encodeSignedState(state, IDS, leader.private))!;
    const edited = real.slice();
    edited[6] ^= 1;
    expect((await decodeSignedState(edited, IDS, leader.public)).ok).toBe(false);
  });

  it('the signed state is its own version on its own characteristic: older apps keep reading the band-key state', async () => {
    expect(STAGE_BLE_SIGNED_CHARACTERISTIC).not.toBe(STAGE_BLE_CHARACTERISTIC);
    const leader = await generateSigner();
    const signed = (await encodeSignedState(state, IDS, leader.private))!;
    // An older app's decoder (version 2, band key) never takes a signed frame for a state.
    expect(await decodeStageState(signed, IDS, HMAC_KEY)).toEqual({ ok: false, reason: 'format' });
    // The leader still serves the version 2 state for them, unchanged.
    expect(await decodeStageState((await encodeStageState(state, IDS, HMAC_KEY))!, IDS, HMAC_KEY)).toEqual({ ok: true, state });
  });

  it("another setlist on this phone is told apart from a bad signature", async () => {
    const leader = await generateSigner();
    const bytes = (await encodeSignedState(state, IDS, leader.private))!;
    expect(await decodeSignedState(bytes, ['a1', 'b2'], leader.public)).toMatchObject({ ok: false, reason: 'setlist' });
  });

  it('signatures are 64 bytes (r‖s), the WebCrypto form the native plugins also produce', async () => {
    const leader = await generateSigner();
    const sig = await signBytes(leader.private, new Uint8Array([1, 2, 3]));
    expect(sig.length).toBe(SIGNATURE_BYTES);
    expect(await verifyBytes(leader.public, new Uint8Array([1, 2, 3]), sig)).toBe(true);
    expect(await verifyBytes(leader.public, new Uint8Array([1, 2, 4]), sig)).toBe(false);
    expect(await verifyBytes('not a key', new Uint8Array([1]), sig)).toBe(false);
  });

  it("the leader's clock readings are signed too: a member can't shift the band's clock", async () => {
    const leader = await generateSigner();
    const t1 = 1_795_000_000_123.4;
    const frame = await encodeClock(t1, leader.private);
    expect(await decodeClock(frame, leader.public)).toBe(t1);
    const mine = await generateSigner();
    expect(await decodeClock(await encodeClock(t1 + 400, mine.private), leader.public)).toBeNull();
  });

  it("carries the pair's version: a newer one means this phone's public key is out of date, an older one is refused", async () => {
    const leader = await generateSigner();
    const bytes = (await encodeSignedState(state, IDS, leader.private, 2))!;
    expect(await decodeSignedState(bytes, IDS, leader.public, 2)).toEqual({ ok: true, state });
    // This phone kept version 1: it fetches the new key (not "a forger").
    expect(await decodeSignedState(bytes, IDS, leader.public, 1)).toEqual({ ok: false, reason: 'stale' });
    // Signed with a pair from before a rotation (an admin no longer): refused.
    const old = (await encodeSignedState(state, IDS, leader.private, 1))!;
    expect(await decodeSignedState(old, IDS, leader.public, 2)).toEqual({ ok: false, reason: 'auth' });
  });

  it('the version is signed: a forger cannot raise it to look like a newer key', async () => {
    const leader = await generateSigner();
    const bytes = (await encodeSignedState(state, IDS, leader.private, 3))!;
    const bumped = bytes.slice();
    bumped[2] = 4; // the version's low byte
    expect(await decodeSignedState(bumped, IDS, leader.public, 4)).toEqual({ ok: false, reason: 'auth' });
  });

  it('the biggest setlist (254 songs, 200 struck off) fits one Bluetooth value (512 bytes) and reads back', async () => {
    const ids = Array.from({ length: 254 }, (_, i) => `row-${String(i).padStart(3, '0')}`);
    const big = { seq: 2 ** 31, from: 'x'.repeat(16), songId: ids[100], order: [...ids].reverse(), skipped: ids.slice(0, 200) };
    const leader = await generateSigner();
    const bytes = (await encodeSignedState(big, ids, leader.private, 65535))!;
    expect(bytes.length).toBeLessThanOrEqual(512);
    const back = await decodeSignedState(bytes, ids, leader.public, 65535);
    expect(back.ok && back.state.order).toEqual(big.order);
    expect(back.ok && [...(back.state.skipped ?? [])].sort()).toEqual(big.skipped);
    // The band-key state for older apps fits too.
    expect((await encodeStageState(big, ids, HMAC_KEY))!.length).toBeLessThanOrEqual(512);
  });
});
