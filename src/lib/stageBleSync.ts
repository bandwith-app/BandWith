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
 * plugin itself, at once, with its clock at that moment, 72 bytes:
 *   [0] version (3)  [1] type 2
 *   [2..7]   t1: the leader's clock, in 0.1 ms units (the same clock the
 *            leader's app uses for `startAt`)
 *   [8..71]  the leader's signature over bytes 0..7 (ECDSA P-256, r‖s, the
 *            gig's key pair, migration 190): a member can't shift the clock
 * (Read by offset when the MTU is small; the round trip is still brief.)
 *
 * Why reads, not a written ping: on Android the Bluetooth LE plugin's write
 * throws an uncaught exception, and the app crashes, if Bluetooth turns off
 * while it goes out (seen on the emulator; airplane mode does exactly that).
 * Reads fail cleanly. A read's answer belongs to that read; a replayed old
 * answer among real ones is far from the others and is filtered out.
 *
 * Residual risk, left for a later release (review of #288): the answer has
 * no member nonce, since a nonce means a member write, the crash above.
 * Offline, a nearby phone running a modified app can delay the click without
 * limit: it plays back signed clock answers it recorded, as late as it likes
 * (it can't make new ones). Online it is cancelled by Realtime: a Bluetooth
 * clock more than BLE_CLOCK_AGREE_MS (30 ms) off the Realtime one for the
 * same leader is dropped (pickClock, stageClick.ts). Fix once a write is
 * safe: the member writes 8 random bytes, the leader signs t1 with them.
 *
 * Then the NTP-style maths of the Realtime click (clockSample / bestSample).
 */
import { SIGNATURE_BYTES, signBytes, verifyBytes } from './stageSign';
import { bestSample, clockSample, type ClockSample } from './stageClick';

export const STAGE_BLE_SYNC_VERSION = 3;
/**
 * The leader's clock, one fresh signed reading per read (same for every gig).
 * Not b7d50002: builds from main between #265 and #288 (never released) read
 * a 16-byte band-key clock there. Nothing is served on it now, so such a
 * build sees a leader with no clock (the song still syncs) and can't be fed
 * a member's clock.
 */
export const STAGE_BLE_CLOCK_CHARACTERISTIC = 'b7d50005-5b1e-4c6a-9b3d-6e0a2f7c1d42';
/** The live frame (click, count-in, playhead): read + notify, filled in B3. */
export const STAGE_BLE_LIVE_CHARACTERISTIC = 'b7d50003-5b1e-4c6a-9b3d-6e0a2f7c1d42';

export const SYNC_CLOCK = 2;

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

/** The leader's clock reading (built natively in the apps; here for the tests and the spec). `signKey`: PKCS#8. */
export async function encodeClock(t1: number, signKey: string): Promise<Uint8Array> {
  const body = new Uint8Array(CLOCK_BODY);
  const view = new DataView(body.buffer);
  body[0] = STAGE_BLE_SYNC_VERSION;
  body[1] = SYNC_CLOCK;
  const ticks = Math.round(t1 * TICKS_PER_MS);
  view.setUint16(2, Math.floor(ticks / 2 ** 32));
  view.setUint32(4, ticks >>> 0);
  const out = new Uint8Array(CLOCK_BODY + SIGNATURE_BYTES);
  out.set(body);
  out.set(await signBytes(signKey, body), CLOCK_BODY);
  return out;
}

/** The leader's clock from a checked frame, or null (wrong version or type, not the leader's signature). */
export async function decodeClock(bytes: Uint8Array, publicKey: string): Promise<number | null> {
  if (bytes.length !== CLOCK_BODY + SIGNATURE_BYTES || bytes[0] !== STAGE_BLE_SYNC_VERSION || bytes[1] !== SYNC_CLOCK) return null;
  if (!(await verifyBytes(publicKey, bytes.slice(0, CLOCK_BODY), bytes.slice(CLOCK_BODY)))) return null;
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
    if (all.length < 3) return bestSample(all);
    const mid = median(all.map((s) => s.offset));
    return bestSample(all.filter((s) => Math.abs(s.offset - mid) <= CLOCK_OUTLIER_MS + s.rtt / 2));
  }

  clear() {
    this.kept = [];
  }
}
