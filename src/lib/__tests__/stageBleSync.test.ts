import { describe, expect, it } from 'vitest';
import { decodeStageState, encodeStageState, toBase64 } from '../stageBle';
import {
  BleClockBook,
  CLOCK_MAX_AGE_MS,
  STAGE_BLE_SYNC_CHARACTERISTIC,
  STAGE_BLE_SYNC_VERSION,
  decodePong,
  encodePing,
  encodePong,
  parsePing,
} from '../stageBleSync';
import { STAGE_BLE_CHARACTERISTIC, STAGE_BLE_VERSION } from '../stageBle';
import { bestSample, clockSample, pickClock } from '../stageClick';

// jsdom has no WebCrypto; the app runs where it does (WKWebView, Android WebView).
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const KEY = toBase64(new Uint8Array(32).map((_, i) => i * 7));
const OTHER_KEY = toBase64(new Uint8Array(32).map((_, i) => 255 - i));
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('stageBleSync frames', () => {
  it('is a new frame version on its own characteristic (older apps never read it)', () => {
    expect(STAGE_BLE_SYNC_VERSION).toBeGreaterThan(STAGE_BLE_VERSION);
    expect(STAGE_BLE_SYNC_CHARACTERISTIC).not.toBe(STAGE_BLE_CHARACTERISTIC);
    expect(STAGE_BLE_SYNC_CHARACTERISTIC).toMatch(/^[0-9a-f]{8}-5b1e-4c6a-9b3d-6e0a2f7c1d42$/);
  });

  it('pings are 4 bytes: version, type, nonce', () => {
    const ping = encodePing(0xbeef);
    expect([...ping]).toEqual([STAGE_BLE_SYNC_VERSION, 1, 0xbe, 0xef]);
    expect(parsePing(ping)).toBe(0xbeef);
    expect(parsePing(new Uint8Array([2, 1, 0, 1]))).toBeNull();
    expect(parsePing(new Uint8Array([STAGE_BLE_SYNC_VERSION, 2, 0, 1]))).toBeNull();
    expect(parsePing(new Uint8Array([STAGE_BLE_SYNC_VERSION, 1, 0]))).toBeNull();
  });

  it('pongs fit one notification at the default MTU (20 bytes) and keep 0.1 ms', async () => {
    const t1 = 1_795_000_000_123.4;
    const pong = await encodePong(0x1234, t1, KEY);
    expect(pong.length).toBeLessThanOrEqual(20);
    expect(await decodePong(pong, KEY)).toEqual({ nonce: 0x1234, t1 });
  });

  it('matches the native encoders byte for byte (test vector for Swift and Java)', async () => {
    // StageBlePlugin.swift and StageBlePlugin.java build this same frame.
    const pong = await encodePong(0x1234, 1_795_000_000_123.4, KEY);
    expect(hex(pong)).toBe(PONG_VECTOR);
  });

  it('rejects pongs signed with another key, tampered, or of another version', async () => {
    const pong = await encodePong(7, 1_000_000, KEY);
    expect(await decodePong(pong, OTHER_KEY)).toBeNull();
    const tampered = pong.slice();
    tampered[5] ^= 1;
    expect(await decodePong(tampered, KEY)).toBeNull();
    const old = pong.slice();
    old[0] = STAGE_BLE_VERSION;
    expect(await decodePong(old, KEY)).toBeNull();
    expect(await decodePong(new Uint8Array([STAGE_BLE_SYNC_VERSION, 2, 0]), KEY)).toBeNull();
  });

  it('a sync frame on the state characteristic is ignored by the state decoder (old and new apps)', async () => {
    const pong = await encodePong(7, 1_000_000, KEY);
    expect(await decodeStageState(pong, ['a1'], KEY)).toEqual({ ok: false, reason: 'format' });
    // …and the state frame itself is unchanged (version 2), so older leaders and members keep working.
    const state = await encodeStageState({ seq: 1, from: 'lead', songId: 'a1', order: null }, ['a1'], KEY);
    expect(state![0]).toBe(2);
  });
});

describe('BleClockBook', () => {
  it('turns a ping and its pong into the same sample as the Realtime clock', () => {
    const book = new BleClockBook();
    const { nonce } = book.ping(1000);
    const sample = book.pong(nonce, 1530, 1040);
    expect(sample).toEqual(clockSample(1000, 1530, 1040));
    expect(sample).toEqual({ offset: 510, rtt: 40 });
  });

  it('keeps the fastest round trip, like bestSample', () => {
    const book = new BleClockBook();
    const a = book.ping(0);
    const b = book.ping(100);
    const c = book.ping(200);
    book.pong(a.nonce, 530, 60); // rtt 60
    book.pong(b.nonce, 620, 120); // rtt 20 → offset 510
    book.pong(c.nonce, 750, 290); // rtt 90
    expect(book.best(300)).toEqual({ offset: 510, rtt: 20 });
    expect(book.best(300)).toEqual(bestSample(book.samples(300)));
  });

  it('ignores unknown, repeated and late pongs', () => {
    const book = new BleClockBook();
    const { nonce } = book.ping(0);
    expect(book.pong((nonce + 1) & 0xffff, 500, 20)).toBeNull();
    expect(book.pong(nonce, 500, 20)).not.toBeNull();
    // A replayed pong for the same ping is not a second sample.
    expect(book.pong(nonce, 500, 25)).toBeNull();
    const late = book.ping(1000);
    expect(book.pong(late.nonce, 1500, 1000 + 5000)).toBeNull();
  });

  it('forgets samples older than the window, so drift does not stick', () => {
    const book = new BleClockBook();
    const old = book.ping(0);
    book.pong(old.nonce, 500, 10); // rtt 10, the best… but old
    const fresh = book.ping(CLOCK_MAX_AGE_MS + 1000);
    book.pong(fresh.nonce, CLOCK_MAX_AGE_MS + 1530, CLOCK_MAX_AGE_MS + 1040);
    expect(book.best(CLOCK_MAX_AGE_MS + 1100)).toEqual({ offset: 510, rtt: 40 });
  });

  it('every ping has its own nonce', () => {
    const book = new BleClockBook();
    const seen = new Set(Array.from({ length: 50 }, (_, i) => book.ping(i).nonce));
    expect(seen.size).toBe(50);
  });

  it('frames the ping it hands out', () => {
    const book = new BleClockBook();
    const { nonce, bytes } = book.ping(0);
    expect(parsePing(bytes)).toBe(nonce);
  });
});

describe('pickClock', () => {
  it('uses the path with the fastest round trip for the same leader', () => {
    const realtime = { from: 'lead', sample: { offset: 480, rtt: 120 } };
    const ble = { from: 'lead', sample: { offset: 505, rtt: 30 } };
    expect(pickClock('lead', [realtime, ble])).toEqual({ offset: 505, rtt: 30 });
    expect(pickClock('lead', [realtime, null])).toEqual({ offset: 480, rtt: 120 });
  });

  it('never uses a clock measured against someone else', () => {
    const ble = { from: 'old-leader', sample: { offset: 505, rtt: 30 } };
    expect(pickClock('lead', [ble])).toBeNull();
    expect(pickClock(null, [ble])).toBeNull();
  });
});

// Computed once from the JS encoder; the native plugins must produce exactly this.
const PONG_VECTOR = '0302123410534f5fb0d2879d96279f5e7feb';
