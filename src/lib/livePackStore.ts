/**
 * Live packs on the device (plan §3.1–3.2): kept in the offline store
 * (offline/storage.ts, IndexedDB) under `bw:<user>:<band>:live_pack:<event>`,
 * so sign-out (clearOfflineCache) and a role change (syncCachedRoles) drop
 * them with the rest. Also removed 24 h after the event and when the person
 * is no longer in the band (sweepPacks).
 *
 * - savePackSongs: the event was opened online → its songs are kept (what the
 *   old localStorage copy did, for Stage and Bluetooth on stage).
 * - refreshPack: the whole pack (my notes and files, a rehearsal's band notes,
 *   the stage key), on open and ahead of time (runLivePackPrefetch).
 * - readPack / readPackBySetlist: Stage and the event screen with no signal.
 */
import { supabase, isDemoMode } from './supabase';
import { getCacheKey, getOfflineItem, listOfflineKeys, removeOfflineItem, setOfflineItem } from './offline/storage';
import { isOfflineError } from './offline/networkErrors';
import {
  BASE_SONG_COLUMNS,
  EXTRA_SONG_COLUMNS,
  isPackExpired,
  legacyPacksFrom,
  packEventFrom,
  packExpiresAt,
  packVersion,
  prefetchCandidates,
  songFromRow,
  type LivePack,
  type LivePackCandidate,
  type LivePackEvent,
  type LivePackFile,
  type LivePackPersonal,
  type LiveSong,
} from './livePack';
import { anyPackAllowed, packAllowed, readChoice } from './livePackConsent';
import { downloadPackFile, packFilesAvailable, removePackFiles } from './livePackFiles';
import { fetchOccurrenceNotes, fetchOpenBandNotes } from './services/rehearsalNotes';
import type { RehearsalNote } from './rehearsalNotes';
import { stageBleAvailable, stageKey } from './stageBleNative';

export const LIVE_PACK_CHANGED = 'bw:live-pack-changed';
const PACK = 'live_pack:';

export const packKey = (userId: string, bandId: string, eventId: string) => getCacheKey(userId, bandId, `${PACK}${eventId}`);
const isPackKey = (k: string) => k.includes(`:${PACK}`);

const changed = (eventId: string) => {
  try {
    window.dispatchEvent(new CustomEvent(LIVE_PACK_CHANGED, { detail: { eventId } }));
  } catch {
    /* no window (tests) */
  }
};

// ── reading ───────────────────────────────────────────────────────────────

const valid = (p: unknown): p is LivePack =>
  !!p && typeof p === 'object' && (p as LivePack).v === 1 && Array.isArray((p as LivePack).songs) && typeof (p as LivePack).eventId === 'string';

/** Every pack of this user on the device (expired ones are removed on the way). */
export async function listPacks(userId: string | null | undefined, now: Date = new Date()): Promise<LivePack[]> {
  if (!userId) return [];
  const keys = (await listOfflineKeys(`bw:${userId}:`)).filter(isPackKey);
  const out: LivePack[] = [];
  for (const k of keys) {
    const p = await getOfflineItem<LivePack>(k);
    if (!valid(p) || p.userId !== userId) continue;
    if (isPackExpired(p, now)) {
      await dropPack(k, p);
      continue;
    }
    out.push(p);
  }
  return out;
}

export async function readPack(userId: string | null | undefined, bandId: string | null | undefined, eventId: string | null | undefined): Promise<LivePack | null> {
  if (!userId || !bandId || !eventId) return null;
  const k = packKey(userId, bandId, eventId);
  const p = await getOfflineItem<LivePack>(k);
  if (!valid(p) || p.userId !== userId) return null;
  if (isPackExpired(p)) {
    await dropPack(k, p);
    return null;
  }
  return p;
}

/** A pack for this event in any of my bands (Home's "Go live" knows only the event). */
export async function findPack(userId: string | null | undefined, eventId: string): Promise<LivePack | null> {
  return (await listPacks(userId)).find((p) => p.eventId === eventId) ?? null;
}

/** The songs kept for a setlist (any event using it), newest first. */
export async function readPackBySetlist(userId: string | null | undefined, setlistId: string): Promise<LivePack | null> {
  const packs = (await listPacks(userId)).filter((p) => p.setlistId === setlistId);
  packs.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return packs[0] ?? null;
}

/** My notes and files for a song, from the newest pack that has them (offline). */
export async function personalFromPacks(userId: string | null | undefined, songId: string): Promise<LivePackPersonal | null> {
  const packs = (await listPacks(userId)).filter((p) => p.personal?.[songId]);
  packs.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return packs[0]?.personal[songId] ?? null;
}

/** A rehearsal occurrence's notes, from its pack (offline). */
export async function occurrenceNotesFromPack(userId: string | null | undefined, eventId: string, date: string): Promise<RehearsalNote[] | null> {
  const p = (await listPacks(userId)).find((x) => x.eventId === eventId && x.bandNotes?.date === date);
  return p?.bandNotes?.occurrence ?? null;
}

/** The band's open notes kept in its packs (offline), one copy per note. */
export async function openBandNotesFromPacks(userId: string | null | undefined, bandId: string): Promise<RehearsalNote[] | null> {
  const packs = (await listPacks(userId)).filter((p) => p.bandId === bandId && p.bandNotes);
  if (!packs.length) return null;
  const byId = new Map<string, RehearsalNote>();
  packs.sort((a, b) => a.savedAt.localeCompare(b.savedAt)).forEach((p) => p.bandNotes!.open.forEach((n) => byId.set(n.id, n)));
  return [...byId.values()];
}

// ── writing and removing ──────────────────────────────────────────────────

async function dropPack(key: string, pack: LivePack | null) {
  await removeOfflineItem(key);
  if (pack) {
    await removePackFiles(Object.values(pack.personal ?? {}).flatMap((p) => p.files));
    try {
      localStorage.removeItem(`bw-stage-key:${pack.eventId}`);
    } catch {
      /* storage blocked */
    }
    changed(pack.eventId);
  }
}

export async function savePack(pack: LivePack): Promise<void> {
  await setOfflineItem(packKey(pack.userId, pack.bandId, pack.eventId), pack);
  changed(pack.eventId);
}

export async function deletePack(userId: string, bandId: string, eventId: string) {
  const k = packKey(userId, bandId, eventId);
  await dropPack(k, await getOfflineItem<LivePack>(k));
}

/** Every pack of this user ("Delete all", Settings → Offline & live). */
export async function deleteAllPacks(userId: string) {
  for (const k of (await listOfflineKeys(`bw:${userId}:`)).filter(isPackKey)) await dropPack(k, await getOfflineItem<LivePack>(k));
}

/**
 * Packs that must go: expired (24 h after the event) and those of bands the
 * person is no longer in. Role changes are handled by syncCachedRoles.
 */
export async function sweepPacks(userId: string, bandIds: string[], now: Date = new Date()): Promise<number> {
  const keep = new Set(bandIds);
  let removed = 0;
  for (const k of (await listOfflineKeys(`bw:${userId}:`)).filter(isPackKey)) {
    const p = await getOfflineItem<LivePack>(k);
    if (!valid(p) || isPackExpired(p, now) || !keep.has(p.bandId)) {
      await dropPack(k, valid(p) ? p : null);
      removed++;
    }
  }
  return removed;
}

const occurrenceEvent = (event: LivePackEvent, date?: string): LivePackEvent => (date ? { ...event, event_date: date } : event);

/**
 * The event was opened online: keep its songs (and keep what the pack
 * already had: my notes and files, band notes, the key). Version follows.
 */
export async function savePackSongs(args: {
  userId: string;
  event: Record<string, unknown>;
  occurrenceDate?: string;
  songs: LiveSong[];
}): Promise<LivePack | null> {
  const event = occurrenceEvent(packEventFrom(args.event), args.occurrenceDate);
  if (!event.id || !event.band_id || !event.setlist_id || !event.event_date) return null;
  const prev = await readPack(args.userId, event.band_id, event.id);
  const personal = prev && prev.setlistId === event.setlist_id ? prev.personal : {};
  const pack: LivePack = {
    v: 1,
    eventId: event.id,
    bandId: event.band_id,
    userId: args.userId,
    setlistId: event.setlist_id,
    event,
    songs: args.songs,
    personal,
    bandNotes: prev?.bandNotes,
    stageKey: prev?.stageKey,
    version: packVersion(args.songs, personal),
    savedAt: new Date().toISOString(),
    expiresAt: packExpiresAt(event),
  };
  await savePack(pack);
  return pack;
}

// ── downloading ───────────────────────────────────────────────────────────

/** null = the database doesn't have the other parts' columns yet (asked again after a while). */
let extrasMissingAt: number | null = null;
const EXTRAS_RETRY_MS = 10 * 60 * 1000;

/**
 * The setlist's rows with their songs. Asks for the live fields of the other
 * parts too; a database without those columns answers with an error, then
 * the plain columns are asked for.
 */
export async function fetchSetlistRows(setlistId: string): Promise<{ rows: any[] | null; error: unknown }> {
  const ask = (cols: string) =>
    supabase
      .from('setlist_songs')
      .select(`*, song:songs(${cols})`)
      .eq('setlist_id', setlistId)
      .order('set_number', { ascending: true })
      .order('position', { ascending: true });
  const tryExtras = extrasMissingAt === null || Date.now() - extrasMissingAt > EXTRAS_RETRY_MS;
  if (tryExtras) {
    const { data, error } = await ask(`${BASE_SONG_COLUMNS}, ${EXTRA_SONG_COLUMNS}`);
    if (!error) {
      extrasMissingAt = null;
      return { rows: data ?? [], error: null };
    }
    if (isOfflineError(error)) return { rows: null, error };
    extrasMissingAt = Date.now();
  }
  const { data, error } = await ask(BASE_SONG_COLUMNS);
  return error ? { rows: null, error } : { rows: data ?? [], error: null };
}

/** Tests: ask for the extra columns again. */
export const resetExtrasProbe = () => {
  extrasMissingAt = null;
};

async function fetchPersonal(userId: string, songIds: string[]): Promise<Record<string, LivePackPersonal> | null> {
  if (!songIds.length) return {};
  const [n, f] = await Promise.all([
    supabase.from('song_personal_notes').select('id, song_id, anchor, body, created_at, updated_at').eq('user_id', userId).in('song_id', songIds),
    supabase.from('song_personal_files').select('id, song_id, name, kind, ref, size, created_at').eq('user_id', userId).in('song_id', songIds),
  ]);
  if (n.error || f.error) return null;
  const out: Record<string, LivePackPersonal> = {};
  const slot = (id: string) => (out[id] ??= { notes: [], files: [] });
  for (const note of (n.data as any[] | null) ?? []) if (note?.anchor && note.song_id) slot(note.song_id).notes.push(note);
  for (const file of (f.data as any[] | null) ?? []) if (file?.song_id) slot(file.song_id).files.push(file as LivePackFile);
  return out;
}

const inflight = new Map<string, Promise<LivePack | null>>();

/**
 * Download (or bring up to date) the whole pack of one event: songs, my
 * notes, my files (native, when `withFiles`), a rehearsal's band notes, the
 * stage key. Keeps what was there when a part can't be fetched now.
 */
export function refreshPack(args: {
  userId: string;
  event: Record<string, unknown>;
  occurrenceDate?: string;
  songs?: LiveSong[];
  withFiles?: boolean;
  unknownTitle?: string;
}): Promise<LivePack | null> {
  const id = String(args.event.id ?? '');
  const running = inflight.get(id);
  if (running) return running;
  const run = refreshOnce(args).finally(() => inflight.delete(id));
  inflight.set(id, run);
  return run;
}

async function refreshOnce(args: Parameters<typeof refreshPack>[0]): Promise<LivePack | null> {
  const event = occurrenceEvent(packEventFrom(args.event), args.occurrenceDate);
  if (!event.id || !event.band_id || !event.setlist_id || !event.event_date) return null;
  const prev = await readPack(args.userId, event.band_id, event.id);
  let songs = args.songs;
  if (!songs) {
    const { rows } = await fetchSetlistRows(event.setlist_id);
    if (!rows) return prev;
    songs = rows.map((r) => songFromRow(r, args.unknownTitle ?? 'Unknown Song'));
  }
  if (!songs.length) {
    if (prev) await deletePack(args.userId, event.band_id, event.id);
    return null;
  }
  const songIds = [...new Set(songs.map((s) => s.songId).filter((x): x is string => !!x))];
  const personal = (await fetchPersonal(args.userId, songIds).catch(() => null)) ?? (prev?.setlistId === event.setlist_id ? prev.personal : {});
  // My files: the copies already on the device stay; new ones come down (native).
  const prevFiles = new Map(Object.values(prev?.personal ?? {}).flatMap((p) => p.files).map((f) => [f.id, f]));
  const kept = new Set<string>();
  for (const p of Object.values(personal)) {
    for (const f of p.files) {
      const had = prevFiles.get(f.id)?.local;
      if (had) f.local = had;
      if (!f.local && args.withFiles && packFilesAvailable()) f.local = (await downloadPackFile(args.userId, f)) ?? undefined;
      if (f.local) kept.add(f.id);
    }
  }
  await removePackFiles([...prevFiles.values()].filter((f) => !kept.has(f.id)));

  let bandNotes = prev?.bandNotes;
  if (event.event_type === 'rehearsal') {
    const [occurrence, open] = await Promise.all([
      fetchOccurrenceNotes(event.id, event.event_date).catch(() => null),
      fetchOpenBandNotes(event.band_id).catch(() => null),
    ]);
    const ids = new Set(songIds);
    if (occurrence && open)
      bandNotes = { date: event.event_date, occurrence, open: open.filter((n) => !n.songId || ids.has(n.songId)) };
  }

  let key = prev?.stageKey ?? null;
  if (!key && !isDemoMode) {
    try {
      if (stageBleAvailable()) key = await stageKey(event.id);
    } catch {
      /* no key: Bluetooth just needs internet the first time */
    }
  }

  const pack: LivePack = {
    v: 1,
    eventId: event.id,
    bandId: event.band_id,
    userId: args.userId,
    setlistId: event.setlist_id,
    event,
    songs,
    personal,
    bandNotes,
    stageKey: key,
    version: packVersion(songs, personal),
    savedAt: new Date().toISOString(),
    expiresAt: packExpiresAt(event),
  };
  await savePack(pack);
  return pack;
}

// ── ahead of time ─────────────────────────────────────────────────────────

const LEGACY_PREFIX = 'bw-setlist-songs:';

/** The old copies (localStorage, PR #93) move into packs once, then go. */
export async function migrateLegacySetlists(userId: string, events: LivePackCandidate[], eventRows: Map<string, Record<string, unknown>>) {
  const legacy: Record<string, LiveSong[]> = {};
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LEGACY_PREFIX)) keys.push(k);
    }
    for (const k of keys) {
      const v = JSON.parse(localStorage.getItem(k) || 'null');
      if (Array.isArray(v)) legacy[k.slice(LEGACY_PREFIX.length)] = v;
    }
  } catch {
    return;
  }
  if (!keys.length) return;
  for (const m of legacyPacksFrom(legacy, events)) {
    const row = eventRows.get(m.eventId);
    if (!row) continue;
    const date = events.find((e) => e.eventId === m.eventId)?.date;
    if (!(await readPack(userId, m.bandId, m.eventId))) await savePackSongs({ userId, event: row, occurrenceDate: date, songs: m.songs });
  }
  try {
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage blocked */
  }
}

/** Fresh enough: not downloaded again within this time unless something changed. */
const FRESH_MS = 30 * 60 * 1000;

export interface PrefetchEvent extends LivePackCandidate {
  /** The event's row (only the basics are kept: packEventFrom). */
  row: Record<string, unknown>;
}

let running: Promise<number> | null = null;

/**
 * App open / resume: tidy up, then download the packs of the next 7 days
 * the person agreed to (livePackConsent). Returns how many were refreshed.
 */
export function runLivePackPrefetch(args: {
  userId: string;
  /** The bands I'm in; null while the list is still loading (nothing is swept then). */
  bandIds: string[] | null;
  events: PrefetchEvent[];
  online: boolean;
  /** On Wi-Fi now (or unknown): the "Wi-Fi only" setting. */
  onWifi?: boolean;
  unknownTitle?: string;
  now?: Date;
}): Promise<number> {
  if (running) return running;
  running = prefetchOnce(args).finally(() => {
    running = null;
  });
  return running;
}

async function prefetchOnce({ userId, bandIds, events, online, onWifi = true, unknownTitle, now = new Date() }: Parameters<typeof runLivePackPrefetch>[0]): Promise<number> {
  const rows = new Map(events.map((e) => [e.eventId, e.row]));
  await migrateLegacySetlists(userId, events, rows);
  if (bandIds) await sweepPacks(userId, bandIds, now);
  const choice = readChoice(userId);
  if (!online || !anyPackAllowed(choice) || (choice.wifiOnly && !onWifi)) return 0;
  let candidates = prefetchCandidates(events, now).filter((e) => packAllowed(choice, e.eventId));
  if (!candidates.length) return 0;
  // Events I said no to: no pack (the server's rule for setlists too).
  const { data: mine } = await supabase
    .from('event_members')
    .select('event_id, status')
    .eq('user_id', userId)
    .in('event_id', candidates.map((e) => e.eventId));
  const declined = new Set(((mine as any[] | null) ?? []).filter((m) => m.status === 'declined').map((m) => m.event_id));
  candidates = candidates.filter((e) => !declined.has(e.eventId));
  let done = 0;
  for (const e of candidates) {
    const prev = await readPack(userId, e.bandId, e.eventId);
    if (prev && prev.event.event_date === e.date && now.getTime() - new Date(prev.savedAt).getTime() < FRESH_MS) continue;
    const pack = await refreshPack({ userId, event: e.row, occurrenceDate: e.date, withFiles: true, unknownTitle });
    if (pack) done++;
  }
  return done;
}
