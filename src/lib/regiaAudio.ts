/**
 * Audio on the Regia device (stage manager mode): the songs' files kept on
 * the device before the gig, and the one player that plays them out to the
 * mixer. Only the Regia device ever uses this module (useStageRegia creates
 * the player when the Regia turns on); no other phone loads any audio.
 *
 * - Native apps: the file is downloaded once into the app's private library
 *   (no iCloud backup) and played from there, so on stage it needs no
 *   network.
 * - Web (a laptop at the mixer): kept in IndexedDB as a Blob. A link the
 *   browser can't fetch (a Google Drive share, CORS) plays streamed instead,
 *   and is not counted as ready.
 */
import { Capacitor } from '@capacitor/core';
import { playableAudioUrl, resolveSongFileUrl } from './services/songFiles';

const DIR = 'regia-audio';
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

const fs = () => import('@capacitor/filesystem');

const nativeUri = async (key: string): Promise<string | null> => {
  const { Filesystem, Directory } = await fs();
  try {
    const st = await Filesystem.stat({ path: `${DIR}/${key}`, directory: Directory.LibraryNoCloud });
    return st.size > 0 ? st.uri : null;
  } catch {
    return null;
  }
};

/** Where a song file can be fetched from (a signed URL for band files, Drive links made direct). */
const remoteUrl = async (ref: string): Promise<string | null> => {
  const resolved = await resolveSongFileUrl(ref);
  return resolved ? playableAudioUrl(resolved) : null;
};

/** Which of `refs` are already on this device. */
export async function cachedAudio(refs: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const native = Capacitor.isNativePlatform();
  await Promise.all(
    [...new Set(refs)].map(async (ref) => {
      try {
        const key = await audioKey(ref);
        const has = native ? !!(await nativeUri(key)) : !!(await idb('readonly', (s) => s.getKey(key)));
        if (has) out.add(ref);
      } catch {
        /* storage blocked: not cached */
      }
    }),
  );
  return out;
}

/** Download one song file onto the device. True when it is there afterwards. */
export async function downloadAudio(ref: string): Promise<boolean> {
  try {
    const key = await audioKey(ref);
    const url = await remoteUrl(ref);
    if (!url) return false;
    if (Capacitor.isNativePlatform()) {
      const { Filesystem, Directory } = await fs();
      // Native download: no CORS, straight to disk (a 50 MB file never sits in memory).
      await Filesystem.downloadFile({ url, path: `${DIR}/${key}`, directory: Directory.LibraryNoCloud, recursive: true });
      return !!(await nativeUri(key));
    }
    const res = await fetch(url);
    if (!res.ok) return false;
    // Bytes, not a Blob: Safari's private windows refuse Blobs in IndexedDB.
    const data = await res.arrayBuffer();
    if (!data.byteLength) return false;
    const type = res.headers.get('content-type') || 'audio/mpeg';
    await idb('readwrite', (s) => s.put({ type, data } satisfies StoredAudio, key));
    return true;
  } catch {
    return false;
  }
}

/** A URL the player can use: the copy on the device, or else streamed from the network. */
export async function playableUrl(ref: string): Promise<{ url: string; local: boolean } | null> {
  try {
    const key = await audioKey(ref);
    if (Capacitor.isNativePlatform()) {
      const uri = await nativeUri(key);
      if (uri) return { url: Capacitor.convertFileSrc(uri), local: true };
    } else {
      const stored = await idb<StoredAudio | undefined>('readonly', (s) => s.get(key) as IDBRequest<StoredAudio | undefined>);
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

  return {
    load(url) {
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
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      release();
      listeners.clear();
      status = 'idle';
    },
  };
}
