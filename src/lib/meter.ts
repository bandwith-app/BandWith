/**
 * Time signatures for live mode: how a bar is counted and how long it lasts
 * at the song's BPM (Follow the tempo, count-in, click).
 *
 * A bar is `num` ticks of the `den` note (7/8 = seven eighths). The counted
 * beats group those ticks the way musicians count them:
 *   4/4 → 1 1 1 1 · 3/4 → 1 1 1 · 5/4 → 1 1 1 1 1
 *   6/8 → 3 3 (two dotted beats) · 12/8 → 3 3 3 3 · 9/8 → 3 3 3
 *   7/8 → 2 2 3 (or the chart's own "2+3+2") · 5/8 → 2 3
 *
 * What the BPM counts: the beat you feel.
 *   x/4 and x/2: the quarter (half) note, as always;
 *   compound 3/8, 6/8, 9/8, 12/8: the dotted beat (the "1 2" of a 6/8);
 *   odd /8 and /16 (5/8, 7/8, 11/16): the quarter note, so a 7/8 at 120
 *   lasts 3.5 quarters (1.75 s).
 */

export interface Meter {
  /** As written, normalised: "7/8". */
  time: string;
  num: number;
  den: number;
  /** Counted beats in the bar, each as its length in ticks (they add up to `num`). */
  beats: number[];
  /** Three ticks per counted beat (6/8, 12/8): the eighths shown as small dots. */
  compound: boolean;
  /** Ticks counted beat by beat from 1 (cumulative starts of `beats`). */
  starts: number[];
}

export const DEFAULT_TIME = '4/4';
const TIME_RE = /^\s*(\d{1,2})\s*\/\s*(1|2|4|8|16)\s*$/;

/** "6/8" → "6/8"; "  3 / 4 " → "3/4"; anything else → null. */
export function normalizeTime(time: string | null | undefined): string | null {
  const m = (time || '').match(TIME_RE);
  if (!m) return null;
  const num = Number(m[1]);
  if (num < 1 || num > 16) return null;
  return `${num}/${m[2]}`;
}

/** "2+2+3" (the chart's own grouping of an odd bar) → [2, 2, 3], when it adds up to `num`. */
export function parseGrouping(text: string | null | undefined, num: number): number[] | null {
  const m = (text || '').match(/(?:^|\s|\()(\d(?:\s*\+\s*\d)+)(?:$|\s|\))/);
  if (!m) return null;
  const parts = m[1].split('+').map((p) => Number(p.trim()));
  if (parts.some((p) => !(p >= 1 && p <= 4))) return null;
  return parts.reduce((a, b) => a + b, 0) === num ? parts : null;
}

const defaultGroups = (num: number): number[] => {
  // Odd /8: twos, and a three at the end of an odd count (7 → 2 2 3, 5 → 2 3).
  const out: number[] = [];
  let left = num;
  while (left > 3) {
    out.push(2);
    left -= 2;
  }
  if (left) out.push(left);
  return out;
};

/** A time signature (and the chart's grouping, for odd meters) → how it is counted. Unknown → 4/4. */
export function meterOf(time: string | null | undefined, grouping?: number[] | null): Meter {
  const t = normalizeTime(time) ?? DEFAULT_TIME;
  const [num, den] = t.split('/').map(Number);
  const compound = den >= 8 && num % 3 === 0;
  let beats: number[];
  if (den <= 4) beats = Array.from({ length: num }, () => 1);
  else if (compound) beats = Array.from({ length: num / 3 }, () => 3);
  else beats = grouping && grouping.reduce((a, b) => a + b, 0) === num ? [...grouping] : defaultGroups(num);
  const starts: number[] = [];
  beats.reduce((at, b) => (starts.push(at), at + b), 0);
  return { time: t, num, den, beats, compound, starts };
}

/** One tick (one `den` note) in ms at `bpm`, by the rule in the header. */
export function tickMs(meter: Meter, bpm: number): number {
  const beat = 60000 / Math.max(1, bpm);
  if (meter.den <= 4) return beat;
  if (meter.compound) return beat / 3;
  return (beat * 4) / meter.den;
}

/** One bar in ms at `bpm`. */
export const barMs = (meter: Meter, bpm: number) => meter.num * tickMs(meter, bpm);

/** The tick rate the click and the count-in run at (ticks per minute). */
export const tickBpm = (meter: Meter, bpm: number) => 60000 / tickMs(meter, bpm);

/** Which counted beat a tick of the bar falls in (0-based), and whether it starts it. */
export function beatOfTick(meter: Meter, tick: number): { beat: number; first: boolean } {
  const t = ((tick % meter.num) + meter.num) % meter.num;
  let beat = 0;
  for (let i = 0; i < meter.starts.length; i++) if (meter.starts[i] <= t) beat = i;
  return { beat, first: meter.starts[beat] === t };
}

/** The song's meter: its own time signature, else the chart's, else 4/4; odd bars grouped as the chart writes them. */
export function songMeter(song: { timeSignature?: string | null; chart?: { time?: string; sections?: { bars: { text?: string }[] }[] } | null }): Meter {
  const time = normalizeTime(song.timeSignature) ?? normalizeTime(song.chart?.time) ?? DEFAULT_TIME;
  const num = Number(time.split('/')[0]);
  let grouping: number[] | null = null;
  for (const s of song.chart?.sections ?? []) {
    for (const b of s.bars) {
      grouping = parseGrouping(b.text, num);
      if (grouping) break;
    }
    if (grouping) break;
  }
  return meterOf(time, grouping);
}

/** Time signatures offered in the song editor. */
export const COMMON_TIMES = ['4/4', '3/4', '2/4', '5/4', '6/8', '9/8', '12/8', '5/8', '7/8'] as const;
