/**
 * Stage mode over Bluetooth, part 2: the leader's clock (and, later, the
 * click and the playhead) for members with no internet. Pure bytes and
 * maths, no React and no plugins, so it can be tested. The state frame
 * (song, order, struck off) stays as it is in stageBle.ts, version 2.
 *
 * It lives on a second characteristic of the gig's service, so apps from
 * before it never see these frames, and members with a newer app simply
 * get no answer from an older leader (the write fails: no Bluetooth clock).
 *
 * Sync characteristic (write + read + notify). All integers big-endian.
 *
 * Ping, member → leader (write), 4 bytes:
 *   [0] version (3)  [1] type 1  [2..3] nonce
 *
 * Pong, leader → that member only (notify), 18 bytes (fits the 20 bytes a
 * notification carries before any MTU is negotiated):
 *   [0] version (3)  [1] type 2  [2..3] nonce (the ping's)
 *   [4..9]   t1: the leader's clock when the ping arrived, in 0.1 ms units
 *            (the same clock the leader's app uses for `startAt`)
 *   [10..17] HMAC-SHA256(key, bytes 0..9), truncated
 *
 * The leader's phone answers natively, at once (StageBlePlugin.swift /
 * .java), so the app's own delays don't enter the measurement; then the
 * NTP-style maths of the Realtime click (clockSample / bestSample) applies.
 * The nonce ties a pong to its ping, and the HMAC (only band members hold
 * the key) means nobody nearby can shift the band's clock.
 */
import { fromBase64 } from './stageBle';
import { bestSample, clockSample, type ClockSample } from './stageClick';

export const STAGE_BLE_SYNC_VERSION = 3;
/** Characteristic for the clock (and later the click and playhead), same for every gig. */
export const STAGE_BLE_SYNC_CHARACTERISTIC = 'b7d50002-5b1e-4c6a-9b3d-6e0a2f7c1d42';

export const SYNC_PING = 1;
export const SYNC_PONG = 2;

const MAC_BYTES = 8;
const PONG_BODY = 10;
const TICKS_PER_MS = 10;

/** A pong later than this is not worth a sample (and its ping is forgotten). */
export const PONG_TIMEOUT_MS = 2000;
/** Samples older than this are dropped: phone clocks drift a few ms a minute. */
export const CLOCK_MAX_AGE_MS = 90_000;
/** Pings in a burst, and the gap between them (one BLE connection event or more). */
export const BURST_PINGS = 6;
export const BURST_GAP_MS = 150;
/** Measure again this often while linked. */
export const CLOCK_RESYNC_MS = 30_000;

const bs = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>;

const hmac8 = async (keyB64: string, data: Uint8Array) => {
  const key = await crypto.subtle.importKey('raw', bs(fromBase64(keyB64)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, bs(data))).slice(0, MAC_BYTES);
};

export const encodePing = (nonce: number) =>
  new Uint8Array([STAGE_BLE_SYNC_VERSION, SYNC_PING, (nonce >> 8) & 0xff, nonce & 0xff]);

/** The nonce of a ping, or null for anything else. */
export const parsePing = (bytes: Uint8Array): number | null =>
  bytes.length === 4 && bytes[0] === STAGE_BLE_SYNC_VERSION && bytes[1] === SYNC_PING ? (bytes[2] << 8) | bytes[3] : null;

/** The leader's answer (built natively in the apps; here for the tests and the spec). */
export async function encodePong(nonce: number, t1: number, keyB64: string): Promise<Uint8Array> {
  const out = new Uint8Array(PONG_BODY + MAC_BYTES);
  const view = new DataView(out.buffer);
  out[0] = STAGE_BLE_SYNC_VERSION;
  out[1] = SYNC_PONG;
  view.setUint16(2, nonce & 0xffff);
  const ticks = Math.round(t1 * TICKS_PER_MS);
  view.setUint16(4, Math.floor(ticks / 2 ** 32));
  view.setUint32(6, ticks >>> 0);
  out.set(await hmac8(keyB64, out.subarray(0, PONG_BODY)), PONG_BODY);
  return out;
}

/** A checked pong, or null (wrong version or type, wrong key, tampered). */
export async function decodePong(bytes: Uint8Array, keyB64: string): Promise<{ nonce: number; t1: number } | null> {
  if (bytes.length !== PONG_BODY + MAC_BYTES || bytes[0] !== STAGE_BLE_SYNC_VERSION || bytes[1] !== SYNC_PONG) return null;
  const expected = await hmac8(keyB64, bytes.slice(0, PONG_BODY));
  let diff = 0;
  for (let i = 0; i < MAC_BYTES; i++) diff |= bytes[PONG_BODY + i] ^ expected[i];
  if (diff !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ticks = view.getUint16(4) * 2 ** 32 + view.getUint32(6);
  return { nonce: view.getUint16(2), t1: ticks / TICKS_PER_MS };
}

/**
 * A member's pings to the leader and the samples their pongs give. Times are
 * the member's own clock (ms); the offset is the leader's clock minus ours.
 */
export class BleClockBook {
  private next = Math.floor(Math.random() * 0x10000);
  private pending = new Map<number, number>();
  private kept: Array<ClockSample & { at: number }> = [];

  /** A new ping sent at `t0`. */
  ping(t0: number): { nonce: number; bytes: Uint8Array } {
    for (const [n, sent] of this.pending) if (t0 - sent > PONG_TIMEOUT_MS) this.pending.delete(n);
    const nonce = this.next;
    this.next = (this.next + 1) & 0xffff;
    this.pending.set(nonce, t0);
    return { nonce, bytes: encodePing(nonce) };
  }

  /** The pong for ping `nonce`, stamped `t1` by the leader, arrived at `t2`: its sample, once. */
  pong(nonce: number, t1: number, t2: number): ClockSample | null {
    const t0 = this.pending.get(nonce);
    if (t0 === undefined) return null;
    this.pending.delete(nonce);
    if (t2 - t0 > PONG_TIMEOUT_MS || t2 < t0) return null;
    const sample = clockSample(t0, t1, t2);
    this.kept.push({ ...sample, at: t2 });
    return sample;
  }

  /** Samples still fresh at `now`. */
  samples(now: number): ClockSample[] {
    this.kept = this.kept.filter((s) => now - s.at <= CLOCK_MAX_AGE_MS);
    return this.kept.map(({ offset, rtt }) => ({ offset, rtt }));
  }

  best(now: number): ClockSample | null {
    return bestSample(this.samples(now));
  }

  clear() {
    this.pending.clear();
    this.kept = [];
  }
}
