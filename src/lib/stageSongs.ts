/**
 * What Stage mode reads of each setlist song, on top of the live pack's
 * fields (livePack.songFromRow, migration 171's columns included).
 */
import { asLineTiming, type LineTiming } from './lineTiming';

export interface LiveSongFields {
  /** songs.time_signature, normalised ("6/8"); undefined = the chart's. */
  timeSignature?: string;
  /** Bars of count-in: 1 (default) or 2. */
  countInBars?: number;
  /** Beats before bar 1 (a pickup). */
  pickupBeats?: number;
  /** Played with a backing track: no count-in. */
  backingTrack?: boolean;
  /** songs.line_timing (checked against the lyrics when used). */
  lineTiming?: LineTiming;
  /** songs.duration_seconds (stretches a lyrics-only timeline). */
  durationSeconds?: number;
}

/**
 * A song as the live pack reads it (livePack.songFromRow: line timing
 * unchecked, length as "m:ss") → the fields Stage mode follows the tempo
 * with: line timing checked, the length in seconds.
 */
export function stageSongOf<T extends { lineTiming?: unknown; duration?: string; durationSeconds?: number }>(
  song: T,
): Omit<T, 'lineTiming'> & Pick<LiveSongFields, 'lineTiming' | 'durationSeconds'> {
  const { lineTiming, ...rest } = song;
  const out: Omit<T, 'lineTiming'> & Pick<LiveSongFields, 'lineTiming' | 'durationSeconds'> = rest;
  const timing = asLineTiming(lineTiming);
  if (timing) out.lineTiming = timing;
  const m = /^(\d+):([0-5]\d)$/.exec(song.duration ?? '');
  if (m && out.durationSeconds === undefined) out.durationSeconds = Number(m[1]) * 60 + Number(m[2]);
  return out;
}
