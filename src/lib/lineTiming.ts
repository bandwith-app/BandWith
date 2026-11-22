/**
 * Lyric lines for Follow the tempo, and `songs.line_timing` (migration 171):
 * where each line starts, stored in ticks (beats of the song's meter) from
 * the first beat of bar 1, so it survives a tempo change.
 *
 * A line is any non-blank line of the parsed lyrics (src/lib/lyrics.ts), in
 * order; a line of chords only counts too (it is on screen). The timing
 * carries a hash of the lyrics with chords and voice markers removed: when
 * the words change (a line added, removed or rewritten) the hash no longer
 * matches and the timing is ignored, so a stale timing never highlights
 * the wrong line. Changing chords keeps it.
 */
import { parseLyrics } from './lyrics';

export interface LiveLine {
  /** Section index in parseLyrics(). */
  section: number;
  /** Line index inside that section (blank lines included, as the reader renders them). */
  line: number;
  /** Words only: no [chords], no voice markers. */
  text: string;
}

export interface LineTiming {
  v: 1;
  /** lyricsHash() of the lyrics this was made for. */
  hash: string;
  /** Start of each line (liveLines order), in ticks from bar 1 beat 1. */
  at: number[];
  /** How it was made: tapping along with the recording, or bars per line. */
  mode: 'tap' | 'bars';
  /** Bars per line, kept to edit them again (mode 'bars'). */
  bars?: number[];
}

/** Voice part markers (plan §5.3): {bv}…{/bv}, {v2}, {all}, {sp}. */
const VOICE_MARKERS = /\{\/?(?:bv|v2|all|sp)\}/gi;
/** Inline chords: [Am], [F#m7b5/C#], [N.C.]. */
const INLINE_CHORDS = /\[[^\]\s]{1,16}\]/g;

export const lineWords = (line: string) => line.replace(VOICE_MARKERS, '').replace(INLINE_CHORDS, '').replace(/\s+/g, ' ').trim();

export function liveLines(lyrics: string | null | undefined): LiveLine[] {
  const out: LiveLine[] = [];
  parseLyrics(lyrics).forEach((s, si) =>
    s.lines.forEach((l, li) => {
      if (l.trim()) out.push({ section: si, line: li, text: lineWords(l) });
    }),
  );
  return out;
}

/** FNV-1a (32 bit) of the lines' words: short, stable, enough to notice an edit. */
export function lyricsHash(lyrics: string | null | undefined): string {
  const text = liveLines(lyrics)
    .map((l) => l.text.toLowerCase())
    .join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Earliest a line can start: a line sung in the pickup is before bar 1
 * (negative). 171 allows a pickup of up to 15 beats, at most 4 ticks each.
 */
export const MIN_LINE_TICK = -60;

/** A stored value, if it is a line timing (anything else: null). */
export function asLineTiming(v: unknown): LineTiming | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.v !== 1 || typeof o.hash !== 'string' || !Array.isArray(o.at)) return null;
  const at = o.at.filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x >= MIN_LINE_TICK);
  if (at.length !== o.at.length) return null;
  const bars = Array.isArray(o.bars) ? o.bars.filter((x): x is number => typeof x === 'number' && x > 0) : undefined;
  return { v: 1, hash: o.hash, at, mode: o.mode === 'bars' ? 'bars' : 'tap', ...(bars?.length ? { bars } : {}) };
}

/** The timing, when it still belongs to these lyrics (same words, one start per line, in order). */
export function validLineTiming(timing: unknown, lyrics: string | null | undefined): LineTiming | null {
  const t = asLineTiming(timing);
  if (!t) return null;
  if (t.hash !== lyricsHash(lyrics)) return null;
  if (t.at.length !== liveLines(lyrics).length) return null;
  for (let i = 1; i < t.at.length; i++) if (t.at[i] < t.at[i - 1]) return null;
  return t;
}

/** Bars per line → a timing (each line starts after the bars of the ones before). */
export function timingFromBars(lyrics: string, bars: number[], ticksPerBar: number): LineTiming {
  const at: number[] = [];
  bars.reduce((tick, b) => (at.push(tick), tick + Math.max(0, b) * ticksPerBar), 0);
  return { v: 1, hash: lyricsHash(lyrics), at, mode: 'bars', bars: [...bars] };
}
