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
  bpm: number;
  /** Beats in a bar (the first one is accented). */
  beats: number;
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
export const MAX_CLICK_BPM = 300;
/** The leader starts this far ahead, so the others get the message before beat 0. */
export const START_LEAD_MS = 700;

const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export const parseClickState = (payload: unknown): ClickState | null => {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (!num(p.seq, 0, Number.MAX_SAFE_INTEGER) || typeof p.from !== 'string' || !p.from) return null;
  if (typeof p.on !== 'boolean' || !num(p.bpm, MIN_CLICK_BPM, MAX_CLICK_BPM) || !num(p.beats, 1, 16)) return null;
  if (p.bars !== null && !num(p.bars, 1, 64)) return null;
  if (!num(p.startAt, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (p.songId !== null && typeof p.songId !== 'string') return null;
  return {
    seq: p.seq as number,
    from: p.from,
    on: p.on,
    bpm: p.bpm as number,
    beats: Math.round(p.beats as number),
    bars: (p.bars as number | null) === null ? null : Math.round(p.bars as number),
    startAt: p.startAt as number,
    songId: (p.songId as string | null) ?? null,
  };
};

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
 * The offset to use for `leader`'s click: of the clocks measured against that
 * same leader, over any path, the one with the shortest round trip.
 */
export const pickClock = (leader: string | null, clocks: Array<PeerClock | null | undefined>): ClockSample | null =>
  leader ? fastest(clocks.flatMap((c) => (c && c.from === leader && c.sample ? [c.sample] : []))) : null;

export interface BeatPosition {
  /** Beat number from 0, or -1 before the start. */
  beat: number;
  /** 0…1 through the current beat. */
  phase: number;
  /** First beat of a bar. */
  downbeat: boolean;
  /** Beat in the bar, 1-based (for "1 2 3 4"). */
  count: number;
  /** A count-in has played out. */
  done: boolean;
}

/** Where the click is at `now` (my clock), given the leader's offset (their clock minus mine). */
export function beatAt(state: Pick<ClickState, 'bpm' | 'beats' | 'bars' | 'startAt'>, now: number, offset: number): BeatPosition {
  const period = 60000 / state.bpm;
  const elapsed = now + offset - state.startAt;
  if (elapsed < 0) return { beat: -1, phase: 0, downbeat: false, count: 0, done: false };
  const beat = Math.floor(elapsed / period);
  const done = state.bars != null && beat >= state.bars * state.beats;
  const inBar = beat % state.beats;
  return { beat, phase: (elapsed - beat * period) / period, downbeat: inBar === 0, count: inBar + 1, done };
}

/** Beats in a bar from a chart's time signature ("3/4" → 3, "6/8" → 6, "12/8" → 12); 4 otherwise. */
export const beatsInBar = (time?: string | null) => {
  const n = parseInt((time || '').split('/')[0], 10);
  return n >= 1 && n <= 16 ? n : 4;
};
