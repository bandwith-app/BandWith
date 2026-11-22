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
import { generateSigner } from '../stageSign';

// jsdom has no WebCrypto; the app runs where it does (WKWebView, Android WebView).
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const KEY = toBase64(new Uint8Array(32).map((_, i) => i * 7));
const unhex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
const LEADER = await generateSigner();
const OTHER = await generateSigner();

/**
 * Frames made by the native encoders (StageBlePlugin.swift and .java, the
 * same `clockFrame`) for t1 1795000000123.4 with this key pair. ECDSA
 * signatures differ every time, so the check is that ours verifies them.
 */
const NATIVE_PUBLIC = 'BM1VAXa4XHA0VsfT8YKYKDlWe5OQMF9WKCB4IS1k+PMoy256HF3K8UrdeTyQASr4cPR1QEH9+o6Po2xUgtv1iW8=';
const SWIFT_FRAME =
  '030210534f5fb0d287097c1eed927d2403d782d4142e61c9ee9e4c685c0da8fc150ff0d59e3661d8013a896bfaeef181843473c3a77c92cfd442fa2773fad75d0c2f1589fe0b1478';
const JAVA_FRAME =
  '030210534f5fb0d27e6d83a753f490d3f8cbff1a63534a6b8eeb945eeed2cb249974b711b43ccbc09abc8735587bb4eafc267ae1e334e6af6065e4193a0e3a5c7be905c6f7d14642';

describe('stageBleSync clock frame', () => {
  it('the signed clock has a characteristic of its own: builds that read the band-key clock (b7d50002, never released) find none', () => {
    // Those builds (main after #265) expect 16 bytes there: they get "no clock" (their older-leader path), never a frame to misread.
    expect(STAGE_BLE_CLOCK_CHARACTERISTIC).toBe('b7d50005-5b1e-4c6a-9b3d-6e0a2f7c1d42');
  });

  it('is a new frame version on characteristics of its own (older apps never read them)', () => {
    expect(STAGE_BLE_SYNC_VERSION).toBeGreaterThan(STAGE_BLE_VERSION);
    const chars = new Set([STAGE_BLE_CHARACTERISTIC, STAGE_BLE_CLOCK_CHARACTERISTIC, STAGE_BLE_LIVE_CHARACTERISTIC]);
    expect(chars.size).toBe(3);
    for (const c of chars) expect(c).toMatch(/^[0-9a-f]{8}-5b1e-4c6a-9b3d-6e0a2f7c1d42$/);
  });

  it('signed by the leader (72 bytes, one read once the MTU is negotiated) and keeps 0.1 ms', async () => {
    const t1 = 1_795_000_000_123.4;
    const frame = await encodeClock(t1, LEADER.private);
    expect(frame.length).toBe(72);
    expect(await decodeClock(frame, LEADER.public)).toBe(t1);
  });

  it("verifies the native encoders' frames (Swift and Java)", async () => {
    expect(await decodeClock(unhex(SWIFT_FRAME), NATIVE_PUBLIC)).toBe(1_795_000_000_123.4);
    expect(await decodeClock(unhex(JAVA_FRAME), NATIVE_PUBLIC)).toBe(1_795_000_000_123.4);
    expect(await decodeClock(unhex(SWIFT_FRAME), LEADER.public)).toBeNull();
  });

  it("rejects frames not signed by the leader's key, tampered, or of another version", async () => {
    const frame = await encodeClock(1_000_000, LEADER.private);
    expect(await decodeClock(frame, OTHER.public)).toBeNull();
    // A member's own key pair can't move the band's clock.
    expect(await decodeClock(await encodeClock(1_000_000, OTHER.private), LEADER.public)).toBeNull();
    const tampered = frame.slice();
    tampered[5] ^= 1;
    expect(await decodeClock(tampered, LEADER.public)).toBeNull();
    const old = frame.slice();
    old[0] = STAGE_BLE_VERSION;
    expect(await decodeClock(old, LEADER.public)).toBeNull();
    expect(await decodeClock(new Uint8Array(0), LEADER.public)).toBeNull();
    // The band-key clock of builds before signing (16 bytes) is not read.
    expect(await decodeClock(frame.slice(0, 16), LEADER.public)).toBeNull();
  });

  it('a clock frame read as a state is ignored, and the state frame is unchanged (version 2)', async () => {
    const frame = await encodeClock(1_000_000, LEADER.private);
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
