/**
 * Audio on the Regia device (stage manager mode): the songs' files kept on
 * the device before the gig, and the one player that plays them out to the
 * mixer. Only the Regia device ever uses this module (useStageRegia creates
 * the player when the Regia turns on); no other phone loads any audio.
 *
 * - Native apps: the file is downloaded once (@capacitor/file-transfer) into
 *   the app's private library with no cloud backup (iOS Library/NoCloud,
 *   excluded from iCloud by AppDelegate; Android's files folder, app backup
 *   off) and played from there, so on stage it needs no network. It stays
 *   there for the next gigs (one file per song link).
 * - Any screen may ask for a song (Stage, the download before the gig): the
 *   same song asked twice at once is downloaded once.
 * - Web (a laptop at the mixer): kept in IndexedDB as a Blob. A link the
 *   browser can't fetch (a Google Drive share, CORS) plays streamed instead,
 *   and is not counted as ready.
 * - Sign-out removes them all, downloads still on their way included
 *   (clearDownloadedAudio): a band's private recordings never stay on a
 *   shared laptop for the next person (audit 06 #2).
 */
import { Capacitor } from '@capacitor/core';
import { playableAudioUrl, resolveSongFileUrl } from './services/songFiles';
import { sessionUserId } from './sessionUser';

/** Older builds' folder (one for everybody, no owner): never read, deleted (#296 round 5). */
const DIR = 'regia-audio';
/**
 * One folder per account (`<ROOT>/<user id>/<file>`), and on the web one key
 * prefix per account in the database: a cleanup for one account never
 * touches another's recordings (#296 round 5).
 */
const ROOT = 'regia-audio-by-owner';
const ownerDir = (owner: string) => owner.replace(/[^A-Za-z0-9_-]/g, '_');
const webKey = (owner: string, key: string) => `${ownerDir(owner)}/${key}`;
const DB = 'bw-regia-audio';
const STORE = 'files';

/** A short, file-name-safe key for a song file reference. */
export async function audioKey(ref: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ref)));
  return [...digest.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Web: IndexedDB ───────────────────────────────────────────────────────

interface StoredAudio {
  type: string;
  data: ArrayBuffer;
  /** The account that downloaded it (#296 round 4); missing in copies of older builds. */
  owner?: string | null;
}

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const idb = async <R>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<R>): Promise<R> => {
  const db = await openDb();
  try {
    return await new Promise<R>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
};

// ── Native: Filesystem ───────────────────────────────────────────────────

let fsModule: Promise<typeof import('@capacitor/filesystem')> | null = null;
/** The plugin, imported once (concurrent first imports would load it twice). */
const fs = () => (fsModule ??= import('@capacitor/filesystem'));

/**
 * Where the files live: the library with no cloud backup. The download and
 * the check must use the same folder: the deprecated Filesystem.downloadFile
 * didn't know this one (iOS wrote into Documents, Android failed), so no song
 * was ever "ready" (field bug 11-20). file-transfer takes the full path.
 */
const nativeLoc = async (owner: string, key: string) => {
  const { Directory } = await fs();
  return { path: `${ROOT}/${ownerDir(owner)}/${key}`, directory: Directory.LibraryNoCloud };
};

const nativeUri = async (owner: string, key: string): Promise<string | null> => {
  const { Filesystem } = await fs();
  try {
    const st = await Filesystem.stat(await nativeLoc(owner, key));
    return st.size > 0 ? st.uri : null;
  } catch {
    return null;
  }
};

/**
 * Copies in the old places, never used again: the shared folder of builds
 * before per-account folders, Documents (iOS builds up to 11-20) and Library
 * (test builds of the first fix). Not moved into anyone's folder (whose they
 * are can't be known, and moving could hand one account's recordings to
 * another): deleted, at the first download here and at every cleanup.
 * True when they are all gone.
 */
const removeLegacy = async (): Promise<boolean> => {
  const { Filesystem, Directory } = await fs();
  const dirs = Capacitor.getPlatform?.() === 'ios' ? [Directory.LibraryNoCloud, Directory.Documents, Directory.Library] : [Directory.LibraryNoCloud];
  return (await Promise.all(dirs.map((d) => removeNative(DIR, d)))).every(Boolean);
};
/** rmdir, then checked: true only if the folder is really gone (not just "nothing to delete"). */
const removeNative = async (path: string, directory: string): Promise<boolean> => {
  const { Filesystem } = await fs();
  await Filesystem.rmdir({ path, directory: directory as never, recursive: true }).catch(() => undefined);
  return Filesystem.stat({ path, directory: directory as never }).then(
    () => false,
    () => true,
  );
};
let leftoversCleared = false;
const clearLeftovers = async () => {
  if (leftoversCleared) return;
  leftoversCleared = true;
  await removeLegacy().catch(() => undefined);
};

/** Where a song file can be fetched from (a signed URL for band files, Drive links made direct). */
const remoteUrl = async (ref: string): Promise<string | null> => {
  const resolved = await resolveSongFileUrl(ref);
  return resolved ? playableAudioUrl(resolved) : null;
};

// ── Why a song can't be ready ─────────────────────────────────────────────

/**
 * - link: the link gives no audio file (a private Drive file, a folder, a web page, a link that refuses).
 * - offline: no internet now (it downloads once back online).
 * - format: the file is there but this device can't play it.
 * - failed: anything else (storage full, the download broke off).
 */
export type AudioFailure = 'link' | 'offline' | 'format' | 'failed';

export type DownloadResult = { ok: true } | { ok: false; reason: AudioFailure };

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/** The first bytes of an audio file (MP3, WAV, M4A/AAC, FLAC, OGG), not a web page or an error. */
export function looksLikeAudio(head: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (ascii(0, 3) === 'ID3') return true;
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return true; // MPEG / ADTS frame
  if (ascii(0, 4) === 'RIFF' || ascii(0, 4) === 'fLaC' || ascii(0, 4) === 'OggS' || ascii(0, 4) === 'FORM') return true;
  if (ascii(4, 8) === 'ftyp') return true; // M4A, MP4
  return false;
}

/** Why the player couldn't load a song (what Play tells the stage manager). */
export function audioFailureFor({ online, downloadReason, local }: { online: boolean; downloadReason?: AudioFailure; local: boolean }): AudioFailure {
  if (local) return 'format';
  if (!online) return 'offline';
  return downloadReason ?? 'link';
}

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * Whose recordings this device may read: the signed-in account, or, with its
 * session expired offline, the account that last downloaded here (read only:
 * nothing is ever downloaded without a session, #296 round 5).
 */
const readOwner = async (): Promise<string | null> => (await sessionUserId()) ?? store.get(OWNER_KEY);

/** Which of `refs` are already on this device (the signed-in account's). */
export async function cachedAudio(refs: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const native = Capacitor.isNativePlatform();
  const owner = await readOwner();
  if (!owner) return out;
  await Promise.all(
    [...new Set(refs)].map(async (ref) => {
      try {
        const key = await audioKey(ref);
        const has = native ? !!(await nativeUri(owner, key)) : !!(await idb('readonly', (s) => s.getKey(webKey(owner, key))));
        if (has) out.add(ref);
      } catch {
        /* storage blocked: not cached */
      }
    }),
  );
  return out;
}

/**
 * Download one song file onto the device, reporting progress (0–1, or null
 * when the size is unknown). A link that gives a web page instead of audio
 * (a private Drive file) is not kept.
 */
export function downloadAudio(ref: string, onProgress?: (fraction: number | null) => void): Promise<DownloadResult> {
  let run = inflight.get(ref);
  if (!run) {
    const listeners = new Set<(fraction: number | null) => void>();
    const promise = downloadOnce(ref, (p) => listeners.forEach((l) => l(p))).finally(() => {
      // Only this run's entry (sign-out may have cleared it and a new one started).
      if (inflight.get(ref)?.promise === promise) inflight.delete(ref);
    });
    run = { promise, listeners };
    inflight.set(ref, run);
  }
  if (onProgress) run.listeners.add(onProgress);
  const listeners = run.listeners;
  return run.promise.finally(() => {
    if (onProgress) listeners.delete(onProgress);
  });
}

/** Downloads running now, by song file reference (one per song, whoever asked). */
const inflight = new Map<string, { promise: Promise<DownloadResult>; listeners: Set<(fraction: number | null) => void> }>();

/** Bumped by sign-out: a download that started before it keeps nothing. */
let generation = 0;
/** Web downloads on their way (sign-out stops them). */
const fetches = new Set<AbortController>();

/**
 * Sign-out in any tab of this browser (#296 B5): its mark in the storage the
 * tabs share, read again right before a download writes, and a message to
 * the other tabs so they stop theirs at once.
 */
const CLEARED_KEY = 'bw-regia-audio:cleared';
const clearedMark = (): string | null => {
  try {
    return localStorage.getItem(CLEARED_KEY);
  } catch {
    return null;
  }
};
let tabs: BroadcastChannel | null = null;
const otherTabs = (): BroadcastChannel | null => {
  if (!tabs && typeof BroadcastChannel !== 'undefined') {
    try {
      tabs = new BroadcastChannel(DB);
      tabs.onmessage = (e) => {
        if (e.data === 'cleared') stopDownloads();
      };
    } catch {
      tabs = null;
    }
  }
  return tabs;
};
function stopDownloads() {
  generation += 1;
  inflight.clear();
  fetches.forEach((c) => c.abort());
  fetches.clear();
}

/**
 * A batch of downloads (the setlist's songs, one after the other) holds on
 * to this: false once anyone signed out, here or in another tab, so the
 * batch stops instead of starting the next song (#296 round 3).
 */
export function audioSession(): () => boolean {
  otherTabs();
  const started = generation;
  const mark = clearedMark();
  return () => generation === started && clearedMark() === mark;
}

/**
 * Sign-out whose deletion didn't finish (the 3 s budget ran out, the app was
 * closed): marked, and finished at the next launch (finishPendingAudioCleanup).
 */
const PENDING_KEY = 'bw-regia-audio:cleanup-pending';
/** The account the downloads on this device belong to (the one a pending deletion is for). */
const OWNER_KEY = 'bw-regia-audio:owner';
const store = {
  get: (k: string): string | null => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  },
};
/**
 * The accounts whose recordings a cleanup still has to delete (#296 round 5),
 * and whether the older builds' shared copies are still there. Read from the
 * round-4 format ({ user }) and the first one ('1') too.
 */
interface Pending {
  users: string[];
}
const readPending = (): Pending | null => {
  const v = store.get(PENDING_KEY);
  if (!v) return null;
  try {
    const p = JSON.parse(v) as { users?: unknown; user?: unknown } | number;
    if (!p || typeof p !== 'object') return { users: [] };
    const users = Array.isArray(p.users) ? p.users.filter((u): u is string => typeof u === 'string') : [];
    if (typeof p.user === 'string') users.push(p.user);
    return { users: [...new Set(users)] };
  } catch {
    return { users: [] };
  }
};
const writePending = (p: Pending | null) => store.set(PENDING_KEY, p ? JSON.stringify({ users: [...new Set(p.users)] }) : null);
/** One more account to delete (a download that couldn't be deleted after its session ended). */
const addPending = (owner: string | null) => writePending({ users: [...(readPending()?.users ?? []), ...(owner ? [owner] : [])] });

/**
 * Deletes recordings and says what is left to delete. `me`: who is signed in
 * now (null: nobody, so everything goes); otherwise only `users`' folders go,
 * never `me`'s, and never another account's. The older builds' shared copies
 * go in both cases. Every deletion is checked; an error keeps it pending.
 */
async function purge(users: string[], me: string | null): Promise<Pending | null> {
  const others = users.filter((u) => u !== me);
  if (Capacitor.isNativePlatform()) {
    try {
      const { Directory } = await fs();
      const legacyGone = await removeLegacy();
      let left: string[];
      if (me === null) left = (await removeNative(ROOT, Directory.LibraryNoCloud)) ? [] : others;
      else {
        left = [];
        for (const u of others) if (!(await removeNative(`${ROOT}/${ownerDir(u)}`, Directory.LibraryNoCloud))) left.push(u);
      }
      return left.length || !legacyGone ? { users: left } : null;
    } catch {
      return { users: others };
    }
  }
  if (typeof indexedDB === 'undefined') return null;
  if (me === null) {
    // Nobody signed in: the whole database (never opened here: a device that never was the Regia gets none).
    return new Promise<Pending | null>((resolve) => {
      try {
        const req = indexedDB.deleteDatabase(DB);
        req.onsuccess = () => resolve(null);
        // Not deleted (an error), or another tab still has it open: still to do.
        req.onerror = req.onblocked = () => resolve({ users: others });
      } catch {
        resolve({ users: others });
      }
    });
  }
  try {
    const prefixes = others.map((u) => `${ownerDir(u)}/`);
    const keys = await idb('readonly', (s) => s.getAllKeys());
    for (const k of keys) {
      const key = String(k);
      // No owner prefix: an older build's copy (never read): deleted too.
      if (!key.includes('/') || prefixes.some((p) => key.startsWith(p))) await idb('readwrite', (s) => s.delete(k));
    }
    return null;
  } catch {
    return { users: others };
  }
}

/**
 * Sign-out: every song file this device downloaded goes (the band's private
 * recordings), and downloads still on their way keep nothing, in other tabs
 * of this browser too. Called once the session has ended (nobody is signed
 * in): the whole folder goes. Marked first, and the mark goes only once the
 * deletion is confirmed; otherwise the next launch finishes it, for the
 * accounts it names only (finishPendingAudioCleanup).
 */
export async function clearDownloadedAudio(): Promise<void> {
  stopDownloads();
  try {
    localStorage.setItem(CLEARED_KEY, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  } catch {
    /* storage blocked: this tab only */
  }
  try {
    otherTabs()?.postMessage('cleared');
  } catch {
    /* no other tabs to tell */
  }
  addPending(store.get(OWNER_KEY));
  store.set(OWNER_KEY, null);
  writePending(await purge(readPending()?.users ?? [], null));
}

/**
 * At launch: a sign-out's deletion that didn't finish is finished now, for
 * the accounts it names only: whoever is signed in now keeps theirs (#296
 * round 5: another person's downloads since then are never touched).
 */
export async function finishPendingAudioCleanup(): Promise<void> {
  const pending = readPending();
  if (!pending) return;
  writePending(await purge(pending.users, await sessionUserId()));
}

async function downloadOnce(ref: string, onProgress: (fraction: number | null) => void): Promise<DownloadResult> {
  otherTabs();
  const started = generation;
  const mark = clearedMark();
  const stale = () => generation !== started || clearedMark() !== mark;
  // The account it is downloaded for: signed out (an expired session too) or someone else by the end, not kept.
  // No session (expired offline): nothing is downloaded (#296 round 5).
  const owner = await sessionUserId();
  if (!owner) return { ok: false, reason: isOnline() ? 'failed' : 'offline' };
  const gone = async () => stale() || (await sessionUserId()) !== owner;
  let url: string | null = null;
  try {
    url = await remoteUrl(ref);
  } catch {
    return { ok: false, reason: isOnline() ? 'failed' : 'offline' };
  }
  if (!url) return { ok: false, reason: isOnline() || !ref.startsWith('sb://') ? 'link' : 'offline' };
  try {
    const key = await audioKey(ref);
    if (Capacitor.isNativePlatform()) {
      void clearLeftovers();
      const { Filesystem } = await fs();
      const { FileTransfer } = await import('@capacitor/file-transfer');
      const loc = await nativeLoc(owner, key);
      const listener = await FileTransfer.addListener('progress', (p) => {
        if (p.url === url) onProgress(p.lengthComputable && p.contentLength > 0 ? Math.min(1, p.bytes / p.contentLength) : null);
      });
      // Make the folder first (Android's download may not): it fails when it's already there, which is fine.
      await Filesystem.mkdir({ path: `${ROOT}/${ownerDir(owner)}`, directory: loc.directory, recursive: true }).catch(() => undefined);
      try {
        // Native download: no CORS, straight to disk (a 50 MB file never sits in memory).
        const { uri } = await Filesystem.getUri(loc);
        await FileTransfer.downloadFile({ url, path: uri, progress: true });
      } catch (e) {
        // An HTTP error is the link (Drive answers 404 for a private or deleted file).
        const status = (e as { httpStatus?: number } | null)?.httpStatus;
        return { ok: false, reason: status || isOnline() ? 'link' : 'offline' };
      } finally {
        void listener.remove();
      }
      if (await gone()) {
        // Signed out while it came down: not kept. The delete is checked; one that failed
        // stays marked for the next launch (#296 round 4).
        await Filesystem.deleteFile(loc).catch(() => undefined);
        if (await Filesystem.stat(loc).then(() => true, () => false)) addPending(owner);
        return { ok: false, reason: 'failed' };
      }
      const st = await Filesystem.stat(loc);
      const head = st.size > 0 ? fromBase64(String((await Filesystem.readFile({ ...loc, offset: 0, length: 16 })).data)) : new Uint8Array();
      if (!looksLikeAudio(head)) {
        await Filesystem.deleteFile(loc).catch(() => undefined);
        return { ok: false, reason: 'link' };
      }
      store.set(OWNER_KEY, owner);
      return { ok: true };
    }
    if (stale()) return { ok: false, reason: 'failed' };
    const abort = new AbortController();
    fetches.add(abort);
    let res: Response;
    let data: ArrayBuffer;
    try {
      try {
        res = await fetch(url, { signal: abort.signal });
      } catch {
        if (stale()) return { ok: false, reason: 'failed' };
        // Offline, or a site that doesn't let the browser fetch it (it may still stream).
        return { ok: false, reason: isOnline() ? 'link' : 'offline' };
      }
      if (!res.ok || /text\/html|json/.test(res.headers.get('content-type') ?? '')) return { ok: false, reason: 'link' };
      data = await readBody(res, onProgress);
    } finally {
      fetches.delete(abort);
    }
    // Signed out while it came down: not kept.
    if (await gone()) return { ok: false, reason: 'failed' };
    if (!data.byteLength || !looksLikeAudio(new Uint8Array(data, 0, Math.min(16, data.byteLength)))) return { ok: false, reason: 'link' };
    const type = res.headers.get('content-type') || 'audio/mpeg';
    // Bytes, not a Blob: Safari's private windows refuse Blobs in IndexedDB.
    store.set(OWNER_KEY, owner);
    await idb('readwrite', (s) => s.put({ type, data, owner } satisfies StoredAudio, webKey(owner, key)));
    if (await gone()) {
      // Signed out while it was being written (another tab): taken back out.
      await idb('readwrite', (s) => s.delete(webKey(owner, key))).catch(() => addPending(owner));
      return { ok: false, reason: 'failed' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: isOnline() ? 'failed' : 'offline' };
  }
}

/** A response body as bytes, reporting progress while it arrives. */
async function readBody(res: Response, onProgress?: (fraction: number | null) => void): Promise<ArrayBuffer> {
  const total = Number(res.headers.get('content-length')) || 0;
  if (!onProgress || !res.body) return res.arrayBuffer();
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress(total ? Math.min(1, got / total) : null);
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out.buffer;
}

/** A URL the player can use: the copy on the device, or else streamed from the network. */
export async function playableUrl(ref: string): Promise<{ url: string; local: boolean } | null> {
  try {
    const key = await audioKey(ref);
    const owner = await readOwner();
    if (!owner) {
      /* nobody's copy to read: streamed */
    } else if (Capacitor.isNativePlatform()) {
      const uri = await nativeUri(owner, key);
      if (uri) return { url: Capacitor.convertFileSrc(uri), local: true };
    } else {
      const stored = await idb<StoredAudio | undefined>('readonly', (s) => s.get(webKey(owner, key)) as IDBRequest<StoredAudio | undefined>);
      if (stored?.data) return { url: URL.createObjectURL(new Blob([stored.data], { type: stored.type })), local: true };
    }
  } catch {
    /* fall back to streaming */
  }
  const url = await remoteUrl(ref);
  return url ? { url, local: false } : null;
}

// ── The player ───────────────────────────────────────────────────────────

export type RegiaPlayerStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';

export interface RegiaPlayerSnapshot {
  status: RegiaPlayerStatus;
  positionMs: number;
  durationMs: number | null;
}

/** What useStageRegia needs from a player (a fake one in tests). */
export interface RegiaPlayer {
  /** Load a file; resolves once it can play (false: it can't). */
  load(url: string): Promise<boolean>;
  play(): Promise<boolean>;
  pause(): void;
  /** Stop and rewind, fading out first where the device allows it. */
  stop(fadeMs?: number): Promise<void>;
  /** Stop and drop the file: nothing is loaded any more (a song with no audio is up). */
  unload(): void;
  snapshot(): RegiaPlayerSnapshot;
  /** Called on every change (status, a new position about 4× a second). */
  subscribe(fn: () => void): () => void;
  dispose(): void;
}

/** The real player: one <audio> element, out through the device's output (the cable to the mixer). */
export function createRegiaPlayer(): RegiaPlayer {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.setAttribute('playsinline', '');
  let status: RegiaPlayerStatus = 'idle';
  let objectUrl: string | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const setStatus = (s: RegiaPlayerStatus) => {
    status = s;
    emit();
  };
  audio.addEventListener('playing', () => setStatus('playing'));
  audio.addEventListener('pause', () => {
    if (status === 'playing') setStatus('paused');
  });
  audio.addEventListener('ended', () => setStatus('ended'));
  audio.addEventListener('timeupdate', emit);
  audio.addEventListener('durationchange', emit);
  audio.addEventListener('error', () => {
    if (status !== 'idle') setStatus('error');
  });

  // iOS 17+: media plays as "playback" (the silent switch doesn't mute it).
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
  } catch {
    /* not supported */
  }

  // iOS ignores element volume: there the stop is immediate (Stop needs a hold anyway).
  const canFade = (() => {
    try {
      audio.volume = 0.5;
      const ok = Math.abs(audio.volume - 0.5) < 0.01;
      audio.volume = 1;
      return ok;
    } catch {
      return false;
    }
  })();

  const release = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };
  const empty = () => {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    release();
  };
  /** Disposed (Stage closed): a load or play still on its way does nothing (audit 06 #7). */
  let disposed = false;

  return {
    load(url) {
      if (disposed) return Promise.resolve(false);
      release();
      if (url.startsWith('blob:')) objectUrl = url;
      setStatus('loading');
      return new Promise<boolean>((resolve) => {
        const done = (ok: boolean) => {
          audio.removeEventListener('canplay', onOk);
          audio.removeEventListener('error', onErr);
          if (ok) setStatus('ready');
          resolve(ok);
        };
        const onOk = () => done(true);
        const onErr = () => done(false);
        audio.addEventListener('canplay', onOk);
        audio.addEventListener('error', onErr);
        audio.volume = 1;
        audio.src = url;
        audio.load();
      });
    },
    async play() {
      if (disposed) return false;
      try {
        if (status === 'ended') audio.currentTime = 0;
        await audio.play();
        return true;
      } catch {
        setStatus('paused');
        return false;
      }
    },
    pause() {
      audio.pause();
    },
    async stop(fadeMs = 600) {
      if (canFade && !audio.paused && fadeMs > 0) {
        const steps = 12;
        for (let i = steps - 1; i >= 0; i--) {
          audio.volume = i / steps;
          await new Promise((r) => setTimeout(r, fadeMs / steps));
        }
      }
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1;
      setStatus('ready');
    },
    unload() {
      empty();
      setStatus('idle');
    },
    snapshot() {
      const d = audio.duration;
      return {
        status,
        positionMs: Math.round((audio.currentTime || 0) * 1000),
        durationMs: Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : null,
      };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      disposed = true;
      empty();
      listeners.clear();
      status = 'idle';
    },
  };
}
