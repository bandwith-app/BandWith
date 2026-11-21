/**
 * A song's score on this device (sheet music plan §4.4): downloaded once,
 * then read from the device, so Stage mode shows it at a venue with no
 * signal. A score's reference never changes (a new upload gets a new
 * path), so the kept copy is always the current one: read it first.
 *
 * - Kept in IndexedDB as text (MusicXML is small: tens of KB), in the web
 *   app and in the iOS / Android web views alike.
 * - Stage mode keeps the whole setlist's scores before the gig
 *   (prefetchScores), not only the ones opened.
 * - The demo build's made-up scores come from a bundled chunk, never the network.
 */
import { resolveSongFileUrl } from './services/songFiles';
import { DEMO_SCORE_PREFIX, isDemoScoreRef, scoreXml } from './score';

export interface ScoreStore {
  get(key: string): Promise<string | null>;
  set(key: string, xml: string): Promise<void>;
}

const DB = 'bw-scores';
const STORE = 'scores';

const idbStore = (): ScoreStore => {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const run = async <R>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<R>): Promise<R> => {
    const db = await open();
    try {
      return await new Promise<R>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    get: async (key) => {
      try {
        const v = await run<unknown>('readonly', (s) => s.get(key));
        return typeof v === 'string' ? v : null;
      } catch {
        return null;
      }
    },
    set: async (key, xml) => {
      try {
        await run('readwrite', (s) => s.put(xml, key));
      } catch {
        /* private mode / no storage: this session only */
      }
    },
  };
};

let store: ScoreStore | null = null;
const getStore = () => (store ??= typeof indexedDB !== 'undefined' ? idbStore() : { get: async () => null, set: async () => {} });

/** Tests: another place to keep scores. */
export const setScoreStore = (s: ScoreStore | null) => {
  store = s;
  memory.clear();
};

/** Read this session already: no IndexedDB round trip when switching views or songs. */
const memory = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

/** A short key for a score reference (two FNV-1a hashes: no secret in it, only a name). */
export async function scoreCacheKey(ref: string): Promise<string> {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x811c9dc5) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}${ref.length.toString(16)}`;
}

async function demoScore(ref: string): Promise<string> {
  const { DEMO_SCORES } = await import('./demo/scores');
  const xml = DEMO_SCORES[ref.slice(DEMO_SCORE_PREFIX.length)];
  if (!xml) throw new Error('not-found');
  return xml;
}

async function download(ref: string): Promise<string> {
  let url: string | null = null;
  let bytes: Uint8Array;
  try {
    url = await resolveSongFileUrl(ref);
    if (!url) throw new Error('offline');
    const res = await fetch(url);
    if (!res.ok) throw new Error('offline');
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    throw new Error('offline');
  }
  return scoreXml(bytes);
}

async function load(ref: string): Promise<string> {
  if (isDemoScoreRef(ref)) return demoScore(ref);
  const key = await scoreCacheKey(ref);
  const kept = await getStore().get(key);
  if (kept) return kept;
  const xml = await download(ref);
  await getStore().set(key, xml);
  return xml;
}

/** The score's MusicXML text. Throws 'offline' (no copy, no network), 'not-musicxml', 'not-found' (demo). */
export function loadScore(ref: string): Promise<string> {
  const hit = memory.get(ref);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(ref);
  if (!p) {
    p = load(ref)
      .then((xml) => {
        memory.set(ref, xml);
        return xml;
      })
      .finally(() => inflight.delete(ref));
    inflight.set(ref, p);
  }
  return p;
}

/** Keeps these scores on the device (Stage mode, before the gig). Returns how many were downloaded. */
export async function prefetchScores(refs: Array<string | null | undefined>): Promise<number> {
  const unique = [...new Set(refs.filter((r): r is string => !!r && !isDemoScoreRef(r)))];
  let downloaded = 0;
  for (const ref of unique) {
    try {
      const key = await scoreCacheKey(ref);
      if (await getStore().get(key)) continue;
      const xml = await download(ref);
      await getStore().set(key, xml);
      downloaded++;
    } catch {
      /* the next one: a missing file never stops the others */
    }
  }
  return downloaded;
}
