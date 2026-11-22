/**
 * The "live pack" (plan docs/plans/live-offline-and-tempo.md §3.1): one
 * event's setlist with everything live mode (gig Stage, rehearsal Live mode)
 * needs with no signal, kept on the device. Pure rules here; storage,
 * download and clean-up in livePackStore.ts.
 *
 * In the pack: the event's basics, the setlist order and sets, per song its
 * lyrics, chord chart, key, BPM and the live fields of the other parts
 * (time signature, count-in, pickup, backing track, line timing, voice parts),
 * the user's OWN personal notes and files, a rehearsal's band notes, the
 * stage key and a version.
 * Never in it: fees, deposits, contracts, quotes, the client, other members'
 * personal notes.
 */
import { asSongChart, type SongChart } from './ireal';
import type { PersonalNote } from './personalNotes';
import type { RehearsalNote } from './rehearsalNotes';

/** Gigs and rehearsals this many days ahead come down by themselves (owner, 11-21). */
export const LIVE_PACK_WINDOW_DAYS = 7;
/** A pack goes this long after its event ends. */
export const LIVE_PACK_KEEP_AFTER_MS = 24 * 60 * 60 * 1000;

// ── songs ─────────────────────────────────────────────────────────────────

/**
 * Song fields added by the tempo (B, D) and voices (C) parts. Optional: the
 * columns come from those parts' migrations, and old packs don't have them.
 */
// Types, not interfaces: they fit index-signature types (GigSetlistSong).
export type LiveSongExtras = {
  /** songs.time_signature, e.g. '4/4', '6/8'. */
  timeSignature?: string;
  /** songs.count_in_bars (1 or 2). */
  countInBars?: number;
  /** songs.pickup_beats: the song starts this many beats before bar 1. */
  pickupBeats?: number;
  /** songs.backing_track: played with a track (no count-in). */
  backingTrack?: boolean;
  /** songs.line_timing (Part B, "Sync lines"). */
  lineTiming?: unknown;
  /** songs.vocal_parts: who sings which part (Part C). */
  vocalParts?: Record<string, unknown>;
  /** setlist_songs.vocal_parts: this gig's override (a deputy sings instead). */
  setlistVocalParts?: Record<string, unknown>;
  /** songs.updated_at: part of the pack's version. */
  updatedAt?: string;
};

/** A setlist song as live mode shows it (StageSong + the live fields). */
export type LiveSong = LiveSongExtras & {
  id?: string;
  songId?: string;
  setNumber?: number;
  title: string;
  artist?: string;
  duration?: string;
  key?: string;
  bpm?: number;
  lyrics?: string;
  chart?: SongChart;
  audio?: string;
};

/** The song columns live mode reads today. */
export const BASE_SONG_COLUMNS = 'title, artist, duration_seconds, key, bpm, lyrics, chord_chart, audio_url, updated_at';
/** And the ones the other parts add (asked for, and dropped while a database doesn't have them yet). */
export const EXTRA_SONG_COLUMNS = 'time_signature, count_in_bars, pickup_beats, backing_track, line_timing, vocal_parts';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const posNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
const count = (v: unknown, max: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined;
const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/** One `setlist_songs` row with its `song` joined → the song live mode shows. */
export function songFromRow(row: any, unknownTitle: string): LiveSong {
  const song = row?.song ?? {};
  const secs = song.duration_seconds;
  const out: LiveSong = {
    id: str(row?.id),
    songId: str(row?.song_id),
    setNumber: typeof row?.set_number === 'number' ? row.set_number : undefined,
    title: str(song.title) ?? unknownTitle,
    artist: str(song.artist),
    duration: typeof secs === 'number' && secs > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : undefined,
    key: str(song.key),
    bpm: posNum(song.bpm),
    lyrics: str(song.lyrics),
    chart: asSongChart(song.chord_chart) || undefined,
    // The Regia (stage manager mode) plays it; nobody else loads it.
    audio: str(song.audio_url),
    updatedAt: str(song.updated_at),
  };
  const ts = str(song.time_signature);
  if (ts && /^\d{1,2}\/\d{1,2}$/.test(ts)) out.timeSignature = ts;
  const bars = count(song.count_in_bars, 8);
  if (bars !== undefined) out.countInBars = bars;
  const pickup = count(song.pickup_beats, 16);
  if (pickup !== undefined) out.pickupBeats = pickup;
  if (typeof song.backing_track === 'boolean') out.backingTrack = song.backing_track;
  const timing = obj(song.line_timing);
  if (timing) out.lineTiming = timing;
  const parts = obj(song.vocal_parts);
  if (parts) out.vocalParts = parts;
  const override = obj(row?.vocal_parts);
  if (override) out.setlistVocalParts = override;
  return out;
}

// ── the event ─────────────────────────────────────────────────────────────

/** The event's basics: what live mode and "Go live" need. No money, client or contract. */
export interface LivePackEvent {
  id: string;
  band_id: string;
  title: string;
  event_type: string;
  status?: string;
  event_date: string;
  start_time?: string;
  end_time?: string;
  load_in_time?: string;
  soundcheck_time?: string;
  venue_name?: string;
  venue_city?: string;
  venue_address?: string;
  setlist_id: string;
}

const EVENT_FIELDS = [
  'id', 'band_id', 'title', 'event_type', 'status', 'event_date', 'start_time', 'end_time',
  'load_in_time', 'soundcheck_time', 'venue_name', 'venue_city', 'venue_address', 'setlist_id',
] as const;

/** Only the listed fields: anything else on the row (fee, client, deposit, contract) stays out. */
export function packEventFrom(row: Record<string, unknown>): LivePackEvent {
  const out: Record<string, unknown> = {};
  for (const k of EVENT_FIELDS) {
    const v = row[k];
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out as unknown as LivePackEvent;
}

/** The event as the app shows it (AuthenticatedApp's EventItem): the fields the pack keeps. */
export interface LivePackItem {
  eventId?: string;
  band_id?: string;
  title?: string;
  eventType?: string;
  status?: string;
  date?: string;
  time?: string;
  /** false: `time` is a stand-in (no start time set). */
  timeSet?: boolean;
  endTime?: string;
  loadInTime?: string;
  soundcheckTime?: string;
  venueName?: string;
  venueCity?: string;
  venueAddress?: string;
  setlistId?: string;
}

/** The event on screen → the pack's row (packEventFrom keeps only the basics). */
export const packRowFromItem = (e: LivePackItem): Record<string, unknown> => ({
  id: e.eventId,
  band_id: e.band_id,
  title: e.title,
  event_type: e.eventType,
  event_date: e.date,
  start_time: e.timeSet === false ? undefined : e.time,
  end_time: e.endTime,
  load_in_time: e.loadInTime,
  soundcheck_time: e.soundcheckTime,
  venue_name: e.venueName,
  venue_city: e.venueCity,
  venue_address: e.venueAddress,
  setlist_id: e.setlistId,
});

// ── the pack ──────────────────────────────────────────────────────────────

/** One of my files for a song; `local` = where it is on this device (Capacitor Filesystem). */
export interface LivePackFile {
  id: string;
  song_id: string;
  name: string;
  kind: string;
  ref: string;
  size?: number | null;
  created_at?: string;
  local?: { path: string; directory: string };
}

export interface LivePackPersonal {
  notes: Array<Pick<PersonalNote, 'id'> & Partial<PersonalNote>>;
  files: LivePackFile[];
}

export interface LivePack {
  v: 1;
  eventId: string;
  bandId: string;
  userId: string;
  setlistId: string;
  event: LivePackEvent;
  songs: LiveSong[];
  /** song id → my notes and files (only mine: RLS user_id = auth.uid()). */
  personal: Record<string, LivePackPersonal>;
  /** Rehearsals: this occurrence's notes and the band's open notes on these songs. */
  bandNotes?: { date: string; occurrence: RehearsalNote[]; open: RehearsalNote[] };
  /** The gig's Bluetooth key (087). */
  stageKey?: string | null;
  version: string;
  /** When it was downloaded (ISO). */
  savedAt: string;
  /** Removed after this (ISO): 24 h after the event ends. */
  expiresAt: string;
  /**
   * Kept while live_pack was switched off (docs/flags.md): the songs and a
   * tidied pack, but not complete. Never fresh for the prefetch, never
   * "Offline ready", never reported to the admins; completed once it's on.
   */
  partial?: boolean;
}

/** Complete and on the device: "Offline ready", and counts for "N of M members ready". */
export const isPackReady = (p: LivePack | null | undefined): boolean => !!p && !p.partial && p.songs.length > 0;

/** FNV-1a, 32 bit, as 8 hex digits: a short, stable fingerprint. */
const fnv = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

/**
 * The pack's version: the setlist (order, sets, songs), each song's
 * updated_at and my notes' and files' timestamps. Same content → same version,
 * so devices can report it (live_pack_status) and admins see who is behind.
 */
export function packVersion(
  songs: Array<Pick<LiveSong, 'id' | 'songId' | 'setNumber' | 'updatedAt'>>,
  personal: Record<string, { notes: Array<{ id: string; updated_at?: string }>; files: Array<{ id: string; created_at?: string }> }>,
): string {
  const order = songs.map((s) => `${s.id ?? ''}:${s.songId ?? ''}:${s.setNumber ?? ''}:${s.updatedAt ?? ''}`).join('|');
  const mine = Object.keys(personal)
    .sort()
    .map((id) => {
      const p = personal[id];
      const notes = p.notes.map((n) => `${n.id}@${n.updated_at ?? ''}`).sort().join(',');
      const files = p.files.map((f) => `${f.id}@${f.created_at ?? ''}`).sort().join(',');
      return `${id}=${notes};${files}`;
    })
    .join('|');
  return fnv(order) + fnv(mine);
}

// ── when it goes ──────────────────────────────────────────────────────────

const at = (date: string, time: string | undefined, fallback: string): Date => {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time && /^\d{1,2}:\d{2}/.test(time) ? time : fallback).split(':').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
};

/** When the event ends: its end time (next day when before the start), else the end of its day. */
export function eventEndsAt(e: { event_date: string; start_time?: string; end_time?: string }): Date {
  if (!e.end_time) return at(e.event_date, undefined, '23:59');
  const end = at(e.event_date, e.end_time, '23:59');
  const start = at(e.event_date, e.start_time, '00:00');
  if (end.getTime() < start.getTime()) end.setDate(end.getDate() + 1);
  return end;
}

export const packExpiresAt = (e: { event_date: string; start_time?: string; end_time?: string }): string =>
  new Date(eventEndsAt(e).getTime() + LIVE_PACK_KEEP_AFTER_MS).toISOString();

export const isPackExpired = (p: Pick<LivePack, 'expiresAt'>, now: Date = new Date()): boolean =>
  !p.expiresAt || now.getTime() > new Date(p.expiresAt).getTime();

// ── which events come down ────────────────────────────────────────────────

export interface LivePackCandidate {
  eventId: string;
  bandId?: string;
  /** "YYYY-MM-DD" (a recurring event: the occurrence). */
  date: string;
  eventType?: string;
  setlistId?: string;
  /** I said I can't make it. */
  declined?: boolean;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Band gigs and rehearsals with a setlist, from today to 7 days ahead, that I
 * didn't decline. A recurring event once, at its next occurrence.
 */
export function prefetchCandidates<T extends LivePackCandidate>(events: T[], now: Date = new Date()): T[] {
  const from = ymd(now);
  const last = new Date(now);
  last.setDate(last.getDate() + LIVE_PACK_WINDOW_DAYS);
  const to = ymd(last);
  const byEvent = new Map<string, T>();
  for (const e of events) {
    if (!e.eventId || !e.bandId || !e.setlistId || e.declined) continue;
    if (e.eventType !== 'gig' && e.eventType !== 'rehearsal') continue;
    if (!e.date || e.date < from || e.date > to) continue;
    const seen = byEvent.get(e.eventId);
    if (!seen || e.date < seen.date) byEvent.set(e.eventId, e);
  }
  return [...byEvent.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ── the old copy (localStorage bw-setlist-songs:, PR #93) ─────────────────

/** Each old setlist copy goes to the events that use it; copies no event uses are dropped. */
export function legacyPacksFrom<S>(
  legacy: Record<string, S[]>,
  events: Array<Pick<LivePackCandidate, 'eventId' | 'bandId' | 'setlistId'>>,
): Array<{ eventId: string; bandId: string; setlistId: string; songs: S[] }> {
  const out: Array<{ eventId: string; bandId: string; setlistId: string; songs: S[] }> = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (!e.setlistId || !e.bandId || seen.has(e.eventId)) continue;
    const songs = legacy[e.setlistId];
    if (!songs?.length) continue;
    seen.add(e.eventId);
    out.push({ eventId: e.eventId, bandId: e.bandId, setlistId: e.setlistId, songs });
  }
  return out;
}

/**
 * A silent push said an event's setlist or songs changed (migration 170):
 * `detail.eventId` (iOS native also sets `eventId` on the event itself).
 */
export const LIVE_PACK_REFRESH_EVENT = 'bw:live-pack-refresh';

/** About how much the songs take on the device (text, UTF-8-ish). Files are counted apart. */
export function estimatePackBytes(songs: LiveSong[]): number {
  try {
    return new TextEncoder().encode(JSON.stringify(songs)).length;
  } catch {
    return 0;
  }
}

/** "0.1", "2.3": megabytes with one decimal, never 0 (shown as "About {size} MB"). */
export const packSizeMb = (bytes: number): string => Math.max(0.1, Math.round(bytes / 100_000) / 10).toFixed(1);
