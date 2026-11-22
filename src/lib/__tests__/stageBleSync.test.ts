import { describe, expect, it } from 'vitest';
import { decodeStageState, encodeStageState, toBase64 } from '../stageBle';
import {
  BleClockBook,
  CLOCK_MAX_AGE_MS,
  STAGE_BLE_CLOCK_CHARACTERISTIC,
  STAGE_BLE_LIVE_CHARACTERISTIC,
  STAGE_BLE_SYNC_VERSION,
  decodeClock,
  encodeClock,
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

describe('stageBleSync clock frame', () => {
  it('is a new frame version on characteristics of its own (older apps never read them)', () => {
    expect(STAGE_BLE_SYNC_VERSION).toBeGreaterThan(STAGE_BLE_VERSION);
    const chars = new Set([STAGE_BLE_CHARACTERISTIC, STAGE_BLE_CLOCK_CHARACTERISTIC, STAGE_BLE_LIVE_CHARACTERISTIC]);
    expect(chars.size).toBe(3);
    for (const c of chars) expect(c).toMatch(/^[0-9a-f]{8}-5b1e-4c6a-9b3d-6e0a2f7c1d42$/);
  });

  it('fits one read before any MTU is negotiated (22 bytes) and keeps 0.1 ms', async () => {
    const t1 = 1_795_000_000_123.4;
    const frame = await encodeClock(t1, KEY);
    expect(frame.length).toBeLessThanOrEqual(22);
    expect(await decodeClock(frame, KEY)).toBe(t1);
  });

  it('matches the native encoders byte for byte (test vector for Swift and Java)', async () => {
    // StageBlePlugin.swift and StageBlePlugin.java build this same frame.
    expect(hex(await encodeClock(1_795_000_000_123.4, KEY))).toBe(CLOCK_VECTOR);
  });

  it('rejects frames signed with another key, tampered, or of another version', async () => {
    const frame = await encodeClock(1_000_000, KEY);
    expect(await decodeClock(frame, OTHER_KEY)).toBeNull();
    const tampered = frame.slice();
    tampered[5] ^= 1;
    expect(await decodeClock(tampered, KEY)).toBeNull();
    const old = frame.slice();
    old[0] = STAGE_BLE_VERSION;
    expect(await decodeClock(old, KEY)).toBeNull();
    expect(await decodeClock(new Uint8Array(0), KEY)).toBeNull();
  });

  it('a clock frame read as a state is ignored, and the state frame is unchanged (version 2)', async () => {
    const frame = await encodeClock(1_000_000, KEY);
    expect(await decodeStageState(frame, ['a1'], KEY)).toEqual({ ok: false, reason: 'format' });
    const state = await encodeStageState({ seq: 1, from: 'lead', songId: 'a1', order: null }, ['a1'], KEY);
    expect(state![0]).toBe(2);
  });
});

describe('BleClockBook', () => {
  it('turns a read (sent t0, stamped t1, back t2) into the same sample as the Realtime clock', () => {
    const book = new BleClockBook();
    expect(book.add(1000, 1530, 1040)).toEqual(clockSample(1000, 1530, 1040));
    expect(book.best(1100)).toEqual({ offset: 510, rtt: 40 });
  });

  it('keeps the fastest round trip, like bestSample', () => {
    const book = new BleClockBook();
    book.add(0, 530, 60); // rtt 60
    book.add(100, 620, 120); // rtt 20 → offset 510
    book.add(200, 750, 290); // rtt 90
    expect(book.best(300)).toEqual({ offset: 510, rtt: 20 });
    expect(book.best(300)).toEqual(bestSample(book.samples(300)));
  });

  it('ignores reads that took too long', () => {
    const book = new BleClockBook();
    expect(book.add(0, 500, 5000)).toBeNull();
    expect(book.best(5000)).toBeNull();
  });

  it('a replayed old answer (fast, but far from the others) is not used', () => {
    const book = new BleClockBook();
    book.add(0, 530, 50);
    book.add(200, 735, 260);
    book.add(400, 935, 460);
    // A captured frame from 10 minutes ago, injected as a very fast answer.
    book.add(600, 630 - 600_000, 610);
    expect(Math.abs(book.best(700)!.offset - 510)).toBeLessThan(10);
  });

  it('forgets samples older than the window, so drift does not stick', () => {
    const book = new BleClockBook();
    book.add(0, 500, 10); // rtt 10, the best… but old
    book.add(CLOCK_MAX_AGE_MS + 1000, CLOCK_MAX_AGE_MS + 1530, CLOCK_MAX_AGE_MS + 1040);
    expect(book.best(CLOCK_MAX_AGE_MS + 1100)).toEqual({ offset: 510, rtt: 40 });
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
const CLOCK_VECTOR = '030210534f5fb0d28cb51b043ea1b037';
