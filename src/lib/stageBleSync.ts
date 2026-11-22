/**
 * Stage mode over Bluetooth, part 2: the leader's clock (and, in B3, the
 * click and the playhead) for members with no internet. Pure bytes and
 * maths, no React and no plugins, so it can be tested. The state frame
 * (song, order, struck off) stays as it is in stageBle.ts, version 2.
 *
 * These frames live on characteristics of their own in the gig's service,
 * so apps from before them never see them, and members with a newer app
 * simply find nothing on an older leader (no Bluetooth clock).
 *
 * Clock characteristic (read only). Every read is answered by the leader's
 * plugin itself, at once, with its clock at that moment, 16 bytes:
 *   [0] version (3)  [1] type 2
 *   [2..7]   t1: the leader's clock, in 0.1 ms units (the same clock the
 *            leader's app uses for `startAt`)
 *   [8..15]  HMAC-SHA256(key, bytes 0..7), truncated
 * It fits a single read before any MTU is negotiated (22 bytes).
 *
 * Why reads, not a written ping: on Android the Bluetooth LE plugin's write
 * throws an uncaught exception, and the app crashes, if Bluetooth turns off
 * while it goes out (seen on the emulator; airplane mode does exactly that).
 * Reads fail cleanly. A read's answer belongs to that read, so it needs no
 * nonce; a replayed old answer is far from the others and is filtered out.
 *
 * Then the NTP-style maths of the Realtime click (clockSample / bestSample).
 * The HMAC (only band members hold the key) means nobody nearby can shift the
 * band's clock.
 */
import { fromBase64 } from './stageBle';
import { BLE_MAX_CLOCK_RTT_MS, bestSample, clockSample, type ClockSample } from './stageClick';

export const STAGE_BLE_SYNC_VERSION = 3;
/** The leader's clock, one fresh signed reading per read (same for every gig). */
export const STAGE_BLE_CLOCK_CHARACTERISTIC = 'b7d50002-5b1e-4c6a-9b3d-6e0a2f7c1d42';
/** The live frame (click, count-in, playhead): read + notify, filled in B3. */
export const STAGE_BLE_LIVE_CHARACTERISTIC = 'b7d50003-5b1e-4c6a-9b3d-6e0a2f7c1d42';

export const SYNC_CLOCK = 2;

const MAC_BYTES = 8;
const CLOCK_BODY = 8;
const TICKS_PER_MS = 10;

/** A read slower than this is not worth a sample. */
export const READ_TIMEOUT_MS = 2000;
/** Samples older than this are dropped: phone clocks drift a few ms a minute. */
export const CLOCK_MAX_AGE_MS = 90_000;
/** Samples further than this from the others' median are left out (a replayed frame). */
export const CLOCK_OUTLIER_MS = 50;
/** Reads in a burst, and the gap between them (one BLE connection event or more). */
export const BURST_READS = 6;
export const BURST_GAP_MS = 150;
/** Measure again this often while linked. */
export const CLOCK_RESYNC_MS = 30_000;

const bs = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>;

const hmac8 = async (keyB64: string, data: Uint8Array) => {
  const key = await crypto.subtle.importKey('raw', bs(fromBase64(keyB64)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, bs(data))).slice(0, MAC_BYTES);
};

/** The leader's clock reading (built natively in the apps; here for the tests and the spec). */
export async function encodeClock(t1: number, keyB64: string): Promise<Uint8Array> {
  const out = new Uint8Array(CLOCK_BODY + MAC_BYTES);
  const view = new DataView(out.buffer);
  out[0] = STAGE_BLE_SYNC_VERSION;
  out[1] = SYNC_CLOCK;
  const ticks = Math.round(t1 * TICKS_PER_MS);
  view.setUint16(2, Math.floor(ticks / 2 ** 32));
  view.setUint32(4, ticks >>> 0);
  out.set(await hmac8(keyB64, out.subarray(0, CLOCK_BODY)), CLOCK_BODY);
  return out;
}

/** The leader's clock from a checked frame, or null (wrong version or type, wrong key, tampered). */
export async function decodeClock(bytes: Uint8Array, keyB64: string): Promise<number | null> {
  if (bytes.length !== CLOCK_BODY + MAC_BYTES || bytes[0] !== STAGE_BLE_SYNC_VERSION || bytes[1] !== SYNC_CLOCK) return null;
  const expected = await hmac8(keyB64, bytes.slice(0, CLOCK_BODY));
  let diff = 0;
  for (let i = 0; i < MAC_BYTES; i++) diff |= bytes[CLOCK_BODY + i] ^ expected[i];
  if (diff !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (view.getUint16(2) * 2 ** 32 + view.getUint32(4)) / TICKS_PER_MS;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * A member's readings of the leader's clock. Times are the member's own clock
 * (ms); the offset is the leader's clock minus ours.
 */
export class BleClockBook {
  private kept: Array<ClockSample & { at: number }> = [];

  /** A read sent at `t0`, stamped `t1` by the leader, back at `t2`: its sample (null if too slow). */
  add(t0: number, t1: number, t2: number): ClockSample | null {
    if (t2 < t0 || t2 - t0 > READ_TIMEOUT_MS) return null;
    const sample = clockSample(t0, t1, t2);
    this.kept.push({ ...sample, at: t2 });
    return sample;
  }

  /** Samples still fresh at `now`. */
  samples(now: number): ClockSample[] {
    this.kept = this.kept.filter((s) => now - s.at <= CLOCK_MAX_AGE_MS);
    return this.kept.map(({ offset, rtt }) => ({ offset, rtt }));
  }

  /** The fastest round trip among the samples that agree with the others. */
  best(now: number): ClockSample | null {
    const all = this.samples(now);
    if (all.length < 3) return bestSample(all, BLE_MAX_CLOCK_RTT_MS);
    const mid = median(all.map((s) => s.offset));
    return bestSample(
      all.filter((s) => Math.abs(s.offset - mid) <= CLOCK_OUTLIER_MS + s.rtt / 2),
      BLE_MAX_CLOCK_RTT_MS,
    );
  }

  clear() {
    this.kept = [];
  }
}
