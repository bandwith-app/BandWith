/**
 * Follow the tempo: where the band is in the song, on every phone (plan §4).
 *
 * The leader sends a small state on the stage channel — "bar B starts at
 * <my time> T, at N BPM" — and every phone works out the current bar, beat,
 * section and lyric line from it with the clock offset the click already
 * measures (stageClick.ts), the same way the click works out its beats. No
 * beat is ever sent. The leader's taps (start, re-align, Hold, Stop) each
 * send a new state.
 *
 * The timeline is the song played out bar by bar: the chord chart's road map
 * (unrollChart), or, with no chart, the lyrics' sections (two bars a line,
 * stretched to the song's length when it is known; "Chorus x2" twice).
 *
 * Pure: no React, no channel.
 */
import type { SongChart } from './ireal';
import { parseLyrics } from './lyrics';
import { barMs, meterOf, songMeter, type Meter } from './meter';
import { parseSectionName } from './songFormat';
import { nextSeq } from './stageLive';
import { unrollChart, unrolledSections, type UnrolledSection } from './unrollChart';
import { liveLines, validLineTiming } from './lineTiming';

/** Realtime broadcast event on the stage channel. */
export const PLAYHEAD_EVENT = 'playhead';

export interface TimelineBar {
  /** Chart cell (ChordChart data-bar) or lyric section / bar in it. */
  section: number;
  bar: number;
  part?: 1;
  label: string | null;
  meter: Meter;
  /** Wait here for the leader (fermata, ad lib). */
  hold?: boolean;
}

export interface Timeline {
  source: 'chart' | 'lyrics';
  bars: TimelineBar[];
  sections: UnrolledSection[];
  /** Start of each lyric line (liveLines order) as a bar position (bar index + fraction); empty with no lyrics. */
  lines: number[];
  /** The lines come from the song's own timing (Sync lines), not a spread. */
  timedLines: boolean;
}

export interface TimelineSong {
  chart?: SongChart | null;
  lyrics?: string | null;
  timeSignature?: string | null;
  /** songs.duration_seconds: stretches a lyrics-only timeline to the song's length. */
  durationSeconds?: number | null;
  bpm?: number | null;
  lineTiming?: unknown;
}

const DEFAULT_BARS_PER_LINE = 2;
const timesOfName = (name: string | null) => {
  const m = (name || '').match(/(?:\bx\s?(\d)|\b(\d)\s?x)\b/i);
  const n = m ? Number(m[1] || m[2]) : 1;
  return n >= 2 && n <= 8 ? n : 1;
};

/** Bar position (index + fraction) of a tick count from the start, walking the bars' meters. */
export function tickToBar(bars: TimelineBar[], tick: number): number {
  let left = tick;
  for (let i = 0; i < bars.length; i++) {
    const n = bars[i].meter.num;
    if (left < n) return i + left / n;
    left -= n;
  }
  return bars.length;
}

export function buildTimeline(song: TimelineSong): Timeline | null {
  const meter = songMeter({ timeSignature: song.timeSignature, chart: song.chart });
  const lyricSections = parseLyrics(song.lyrics);
  const lines = liveLines(song.lyrics);
  let bars: TimelineBar[] = [];
  let source: Timeline['source'] = 'chart';
  /** Lyric section index → where its lines go: [first bar, bars] per occurrence. */
  let lyricSpans: { lyric: number; start: number; length: number }[] = [];

  const played = unrollChart(song.chart, { time: song.timeSignature });
  if (played.length) {
    bars = played.map((b) => ({
      section: b.section,
      bar: b.bar,
      ...(b.part ? { part: b.part } : {}),
      label: b.label,
      meter: b.time === meter.time ? meter : meterOf(b.time),
      ...(b.hold ? { hold: true } : {}),
    }));
  } else if (lyricSections.length) {
    source = 'lyrics';
    // Two bars a line; stretched (or shrunk) to the song's length when it has one.
    const plan = lyricSections.flatMap((s, si) => {
      const count = Math.max(1, s.lines.filter((l) => l.trim()).length);
      return Array.from({ length: timesOfName(s.name) }, () => ({ si, name: s.name, bars: count * DEFAULT_BARS_PER_LINE }));
    });
    const total = plan.reduce((n, p) => n + p.bars, 0);
    const fit = song.durationSeconds && song.bpm ? Math.round((song.durationSeconds * 1000) / barMs(meter, song.bpm)) : 0;
    const scale = fit >= plan.length && total ? fit / total : 1;
    let at = 0;
    plan.forEach((p, k) => {
      const n = Math.max(1, Math.round(p.bars * scale));
      for (let j = 0; j < n; j++) bars.push({ section: k, bar: j, label: p.name, meter });
      lyricSpans.push({ lyric: p.si, start: at, length: n });
      at += n;
    });
  } else {
    return null;
  }

  const sections =
    source === 'chart'
      ? unrolledSections(played)
      : lyricSpans.map((s, k) => ({ label: bars[s.start].label, section: k, start: s.start, length: s.length }));

  // Lyric lines on the bars.
  let starts: number[] = [];
  const timing = validLineTiming(song.lineTiming, song.lyrics);
  if (timing) {
    starts = timing.at.map((tick) => tickToBar(bars, tick));
  } else if (lines.length) {
    if (source === 'chart') lyricSpans = matchLyricsToChart(lyricSections.map((s) => s.name), sections, bars.length, lyricSections.map((s) => s.lines.filter((l) => l.trim()).length));
    starts = spreadLines(lines, lyricSpans);
  }
  return { source, bars, sections, lines: starts, timedLines: !!timing };
}

/**
 * Where the lyric sections fall on the chart: in order, each named section on
 * the next chart section of the same kind (Verse ↔ Verse or A…). When a name
 * doesn't match, the lyrics are spread over the whole chart by line count.
 */
function matchLyricsToChart(names: (string | null)[], sections: UnrolledSection[], totalBars: number, counts: number[]) {
  const spans: { lyric: number; start: number; length: number }[] = [];
  let cursor = 0;
  let all = names.length > 0;
  names.forEach((name, li) => {
    if (!all) return;
    const kind = name ? parseSectionName(name).kind : null;
    const k = kind ? sections.findIndex((s, i) => i >= cursor && !!s.label && parseSectionName(s.label, { letters: true }).kind === kind) : -1;
    if (k < 0) {
      all = false;
      return;
    }
    spans.push({ lyric: li, start: sections[k].start, length: sections[k].length });
    cursor = k + 1;
  });
  if (all) return spans;
  // By line count over the whole chart.
  const lines = counts.reduce((a, b) => a + Math.max(1, b), 0) || 1;
  let at = 0;
  return names.map((_, li) => {
    const length = (totalBars * Math.max(1, counts[li])) / lines;
    const span = { lyric: li, start: at, length };
    at += length;
    return span;
  });
}

/** Each line's start: the lines of a section evenly over its bars (first occurrence only). */
function spreadLines(lines: ReturnType<typeof liveLines>, spans: { lyric: number; start: number; length: number }[]): number[] {
  const first = new Map<number, { start: number; length: number }>();
  for (const s of spans) if (!first.has(s.lyric)) first.set(s.lyric, s);
  const bySection = new Map<number, number>();
  lines.forEach((l) => bySection.set(l.section, (bySection.get(l.section) ?? 0) + 1));
  const seen = new Map<number, number>();
  let last = 0;
  return lines.map((l) => {
    const span = first.get(l.section);
    const k = seen.get(l.section) ?? 0;
    seen.set(l.section, k + 1);
    if (!span) return last;
    last = span.start + (span.length * k) / (bySection.get(l.section) ?? 1);
    return last;
  });
}

// ── The shared state ───────────────────────────────────────────────────────

export interface PlayheadState {
  seq: number;
  from: string;
  /** setlist_songs row id: another song means it no longer applies. */
  songId: string | null;
  on: boolean;
  /** BPM played (the song's, times the rehearsal speed). */
  bpm: number;
  /** Rehearsal speed, 0.5…1 ("Play at 80%"); the song's BPM is unchanged. */
  speed: number;
  /** Timeline bar that starts at `startAt`. */
  bar: number;
  /** In the sender's clock (ms since epoch). */
  startAt: number;
  /** Bars looped while Hold is on: [first, last]. */
  hold: [number, number] | null;
}

const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export function parsePlayheadState(payload: unknown): PlayheadState | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (!num(p.seq, 0, Number.MAX_SAFE_INTEGER) || typeof p.from !== 'string' || !p.from) return null;
  if (typeof p.on !== 'boolean' || !num(p.bpm, 10, 400) || !num(p.speed, 0.25, 2) || !num(p.bar, 0, 4000)) return null;
  if (!num(p.startAt, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (p.songId !== null && typeof p.songId !== 'string') return null;
  let hold: [number, number] | null = null;
  if (p.hold != null) {
    const h = p.hold as unknown[];
    if (!Array.isArray(h) || h.length !== 2 || !num(h[0], 0, 4000) || !num(h[1], h[0] as number, 4000)) return null;
    hold = [Math.round(h[0] as number), Math.round(h[1] as number)];
  }
  return {
    seq: p.seq as number,
    from: p.from,
    songId: (p.songId as string | null) ?? null,
    on: p.on,
    bpm: p.bpm as number,
    speed: p.speed as number,
    bar: Math.round(p.bar as number),
    startAt: p.startAt as number,
    hold,
  };
}

// ── Where the playhead is ──────────────────────────────────────────────────

export interface PlayheadPosition {
  /** Timeline bar (clamped to the song) and how far through it, 0…1. */
  bar: number;
  phase: number;
  /** Counted beat in the bar, 0-based (meter.beats). */
  beat: number;
  /** The start time has not come yet (the count-in is still running). */
  before: boolean;
  /** Waiting on a fermata / ad lib bar until the leader taps. */
  waiting: boolean;
  /** Past the last bar. */
  done: boolean;
  /** Index in timeline.sections. */
  section: number;
  /** The next section, and how many bars until it starts (counting this one). */
  next: number | null;
  barsToNext: number | null;
  /** Current lyric line (liveLines index), -1 before the first. */
  line: number;
}

const startsCache = new WeakMap<Timeline, Map<number, number[]>>();

/** Start of every bar in ms from bar 0 at `bpm` (one more entry: the end). */
export function barStarts(timeline: Timeline, bpm: number): number[] {
  let byBpm = startsCache.get(timeline);
  if (!byBpm) startsCache.set(timeline, (byBpm = new Map()));
  const hit = byBpm.get(bpm);
  if (hit) return hit;
  const out = [0];
  for (const b of timeline.bars) out.push(out[out.length - 1] + barMs(b.meter, bpm));
  byBpm.set(bpm, out);
  return out;
}

const findBar = (starts: number[], t: number) => {
  let lo = 0;
  let hi = starts.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

export const sectionOf = (timeline: Timeline, bar: number) => {
  let k = 0;
  timeline.sections.forEach((s, i) => {
    if (s.start <= bar) k = i;
  });
  return k;
};

/** Where the playhead is at `now` (my clock), with the sender's offset (their clock minus mine). */
export function playheadAt(timeline: Timeline, state: Pick<PlayheadState, 'bpm' | 'bar' | 'startAt' | 'hold'>, now: number, offset = 0): PlayheadPosition {
  const starts = barStarts(timeline, state.bpm);
  const n = timeline.bars.length;
  const from = Math.min(Math.max(0, state.bar), n - 1);
  const elapsed = now + offset - state.startAt;
  let before = false;
  let waiting = false;
  let done = false;
  let t = starts[from] + Math.max(0, elapsed);
  if (elapsed < 0) before = true;

  // Hold: the held bars again and again.
  const hold = state.hold && state.hold[0] <= from && from <= state.hold[1] ? state.hold : null;
  if (hold) {
    const a = starts[hold[0]];
    const b = starts[Math.min(n, hold[1] + 1)];
    if (t >= b && b > a) t = a + ((t - a) % (b - a));
  }
  // A fermata / ad lib bar on the way: stop at its end until the leader taps.
  if (!hold) {
    for (let i = from; i < n; i++) {
      if (starts[i] > t) break;
      if (timeline.bars[i].hold && t >= starts[i + 1]) {
        t = starts[i + 1] - 1e-6;
        waiting = true;
        break;
      }
    }
  }
  if (t >= starts[n]) {
    t = starts[n] - 1e-6;
    done = true;
  }
  const bar = findBar(starts, t);
  const len = starts[bar + 1] - starts[bar];
  const phase = len > 0 ? Math.min(1, (t - starts[bar]) / len) : 0;
  const m = timeline.bars[bar].meter;
  const tick = phase * m.num;
  let beat = 0;
  m.starts.forEach((s, i) => {
    if (s <= tick) beat = i;
  });
  const section = sectionOf(timeline, bar);
  const nextSec = section + 1 < timeline.sections.length ? section + 1 : null;
  const pos = bar + phase;
  let line = -1;
  timeline.lines.forEach((s, i) => {
    if (s <= pos + 1e-9) line = i;
  });
  return {
    bar,
    phase,
    beat,
    before,
    waiting,
    done,
    section,
    next: nextSec,
    barsToNext: nextSec == null ? null : timeline.sections[nextSec].start - bar,
    line,
  };
}

// ── The leader's taps ──────────────────────────────────────────────────────

/** Start playing from `bar` at `startAt` (the count-in's GO, or now). */
export function startPlayhead(opts: { from: string; songId: string | null; bpm: number; speed?: number; startAt: number; bar?: number; prev?: PlayheadState | null }): PlayheadState {
  const speed = opts.speed ?? 1;
  return {
    seq: nextSeq(opts.prev?.seq),
    from: opts.from,
    songId: opts.songId,
    on: true,
    bpm: Math.round(opts.bpm * speed * 100) / 100,
    speed,
    bar: Math.max(0, opts.bar ?? 0),
    startAt: opts.startAt,
    hold: null,
  };
}

/** The same position, written from the start of the current bar (so the next change keeps it). */
function rebase(timeline: Timeline, state: PlayheadState, now: number): Pick<PlayheadState, 'bar' | 'startAt'> {
  const pos = playheadAt(timeline, state, now, 0);
  if (pos.before) return { bar: state.bar, startAt: state.startAt };
  const starts = barStarts(timeline, state.bpm);
  const len = starts[pos.bar + 1] - starts[pos.bar];
  return { bar: pos.bar, startAt: now - pos.phase * len };
}

/** "We are at the start of bar `bar` now" (a tap on a bar, a line or a section). Hold ends unless the bar is in it. */
export function realign(state: PlayheadState, bar: number, now: number, timeline: Timeline): PlayheadState {
  const b = Math.min(Math.max(0, bar), timeline.bars.length - 1);
  const hold = state.hold && state.hold[0] <= b && b <= state.hold[1] ? state.hold : null;
  return { ...state, seq: nextSeq(state.seq), on: true, bar: b, startAt: now, hold };
}

/** Hold: repeat the current section until released. */
export function holdSection(state: PlayheadState, now: number, timeline: Timeline): PlayheadState {
  const at = rebase(timeline, state, now);
  const s = timeline.sections[sectionOf(timeline, at.bar)];
  return { ...state, ...at, seq: nextSeq(state.seq), hold: [s.start, s.start + s.length - 1] };
}

export function releaseHold(state: PlayheadState, now: number, timeline: Timeline): PlayheadState {
  return { ...state, ...rebase(timeline, state, now), seq: nextSeq(state.seq), hold: null };
}

/** Past a fermata / ad lib: the next bar starts now. */
export function continuePlayhead(state: PlayheadState, now: number, timeline: Timeline): PlayheadState {
  const pos = playheadAt(timeline, state, now, 0);
  return realign({ ...state, hold: null }, pos.waiting ? pos.bar + 1 : pos.bar, now, timeline);
}

/** Another speed (rehearsals): same place, new BPM. */
export function setPlayheadSpeed(state: PlayheadState, songBpm: number, speed: number, now: number, timeline: Timeline): PlayheadState {
  const pos = playheadAt(timeline, state, now, 0);
  const bpm = Math.round(songBpm * speed * 100) / 100;
  if (pos.before) return { ...state, seq: nextSeq(state.seq), bpm, speed };
  const starts = barStarts(timeline, bpm);
  const len = starts[pos.bar + 1] - starts[pos.bar];
  return { ...state, seq: nextSeq(state.seq), bpm, speed, bar: pos.bar, startAt: now - pos.phase * len };
}

export function stopPlayhead(state: PlayheadState): PlayheadState {
  return { ...state, seq: nextSeq(state.seq), on: false, hold: null };
}

/** The song can follow the tempo: a BPM and something to follow (a chart, or lyrics). */
export const canFollow = (song: TimelineSong) => !!song.bpm && song.bpm > 0 && (!!song.chart?.sections?.length || parseLyrics(song.lyrics).length > 0);
