/**
 * Song files (audio + charts) in Supabase Storage.
 *
 * Bucket `song-files` is PRIVATE (migration 047): objects live under
 * `<band_id>/...` and only active members of that band can read or write them.
 * Songs store a reference `sb://song-files/<path>`; the app turns it into a
 * short-lived signed URL when someone plays or opens the file.
 */
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { supabase } from '../supabase';
import { t } from '@/lib/i18n';
import { UserError } from '../userError';

export const SONG_FILES_BUCKET = 'song-files';
const REF_PREFIX = `sb://${SONG_FILES_BUCKET}/`;

export const SONG_AUDIO_MAX_BYTES = 50 * 1024 * 1024;
export const SONG_CHART_MAX_BYTES = 20 * 1024 * 1024;

const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'aif', 'aiff', 'ogg', 'flac'];
const CHART_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'heic', 'webp'];

/** Accept attribute for <input type="file"> (iOS Files shows iCloud, Drive, Dropbox…). */
export const SONG_FILE_ACCEPT = [
  ...AUDIO_EXT.map((e) => `.${e}`),
  ...CHART_EXT.map((e) => `.${e}`),
  'audio/*',
  'application/pdf',
].join(',');

export type SongFileKind = 'audio' | 'chart';

const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '');

/** MIME types the `song-files` bucket accepts (migration 047, allowed_mime_types). */
export const SONG_FILE_MIME_TYPES: readonly string[] = [
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/wav', 'audio/x-wav',
  'audio/wave', 'audio/aiff', 'audio/x-aiff', 'audio/ogg', 'audio/flac', 'audio/x-flac',
  'application/pdf', 'image/png', 'image/jpeg', 'image/heic', 'image/webp',
];

/** Extension → MIME type, for when the browser/OS gives no (or an odd) type. */
const MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/x-m4a',
  aac: 'audio/aac',
  wav: 'audio/wav',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  heic: 'image/heic',
  webp: 'image/webp',
};

const unsupportedTypeMessage = () =>
  t('This file type is not supported. Use MP3, M4A, WAV, AIFF, AAC, OGG or FLAC audio, or a PDF, PNG, JPG, HEIC or WebP chart.');

/**
 * Content type to upload with: the file's own type when the bucket accepts
 * it, otherwise the type implied by the extension. Null when neither is
 * accepted by the bucket.
 */
export const songFileContentType = (file: Pick<File, 'name' | 'type'>): string | null => {
  const type = (file.type || '').toLowerCase();
  if (type && SONG_FILE_MIME_TYPES.includes(type)) return type;
  const byExt = MIME_BY_EXT[extOf(file.name)];
  return byExt && SONG_FILE_MIME_TYPES.includes(byExt) ? byExt : null;
};

export const classifySongFile = (file: Pick<File, 'name' | 'type'>): SongFileKind | null => {
  const ext = extOf(file.name);
  if (file.type.startsWith('audio/') || AUDIO_EXT.includes(ext)) return 'audio';
  if (file.type === 'application/pdf' || file.type.startsWith('image/') || CHART_EXT.includes(ext)) return 'chart';
  return null;
};

/** Human-readable problem with a picked file, or null if it can be uploaded. */
export const validateSongFile = (file: Pick<File, 'name' | 'type' | 'size'>): string | null => {
  const kind = classifySongFile(file);
  if (!kind) return t('Use an audio file (MP3, M4A, WAV…) or a chart (PDF or image).');
  if (!songFileContentType(file)) return unsupportedTypeMessage();
  const max = kind === 'audio' ? SONG_AUDIO_MAX_BYTES : SONG_CHART_MAX_BYTES;
  if (file.size > max) {
    const mb = Math.round(max / 1024 / 1024);
    return kind === 'audio' ? t('File too large: max {mb} MB for audio.', { mb }) : t('File too large: max {mb} MB for charts.', { mb });
  }
  return null;
};

export const isStoredSongFile = (ref?: string | null): ref is string => !!ref && ref.startsWith(REF_PREFIX);

/** Only https links may be stored or opened (no javascript:, data:, file:…). */
export const safeHttpsUrl = (input?: string | null): string | undefined => {
  const value = (input || '').trim();
  if (!value) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

export const safeName = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(-80) || 'file';

/**
 * Upload a picked file for a band; returns the reference to store on the song.
 * `suggestedBy`: a member's file for a song they suggest goes in
 * `<band>/suggestions/<their id>/`, the only place members can write (108);
 * admins write anywhere in the band's folder.
 */
export const uploadSongFile = async (
  bandId: string,
  file: File,
  opts?: { suggestedBy?: string | null },
): Promise<{ ref: string; kind: SongFileKind; error: null } | { ref: null; kind: null; error: Error }> => {
  const problem = validateSongFile(file);
  if (problem) return { ref: null, kind: null, error: new UserError(problem) };
  const kind = classifySongFile(file)!;
  const contentType = songFileContentType(file);
  if (!contentType) return { ref: null, kind: null, error: new UserError(unsupportedTypeMessage()) };
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
  const folder = opts?.suggestedBy ? `${bandId}/suggestions/${opts.suggestedBy}/${kind}` : `${bandId}/${kind}`;
  const path = `${folder}/${id}-${safeName(file.name)}`;
  const { error } = await supabase.storage.from(SONG_FILES_BUCKET).upload(path, file, {
    contentType,
    upsert: false,
    cacheControl: '3600',
  });
  // Storage's own text stays out of the UI (userMessage maps size / type / network).
  if (error) return { ref: null, kind: null, error: Object.assign(new Error(error.message || 'Upload failed'), { statusCode: (error as { statusCode?: unknown }).statusCode }) };
  return { ref: `${REF_PREFIX}${path}`, kind, error: null };
};

/** Playable/openable URL for a stored file or an https link; null otherwise. */
export const resolveSongFileUrl = async (ref?: string | null): Promise<string | null> => {
  if (!ref) return null;
  // Band files, and a person's own files (109: bucket personal-files, owner only).
  const stored = ref.match(/^sb:\/\/(song-files|personal-files)\/(.+)$/);
  if (stored) {
    const { data, error } = await supabase.storage.from(stored[1]).createSignedUrl(stored[2], 60 * 60);
    return error ? null : data?.signedUrl ?? null;
  }
  return safeHttpsUrl(ref) ?? null;
};

/** A file a member uploaded with a song they suggested (`<band>/suggestions/<id>/…`). */
export const isSuggestionFile = (ref?: string | null): ref is string =>
  isStoredSongFile(ref) && ref.slice(REF_PREFIX.length).split('/')[1] === 'suggestions';

/** The parts of the Supabase client file adoption uses (a test passes its own). */
type AdoptClient = Pick<typeof supabase, 'rpc' | 'from' | 'storage'>;
type Field = 'audio_url' | 'chart_url';
type AdoptRefs = { audio_url?: string; chart_url?: string };
const asError = (e: unknown, fallback: string): Error =>
  e instanceof Error ? e : new Error(String((e as { message?: unknown })?.message || fallback));

/**
 * An accepted suggested song: its files move into the band's own folders, so
 * the member who suggested it can no longer replace or delete them (197 also
 * stops them on the server) and the copy belongs to the band, not to the
 * member's account.
 *
 * Nothing here can leave a song on a missing file (audit 09 #5 / #9, PR #295
 * review), whatever runs at once (two admins, one admin on phone + iPad) or
 * stops half-way:
 *  1. bw_song_file_adopt_begin: the server says whether to go and names the
 *     destination, unique per song (`<band>/<kind>/<song id>-<name>`).
 *  2. Copy. A copy already there (an earlier or parallel run) is used only
 *     if it is the same file (size + hash); else a new name is picked.
 *  3. bw_song_file_adopt_repoint: the song row locked on the server, the
 *     reference changed only if it is still the original. The original is
 *     recorded for the sweep in the same transaction.
 *  4. The sweep deletes recorded originals no song uses, each claimed on
 *     the server right before its delete (see sweepAdoptedFiles).
 * Deleted by a run: only a copy it made itself, when the server (song row
 * locked) says no song uses it. A lost response is re-read, never undone.
 * Returns the new references written to the song.
 */
export const adoptSuggestionFiles = async (
  song: { id: string; band_id?: string | null; audio_url?: string | null; chart_url?: string | null },
  opts?: { client?: AdoptClient; busyWait?: BusyWait },
): Promise<{ refs: AdoptRefs; error: Error | null }> => {
  const client = opts?.client ?? supabase;
  const busyWait = opts?.busyWait ?? { tries: 6, ms: 1500 };
  const refs: AdoptRefs = {};
  let error: Error | null = null;
  let bandId = song.band_id ?? null;
  try {
    for (const field of ['audio_url', 'chart_url'] as const) {
      const ref = song[field];
      if (!isSuggestionFile(ref)) continue;
      bandId ??= ref.slice(REF_PREFIX.length).split('/')[0];
      const one = await adoptOne(client, song.id, field, busyWait);
      if (one.ref) refs[field] = one.ref;
      if (one.error) error ??= one.error;
    }
  } catch (e) {
    error ??= asError(e, 'Could not move the files');
  }
  if (bandId) {
    const swept = await sweepAdoptedFiles(bandId, { client });
    if (swept.error && !error && Object.keys(refs).length === 0) error = swept.error;
  }
  return { refs, error };
};

/** How long a run waits for another admin's run on the same file (then the retry on the next visit). */
type BusyWait = { tries: number; ms: number };

/** The song's own copy (`<band>/<kind>/<song id>-…`), not the suggestion original. */
const isOwnCopy = (ref: string | null | undefined, songId: string): ref is string => {
  if (!isStoredSongFile(ref)) return false;
  const parts = ref.slice(REF_PREFIX.length).split('/');
  return parts.length === 3 && parts[1] !== 'suggestions' && parts[2].startsWith(`${songId}-`);
};

async function adoptOne(client: AdoptClient, songId: string, field: Field, busyWait: BusyWait): Promise<{ ref?: string; error?: Error }> {
  const bucket = client.storage.from(SONG_FILES_BUCKET);
  const { data: claim, error: claimError } = await client.rpc('bw_song_file_adopt_begin', { p_song_id: songId, p_field: field });
  if (claimError) return { error: asError(claimError, 'Could not move the files') };
  const c = (claim || {}) as { won?: boolean; from?: string; to?: string; reason?: string; ref?: string | null };
  // Another admin is moving it right now: wait for their repoint and report
  // the copy the song then uses (not the original this screen still shows).
  if (c.reason === 'busy') {
    for (let n = 0; n < busyWait.tries; n++) {
      await new Promise((r) => setTimeout(r, busyWait.ms));
      const now = await currentRef(client, songId, field);
      if (isOwnCopy(now, songId)) return { ref: now };
      if (now !== undefined && !isSuggestionFile(now)) return {};
    }
    return {};
  }
  // Nothing to move: maybe another device already finished. Then the song
  // links its own copy (the server's current reference): report that one.
  if (c.reason === 'nothing' && isOwnCopy(c.ref, songId)) return { ref: c.ref };
  // Waiting for review or nothing to move.
  if (!c.won || !c.from || !c.to) return {};

  // 2. The copy: ours, or the same file already there.
  let to: string | null = null;
  let created = false;
  for (let attempt = 0; attempt < 3 && !to; attempt++) {
    const candidate = attempt === 0 ? c.to : withTag(c.to, songId);
    const { error: copyError } = await bucket.copy(c.from, candidate);
    if (!copyError) {
      to = candidate;
      created = true;
    } else if (!alreadyExists(copyError)) {
      return { error: asError(copyError, 'Could not copy the file') };
    } else if (await sameFile(bucket, c.from, candidate)) {
      to = candidate;
    }
  }
  if (!to) return { error: new Error('Could not find a free name for the file') };

  // 3. Repoint, on the server, only if the song still links to the original.
  const { data, error: repointError } = await client.rpc('bw_song_file_adopt_repoint', {
    p_song_id: songId,
    p_field: field,
    p_from: c.from,
    p_to: to,
  });
  const res = data as { won?: boolean; ref?: string | null; to_referenced?: boolean } | null;
  if (repointError || !res) {
    // Lost response: it may have been saved. Re-read; delete nothing either way
    // (an unused copy is picked up again by the next run).
    const now = await currentRef(client, songId, field);
    return now === `${REF_PREFIX}${to}` ? { ref: now } : { error: asError(repointError, 'Could not move the files') };
  }
  if (res.won) return { ref: `${REF_PREFIX}${to}` };
  // Another run finished first: the song already links to a copy.
  if (res.ref && res.ref === `${REF_PREFIX}${to}`) return { ref: res.ref };
  if (isStoredSongFile(res.ref) && res.ref.startsWith(`${REF_PREFIX}${to.split('/').slice(0, 2).join('/')}/${songId}-`)) return { ref: res.ref };
  // The song changed meanwhile: only a copy this run made, and no song uses.
  if (created && res.to_referenced === false) await bucket.remove([to]).catch(() => undefined);
  return { error: new Error('The song changed while its files were being moved.') };
}

/** A sibling name for a destination taken by another file: `<song id>-<tag>-<name>`. */
const withTag = (path: string, songId: string) => {
  const cut = path.lastIndexOf('/');
  const name = path.slice(cut + 1);
  const rest = name.startsWith(`${songId}-`) ? name.slice(songId.length + 1) : name;
  const tag =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${path.slice(0, cut + 1)}${songId}-${tag}-${rest}`;
};

/** Same file: same size and same hash (etag). Unknown counts as different. */
async function sameFile(bucket: ReturnType<AdoptClient['storage']['from']>, a: string, b: string): Promise<boolean> {
  try {
    const [x, y] = await Promise.all([bucket.info(a), bucket.info(b)]);
    const fx = x.data as { size?: number; etag?: string } | null;
    const fy = y.data as { size?: number; etag?: string } | null;
    return !!fx && !!fy && fx.size != null && fx.size === fy.size && !!fx.etag && fx.etag === fy.etag;
  } catch {
    return false;
  }
}

async function currentRef(client: AdoptClient, songId: string, field: Field): Promise<string | null | undefined> {
  try {
    const { data } = await client.from('songs').select('audio_url, chart_url').eq('id', songId).maybeSingle();
    return data ? ((data as Record<Field, string | null>)[field] ?? null) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Originals of moved files no song uses any more (the server checks every
 * song). Each one is claimed right before its delete: the server re-checks,
 * under a lock, that no song links it (a song that links it meanwhile keeps
 * it), and refuses new links while it is being deleted. Then the Storage
 * delete, then done. A delete that fails leaves the claim, which lapses after
 * 10 minutes: the next sweep retries it.
 */
export const sweepAdoptedFiles = async (bandId: string, opts?: { client?: AdoptClient }): Promise<{ error: Error | null }> => {
  const client = opts?.client ?? supabase;
  let first: Error | null = null;
  try {
    const { data, error } = await client.rpc('bw_song_file_sweep_list', { p_band_id: bandId });
    if (error) return { error: asError(error, 'Could not tidy the song files') };
    const paths = ((data as string[] | null) || []).filter((p) => typeof p === 'string' && p.startsWith(`${bandId}/suggestions/`));
    for (const path of paths) {
      const { data: claim, error: claimError } = await client.rpc('bw_song_file_sweep_claim', { p_band_id: bandId, p_path: path });
      if (claimError) {
        first ??= asError(claimError, 'Could not tidy the song files');
        continue;
      }
      // Linked again, being deleted by someone else, or already gone: skip it.
      if (!(claim as { ok?: boolean } | null)?.ok) continue;
      const { error: removeError } = await client.storage.from(SONG_FILES_BUCKET).remove([path]);
      if (removeError) {
        first ??= asError(removeError, 'Could not tidy the song files');
        continue;
      }
      const { error: doneError } = await client.rpc('bw_song_file_sweep_done', { p_band_id: bandId, p_paths: [path] });
      if (doneError) first ??= asError(doneError, 'Could not tidy the song files');
    }
    return { error: first };
  } catch (e) {
    return { error: asError(e, 'Could not tidy the song files') };
  }
};

const alreadyExists = (e: unknown) => {
  const x = e as { statusCode?: unknown; status?: unknown; message?: unknown };
  return String(x?.statusCode ?? x?.status ?? '') === '409' || /already exists|duplicate/i.test(String(x?.message ?? ''));
};

/** A song past review that still links to files in a member's suggestions folder (an adoption to finish). */
export const hasUnadoptedFiles = (song: { status?: string | null; audio_url?: string | null; chart_url?: string | null }) =>
  song.status !== 'suggested' && (isSuggestionFile(song.audio_url) || isSuggestionFile(song.chart_url));

/** Delete stored files nothing else uses (ignores links). Best effort: unsure means kept. */
export const removeSongFiles = async (refs: Array<string | null | undefined>): Promise<void> => {
  const stored = [...new Set(refs.filter(isStoredSongFile))];
  if (stored.length === 0) return;
  try {
    // Only through a claim (197): the server returns the files nothing uses
    // and, until we close the claim (or 10 minutes pass), refuses any new
    // link to them, so nothing can link a file between the check and the
    // delete. If it can't claim, keep them all: a leftover file costs space,
    // a missing one loses a band's recording.
    const { data, error } = await supabase.rpc('bw_song_files_claim_delete', { p_refs: stored });
    if (error || !Array.isArray(data)) return;
    const claimed = stored.filter((r) => (data as string[]).includes(r));
    if (claimed.length === 0) return;
    const { error: removeError } = await supabase.storage.from(SONG_FILES_BUCKET).remove(claimed.map((r) => r.slice(REF_PREFIX.length)));
    // A failed delete keeps the claim: it lapses, and the files stay.
    if (removeError) return;
    await supabase.rpc('bw_song_files_removed', { p_refs: claimed });
  } catch {
    /* kept */
  }
};

/**
 * Open a stored file or https link outside the app.
 *
 * Pass several candidates (e.g. recording, then Spotify, then YouTube) to open
 * the first one that resolves. Call it straight from the click handler, before
 * any other `await`: on the web a blank tab is opened synchronously (so popup
 * blockers allow it) and pointed at the signed URL once it is ready. On native
 * the URL opens in the in-app browser, which has a Done button back to the app.
 */
export const openSongResource = async (
  refs?: string | null | Array<string | null | undefined>,
): Promise<boolean> => {
  const candidates = (Array.isArray(refs) ? refs : [refs]).filter((r): r is string => !!r);
  if (candidates.length === 0) return false;

  if (Capacitor.isNativePlatform()) {
    for (const ref of candidates) {
      const url = await resolveSongFileUrl(ref);
      if (!url) continue;
      try {
        await Browser.open({ url });
        return true;
      } catch {
        /* try the next candidate */
      }
    }
    return false;
  }

  // Web: open the tab now, while we still have the user gesture.
  let win: Window | null = null;
  try {
    win = window.open('about:blank', '_blank');
    if (win) win.opener = null;
  } catch {
    win = null;
  }

  for (const ref of candidates) {
    const url = await resolveSongFileUrl(ref);
    if (!url) continue;
    if (win && !win.closed) {
      win.location.href = url;
    } else {
      window.location.assign(url);
    }
    return true;
  }

  win?.close();
  return false;
};

/* ── Files from cloud providers (Google Drive…) ─────────────────────────────
 * Picked through Android's Drive provider, a file can arrive with no
 * extension and an empty or generic type ("application/octet-stream"), so
 * the type checks rejected real MP3s. The first bytes tell what it is.
 * ───────────────────────────────────────────────────────────────────────── */

const sniffExt = (b: Uint8Array): string | null => {
  const s = (from: number, len: number) => String.fromCharCode(...b.slice(from, from + len));
  if (s(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return 'mp3';
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'aac';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return 'wav';
  if (s(0, 4) === 'FORM' && (s(8, 4) === 'AIFF' || s(8, 4) === 'AIFC')) return 'aiff';
  if (s(0, 4) === 'fLaC') return 'flac';
  if (s(0, 4) === 'OggS') return 'ogg';
  if (s(4, 4) === 'ftyp') return 'm4a';
  if (s(0, 4) === '%PDF') return 'pdf';
  if (b[0] === 0x89 && s(1, 3) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'webp';
  return null;
};

/**
 * The picked file as-is when its name/type are usable; otherwise a copy named
 * and typed from its content (e.g. "Track 01" from Drive → "Track 01.mp3").
 */
export const normalizeSongFile = async (file: File): Promise<File> => {
  if (classifySongFile(file) && songFileContentType(file)) return file;
  try {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const ext = sniffExt(head);
    if (!ext) return file;
    const base = file.name.replace(/\.[^/.]+$/, '') || 'file';
    return new File([file], `${base}.${ext}`, { type: MIME_BY_EXT[ext], lastModified: file.lastModified });
  } catch {
    return file;
  }
};

/** Drive file id from a share link ("…/file/d/<id>/view", "open?id=<id>", "uc?id=<id>"). */
export const googleDriveFileId = (url: string): string | null => {
  try {
    const u = new URL(url);
    if (!/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$|drive\.usercontent\.google\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/\/file\/d\/([\w-]{10,})/);
    return m?.[1] || u.searchParams.get('id');
  } catch {
    return null;
  }
};

/**
 * URL an <audio> element can stream: Drive share links (an HTML viewer page)
 * become the direct file download. Works for files shared as "Anyone with
 * the link"; a private Drive file can't be streamed by any app.
 */
export const playableAudioUrl = (url: string): string => {
  const id = googleDriveFileId(url);
  return id ? `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download` : url;
};
