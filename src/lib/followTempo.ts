/**
 * Follow the tempo, on screen (plan §4.1–4.2): from where the playhead is
 * (playhead.ts) to what lights up — the chart cell, the section, the lyric
 * line — and the one line of status above the song ("Next: Bridge in 4
 * bars"). Also the other way round: the leader taps a bar, a line or a
 * section and gets the timeline bar to re-align to.
 *
 * The keys match the drawn song: a chart cell is "section:bar" of
 * chart.sections (ChordChart's data-cell), a lyric line is "section:line"
 * of parseLyrics (LyricsText's data-line), a lyric section its index.
 *
 * Pure: no React, no clock.
 */
import { liveLines, type LiveLine } from './lineTiming';
import { parseLyrics } from './lyrics';
import type { PlayheadPosition, PlayheadState, Timeline } from './playhead';
import { START_LEAD_MS } from './stageClick';

export interface FollowContext {
  timeline: Timeline;
  /** liveLines() of the lyrics on screen (timeline.lines' order). */
  lines: LiveLine[];
  /** Per timeline section: the lyric section played there (null: none, e.g. a solo). */
  lyricOf: (number | null)[];
  /** Per timeline section: the lyric lines that start in it. */
  ownLines: number[][];
  /** Per timeline section with no lines of its own: an earlier time through the same section that has them. */
  mirror: (number | null)[];
}

/** "Chorus x2" → 2 (as the timeline plays it). */
const timesOf = (name: string | null) => {
  const m = (name || '').match(/(?:\bx\s?(\d)|\b(\d)\s?x)\b/i);
  const n = m ? Number(m[1] || m[2]) : 1;
  return n >= 2 && n <= 8 ? n : 1;
};

/** A section's name as read on stage: "Chorus x2" → "Chorus". */
export const cleanLabel = (label: string | null) => (label ? label.replace(/\s*(?:\bx\s?\d|\b\d\s?x)\s*$/i, '').trim() || label : null);

export function followContext(timeline: Timeline, lyrics: string | null | undefined): FollowContext {
  const lines = liveLines(lyrics);
  const { sections } = timeline;
  const ownLines = sections.map((s) =>
    timeline.lines.flatMap((start, i) => (start >= s.start - 1e-9 && start < s.start + s.length - 1e-9 ? [i] : [])),
  );
  const mirror = sections.map((s, k) => {
    if (ownLines[k].length || !s.label) return null;
    for (let j = k - 1; j >= 0; j--) if (sections[j].label === s.label && ownLines[j].length) return j;
    return null;
  });
  let lyricOf: (number | null)[];
  if (timeline.source === 'lyrics') {
    // In order, each lyric section as many times as its "x2" says (buildTimeline's plan).
    const names = parseLyrics(lyrics).map((s) => s.name);
    let li = 0;
    let rep = 0;
    lyricOf = sections.map(() => {
      const here = li < names.length ? li : null;
      if (++rep >= timesOf(names[li] ?? null)) {
        li += 1;
        rep = 0;
      }
      return here;
    });
  } else {
    lyricOf = sections.map((_, k) => {
      const own = ownLines[k][0] ?? (mirror[k] != null ? ownLines[mirror[k]!][0] : undefined);
      return own != null ? lines[own]?.section ?? null : null;
    });
  }
  return { timeline, lines, lyricOf, ownLines, mirror };
}

export type FollowStatus =
  | { kind: 'starting' }
  | { kind: 'waiting' }
  | { kind: 'end' }
  | { kind: 'holding'; label: string | null }
  | { kind: 'last'; label: string | null }
  | { kind: 'next'; label: string | null; bars: number };

export interface FollowFrame {
  /** Chart cell being played ("section:bar"), null on a lyrics-only song. */
  cell: string | null;
  /** chart.sections index of the section being played. */
  chartSection: number | null;
  /** parseLyrics index of the lyric section being played. */
  lyricSection: number | null;
  /** Lyric line being sung ("section:line"), null between lines' sections (a solo). */
  line: string | null;
  /** The one line above the song. */
  status: FollowStatus;
  /** The section being played (its name), and for the floor wedge's countdown. */
  label: string | null;
  bar: number;
}

const lastStarted = (ids: number[], starts: number[], pos: number) => {
  let out = -1;
  for (const i of ids) if (starts[i] <= pos + 1e-9) out = i;
  return out;
};

/** The current line, reading a repeat's lines from its first time through. */
function lineIndex(ctx: FollowContext, pos: PlayheadPosition): number {
  const { timeline } = ctx;
  if (timeline.timedLines) return pos.line;
  const k = pos.section;
  const at = pos.bar + pos.phase;
  if (ctx.ownLines[k]?.length) {
    const i = lastStarted(ctx.ownLines[k], timeline.lines, at);
    return i >= 0 ? i : pos.line;
  }
  const j = ctx.mirror[k];
  if (j == null) return -1;
  const here = timeline.sections[k];
  const there = timeline.sections[j];
  const mapped = there.start + ((at - here.start) * there.length) / Math.max(1, here.length);
  const i = lastStarted(ctx.ownLines[j], timeline.lines, mapped);
  return i >= 0 ? i : ctx.ownLines[j][0];
}

export function followFrame(ctx: FollowContext, pos: PlayheadPosition, state: Pick<PlayheadState, 'hold'>): FollowFrame {
  const { timeline } = ctx;
  const bar = timeline.bars[pos.bar];
  const sec = timeline.sections[pos.section];
  const label = cleanLabel(sec?.label ?? null);
  const li = lineIndex(ctx, pos);
  const line = li >= 0 && ctx.lines[li] ? `${ctx.lines[li].section}:${ctx.lines[li].line}` : null;
  const chart = timeline.source === 'chart';
  let status: FollowStatus;
  if (pos.before) status = { kind: 'starting' };
  else if (pos.waiting) status = { kind: 'waiting' };
  else if (pos.done) status = { kind: 'end' };
  else if (state.hold) status = { kind: 'holding', label };
  else if (pos.next == null) status = { kind: 'last', label };
  else status = { kind: 'next', label: cleanLabel(timeline.sections[pos.next].label), bars: pos.barsToNext ?? 0 };
  return {
    cell: chart && bar ? `${bar.section}:${bar.bar}` : null,
    chartSection: chart && bar ? bar.section : null,
    lyricSection: ctx.lyricOf[pos.section] ?? null,
    line,
    status,
    label,
    bar: pos.bar,
  };
}

/** The candidate nearest to `near` (a tie: the later one). */
const nearest = (candidates: number[], near: number): number | null => {
  let best: number | null = null;
  for (const c of candidates) if (best === null || Math.abs(c - near) < Math.abs(best - near) || (Math.abs(c - near) === Math.abs(best - near) && c > best)) best = c;
  return best;
};

/** A tapped chart cell → the timeline bar it is played at, the time through nearest the current bar. */
export function barForCell(ctx: FollowContext, section: number, bar: number, near: number): number | null {
  const at = ctx.timeline.bars.flatMap((b, i) => (b.section === section && b.bar === bar && !b.part ? [i] : []));
  return nearest(at, near);
}

/** A tapped lyric line ("section:line") → the bar it starts in (also on a repeat that reads it). */
export function barForLine(ctx: FollowContext, key: string, near: number): number | null {
  const [s, l] = key.split(':').map(Number);
  const i = ctx.lines.findIndex((x) => x.section === s && x.line === l);
  if (i < 0) return null;
  const { timeline } = ctx;
  const start = timeline.lines[i];
  const home = timeline.sections.findIndex((_, k) => ctx.ownLines[k].includes(i));
  const at = [start];
  if (home >= 0) {
    const h = timeline.sections[home];
    timeline.sections.forEach((sec, k) => {
      if (ctx.mirror[k] === home) at.push(sec.start + ((start - h.start) * sec.length) / Math.max(1, h.length));
    });
  }
  return nearest(
    at.map((x) => Math.min(timeline.bars.length - 1, Math.floor(x + 1e-9))),
    near,
  );
}

/** A tapped section heading → its first bar (a chart section, or a lyric section). */
export function barForSection(ctx: FollowContext, which: { chart: number } | { lyric: number }, near: number): number | null {
  const { sections } = ctx.timeline;
  const at = sections.flatMap((s, k) => (('chart' in which ? ctx.timeline.source === 'chart' && s.section === which.chart : ctx.lyricOf[k] === which.lyric) ? [s.start] : []));
  return nearest(at, near);
}

/**
 * When the leader's Start begins bar 1: on the next downbeat of their own
 * running click (the band already plays to it), else after the network lead
 * and one bar to get ready.
 */
export function leaderStartAt(opts: { now: number; click: { on: boolean; bpm: number; beats: number; startAt: number } | null; barMs: number }): number {
  const earliest = opts.now + START_LEAD_MS;
  const c = opts.click;
  if (c?.on && c.bpm > 0 && c.beats > 0) {
    const bar = (c.beats * 60_000) / c.bpm;
    const k = Math.max(0, Math.ceil((earliest - c.startAt) / bar));
    return c.startAt + k * bar;
  }
  return earliest + opts.barMs;
}
