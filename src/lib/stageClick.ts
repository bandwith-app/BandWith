import { tickBpm, type Meter } from './meter';

/**
 * Visual metronome in Stage mode, kept in step across the band's phones.
 *
 * Phones' clocks differ by tens or hundreds of milliseconds, so the leader
 * doesn't send beats (they would arrive late and uneven). It sends once:
 * "the click starts at <my time> T, at B BPM". Every other app measures how
 * far its clock is from the leader's (a few ping/pong round trips on the
 * gig's live channel, the fastest one wins, like NTP) and works out beat n
 * at T + n·60/B in its own time. Good to about ±20–40 ms on a decent
 * connection: right for a count-in and a tempo reference, not for an in-ear
 * click.
 */

/** Realtime broadcast events on the stage channel (stageTopic, migration 085). */
export const CLICK_EVENT = 'click';
export const PING_EVENT = 'click-ping';
export const PONG_EVENT = 'click-pong';
/**
 * Answers to members' pings from the clock topic (migration 191), which any
 * band member may write, in anyone's name. Released apps take any PONG_EVENT
 * addressed to them, ping sent or not, so these go out under a name they
 * don't listen to (Codex on #283). Pings from the admins-only stage topic are
 * still answered with PONG_EVENT, as older apps expect.
 */
export const CLOCK_PONG_EVENT = 'click-pong-2';

export interface ClickState {
  /** Lamport clock, as for the stage state. */
  seq: number;
  from: string;
  on: boolean;
  /** Ticks a minute (the 6/8 the admin set at a dotted 120: 360). */
  bpm: number;
  /**
   * Ticks in a bar (the first one is accented). For 4/4 the four beats; for
   * 6/8 the six eighths and 7/8 the seven, grouped by `groups`.
   */
  beats: number;
  /**
   * How the ticks are counted (meter.ts): 6/8 → [3, 3], 7/8 → [2, 2, 3].
   * A group's first tick is a beat, the others are the small ones. Absent
   * (older apps, simple meters): every tick is a beat.
   */
  groups?: number[] | null;
  /** Bars to play, then stop on its own (a count-in); null until stopped. */
  bars: number | null;
  /** Beat 0, in the sender's clock (ms since epoch). */
  startAt: number;
  /** setlist_songs row id the click belongs to: another song means it no longer shows. */
  songId: string | null;
}

/** Wall-clock ms with sub-ms steps (smooth for the metronome); the clock every offset refers to. */
export const nowMs = () => performance.timeOrigin + performance.now();

export const MIN_CLICK_BPM = 30;
/** A song's BPM, and what builds before live mode accept in `bpm` on the wire. */
export const MAX_CLICK_BPM = 300;
/**
 * Ticks a minute, only in the wire's `tick` (new builds): a 12/8 at a dotted
 * 120 ticks at 360, a 7/16 at 250 at 1000; 300 quarters in sixteenths at most.
 */
export const MAX_CLICK_TICKS = 1200;
/** The leader starts this far ahead, so the others get the message before beat 0. */
export const START_LEAD_MS = 700;

const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** `groups` that add up to `beats`, else null. */
const parseGroups = (g: unknown, beats: number): number[] | null => {
  if (!Array.isArray(g) || !g.length || !g.every((x) => num(x, 1, 4))) return null;
  const out = (g as number[]).map(Math.round);
  return out.reduce((a, b) => a + b, 0) === beats ? out : null;
};

/**
 * Reads a click message. Builds before live mode send (and accept) only
 * `bpm` 30–300 and `beats`, every tick a beat. Live mode adds `tick` (the
 * real ticks a minute, ticks a bar and their groups), which those builds
 * ignore: when it is there and sound, it wins.
 */
export const parseClickState = (payload: unknown): ClickState | null => {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (!num(p.seq, 0, Number.MAX_SAFE_INTEGER) || typeof p.from !== 'string' || !p.from) return null;
  if (typeof p.on !== 'boolean' || !num(p.bpm, MIN_CLICK_BPM, MAX_CLICK_BPM) || !num(p.beats, 1, 16)) return null;
  if (p.bars !== null && !num(p.bars, 1, 64)) return null;
  if (!num(p.startAt, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (p.songId !== null && typeof p.songId !== 'string') return null;
  let bpm = p.bpm as number;
  let beats = Math.round(p.beats as number);
  let groups: number[] | null = null;
  const tick = p.tick as Record<string, unknown> | null | undefined;
  if (tick && typeof tick === 'object' && num(tick.bpm, MIN_CLICK_BPM, MAX_CLICK_TICKS) && num(tick.beats, 1, 16)) {
    const tb = Math.round(tick.beats as number);
    const tg = tick.groups == null ? null : parseGroups(tick.groups, tb);
    if (tick.groups == null || tg) {
      bpm = tick.bpm as number;
      beats = tb;
      groups = tg;
    }
  }
  return {
    seq: p.seq as number,
    from: p.from,
    on: p.on,
    bpm,
    beats,
    bars: (p.bars as number | null) === null ? null : Math.round(p.bars as number),
    startAt: p.startAt as number,
    songId: (p.songId as string | null) ?? null,
    ...(groups ? { groups } : {}),
  };
};

/**
 * What builds before live mode can play of a click: `bpm` 30–300, every
 * tick a beat, the same bar length. Even groups (6/8, 12/8) → the counted
 * beats; else the ticks if they fit; else one click a bar.
 */
function legacyClick(bpm: number, beats: number, groups: number[] | null | undefined): { bpm: number; beats: number } {
  const fits = (b: number) => b >= MIN_CLICK_BPM && b <= MAX_CLICK_BPM;
  const g = groups?.length ? groups[0] : 1;
  if (groups?.length && g > 1 && groups.every((x) => x === g) && fits(bpm / g)) return { bpm: round2(bpm / g), beats: groups.length };
  if (fits(bpm)) return { bpm, beats };
  return { bpm: round2(Math.min(MAX_CLICK_BPM, Math.max(MIN_CLICK_BPM, bpm / beats))), beats: 1 };
}

/**
 * The message for a click: the old fields as builds before live mode read
 * them, plus `tick` when the click is more than they can say.
 */
export function clickWire(state: ClickState): Record<string, unknown> {
  const { groups, ...rest } = state;
  const old = legacyClick(state.bpm, state.beats, groups);
  if (!groups?.length && old.bpm === state.bpm && old.beats === state.beats) return { ...rest };
  return { ...rest, ...old, tick: { bpm: state.bpm, beats: state.beats, ...(groups?.length ? { groups: [...groups] } : {}) } };
}

/** One ping/pong: sent at t0 (mine), answered at t1 (theirs), back at t2 (mine). */
export interface ClockSample {
  /** Their clock minus mine. */
  offset: number;
  rtt: number;
}

export const clockSample = (t0: number, t1: number, t2: number): ClockSample => ({ offset: t1 - (t0 + t2) / 2, rtt: Math.max(0, t2 - t0) });

/**
 * The slowest round trip a clock sample may take. A slower one is too vague to
 * keep a click in time, and may be someone answering an old ping late: a
 * bandmate re-sending this phone's ping seconds later would shift its clock.
 */
export const MAX_CLOCK_RTT_MS = 500;

/** Bluetooth reads have a ceiling of their own: a slow link answers within the read's 2 s timeout. */
export const BLE_MAX_CLOCK_RTT_MS = 2_000;
/**
 * With nothing under the ceiling, this many samples make the fastest one
 * usable: a slow network answers every ping slowly, a late replay is one
 * answer. Better than no measure at all (the click then runs on this phone's
 * own clock).
 */
export const SLOW_SAMPLES_MIN = 3;

const fastest = (samples: ClockSample[]) => samples.reduce<ClockSample | null>((best, s) => (!best || s.rtt < best.rtt ? s : best), null);

/**
 * The sample with the shortest round trip is the least distorted by the
 * network: the fastest under `maxRtt`, else (SLOW_SAMPLES_MIN or more) the
 * fastest of all.
 */
export const bestSample = (samples: ClockSample[], maxRtt: number = MAX_CLOCK_RTT_MS): ClockSample | null =>
  fastest(samples.filter((s) => s.rtt <= maxRtt)) ?? (samples.length >= SLOW_SAMPLES_MIN ? fastest(samples) : null);

/** A clock measured against one leader (their clientId), over one path (Realtime or Bluetooth). */
export interface PeerClock {
  from: string | null;
  sample: ClockSample | null;
}

/**
 * Online, a Bluetooth clock further from the Realtime one for the same
 * leader than both measures can be off (half of each round trip, and never
 * less than this) is dropped. A nearby phone can delay a recorded clock answer
 * (there is no member nonce yet, stageBleSync.ts); Realtime can't be
 * replayed that way, so it wins. Within it, the faster round trip is used.
 */
export const BLE_CLOCK_AGREE_MS = 30;
/** However slow the round trips, two measures further apart than this don't agree (Claude on #288). */
export const BLE_CLOCK_AGREE_MAX_MS = 80;

/**
 * The offset to use for `leader`'s click: the clock measured against that
 * same leader over Realtime or Bluetooth with the shortest round trip, but
 * Realtime's whenever the Bluetooth one disagrees with it by more than both
 * measures can be off (half of each round trip, BLE_CLOCK_AGREE_MS at least).
 */
export const pickClock = (leader: string | null, realtime: PeerClock | null | undefined, bluetooth: PeerClock | null | undefined): ClockSample | null => {
  if (!leader) return null;
  const rt = realtime?.from === leader ? realtime.sample : null;
  const bt = bluetooth?.from === leader ? bluetooth.sample : null;
  if (rt && bt) {
    // Each measure may be off by up to half its round trip: they agree within the sum of those
    // (Claude on #288), never more than BLE_CLOCK_AGREE_MAX_MS (a slow link can't make any two agree).
    const agree = Math.min(BLE_CLOCK_AGREE_MAX_MS, Math.max(BLE_CLOCK_AGREE_MS, rt.rtt / 2 + bt.rtt / 2));
    return Math.abs(bt.offset - rt.offset) > agree || rt.rtt <= bt.rtt ? rt : bt;
  }
  return rt ?? bt;
};

export interface BeatPosition {
  /** Beat number from 0, or -1 before the start. */
  beat: number;
  /** 0…1 through the current beat. */
  phase: number;
  /** First beat of a bar. */
  downbeat: boolean;
  /** Beat in the bar, 1-based (for "1 2 3 4"); with groups, the counted beat (6/8: 1 or 2). */
  count: number;
  /** A counted beat starts on this tick (always, without groups). */
  onBeat: boolean;
  /** A count-in has played out. */
  done: boolean;
}

/** Where the click is at `now` (my clock), given the leader's offset (their clock minus mine). */
export function beatAt(state: Pick<ClickState, 'bpm' | 'beats' | 'bars' | 'startAt' | 'groups'>, now: number, offset: number): BeatPosition {
  const period = 60000 / state.bpm;
  const elapsed = now + offset - state.startAt;
  if (elapsed < 0) return { beat: -1, phase: 0, downbeat: false, count: 0, onBeat: false, done: false };
  const beat = Math.floor(elapsed / period);
  const done = state.bars != null && beat >= state.bars * state.beats;
  const inBar = beat % state.beats;
  let count = inBar + 1;
  let onBeat = true;
  if (state.groups?.length) {
    let at = 0;
    count = 0;
    onBeat = false;
    for (const g of state.groups) {
      if (inBar < at) break;
      count += 1;
      onBeat = inBar === at;
      at += g;
    }
  }
  return { beat, phase: (elapsed - beat * period) / period, downbeat: inBar === 0, count, onBeat, done };
}

/**
 * The click for a song: its meter's ticks at the song's BPM (meter.ts, BPM
 * 30–300), counted in its groups. A song with no time signature of its own
 * clicks as it always did: every tick a beat at the BPM, no groups.
 */
export function clickForSong(bpm: number, meter: Meter): { bpm: number; beats: number; groups: number[] | null } {
  const songBpm = Math.min(MAX_CLICK_BPM, Math.max(MIN_CLICK_BPM, bpm));
  if (meter.perTick) return { bpm: round2(songBpm), beats: meter.num, groups: null };
  const grouped = meter.beats.some((b) => b > 1);
  return { bpm: round2(Math.min(MAX_CLICK_TICKS, tickBpm(meter, songBpm))), beats: meter.num, groups: grouped ? [...meter.beats] : null };
}

/** Beats in a bar from a chart's time signature ("3/4" → 3, "6/8" → 6, "12/8" → 12); 4 otherwise. */
export const beatsInBar = (time?: string | null) => {
  const n = parseInt((time || '').split('/')[0], 10);
  return n >= 1 && n <= 16 ? n : 4;
};
