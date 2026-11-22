/**
 * What live mode (Stage / rehearsal Live mode) reads of each setlist song.
 *
 * The live-mode columns of migration 171 (time signature, count-in, pickup,
 * backing track, line timing) are asked for separately: until 171 is
 * applied PostgREST fails the whole query on a missing column, so the app
 * asks again without them and live mode simply uses the defaults.
 */
import { asLineTiming, type LineTiming } from './lineTiming';
import { normalizeTime } from './meter';

const BASE = 'title, artist, duration_seconds, key, bpm, lyrics, chord_chart, audio_url';
const LIVE = 'time_signature, count_in_bars, pickup_beats, backing_track, line_timing';

/** setlist_songs select for live mode, with or without the 171 columns. */
export const stageSongSelect = (withLive = true) => `*, song:songs(${BASE}${withLive ? `, ${LIVE}` : ''})`;

/** A query failed because a column isn't there yet (migration not applied). */
export const isMissingColumn = (error: { code?: string; message?: string } | null | undefined) =>
  !!error && (error.code === '42703' || /column .* does not exist/i.test(error.message || ''));

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

/** The live-mode fields of a joined `songs` row (anything missing: left out). */
export function liveSongFields(song: Record<string, unknown> | null | undefined): LiveSongFields {
  if (!song) return {};
  const out: LiveSongFields = {};
  const ts = normalizeTime(typeof song.time_signature === 'string' ? song.time_signature : null);
  if (ts) out.timeSignature = ts;
  if (song.count_in_bars === 2 || song.count_in_bars === 0) out.countInBars = song.count_in_bars;
  if (typeof song.pickup_beats === 'number' && song.pickup_beats > 0) out.pickupBeats = Math.min(15, Math.round(song.pickup_beats));
  if (song.backing_track === true) out.backingTrack = true;
  const lt = asLineTiming(song.line_timing);
  if (lt) out.lineTiming = lt;
  if (typeof song.duration_seconds === 'number' && song.duration_seconds > 0) out.durationSeconds = song.duration_seconds;
  return out;
}
