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
import { forgetPackStatus, reportPackStatus } from './livePackStatus';
import { isFlagOn } from './appFlags';
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
import { downloadPackFile, hasPackFile, packFilesAvailable, removePackFiles } from './livePackFiles';
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

/**
 * My files on the device sit at one path per file (livePackFiles), so two gigs
 * with the same song share it: of `files`, the ones no other pack of mine
 * (besides the one at `key`) still points to. Those can go.
 */
async function filesNoOtherPackUses(userId: string, key: string, files: LivePackFile[]): Promise<LivePackFile[]> {
  const local = files.filter((f) => f.local);
  if (!local.length) return [];
  const used = new Set<string>();
  for (const k of (await listOfflineKeys(`bw:${userId}:`)).filter(isPackKey)) {
    if (k === key) continue;
    // Read as stored: an expired pack still holds its files until it is dropped.
    const p = await getOfflineItem<LivePack>(k);
    if (!valid(p) || p.userId !== userId) continue;
    for (const x of Object.values(p.personal ?? {})) for (const f of x.files) if (f.local) used.add(localPath(f.local));
  }
  return local.filter((f) => !used.has(localPath(f.local!)));
}
const localPath = (l: NonNullable<LivePackFile['local']>) => `${l.directory}:${l.path}`;
const removeOwnFiles = async (userId: string, key: string, files: LivePackFile[]) =>
  removePackFiles(await filesNoOtherPackUses(userId, key, files));

async function dropPack(key: string, pack: LivePack | null) {
  await removeOfflineItem(key);
  if (pack) {
    await removeOwnFiles(pack.userId, key, Object.values(pack.personal ?? {}).flatMap((p) => p.files));
    try {
      localStorage.removeItem(`bw-stage-key:${pack.eventId}`);
    } catch {
      /* storage blocked */
    }
    // Admins' "N of M ready" no longer counts this device.
    void forgetPackStatus(pack.userId, [pack.eventId]);
    changed(pack.eventId);
  }
}

/**
 * "Delete all" moves the person's generation on: a refresh or a save that
 * started before it saves nothing afterwards (it would bring a pack back).
 */
const generations = new Map<string, number>();
const generationOf = (userId: string) => generations.get(userId) ?? 0;

/** Saves the pack; refused (false) when "Delete all" ran since `generation` was read. */
export async function savePack(pack: LivePack, generation?: number): Promise<boolean> {
  if (generation !== undefined && generation !== generationOf(pack.userId)) return false;
  await setOfflineItem(packKey(pack.userId, pack.bandId, pack.eventId), pack);
  changed(pack.eventId);
  return true;
}

export async function deletePack(userId: string, bandId: string, eventId: string) {
  const k = packKey(userId, bandId, eventId);
  await dropPack(k, await getOfflineItem<LivePack>(k));
}

/** Every pack of this user ("Delete all", Settings → Offline & live). */
export async function deleteAllPacks(userId: string) {
  generations.set(userId, generationOf(userId) + 1);
  inflight.clear(); // a refresh still running ends without saving; the next one starts fresh
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
  /** live_pack off: the pack stays partial (see LivePack.partial). */
  partial?: boolean;
}): Promise<LivePack | null> {
  const generation = generationOf(args.userId);
  const event = occurrenceEvent(packEventFrom(args.event), args.occurrenceDate);
  if (!event.id || !event.band_id || !event.setlist_id || !event.event_date) return null;
  const prev = await readPack(args.userId, event.band_id, event.id);
  const personal = prev && prev.setlistId === event.setlist_id ? prev.personal : {};
  // A song this pack didn't hold (added to the setlist, or another setlist):
  // its notes and files aren't fetched yet, so no "ready" until the full
  // refresh. Reordered or removed songs need nothing new.
  const heldSongs = new Set(prev && prev.setlistId === event.setlist_id ? prev.songs.map((s) => s.songId ?? s.id) : []);
  const songAdded = !!prev && args.songs.some((s) => !heldSongs.has(s.songId ?? s.id));
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
    // Partial until a full refresh with the switch on completes it.
    ...(args.partial || prev?.partial || songAdded ? { partial: true } : {}),
  };
  if (!(await savePack(pack, generation))) return null;
  if (pack.partial) reportPartial(pack);
  return pack;
}

/**
 * A partial pack keeps its status row, marked partial: the admins' "N of M
 * ready" doesn't count it, and the server can still reach it (170's refresh
 * targets are the holders while live_pack is off), so an emptied setlist
 * still removes it from the phone.
 */
function reportPartial(pack: LivePack) {
  void reportPackStatus({ ...pack, partial: true });
}

/**
 * Switched off: only what the pack already holds stays, kept current (an
 * edited note is updated, a deleted one goes), never anything new.
 */
function onlyHeld(fresh: Record<string, LivePackPersonal>, held: Record<string, LivePackPersonal> | undefined): Record<string, LivePackPersonal> {
  const notes = new Set(Object.values(held ?? {}).flatMap((p) => p.notes.map((n) => n.id)));
  const files = new Set(Object.values(held ?? {}).flatMap((p) => p.files.map((f) => f.id)));
  const out: Record<string, LivePackPersonal> = {};
  for (const [songId, p] of Object.entries(fresh)) {
    const kept = { notes: p.notes.filter((n) => notes.has(n.id)), files: p.files.filter((f) => files.has(f.id)) };
    if (kept.notes.length || kept.files.length) out[songId] = kept;
  }
  return out;
}

// ── downloading ───────────────────────────────────────────────────────────

/**
 * The other parts' columns this database doesn't have yet (each part's
 * migration lands on its own), asked for again after a while.
 */
const EXTRA_COLUMNS = EXTRA_SONG_COLUMNS.split(',').map((c) => c.trim());
const missingExtras = new Set<string>();
let extrasMissingAt: number | null = null;
const EXTRAS_RETRY_MS = 10 * 60 * 1000;

/** "column songs.time_signature does not exist" → time_signature. */
const missingColumn = (error: unknown): string | undefined =>
  /column\s+(?:"?\w+"?\.)?"?(\w+)"?\s+does not exist/i.exec(String((error as { message?: unknown })?.message ?? ''))?.[1];

/**
 * The setlist's rows with their songs. Asks for the live fields of the other
 * parts too; when the database lacks one, only that column is dropped (voice
 * parts stay when the tempo columns aren't there yet, and the other way round).
 */
export async function fetchSetlistRows(setlistId: string): Promise<{ rows: any[] | null; error: unknown }> {
  const ask = (cols: string) =>
    supabase
      .from('setlist_songs')
      .select(`*, song:songs(${cols})`)
      .eq('setlist_id', setlistId)
      .order('set_number', { ascending: true })
      .order('position', { ascending: true });
  if (extrasMissingAt !== null && Date.now() - extrasMissingAt > EXTRAS_RETRY_MS) resetExtrasProbe();
  for (;;) {
    const extras = EXTRA_COLUMNS.filter((c) => !missingExtras.has(c));
    const { data, error } = await ask(extras.length ? `${BASE_SONG_COLUMNS}, ${extras.join(', ')}` : BASE_SONG_COLUMNS);
    if (!error) return { rows: data ?? [], error: null };
    if (isOfflineError(error) || !extras.length) return { rows: null, error };
    const named = missingColumn(error);
    if (named && extras.includes(named)) missingExtras.add(named);
    else for (const c of extras) missingExtras.add(c);
    extrasMissingAt = Date.now();
  }
}

/** Tests: ask for the extra columns again. */
export const resetExtrasProbe = () => {
  missingExtras.clear();
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
  /** live_pack off: tidy and keep, but partial (see LivePack.partial). */
  partial?: boolean;
}): Promise<LivePack | null> {
  const id = String(args.event.id ?? '');
  const running = inflight.get(id);
  if (running) return running;
  const run = refreshOnce(args).finally(() => inflight.delete(id));
  inflight.set(id, run);
  return run;
}

/** Downloads of one of my files that fail while online before it counts as gone (a dead link). */
const MAX_FILE_TRIES = 3;

async function refreshOnce(args: Parameters<typeof refreshPack>[0]): Promise<LivePack | null> {
  const generation = generationOf(args.userId);
  const event = occurrenceEvent(packEventFrom(args.event), args.occurrenceDate);
  if (!event.id || !event.band_id || !event.setlist_id || !event.event_date) return null;
  const prev = await readPack(args.userId, event.band_id, event.id);
  const key = packKey(args.userId, event.band_id, event.id);
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
  const heldPersonal = prev?.setlistId === event.setlist_id ? prev.personal : {};
  // Switched off: only the songs whose notes or files are already held are asked
  // about (an event not held yet: nothing is asked, songs only).
  const askIds = args.partial ? songIds.filter((id) => heldPersonal[id]) : songIds;
  const fetched = await fetchPersonal(args.userId, askIds).catch(() => null);
  // Every part loaded? A partial pack becomes full only then.
  let complete = fetched !== null;
  // Switched off: kept current, nothing new.
  const personal = fetched ? (args.partial ? onlyHeld(fetched, heldPersonal) : fetched) : heldPersonal;
  // My files: the copies already on the device stay; new ones come down (native).
  const prevFiles = new Map(Object.values(prev?.personal ?? {}).flatMap((p) => p.files).map((f) => [f.id, f]));
  const kept = new Set<string>();
  const filesWanted = !!args.withFiles && !args.partial && packFilesAvailable();
  // A file that should be on the device and isn't: the pack is not complete.
  let fileMissing = false;
  // Online (my files were listed just now): a failed download counts as a try.
  const counting = fetched !== null;
  const added: LivePackFile[] = [];
  for (const p of Object.values(personal)) {
    for (const f of p.files) {
      const before = prevFiles.get(f.id);
      const same = !!before && before.ref === f.ref;
      // Saved earlier, but is it still there? (The OS can clear it, or the
      // person cleared the app's data.) Not there: downloaded again.
      if (before?.local && (!packFilesAvailable() || (await hasPackFile(before.local)))) f.local = before.local;
      // A dead link given up on: not tried again until the file changes.
      if (!f.local && same && before!.unavailable) {
        f.tries = before!.tries;
        f.unavailable = true;
        continue;
      }
      const tries = same ? (before!.tries ?? 0) : 0;
      if (tries) f.tries = tries;
      if (!f.local && filesWanted) {
        f.local = (await downloadPackFile(args.userId, f)) ?? undefined;
        if (f.local) {
          added.push(f);
          delete f.tries;
        } else if (counting) {
          f.tries = tries + 1;
          if (f.tries >= MAX_FILE_TRIES) f.unavailable = true;
        }
      }
      if (f.local) kept.add(f.id);
      // On a phone, a file of mine not here (no download yes yet, or it
      // failed) means not complete: never "Offline ready" without it, unless
      // its link is gone (then: ready, except that file).
      else if (packFilesAvailable() && !f.unavailable) fileMissing = true;
    }
  }
  if (generation !== generationOf(args.userId)) {
    // "Delete all" ran meanwhile: what this run downloaded goes too.
    await removeOwnFiles(args.userId, key, added);
    return null;
  }
  // Files this pack no longer uses: only those no other pack still points to.
  await removeOwnFiles(args.userId, key, [...prevFiles.values()].filter((f) => !kept.has(f.id)));

  let bandNotes = prev?.bandNotes;
  // A rehearsal's band notes: fetched only when on, or to keep held ones current.
  if (event.event_type === 'rehearsal' && (!args.partial || prev?.bandNotes)) {
    const [occurrence, open] = await Promise.all([
      fetchOccurrenceNotes(event.id, event.event_date).catch(() => null),
      fetchOpenBandNotes(event.band_id).catch(() => null),
    ]);
    const ids = new Set(songIds);
    if (!occurrence || !open) complete = false;
    if (occurrence && open) {
      const fresh = { date: event.event_date, occurrence, open: open.filter((n) => !n.songId || ids.has(n.songId)) };
      if (!args.partial) bandNotes = fresh;
      else if (prev?.bandNotes) {
        // Switched off: the notes already held, kept current; none added.
        const held = new Set([...prev.bandNotes.occurrence, ...prev.bandNotes.open].map((n) => n.id));
        bandNotes = { ...fresh, occurrence: fresh.occurrence.filter((n) => held.has(n.id)), open: fresh.open.filter((n) => held.has(n.id)) };
      }
    }
  }

  let bleKey = prev?.stageKey ?? null;
  // Switched off: no new Bluetooth key either.
  if (!bleKey && !args.partial) {
    try {
      // Inside the try: a partial client mock (tests) has no isDemoMode.
      if (!isDemoMode && stageBleAvailable()) bleKey = await stageKey(event.id);
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
    stageKey: bleKey,
    version: packVersion(songs, personal),
    savedAt: new Date().toISOString(),
    expiresAt: packExpiresAt(event),
    // Partial while switched off, and until every part has loaded once (a full
    // pack that can't fetch a part now keeps what it held, and stays full).
    // One of my files not on the device: partial, whatever it was (it isn't
    // there offline).
    ...(args.partial || fileMissing || (!complete && (!prev || prev.partial)) ? { partial: true } : {}),
  };
  if (!(await savePack(pack, generation))) {
    await removeOwnFiles(args.userId, key, added);
    return null;
  }
  // The full pack is on this device: tell the band's admins (native only).
  if (pack.partial) reportPartial(pack);
  else void reportPackStatus(pack);
  return pack;
}

/**
 * The event was opened online (EventDetail): keep its songs at once, then,
 * every few minutes (`fullDue`), bring the whole pack up to date. With
 * live_pack switched off the tidy-up still runs (deleted notes, files and
 * band notes go, an empty setlist drops the pack) but nothing new is
 * downloaded and the pack stays partial.
 */
/** Which songs, in which order: a pack for other songs is not this one. */
const songsKey = (songs: LiveSong[]) => songs.map((s) => s.songId ?? s.id).join(',');

export async function packOpenedEvent(args: {
  userId: string;
  event: Record<string, unknown>;
  occurrenceDate?: string;
  songs: LiveSong[];
  livePackOn: boolean;
  fullDue: boolean;
  /** My files may come down (the person said yes for this event). */
  allowFiles: boolean;
}): Promise<void> {
  const { userId, event, occurrenceDate, songs, livePackOn } = args;
  const partial = !livePackOn;
  if (!songs.length) {
    await refreshPack({ userId, event, occurrenceDate, songs, partial });
    return;
  }
  // Not held yet, or held for other songs (the setlist replaced or changed):
  // these songs alone are partial until the full pack loads (notes, files,
  // band notes), so no "ready" is claimed for them.
  const basics = packEventFrom(event);
  const prev = basics.band_id && basics.id ? await readPack(userId, basics.band_id, basics.id) : null;
  const held = !!prev && prev.setlistId === basics.setlist_id && songsKey(prev.songs) === songsKey(songs);
  await savePackSongs({ userId, event, occurrenceDate, songs, partial: partial || !held });
  if (args.fullDue) await refreshPack({ userId, event, occurrenceDate, songs, withFiles: livePackOn && args.allowFiles, partial });
}

// ── ahead of time ─────────────────────────────────────────────────────────

const LEGACY_PREFIX = 'bw-setlist-songs:';

/** The old copies (localStorage, PR #93) move into packs once, then go. */
export async function migrateLegacySetlists(
  userId: string,
  events: LivePackCandidate[],
  eventRows: Map<string, Record<string, unknown>>,
  livePackOn: boolean = isFlagOn('live_pack'),
) {
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
    // On: the copy keeps the status it had before the switch existed. Off: partial.
    if (!(await readPack(userId, m.bandId, m.eventId))) await savePackSongs({ userId, event: row, occurrenceDate: date, songs: m.songs, partial: !livePackOn });
  }
  try {
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage blocked */
  }
}

/**
 * Packs of events that are cancelled, deleted (or no longer visible to me)
 * or that I declined go at once, not 24 h after the event. Only on a clear
 * answer from the server: offline or an error removes nothing.
 */
export async function sweepGonePacks(userId: string, dates?: Map<string, string>): Promise<number> {
  const packs = await listPacks(userId);
  if (!packs.length) return 0;
  const ids = [...new Set(packs.map((p) => p.eventId))];
  let removed = 0;
  try {
    if (isDemoMode) return 0;
    const [ev, mine] = await Promise.all([
      supabase.from('events').select('id, status, event_date, is_recurring').in('id', ids),
      supabase.from('event_members').select('event_id, status').eq('user_id', userId).in('event_id', ids),
    ]);
    const gone = new Set<string>();
    if (ev && !ev.error && Array.isArray(ev.data)) {
      type Row = { id: string; status?: string; event_date?: string | null; is_recurring?: boolean | null };
      const found = new Map((ev.data as Row[]).map((r) => [r.id, r]));
      for (const id of ids) if (!found.has(id) || found.get(id)!.status === 'cancelled') gone.add(id);
      // The date on the server now (a gig that moved). A recurring event's row
      // has the series' first date: its occurrence stays the app's.
      for (const r of found.values()) if (dates && r.event_date && !r.is_recurring) dates.set(r.id, String(r.event_date).slice(0, 10));
    }
    if (mine && !mine.error && Array.isArray(mine.data)) {
      for (const m of mine.data as Array<{ event_id: string; status?: string }>) if (m.status === 'declined') gone.add(m.event_id);
    }
    for (const p of packs) {
      if (!gone.has(p.eventId)) continue;
      await deletePack(userId, p.bandId, p.eventId);
      removed++;
    }
  } catch {
    /* no answer: nothing removed on a guess */
  }
  return removed;
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
  /** Refresh these events even if their pack is fresh (silent push: something changed). */
  force?: string[];
  /**
   * false: tidy up only (old copies moved in, expired packs and bands left
   * removed), no downloads. The kill switch live_pack (docs/flags.md) stops
   * downloads, never the tidy-up.
   */
  downloads?: boolean;
  /** Asked before each download: false stops the run (switched off meanwhile). */
  keepGoing?: () => boolean;
}): Promise<number> {
  if (running) return running.then(() => (args.force?.length ? runLivePackPrefetch(args) : 0));
  running = prefetchOnce(args).finally(() => {
    running = null;
  });
  return running;
}

async function prefetchOnce({
  userId,
  bandIds,
  events,
  online,
  onWifi = true,
  unknownTitle,
  now = new Date(),
  force = [],
  downloads = true,
  keepGoing = () => true,
}: Parameters<typeof runLivePackPrefetch>[0]): Promise<number> {
  const rows = new Map(events.map((e) => [e.eventId, e.row]));
  await migrateLegacySetlists(userId, events, rows);
  if (bandIds) await sweepPacks(userId, bandIds, now);
  // Privacy, switch on or off: a cancelled or deleted event, or one I declined, loses its pack now.
  // The same answer gives each held event's date on the server now: a gig
  // that moved is refreshed on its new date, switch on or off. No answer
  // (offline, an error): the date held, or the app's list.
  const serverDates = new Map<string, string>();
  if (online) await sweepGonePacks(userId, serverDates);
  const choice = readChoice(userId);
  if (!downloads || !keepGoing()) {
    // Switched off: the packs already on this device are still brought up to
    // date (tidy, partial, no files: a note deleted elsewhere goes), on app
    // open / resume when not fresh (the server sends no silent refresh while
    // off). It never creates one. "Wi-Fi only" holds here too.
    let tidied = 0;
    if (online && !(choice.wifiOnly && !onWifi)) {
      // Once per event, on the date the pack holds: the list has every
      // occurrence of a series (its first one maybe last week), and a sweep
      // must never move an upcoming pack to a past date (it would expire).
      const done = new Set<string>();
      for (const e of events) {
        if (done.has(e.eventId)) continue;
        done.add(e.eventId);
        const prev = await readPack(userId, e.bandId, e.eventId);
        if (!prev) continue;
        const fresh = now.getTime() - new Date(prev.savedAt).getTime() < FRESH_MS;
        if (fresh && !force.includes(e.eventId)) continue;
        await refreshPack({ userId, event: e.row, occurrenceDate: serverDates.get(e.eventId) ?? prev.event.event_date, withFiles: false, unknownTitle, partial: true });
        tidied++;
      }
    }
    return tidied;
  }
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
    if (!keepGoing()) break;
    const prev = await readPack(userId, e.bandId, e.eventId);
    const date = serverDates.get(e.eventId) ?? e.date;
    const fresh = prev && !prev.partial && prev.event.event_date === date && now.getTime() - new Date(prev.savedAt).getTime() < FRESH_MS;
    if (fresh && !force.includes(e.eventId)) continue;
    const pack = await refreshPack({ userId, event: e.row, occurrenceDate: date, withFiles: true, unknownTitle });
    if (pack) done++;
  }
  return done;
}
