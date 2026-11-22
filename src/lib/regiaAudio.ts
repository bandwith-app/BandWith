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
 *   shared laptop for the next person (audit 06 #2). Only the folders of the
 *   accounts that downloaded here go, never the whole place: a slow cleanup
 *   can't take what the next account downloads (#296 round 6), and a new
 *   download waits for a cleanup still running.
 * - Copies of older builds (one shared folder, no owner: any account that
 *   used the device may have downloaded them) at the first launch of this
 *   build: those of the signed-in account's own songs (its offline songs and
 *   live packs on this device) move into its folder, the rest are deleted
 *   (#296 round 7). With no session they stay until a sign-in or sign-out
 *   deletes them (#296 round 6).
 */
import { Capacitor } from '@capacitor/core';
import { playableAudioUrl, resolveSongFileUrl } from './services/songFiles';
import { sessionUserId } from './sessionUser';

/** Older builds' folder (one for everybody, no owner): moved to its account at the first launch (#296 round 6). */
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

/** The older builds' places: the shared folder, and on iOS Documents (builds up to 11-20) and Library (test builds). */
const legacyDirs = async (): Promise<string[]> => {
  const { Directory } = await fs();
  return Capacitor.getPlatform?.() === 'ios' ? [Directory.LibraryNoCloud, Directory.Documents, Directory.Library] : [Directory.LibraryNoCloud];
};
/** Deletes the older builds' copies. True when they are all gone. */
const removeLegacy = async (): Promise<boolean> => (await Promise.all((await legacyDirs()).map((d) => removeNative(DIR, d)))).every(Boolean);
/** rmdir, then checked: true only if the folder is really gone (not just "nothing to delete"). */
const removeNative = async (path: string, directory: string): Promise<boolean> => {
  const { Filesystem } = await fs();
  await Filesystem.rmdir({ path, directory: directory as never, recursive: true }).catch(() => undefined);
  return Filesystem.stat({ path, directory: directory as never }).then(
    () => false,
    () => true,
  );
};
/** The older builds' copy of one song, if there is one (read only, see readLegacy). */
const legacyNativeUri = async (key: string): Promise<string | null> => {
  const { Filesystem } = await fs();
  for (const directory of await legacyDirs()) {
    try {
      const st = await Filesystem.stat({ path: `${DIR}/${key}`, directory: directory as never });
      if (st.size > 0) return st.uri;
    } catch {
      /* not there */
    }
  }
  return null;
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
/**
 * The older builds' copies are read only while nobody can own them yet: this
 * build first launched with no session (it expired offline) and nobody has
 * signed in since. Then the old build would have played them too.
 */
const readLegacy = () => store.get(LEGACY_KEY) === 'unclaimed';

/** Which of `refs` are already on this device (the signed-in account's). */
export async function cachedAudio(refs: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const native = Capacitor.isNativePlatform();
  const owner = await readOwner();
  const legacy = !owner && readLegacy();
  if (!owner && !legacy) return out;
  await Promise.all(
    [...new Set(refs)].map(async (ref) => {
      try {
        const key = await audioKey(ref);
        const has = owner
          ? native
            ? !!(await nativeUri(owner, key))
            : !!(await idb('readonly', (s) => s.getKey(webKey(owner, key))))
          : native
            ? !!(await legacyNativeUri(key))
            : !!(await idb('readonly', (s) => s.getKey(key)));
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
/** The account that downloaded here last (read only with its session expired offline). */
const OWNER_KEY = 'bw-regia-audio:owner';
/** Every account with a folder here (a sign-out deletes these, and only these). */
const OWNERS_KEY = 'bw-regia-audio:owners';
/** The older builds' copies: 'done' (moved or deleted), 'unclaimed' (first launch had no session). */
const LEGACY_KEY = 'bw-regia-audio:legacy';
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
const readList = (k: string): string[] => {
  try {
    const v: unknown = JSON.parse(store.get(k) || '[]');
    return Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string') : [];
  } catch {
    return [];
  }
};
const writeList = (k: string, list: string[]) => store.set(k, list.length ? JSON.stringify([...new Set(list)]) : null);
const addOwner = (owner: string) => writeList(OWNERS_KEY, [...readList(OWNERS_KEY), owner]);

/**
 * The accounts whose recordings a cleanup still has to delete, and whether
 * the older builds' copies still have to go (a sign-out's). Read from the
 * round-4 format ({ user }) and the first one ('1') too.
 */
interface Pending {
  users: string[];
  legacy: boolean;
}
/**
 * The same, in memory too (#296 round 8, Codex r8 B4): with the storage full
 * the mark can't be written, so the deletion still knows what to delete
 * (this visit; the owner list stays until each deletion is confirmed).
 */
let memPending: Pending | null = null;
const readPending = (): Pending | null => {
  const a = readStoredPending();
  const b = memPending;
  if (!a && !b) return null;
  return { users: [...new Set([...(a?.users ?? []), ...(b?.users ?? [])])], legacy: !!a?.legacy || !!b?.legacy };
};
const readStoredPending = (): Pending | null => {
  const v = store.get(PENDING_KEY);
  if (!v) return null;
  try {
    const p = JSON.parse(v) as { users?: unknown; user?: unknown; legacy?: unknown } | number;
    if (!p || typeof p !== 'object') return { users: [], legacy: true };
    const users = Array.isArray(p.users) ? p.users.filter((u): u is string => typeof u === 'string') : [];
    if (typeof p.user === 'string') users.push(p.user);
    return { users: [...new Set(users)], legacy: p.legacy !== false };
  } catch {
    return { users: [], legacy: true };
  }
};
const writePending = (p: Pending | null) => {
  memPending = p && (p.users.length || p.legacy) ? { users: [...new Set(p.users)], legacy: p.legacy } : null;
  store.set(PENDING_KEY, memPending ? JSON.stringify(memPending) : null);
};
/** One more account to delete (a download that couldn't be deleted after its session ended). */
const addPending = (owner: string | null, legacy = false) => {
  const p = readPending();
  writePending({ users: [...(p?.users ?? []), ...(owner ? [owner] : [])], legacy: legacy || !!p?.legacy });
};
/**
 * A cleanup is done with `tried`: what is left of it stays pending, anything
 * marked meanwhile too. An account leaves the owner list only now, its
 * deletion confirmed (#296 round 8, B4); one kept (signed in again) stays.
 */
const settlePending = (tried: Pending, left: Purged) => {
  const now = readPending();
  writePending({
    users: [...(now?.users ?? []).filter((u) => !tried.users.includes(u)), ...left.users],
    legacy: left.legacy || (!!now?.legacy && !tried.legacy),
  });
  const gone = tried.users.filter((u) => !left.users.includes(u) && !left.kept.includes(u));
  if (gone.length) writeList(OWNERS_KEY, readList(OWNERS_KEY).filter((u) => !gone.includes(u)));
  if (tried.legacy && !left.legacy) store.set(LEGACY_KEY, 'done');
};

/** What a purge left: still to delete, and accounts kept (signed in now). */
type Purged = Pending & { kept: string[] };

/** Something still to delete: tried again in a while, while this app runs (B4: a mark that couldn't be written). */
let retryTimer: ReturnType<typeof setTimeout> | undefined;
const RETRY_CLEANUP_MS = 30_000;
const retryLater = () => {
  if (retryTimer !== undefined || !readPending()) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void (async () => {
      const me = await sessionUserId();
      await exclusive(async () => {
        const p = readPending();
        if (p) settlePending(p, await purge(p, me));
      });
      retryLater();
    })().catch(() => undefined);
  }, RETRY_CLEANUP_MS);
};

/**
 * Cleanups and legacy moves, one at a time; a download waits for the one
 * running (#296 round 6: a slow sign-out cleanup never meets a new download).
 */
let busy: Promise<unknown> = Promise.resolve();
/** Across this browser's tabs too, where the browser has it (#296 round 8, Codex r8 B2). */
const locked = <T>(run: () => Promise<T>): Promise<T> => {
  const locks = typeof navigator !== 'undefined' ? (navigator as { locks?: { request?: (n: string, f: () => Promise<T>) => Promise<T> } }).locks : undefined;
  return typeof locks?.request === 'function' ? locks.request('bw-regia-audio', run) : run();
};
const exclusive = <T>(run: () => Promise<T>): Promise<T> => {
  const go = () => locked(run);
  const next = busy.then(go, go);
  busy = next.catch(() => undefined);
  return next;
};

/**
 * Deletes `users`' recordings (never `me`'s, the account signed in now) and,
 * with `legacy`, the older builds' copies; says what is left. Only those
 * folders or keys: never the whole place, so nothing another account put
 * there meanwhile goes. Every deletion is checked; an error keeps it pending.
 */
async function purge({ users, legacy }: Pending, me: string | null): Promise<Purged> {
  const others = users.filter((u) => u !== me);
  const kept = me && users.includes(me) ? [me] : [];
  if (Capacitor.isNativePlatform()) {
    try {
      const { Directory } = await fs();
      const legacyLeft = legacy && !(await removeLegacy());
      const left: string[] = [];
      for (const u of others) {
        // Signed in again meanwhile (a slow cleanup): theirs now, kept (#296 round 7).
        if ((await sessionUserId()) === u) {
          addOwner(u); // still theirs to delete at their next sign-out
          kept.push(u);
          continue;
        }
        if (!(await removeNative(`${ROOT}/${ownerDir(u)}`, Directory.LibraryNoCloud))) left.push(u);
      }
      return { users: left, legacy: legacyLeft, kept };
    } catch {
      return { users: others, legacy, kept };
    }
  }
  if (typeof indexedDB === 'undefined') return { users: [], legacy: false, kept };
  try {
    const keys = await idb('readonly', (s) => s.getAllKeys());
    for (const k of keys) {
      const key = String(k);
      // No owner prefix: an older build's copy. Signed in again meanwhile: theirs now, kept (#296 round 7).
      const owner = others.find((u) => key.startsWith(`${ownerDir(u)}/`));
      if (owner && (await sessionUserId()) === owner) {
        addOwner(owner);
        if (!kept.includes(owner)) kept.push(owner);
        continue;
      }
      if ((legacy && !key.includes('/')) || owner) await idb('readwrite', (s) => s.delete(k));
    }
    return { users: [], legacy: false, kept };
  } catch {
    return { users: others, legacy, kept };
  }
}

/**
 * The song files of `me`'s own songs, as file keys: every `audio_url` (and
 * a live pack's `audio`) in what this device keeps offline for that account.
 */
async function ownKeys(me: string): Promise<Set<string>> {
  const refs = new Set<string>();
  const collect = (v: unknown, depth = 0): void => {
    if (!v || typeof v !== 'object' || depth > 8) return;
    if (Array.isArray(v)) return v.forEach((x) => collect(x, depth + 1));
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if ((k === 'audio_url' || k === 'audio') && typeof x === 'string' && x) refs.add(x);
      else collect(x, depth + 1);
    }
  };
  try {
    const { listOfflineKeys, getOfflineItem } = await import('./offline/storage');
    for (const k of await listOfflineKeys(`bw:${me}:`)) collect(await getOfflineItem<unknown>(k));
  } catch {
    /* nothing cached: none of them is known to be this account's */
  }
  return new Set(await Promise.all([...refs].map(audioKey)));
}

/**
 * The older builds' copies at the first launch of this build. The folder was
 * shared by every account that used the device, so the session found here
 * (the last account signed in) is not proof they are its own: only the files
 * of its own songs move to its folder, the rest are deleted (#296 round 7,
 * Claude). True when nothing is left there.
 */
async function adoptLegacy(me: string, alive: () => boolean): Promise<boolean> {
  const mine = await ownKeys(me);
  // A sign-out meanwhile (#296 round 8, Codex r8 B2): stop; what was moved already goes with it.
  const stopped = () => {
    if (alive()) return false;
    addPending(me);
    return true;
  };
  if (stopped()) return false;
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await fs();
    const dir = `${ROOT}/${ownerDir(me)}`;
    let all = true;
    for (const directory of await legacyDirs()) {
      let names: string[] = [];
      try {
        names = (await Filesystem.readdir({ path: DIR, directory: directory as never })).files.map((f) => (typeof f === 'string' ? f : f.name));
      } catch {
        continue; // no such folder
      }
      if (names.some((n) => mine.has(n))) {
        if (stopped()) return false;
        await Filesystem.mkdir({ path: dir, directory: Directory.LibraryNoCloud, recursive: true }).catch(() => undefined);
        addOwner(me);
      }
      for (const name of names) {
        if (stopped()) return false;
        const to = { path: `${dir}/${name}`, directory: Directory.LibraryNoCloud };
        const there = !mine.has(name) || (await Filesystem.stat(to).then((st) => st.size > 0, () => false));
        try {
          // Not one of its songs, or already in its folder: deleted.
          if (there) await Filesystem.deleteFile({ path: `${DIR}/${name}`, directory: directory as never });
          else await Filesystem.rename({ from: `${DIR}/${name}`, directory: directory as never, to: to.path, toDirectory: to.directory });
        } catch {
          all = false;
        }
      }
      if (all) all = await removeNative(DIR, directory);
    }
    if (stopped()) return false;
    if (all && !store.get(OWNER_KEY)) store.set(OWNER_KEY, me);
    return all;
  }
  if (typeof indexedDB === 'undefined') return true;
  try {
    const keys = (await idb('readonly', (s) => s.getAllKeys())).map(String).filter((k) => !k.includes('/'));
    if (stopped()) return false;
    if (keys.some((k) => mine.has(k))) addOwner(me);
    for (const key of keys) {
      if (stopped()) return false;
      const v = mine.has(key) ? await idb<StoredAudio | undefined>('readonly', (s) => s.get(key) as IDBRequest<StoredAudio | undefined>) : undefined;
      if (v?.data && !(await idb('readonly', (s) => s.getKey(webKey(me, key))))) {
        await idb('readwrite', (s) => s.put({ ...v, owner: me } satisfies StoredAudio, webKey(me, key)));
      }
      await idb('readwrite', (s) => s.delete(key));
    }
    if (stopped()) return false;
    if (!store.get(OWNER_KEY)) store.set(OWNER_KEY, me);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sign-out: every song file the accounts here downloaded goes (the band's
 * private recordings), and downloads still on their way keep nothing, in
 * other tabs of this browser too. Called once the session has ended. Only
 * those accounts' folders go (and the older builds' copies), never the whole
 * place: an account signing in meanwhile keeps what it downloads, and its
 * downloads wait for this (#296 round 6). Marked first, and the mark goes
 * only once the deletion is confirmed; otherwise the next launch finishes it.
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
  // Synchronously, before anything else can start: who goes. Marked (in memory too, B4); the
  // owner list keeps each account until its deletion is confirmed (settlePending).
  const last = store.get(OWNER_KEY);
  if (last) addOwner(last);
  const owners = [...readList(OWNERS_KEY), ...(last ? [last] : [])];
  addPending(null, true);
  for (const u of owners) addPending(u);
  // Signed out: its files are no longer found by the offline fallback.
  store.set(OWNER_KEY, null);
  await exclusive(async () => {
    // Read when it runs (B2): a legacy move stopped by this sign-out added its account.
    const tried = readPending() ?? { users: owners, legacy: true };
    settlePending(tried, await purge(tried, null));
  });
  retryLater();
}

/**
 * At launch: a sign-out's deletion that didn't finish is finished now, for
 * the accounts it names only: whoever is signed in now keeps theirs. Then
 * the older builds' copies move into the signed-in account's folder (the
 * session they were downloaded under: the update keeps it); with no session
 * they stay where they are, read only (#296 round 6).
 */
export async function finishPendingAudioCleanup(): Promise<void> {
  const alive = audioSession();
  const me = await sessionUserId();
  // Other accounts still listed (a deletion that never finished): not this account's to keep (#296 round 8).
  if (me) for (const u of readList(OWNERS_KEY)) if (u !== me) addPending(u);
  await exclusive(async () => {
    const pending = readPending();
    if (pending) settlePending(pending, await purge(pending, me));
    const legacy = store.get(LEGACY_KEY);
    if (legacy === 'done') return;
    if (!me) {
      store.set(LEGACY_KEY, 'unclaimed');
      return;
    }
    if (legacy === 'unclaimed') {
      // Left unclaimed at an earlier launch: whoever is signed in now may be another account (#296 round 7).
      const tried = { users: [], legacy: true };
      settlePending(tried, await purge(tried, me));
      return;
    }
    if (await adoptLegacy(me, alive).catch(() => false)) store.set(LEGACY_KEY, 'done');
  });
  retryLater();
}

/**
 * A sign-in. The older builds' copies left unclaimed (the first launch had
 * no session) may be another account's: deleted, never handed to this one.
 */
export async function legacyAudioSignedIn(): Promise<void> {
  // Marked at once: the app closed before the deletion ends, the next launch finishes it (#296 round 7).
  if (store.get(LEGACY_KEY) === 'unclaimed') addPending(null, true);
  // Other accounts' recordings still listed here (#296 round 8, Claude r7): this account never keeps them.
  const me = await sessionUserId();
  const others = me ? readList(OWNERS_KEY).filter((u) => u !== me) : [];
  for (const u of others) addPending(u);
  await exclusive(async () => {
    const legacy = store.get(LEGACY_KEY) === 'unclaimed';
    const p = readPending();
    const tried = { users: others.filter((u) => p?.users.includes(u)), legacy };
    if (!tried.users.length && !tried.legacy) return;
    settlePending(tried, await purge(tried, me));
  });
  retryLater();
}

async function downloadOnce(ref: string, onProgress: (fraction: number | null) => void): Promise<DownloadResult> {
  otherTabs();
  const started = generation;
  const mark = clearedMark();
  const stale = () => generation !== started || clearedMark() !== mark;
  // The account it is downloaded for: signed out (an expired session too) or someone else by the end, not kept.
  // No session (expired offline): nothing is downloaded (#296 round 5).
  // A cleanup still running (a sign-out's, a legacy move) first: it never meets this download
  // (10 s at most: a stuck one can't block the Regia; it only ever deletes other accounts' folders).
  await Promise.race([busy, new Promise((r) => setTimeout(r, 10_000))]);
  const owner = await sessionUserId();
  if (!owner) return { ok: false, reason: isOnline() ? 'failed' : 'offline' };
  if (stale()) return { ok: false, reason: 'failed' };
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
      const { Filesystem } = await fs();
      const { FileTransfer } = await import('@capacitor/file-transfer');
      const loc = await nativeLoc(owner, key);
      const listener = await FileTransfer.addListener('progress', (p) => {
        if (p.url === url) onProgress(p.lengthComputable && p.contentLength > 0 ? Math.min(1, p.bytes / p.contentLength) : null);
      });
      addOwner(owner);
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
    addOwner(owner);
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
    if (!owner && !readLegacy()) {
      /* nobody's copy to read: streamed */
    } else if (Capacitor.isNativePlatform()) {
      const uri = owner ? await nativeUri(owner, key) : await legacyNativeUri(key);
      if (uri) return { url: Capacitor.convertFileSrc(uri), local: true };
    } else {
      const at = owner ? webKey(owner, key) : key;
      const stored = await idb<StoredAudio | undefined>('readonly', (s) => s.get(at) as IDBRequest<StoredAudio | undefined>);
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
