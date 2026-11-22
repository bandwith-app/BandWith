/**
 * The count-in (plan live-offline-and-tempo §6): the leader taps "Count in"
 * and every phone in the band shows, at the same moment, a full-screen
 * countdown in the song's tempo and time signature, then GO on the beat the
 * band comes in.
 *
 * Like the click, the leader sends one state — "the count starts at <my
 * time> T, at N BPM, in 6/8, two bars, one beat of pickup" — and every phone
 * works out the count from it with its clock offset. A phone that gets the
 * message late joins on the right beat; Stop (on: false) ends it everywhere.
 *
 *   4/4 → 4 3 2 1 GO · 3/4 → 3 2 1 GO · 6/8 → 2 1 GO (eighths as dots)
 *   7/8 (2+2+3) → 3 2 1 GO, the last beat longer · pickup 1 in 4/4 → 4 3 2 GO
 *   2 bars (slow songs): the first in half time, "2 — 1 —", then 4 3 2 1
 *   style 'up': 1 2 3 4 GO
 *
 * Pure: no React, no clock.
 */
import { meterOf, tickMs, type Meter } from './meter';
import { nextSeq } from './stageLive';

/** Realtime broadcast event on the stage channel. */
export const COUNTIN_EVENT = 'countin';

/** The count starts this long after the leader's tap (the click uses 700 ms), so slow phones get it in time. */
export const COUNTIN_LEAD_MS = 1500;
/** GO stays on screen this long. */
export const GO_MS = 700;

export type CountInStyle = 'down' | 'up';

export interface CountInState {
  seq: number;
  from: string;
  /** setlist_songs row id. */
  songId: string | null;
  on: boolean;
  /** Song BPM (times the rehearsal speed). */
  bpm: number;
  /** Time signature ("6/8") and the chart's grouping of an odd bar. */
  time: string;
  groups: number[] | null;
  /** 1 or 2 (the first in half time). */
  bars: number;
  /** Counted beats before bar 1: GO comes that many beats early. */
  pickup: number;
  style: CountInStyle;
  /** First count, in the sender's clock (ms since epoch). */
  startAt: number;
}

export interface CountEvent {
  /** ms from startAt. */
  at: number;
  /** ms until the next event. */
  length: number;
  /** "4", "3"… or GO. */
  label: string;
  go: boolean;
  /** Count-in bar (0-based) and its number of counts. */
  bar: number;
  index: number;
  of: number;
  /** First count of a bar (stronger: vibration, sound). */
  downbeat: boolean;
  /** The half-time bar of a two-bar count-in. */
  half: boolean;
  /** Small dots inside this count (6/8: the three eighths; 7/8: two or three), 1 = none. */
  dots: number;
  /** Ticks this count lasts (7/8: short 2, long 3). */
  ticks: number;
}

export interface CountInPlan {
  meter: Meter;
  events: CountEvent[];
  /** GO, from startAt. */
  goAt: number;
  /** Bar 1 of the song starts here (GO plus the pickup), from startAt. */
  endAt: number;
  /** Length of one count-in bar. */
  barMs: number;
}

const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export function parseCountInState(payload: unknown): CountInState | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (!num(p.seq, 0, Number.MAX_SAFE_INTEGER) || typeof p.from !== 'string' || !p.from) return null;
  if (typeof p.on !== 'boolean' || !num(p.bpm, 20, 400) || !num(p.bars, 1, 2) || !num(p.pickup, 0, 15)) return null;
  if (typeof p.time !== 'string' || !/^\d{1,2}\/(1|2|4|8|16)$/.test(p.time)) return null;
  if (p.style !== 'down' && p.style !== 'up') return null;
  if (!num(p.startAt, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (p.songId !== null && typeof p.songId !== 'string') return null;
  let groups: number[] | null = null;
  if (p.groups != null) {
    if (!Array.isArray(p.groups) || !p.groups.every((g) => num(g, 1, 4))) return null;
    groups = (p.groups as number[]).map(Math.round);
  }
  return {
    seq: p.seq as number,
    from: p.from,
    songId: (p.songId as string | null) ?? null,
    on: p.on,
    bpm: p.bpm as number,
    time: p.time,
    groups,
    bars: Math.round(p.bars as number),
    pickup: Math.round(p.pickup as number),
    style: p.style,
    startAt: p.startAt as number,
  };
}

/** The leader's tap: a count-in for this song, starting COUNTIN_LEAD_MS from `now`. */
export function startCountIn(opts: {
  from: string;
  songId: string | null;
  bpm: number;
  meter: Meter;
  bars?: number | null;
  pickup?: number | null;
  style?: CountInStyle | null;
  now: number;
  prev?: { seq: number } | null;
}): CountInState {
  const beats = opts.meter.beats.length;
  return {
    seq: nextSeq(opts.prev?.seq),
    from: opts.from,
    songId: opts.songId,
    on: true,
    bpm: opts.bpm,
    time: opts.meter.time,
    groups: opts.meter.beats.some((b) => b !== opts.meter.beats[0]) ? [...opts.meter.beats] : null,
    bars: opts.bars === 2 ? 2 : 1,
    pickup: Math.max(0, Math.min(beats - 1, Math.round(opts.pickup ?? 0))),
    style: opts.style === 'up' ? 'up' : 'down',
    startAt: opts.now + COUNTIN_LEAD_MS,
  };
}

export const stopCountIn = (s: CountInState): CountInState => ({ ...s, seq: nextSeq(s.seq), on: false });

/** Every count of the count-in, and when GO and bar 1 come. */
export function countInPlan(state: Pick<CountInState, 'bpm' | 'time' | 'groups' | 'bars' | 'pickup' | 'style'>): CountInPlan {
  const meter = meterOf(state.time, state.groups);
  const tick = tickMs(meter, state.bpm);
  const barMs = meter.num * tick;
  const dotsOf = (len: number) => (meter.compound ? 3 : meter.den >= 8 ? len : 1);
  const events: CountEvent[] = [];
  const bars = state.bars === 2 ? 2 : 1;
  for (let b = 0; b < bars; b++) {
    const half = bars === 2 && b === 0;
    // Half time: every other counted beat when they pair up, else only the first.
    let counts = meter.beats.map((len, k) => ({ start: meter.starts[k], len }));
    if (half) {
      counts =
        counts.length % 2 === 0
          ? counts.filter((_, k) => k % 2 === 0).map((c, k) => ({ start: c.start, len: meter.beats[2 * k] + meter.beats[2 * k + 1] }))
          : [{ start: 0, len: meter.num }];
    }
    counts.forEach((c, k) =>
      events.push({
        at: b * barMs + c.start * tick,
        length: c.len * tick,
        label: String(state.style === 'up' ? k + 1 : counts.length - k),
        go: false,
        bar: b,
        index: k,
        of: counts.length,
        downbeat: k === 0,
        half,
        dots: half ? 1 : dotsOf(c.len),
        ticks: c.len,
      }),
    );
  }
  const endAt = bars * barMs;
  // Pickup: GO that many counted beats before bar 1, in place of those counts.
  const pickup = Math.max(0, Math.min(meter.beats.length - 1, state.pickup || 0));
  const pickupTicks = pickup ? meter.beats.slice(meter.beats.length - pickup).reduce((a, x) => a + x, 0) : 0;
  const goAt = endAt - pickupTicks * tick;
  const kept = events.filter((e) => e.at < goAt - 0.5);
  kept.push({
    at: goAt,
    length: GO_MS,
    label: 'GO',
    go: true,
    bar: bars - 1,
    index: kept.filter((e) => e.bar === bars - 1).length,
    of: kept.filter((e) => e.bar === bars - 1).length + 1,
    downbeat: !pickup,
    half: false,
    dots: 1,
    ticks: 0,
  });
  return { meter, events: kept, goAt, endAt, barMs };
}

export interface CountInPosition {
  /** Not started yet / counting / GO on screen / over. */
  stage: 'before' | 'count' | 'go' | 'done';
  /** Index in plan.events (-1 before). */
  event: number;
  /** 0…1 through the current count. */
  phase: number;
  /** 0…1 through the whole count-in (the ring), bar by bar: [bar, progress in it]. */
  bar: number;
  barProgress: number;
  /** ms until GO (negative after it). */
  toGo: number;
}

/** Where the count-in is at `now` (my clock) with the sender's offset (their clock minus mine). */
export function countInAt(plan: CountInPlan, state: Pick<CountInState, 'startAt'>, now: number, offset = 0): CountInPosition {
  const t = now + offset - state.startAt;
  const toGo = plan.goAt - t;
  if (t < 0) return { stage: 'before', event: -1, phase: 0, bar: 0, barProgress: 0, toGo };
  if (t >= plan.goAt + GO_MS && t >= plan.endAt) return { stage: 'done', event: plan.events.length - 1, phase: 1, bar: 0, barProgress: 1, toGo };
  let event = 0;
  for (let i = 0; i < plan.events.length; i++) if (plan.events[i].at <= t) event = i;
  const e = plan.events[event];
  const phase = e.length > 0 ? Math.min(1, (t - e.at) / e.length) : 1;
  const bar = Math.min(Math.floor(t / plan.barMs), Math.max(0, Math.round(plan.endAt / plan.barMs) - 1));
  const barProgress = Math.min(1, (t - bar * plan.barMs) / plan.barMs);
  return { stage: e.go ? 'go' : 'count', event, phase, bar, barProgress, toGo };
}

/** The headphone sound of each count (liveAudio.ts): the downbeat higher, GO the highest; a voice says the number. */
export function countInSounds(
  plan: CountInPlan,
  state: Pick<CountInState, 'seq' | 'startAt'>,
  offset: number,
  opts: { voice?: string | null },
): { key: string; at: number; sound: { kind: 'bar' | 'beat' } | { kind: 'voice'; word: string; lang: string } }[] {
  return plan.events.map((e, i) => ({
    key: `countin:${state.seq}:${i}`,
    // Their clock → mine.
    at: state.startAt + e.at - offset,
    sound: opts.voice && !e.go ? { kind: 'voice' as const, word: e.label, lang: opts.voice } : { kind: e.go || e.downbeat ? ('bar' as const) : ('beat' as const) },
  }));
}
