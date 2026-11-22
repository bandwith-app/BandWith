import { describe, it, expect, vi, beforeEach } from 'vitest';

// jsdom has no crypto.subtle (the file key is a SHA-256 of the link): Node's WebCrypto.
const nodeCrypto = 'node:crypto';
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = (await import(/* @vite-ignore */ nodeCrypto)) as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

/**
 * The Regia's audio on the device. Field bug (11-20, Mirage Music on a real
 * phone): "Audio ready 0/…" forever, Play did nothing, then "can't be
 * played". The native download went to a folder the download call doesn't
 * know (LIBRARY_NO_CLOUD: iOS wrote it into Documents, Android failed), so
 * the check afterwards never found it.
 */

const native = { on: true, platform: 'android' };
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.on,
    getPlatform: () => (native.on ? native.platform : 'web'),
    convertFileSrc: (u: string) => `capacitor://localhost/_capacitor_file_${u.replace('file://', '')}`,
  },
}));

const files = new Map<string, Uint8Array>();
const dirs = new Set<string>();
/** Android's native download ignores `recursive`: the folder has to exist already. */
const android = { on: false };
const key = (o: { path: string; directory?: string }) => `${o.directory}:${o.path}`;
const listeners: ((p: { type?: string; url: string; bytes: number; contentLength: number; lengthComputable?: boolean }) => void)[] = [];
/** What the download "fetches" for a URL. */
let served: (url: string) => Uint8Array | Error = () => new Uint8Array(4 << 20);

/** A file URI of the fake device: file:///<DIRECTORY>/<path>. */
const uriOf = (o: { path: string; directory: string }) => `file:///${o.directory}/${o.path}`;
const fromUri = (uri: string) => {
  const [, directory, ...rest] = uri.replace('file://', '').split('/');
  return { directory, path: rest.join('/') };
};
/** The deprecated Filesystem.downloadFile: must not be used any more. */
const legacyDownload = vi.fn(async () => {
  throw new Error('deprecated downloadFile used');
});
/** @capacitor/file-transfer: downloads to a full file path (from Filesystem.getUri). */
const transfer = vi.fn(async (o: { url: string; path: string; progress?: boolean }) => {
  const loc = fromUri(o.path);
  const parent = loc.path.split('/').slice(0, -1).join('/');
  if (android.on && parent && !dirs.has(key({ path: parent, directory: loc.directory }))) {
    throw Object.assign(new Error('ENOENT'), { code: 'OS-PLUG-FLTR-0010' });
  }
  const body = served(o.url);
  if (body instanceof Error) throw body;
  await new Promise((r) => setTimeout(r, 5));
  if (o.progress) listeners.forEach((l) => l({ type: 'download', url: o.url, bytes: body.length / 2, contentLength: body.length, lengthComputable: true }));
  files.set(key(loc), body);
  return { path: o.path };
});
const stat = vi.fn(async (o: { path: string; directory: string }) => {
  const f = files.get(key(o));
  if (!f) {
    // A folder: there while it holds a file.
    if ([...files.keys()].some((k) => k.startsWith(`${key(o)}/`))) return { type: 'directory', size: 0, uri: uriOf(o) };
    throw new Error('File does not exist');
  }
  return { size: f.length, uri: uriOf(o) };
});
const readFile = vi.fn(async (o: { path: string; directory: string; offset?: number; length?: number }) => {
  const f = files.get(key(o))!;
  const part = f.slice(o.offset ?? 0, (o.offset ?? 0) + (o.length ?? f.length));
  return { data: btoa(String.fromCharCode(...part)) };
});
const deleteFile = vi.fn(async (o: { path: string; directory: string }) => {
  files.delete(key(o));
});
const rmdir = vi.fn(async (o: { path: string; directory: string; recursive?: boolean }) => {
  for (const k of [...files.keys()]) if (o.recursive && k.startsWith(`${key(o)}/`)) files.delete(k);
});
const readdir = vi.fn(async (o: { path: string; directory: string }) => {
  const at = `${key(o)}/`;
  const names = [...files.keys()].filter((k) => k.startsWith(at)).map((k) => k.slice(at.length).split('/')[0]);
  if (!names.length) throw new Error('Folder does not exist');
  return { files: [...new Set(names)].map((name) => ({ name })) };
});
const rename = vi.fn(async (o: { from: string; to: string; directory: string; toDirectory?: string }) => {
  const from = key({ path: o.from, directory: o.directory });
  const f = files.get(from);
  if (!f) throw new Error('File does not exist');
  files.delete(from);
  files.set(key({ path: o.to, directory: o.toDirectory ?? o.directory }), f);
});
const mkdir = vi.fn(async (o: { path: string; directory: string }) => {
  if (dirs.has(key(o))) throw new Error('Directory exists');
  dirs.add(key(o));
});

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Library: 'LIBRARY', LibraryNoCloud: 'LIBRARY_NO_CLOUD', Documents: 'DOCUMENTS', Data: 'DATA', Cache: 'CACHE' },
  Filesystem: {
    downloadFile: () => legacyDownload(),
    getUri: async (o: { path: string; directory: string }) => ({ uri: uriOf(o) }),
    stat: (o: never) => stat(o),
    readFile: (o: never) => readFile(o),
    deleteFile: (o: never) => deleteFile(o),
    rmdir: (o: never) => rmdir(o),
    mkdir: (o: never) => mkdir(o),
    readdir: (o: never) => readdir(o),
    rename: (o: never) => rename(o),
  },
}));

vi.mock('@capacitor/file-transfer', () => ({
  FileTransfer: {
    downloadFile: (o: never) => transfer(o),
    addListener: async (_e: string, fn: (typeof listeners)[number]) => {
      listeners.push(fn);
      return {
        remove: async () => {
          listeners.splice(listeners.indexOf(fn), 1);
        },
      };
    },
  },
}));

/** Who is signed in on this device (sessionUserId). */
const auth = { user: 'admin-1' as string | null };
vi.mock('../sessionUser', () => ({ sessionUserId: async () => auth.user }));
vi.mock('../services/songFiles', () => ({
  resolveSongFileUrl: async (ref: string) => (ref.startsWith('https://') ? ref : null),
  playableAudioUrl: (u: string) => u.replace('/view', '/direct'),
}));

/** What this device keeps offline, per key (offline/storage.ts): an account's songs and live packs. */
const offline = new Map<string, unknown>();
/** A slow scan of what is kept offline (the legacy move reads it first): `gate` holds it. */
const scan = { gate: null as Promise<void> | null, started: false };
vi.mock('../offline/storage', () => ({
  listOfflineKeys: async (prefix: string) => {
    scan.started = true;
    await scan.gate;
    return [...offline.keys()].filter((k) => k.startsWith(prefix));
  },
  getOfflineItem: async (k: string) => offline.get(k) ?? null,
  clearOfflineCache: async () => {},
}));
/** A sign-out that ends this device's session (the failed-sign-out wipe calls it first, #296 round 8). */
const localSignOut = vi.fn(async (_o?: unknown) => {
  auth.user = null;
  return { error: null };
});
vi.mock('../supabase', () => ({ supabase: { auth: { signOut: (o: unknown) => localSignOut(o) } } }));
vi.mock('../appAnalytics', () => ({ ANALYTICS_CONSENT_KEY: 'bw.analytics.consent' }));

import authContext from '../AuthContext.tsx?raw';
import { audioFailureFor, audioKey, cachedAudio, clearDownloadedAudio, downloadAudio, finishPendingAudioCleanup, legacyAudioSignedIn, looksLikeAudio, playableUrl } from '../regiaAudio';

/** A tiny in-memory IndexedDB (jsdom has none): one database, one store, the calls regiaAudio makes. */
const idbData = new Map<string, Map<IDBValidKey, unknown>>();
function fakeIndexedDb() {
  const req = <R>(run: () => R) => {
    const r = { result: undefined as R | undefined, error: null, onsuccess: null as null | (() => void), onerror: null };
    setTimeout(() => {
      r.result = run();
      r.onsuccess?.();
    }, 0);
    return r;
  };
  const self = {
    failDelete: false,
    blockDelete: false,
    /** While set, every delete waits for it (a slow cleanup). */
    gate: null as Promise<void> | null,
    open: (name: string) => {
      const r = {
        result: undefined as unknown,
        error: null,
        onupgradeneeded: null as null | (() => void),
        onsuccess: null as null | (() => void),
        onerror: null,
      };
      setTimeout(() => {
        const fresh = !idbData.has(name);
        if (fresh) idbData.set(name, new Map());
        const data = idbData.get(name)!;
        const store = {
          get: (k: IDBValidKey) => req(() => data.get(k)),
          getKey: (k: IDBValidKey) => req(() => (data.has(k) ? k : undefined)),
          getAllKeys: () => req(() => [...data.keys()]),
          put: (v: unknown, k: IDBValidKey) => req(() => (data.set(k, v), k)),
          delete: (k: IDBValidKey) => {
            if (self.failDelete) {
              const r = { error: new Error('UnknownError'), onsuccess: null as null | (() => void), onerror: null as null | (() => void) };
              setTimeout(() => r.onerror?.(), 0);
              return r;
            }
            const r = { result: undefined, error: null, onsuccess: null as null | (() => void), onerror: null };
            void (self.gate ?? Promise.resolve()).then(() => {
              data.delete(k);
              r.onsuccess?.();
            });
            return r;
          },
          clear: () => req(() => void data.clear()),
        };
        r.result = { createObjectStore: () => store, transaction: () => ({ objectStore: () => store }), close: () => {} };
        if (fresh) r.onupgradeneeded?.();
        r.onsuccess?.();
      }, 0);
      return r;
    },
    deleteDatabase(name: string) {
      if (this.blockDelete) {
        const r = { error: null, onsuccess: null as null | (() => void), onerror: null, onblocked: null as null | (() => void) };
        setTimeout(() => r.onblocked?.(), 0);
        return r;
      }
      if (this.failDelete) {
        const r = { error: new Error('UnknownError'), onsuccess: null as null | (() => void), onerror: null as null | (() => void) };
        setTimeout(() => r.onerror?.(), 0);
        return r;
      }
      const r = { error: null, onsuccess: null as null | (() => void), onerror: null };
      void (this.gate ?? Promise.resolve()).then(() => {
        idbData.delete(name);
        r.onsuccess?.();
      });
      return r;
    },
  };
  return self;
}
const storedSongs = () => [...idbData.values()].reduce((n, m) => n + m.size, 0);

const DRIVE = 'https://drive.google.com/file/d/abc123456789/view';
const mp3 = () => {
  const b = new Uint8Array(4 << 20);
  b.set([0x49, 0x44, 0x33]); // "ID3"
  return b;
};

const SECOND = 'https://drive.google.com/file/d/def987654321/view';
/** admin-1's songs kept offline here (its songs list and a live pack). */
const ownSongs = () => {
  offline.set('bw:admin-1:band-1:songs', [{ id: 's1', title: 'Paper Boats', audio_url: DRIVE }]);
  offline.set('bw:admin-1:band-1:live_pack:e1', { songs: [{ id: 's2', title: 'Superstition', audio: SECOND }] });
};

/** Sign-out: the session ends first, then the recordings go (AuthContext); the same account may sign in again after. */
const signOutHere = async () => {
  const was = auth.user;
  auth.user = null;
  await clearDownloadedAudio();
  auth.user = was;
};

beforeEach(() => {
  offline.clear();
  auth.user = 'admin-1';
  native.on = true;
  native.platform = 'android';
  files.clear();
  dirs.clear();
  android.on = false;
  listeners.length = 0;
  vi.clearAllMocks();
  served = () => mp3();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('Regia audio on a phone (native)', () => {
  it('a downloaded song counts as ready: it is saved where the check looks for it', async () => {
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    expect(fromUri(transfer.mock.calls[0][0].path).directory).toBe(stat.mock.calls[stat.mock.calls.length - 1][0].directory);
    expect(await cachedAudio([DRIVE])).toEqual(new Set([DRIVE]));
    expect((await playableUrl(DRIVE))?.local).toBe(true);
  });

  it('saved in the library with no cloud backup, by the file-transfer plugin (not the deprecated download)', async () => {
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    expect(fromUri(transfer.mock.calls[0][0].path).directory).toBe('LIBRARY_NO_CLOUD');
    expect(legacyDownload).not.toHaveBeenCalled();
  });

  it('the same song asked twice at once (Stage and the download before the gig): one download, both told', async () => {
    const a: (number | null)[] = [];
    const b: (number | null)[] = [];
    const [ra, rb] = await Promise.all([downloadAudio(DRIVE, (p) => a.push(p)), downloadAudio(DRIVE, (p) => b.push(p))]);
    expect(ra).toEqual({ ok: true });
    expect(rb).toEqual({ ok: true });
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(a).toContain(0.5);
    expect(b).toContain(0.5);
  });

  it('Android: the folder is made first (its download does not make it), every song, not just the first', async () => {
    android.on = true;
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    expect(await downloadAudio('https://drive.google.com/file/d/other12345678/view')).toEqual({ ok: true });
  });

  it('reports the download progress of the song', async () => {
    const seen: (number | null)[] = [];
    await downloadAudio(DRIVE, (p) => seen.push(p));
    expect(seen).toContain(0.5);
  });

  it('a link that gives a web page (a private Drive file) is not counted as ready, and says why', async () => {
    served = () => new TextEncoder().encode('<!DOCTYPE html><html><body>Sign in</body></html>');
    expect(await downloadAudio(DRIVE)).toEqual({ ok: false, reason: 'link' });
    expect(await cachedAudio([DRIVE])).toEqual(new Set());
  });

  it('a link that refuses (404 from Drive) says the link is the problem', async () => {
    served = () => Object.assign(new Error('HTTP error: 404'), { code: 'OS-PLUG-FLTR-0011', httpStatus: 404 });
    expect(await downloadAudio(DRIVE)).toEqual({ ok: false, reason: 'link' });
  });

  it('no internet: says so (it downloads once back online)', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    served = () => new Error('The Internet connection appears to be offline.');
    expect(await downloadAudio(DRIVE)).toEqual({ ok: false, reason: 'offline' });
  });

  it('a song file that is not a link or a band file: nothing to download', async () => {
    expect(await downloadAudio('ftp://x')).toEqual({ ok: false, reason: 'link' });
    expect(transfer).not.toHaveBeenCalled();
  });
});

describe('audit 06 #2: sign-out leaves no private recording on this device', () => {
  const audioResponse = () => ({
    ok: true,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'audio/mpeg' : null) },
    body: null,
    arrayBuffer: async () => mp3().buffer,
  });
  const web = () => {
    native.on = false;
    idbData.clear();
    localStorage.clear();
    Object.defineProperty(globalThis, 'indexedDB', { value: fakeIndexedDb(), configurable: true, writable: true });
  };

  it('web (a shared laptop): the downloaded recordings are gone after sign-out', async () => {
    web();
    vi.stubGlobal('fetch', vi.fn(async () => audioResponse()));
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    expect(await cachedAudio([DRIVE])).toEqual(new Set([DRIVE]));
    await signOutHere();
    expect(storedSongs()).toBe(0);
    expect(await cachedAudio([DRIVE])).toEqual(new Set());
    vi.unstubAllGlobals();
  });

  it('web: a download still on its way when signing out is not kept', async () => {
    web();
    let arrive!: () => void;
    const fetchMock = vi.fn(
      (_u: string, init?: { signal?: AbortSignal }) =>
        new Promise((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          arrive = () => resolve(audioResponse());
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const run = downloadAudio(DRIVE);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await signOutHere();
    arrive?.();
    expect((await run).ok).toBe(false);
    expect(storedSongs()).toBe(0);
    expect(await cachedAudio([DRIVE])).toEqual(new Set());
    vi.unstubAllGlobals();
  });

  it('sign-out (once the session has ended) clears them', () => {
    const signOut = authContext.slice(authContext.indexOf('const handleSignOut'), authContext.indexOf('const handleResetPassword'));
    expect(signOut).toMatch(/if \(!error\) \{[^}]*import\('\.\/regiaAudio'\)\.then\(\(m\) => m\.clearDownloadedAudio\(\)\)/);
  });

  it('#296 B4: sign-out waits for the deletion before it returns (the app navigates right after)', () => {
    const signOut = authContext.slice(authContext.indexOf('const handleSignOut'), authContext.indexOf('const handleResetPassword'));
    const afterSignOut = signOut.slice(signOut.indexOf('if (!error) {'));
    expect(afterSignOut).toMatch(/await [^;]*import\('\.\/regiaAudio'\)\.then\(\(m\) => m\.clearDownloadedAudio\(\)\)/);
    expect(afterSignOut.indexOf('clearDownloadedAudio')).toBeLessThan(afterSignOut.indexOf('return { error }'));
  });

  it('#296 B5: another tab signing out: a download finishing here keeps nothing', async () => {
    web();
    let arrive!: () => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => (arrive = () => resolve(audioResponse())))));
    const run = downloadAudio(DRIVE);
    await vi.waitFor(() => expect(arrive).toBeTypeOf('function'));
    // The other tab: its sign-out leaves its mark in the storage both tabs share.
    localStorage.setItem('bw-regia-audio:cleared', String(Date.now()));
    arrive();
    expect((await run).ok).toBe(false);
    expect(storedSongs()).toBe(0);
    vi.unstubAllGlobals();
  });

  it('phone: the files in the app library go too, and one still downloading is deleted', async () => {
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    await signOutHere();
    expect(await cachedAudio([DRIVE])).toEqual(new Set());
    let land!: () => void;
    transfer.mockImplementationOnce(async (o: { url: string; path: string }) => {
      await new Promise<void>((r) => (land = r));
      files.set(key(fromUri(o.path)), mp3());
      return { path: o.path };
    });
    const run = downloadAudio(DRIVE);
    await vi.waitFor(() => expect(transfer).toHaveBeenCalledTimes(2));
    await signOutHere();
    land();
    expect((await run).ok).toBe(false);
    expect(await cachedAudio([DRIVE])).toEqual(new Set());
  });
});

describe('#296 round 3: nothing of the recordings is left behind', () => {
  const legacy = (directory: string) => files.set(`${directory}:regia-audio/old-song`, mp3());

  it('iPhone: sign-out right after the update also deletes the folders of older builds (Documents, Library)', async () => {
    native.platform = 'ios';
    legacy('DOCUMENTS');
    legacy('LIBRARY');
    await signOutHere();
    expect([...files.keys()].filter((k) => k.includes('regia-audio'))).toEqual([]);
  });

  it('a deletion that did not finish (the app closed, the 3 s ran out) is finished at the next launch', async () => {
    localStorage.clear();
    let done!: () => void;
    rmdir.mockImplementationOnce(() => new Promise<void>((r) => (done = r)));
    const clearing = clearDownloadedAudio();
    await vi.waitFor(() => expect(rmdir).toHaveBeenCalled());
    // The app is closed here: its files still there, the deletion marked.
    expect(localStorage.getItem('bw-regia-audio:cleanup-pending')).not.toBeNull();
    files.set('LIBRARY_NO_CLOUD:regia-audio/song', mp3());
    // (The stuck call returns, the copy still there: still marked.)
    done();
    await clearing;
    expect(localStorage.getItem('bw-regia-audio:cleanup-pending')).not.toBeNull();
    // Next launch.
    await finishPendingAudioCleanup();
    expect([...files.keys()].filter((k) => k.includes('regia-audio'))).toEqual([]);
    expect(localStorage.getItem('bw-regia-audio:cleanup-pending')).toBeNull();
  });

  it('round 4: phone: the delete fails: still marked, the recordings go at the next launch', async () => {
    localStorage.clear();
    files.set('LIBRARY_NO_CLOUD:regia-audio/song', mp3());
    rmdir.mockImplementationOnce(async () => {
      throw new Error('EPERM');
    });
    await signOutHere();
    expect(files.has('LIBRARY_NO_CLOUD:regia-audio/song')).toBe(true);
    expect(localStorage.getItem('bw-regia-audio:cleanup-pending')).not.toBeNull();
    await finishPendingAudioCleanup();
    expect(files.has('LIBRARY_NO_CLOUD:regia-audio/song')).toBe(false);
    expect(localStorage.getItem('bw-regia-audio:cleanup-pending')).toBeNull();
  });

  it('round 4: web: the recordings can not be deleted: still marked for the next launch', async () => {
    native.on = false;
    localStorage.clear();
    idbData.clear();
    const idb = fakeIndexedDb();
    Object.defineProperty(globalThis, 'indexedDB', { value: idb, configurable: true, writable: true });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'audio/mpeg' : null) },
      body: null,
      arrayBuffer: async () => mp3().buffer,
    })));
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    vi.unstubAllGlobals();
    idb.failDelete = true;
    await signOutHere();
    expect(localStorage.getItem('bw-regia-audio:cleanup-pending')).not.toBeNull();
    idb.failDelete = false;
    await finishPendingAudioCleanup();
    expect(localStorage.getItem('bw-regia-audio:cleanup-pending')).toBeNull();
  });

  it('Claude round 4: web, the deletion fails at sign-out: the next launch deletes only the previous account’s recordings', async () => {
    native.on = false;
    localStorage.clear();
    idbData.clear();
    const idb = fakeIndexedDb();
    Object.defineProperty(globalThis, 'indexedDB', { value: idb, configurable: true, writable: true });
    const OTHER = 'https://drive.google.com/file/d/zzz987654321/view';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'audio/mpeg' : null) },
      body: null,
      arrayBuffer: async () => mp3().buffer,
    })));
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    idb.failDelete = true;
    await signOutHere();
    expect(JSON.parse(localStorage.getItem('bw-regia-audio:cleanup-pending')!)).toEqual({ users: ['admin-1'], legacy: true });
    // Someone else signs in here and downloads a song (nothing was deleted).
    auth.user = 'member-2';
    idb.failDelete = false;
    expect(await downloadAudio(OTHER)).toEqual({ ok: true });
    await finishPendingAudioCleanup();
    expect(await cachedAudio([DRIVE, OTHER])).toEqual(new Set([OTHER]));
    expect(localStorage.getItem('bw-regia-audio:cleanup-pending')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('Claude round 4: phone, the session ends (expired) while a song comes down: not kept, and a failed delete stays marked', async () => {
    localStorage.clear();
    let land!: () => void;
    transfer.mockImplementationOnce(async (o: { url: string; path: string }) => {
      await new Promise<void>((r) => (land = r));
      files.set(key(fromUri(o.path)), mp3());
      return { path: o.path };
    });
    deleteFile.mockImplementationOnce(async () => {
      throw new Error('EPERM');
    });
    const run = downloadAudio(DRIVE);
    await vi.waitFor(() => expect(transfer).toHaveBeenCalled());
    auth.user = null;
    land();
    expect((await run).ok).toBe(false);
    expect(localStorage.getItem('bw-regia-audio:cleanup-pending')).not.toBeNull();
    await finishPendingAudioCleanup();
    expect([...files.keys()].filter((k) => k.includes('regia-audio'))).toEqual([]);
  });

  it('round 5 (Codex): phone, A’s deletion failed and B downloaded before the next launch: the launch deletes A’s only, never B’s', async () => {
    localStorage.clear();
    auth.user = 'admin-a';
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    // A signs out; the delete fails (a locked file).
    auth.user = null;
    rmdir.mockImplementation(async () => {
      throw new Error('EPERM');
    });
    await signOutHere();
    rmdir.mockReset().mockImplementation(async (o: { path: string; directory: string; recursive?: boolean }) => {
      for (const k of [...files.keys()]) if (o.recursive && k.startsWith(`${key(o)}/`)) files.delete(k);
    });
    expect(JSON.parse(localStorage.getItem('bw-regia-audio:cleanup-pending')!)).toEqual({ users: ['admin-a'], legacy: false });
    // B signs in and downloads the same song before the app is closed.
    auth.user = 'member-b';
    expect(await cachedAudio([DRIVE])).toEqual(new Set());
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    // Next launch, B still signed in.
    await finishPendingAudioCleanup();
    expect(await cachedAudio([DRIVE])).toEqual(new Set([DRIVE]));
    auth.user = 'admin-a';
    expect(await cachedAudio([DRIVE])).toEqual(new Set());
    expect([...files.keys()].some((k) => k.includes('/admin-a/'))).toBe(false);
    expect(localStorage.getItem('bw-regia-audio:cleanup-pending')).toBeNull();
  });

  it('older builds’ shared copies go at sign-out', async () => {
    localStorage.clear();
    files.set(`LIBRARY_NO_CLOUD:regia-audio/${await audioKey(DRIVE)}`, mp3());
    auth.user = null;
    await signOutHere();
    expect([...files.keys()].filter((f) => f.includes('regia-audio'))).toEqual([]);
  });

  it('round 5 (Codex minor): session expired offline: the song already here still counts (read only), nothing is downloaded', async () => {
    localStorage.clear();
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    auth.user = null;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(await cachedAudio([DRIVE])).toEqual(new Set([DRIVE]));
    expect((await playableUrl(DRIVE))?.local).toBe(true);
    transfer.mockClear();
    const other = 'https://drive.google.com/file/d/yyy111222333/view';
    expect((await downloadAudio(other)).ok).toBe(false);
    expect(transfer).not.toHaveBeenCalled();
  });

  it('nothing pending: the launch deletes nothing (an older build’s copy is moved, not deleted)', async () => {
    localStorage.clear();
    ownSongs();
    const k = await audioKey(DRIVE);
    files.set(`LIBRARY_NO_CLOUD:regia-audio/${k}`, mp3());
    await finishPendingAudioCleanup();
    expect(files.has(`LIBRARY_NO_CLOUD:regia-audio-by-owner/admin-1/${k}`)).toBe(true);
  });

  it('every sign-out deletes them (an expired or revoked session too), and the launch finishes a pending one', () => {
    const listener = authContext.slice(authContext.indexOf('onAuthStateChange'), authContext.indexOf('Native OAuth'));
    expect(listener).toMatch(/event === 'SIGNED_OUT'\) \{[^}]*import\('\.\/regiaAudio'\)\.then\(\(m\) => m\.clearDownloadedAudio\(\)\)/);
    const mount = authContext.slice(authContext.indexOf('initializeAuth();'), authContext.indexOf('onAuthStateChange'));
    expect(mount).toMatch(/import\('\.\/regiaAudio'\)\.then\(\(m\) => m\.finishPendingAudioCleanup\(\)\)/);
  });
});

describe('#296 round 6 (Codex r7 B2): a slow sign-out cleanup never takes the next account’s download', () => {
  const OTHER = 'https://drive.google.com/file/d/qqq555666777/view';
  const audioResponse = () => ({
    ok: true,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'audio/mpeg' : null) },
    body: null,
    arrayBuffer: async () => mp3().buffer,
  });

  it('phone: A signs out (the deletion is slow), B signs in and downloads: B’s file survives, A’s goes', async () => {
    localStorage.clear();
    auth.user = 'admin-a';
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    rmdir.mockImplementation(async (o: { path: string; directory: string; recursive?: boolean }) => {
      await gate;
      for (const k of [...files.keys()]) if (o.recursive && k.startsWith(`${key(o)}/`)) files.delete(k);
    });
    auth.user = null;
    const clearing = clearDownloadedAudio();
    auth.user = 'member-b';
    const run = downloadAudio(OTHER);
    await new Promise((r) => setTimeout(r, 20));
    release();
    await clearing;
    expect(await run).toEqual({ ok: true });
    rmdir.mockReset().mockImplementation(async (o: { path: string; directory: string; recursive?: boolean }) => {
      for (const k of [...files.keys()]) if (o.recursive && k.startsWith(`${key(o)}/`)) files.delete(k);
    });
    expect(await cachedAudio([OTHER])).toEqual(new Set([OTHER]));
    expect([...files.keys()].some((k) => k.includes('/admin-a/'))).toBe(false);
    expect(localStorage.getItem('bw-regia-audio:cleanup-pending')).toBeNull();
  });

  it('web: the same, in one browser', async () => {
    native.on = false;
    localStorage.clear();
    idbData.clear();
    const idb = fakeIndexedDb();
    Object.defineProperty(globalThis, 'indexedDB', { value: idb, configurable: true, writable: true });
    vi.stubGlobal('fetch', vi.fn(async () => audioResponse()));
    auth.user = 'admin-a';
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    let release!: () => void;
    idb.gate = new Promise<void>((r) => (release = r));
    auth.user = null;
    const clearing = clearDownloadedAudio();
    auth.user = 'member-b';
    const run = downloadAudio(OTHER);
    await new Promise((r) => setTimeout(r, 20));
    release();
    await clearing;
    expect(await run).toEqual({ ok: true });
    idb.gate = null;
    expect(await cachedAudio([DRIVE, OTHER])).toEqual(new Set([OTHER]));
    auth.user = 'admin-a';
    expect(await cachedAudio([DRIVE, OTHER])).toEqual(new Set());
    vi.unstubAllGlobals();
  });
});

describe('#296 round 6 (Codex r7 B3): after the update, the older build’s songs are still there', () => {
  it('phone: the first launch moves them into the signed-in account’s folder; offline at the gig they are found', async () => {
    localStorage.clear();
    ownSongs();
    const k = await audioKey(DRIVE);
    files.set(`LIBRARY_NO_CLOUD:regia-audio/${k}`, mp3());
    await finishPendingAudioCleanup();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(await cachedAudio([DRIVE])).toEqual(new Set([DRIVE]));
    expect((await playableUrl(DRIVE))?.local).toBe(true);
    expect(files.has(`LIBRARY_NO_CLOUD:regia-audio-by-owner/admin-1/${k}`)).toBe(true);
    expect(files.has(`LIBRARY_NO_CLOUD:regia-audio/${k}`)).toBe(false);
    // The session expired offline afterwards: still found (read only).
    auth.user = null;
    expect(await cachedAudio([DRIVE])).toEqual(new Set([DRIVE]));
    // Another account never sees them.
    auth.user = 'member-2';
    expect(await cachedAudio([DRIVE])).toEqual(new Set());
  });

  it('iPhone: the copies in Documents and Library are moved too', async () => {
    localStorage.clear();
    native.platform = 'ios';
    const k = await audioKey(DRIVE);
    ownSongs();
    const k2 = await audioKey(SECOND);
    files.set(`DOCUMENTS:regia-audio/${k}`, mp3());
    files.set(`LIBRARY:regia-audio/${k2}`, mp3());
    await finishPendingAudioCleanup();
    expect(await cachedAudio([DRIVE, SECOND])).toEqual(new Set([DRIVE, SECOND]));
    expect([...files.keys()].filter((f) => f.includes(':regia-audio/'))).toEqual([]);
    expect(files.has(`LIBRARY_NO_CLOUD:regia-audio-by-owner/admin-1/${k2}`)).toBe(true);
  });

  it('web: the old keys move to the signed-in account', async () => {
    native.on = false;
    localStorage.clear();
    idbData.clear();
    Object.defineProperty(globalThis, 'indexedDB', { value: fakeIndexedDb(), configurable: true, writable: true });
    ownSongs();
    const k = await audioKey(DRIVE);
    idbData.set('bw-regia-audio', new Map([[k, { type: 'audio/mpeg', data: mp3().buffer }]]));
    await finishPendingAudioCleanup();
    expect([...idbData.get('bw-regia-audio')!.keys()]).toEqual([`admin-1/${k}`]);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    expect(await cachedAudio([DRIVE])).toEqual(new Set([DRIVE]));
    expect((await playableUrl(DRIVE))?.local).toBe(true);
  });

  it('first launch with no session (expired offline): left in place and still found; a sign-in later (maybe someone else) deletes them', async () => {
    localStorage.clear();
    const k = await audioKey(DRIVE);
    files.set(`LIBRARY_NO_CLOUD:regia-audio/${k}`, mp3());
    auth.user = null;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await finishPendingAudioCleanup();
    expect(files.has(`LIBRARY_NO_CLOUD:regia-audio/${k}`)).toBe(true);
    expect(await cachedAudio([DRIVE])).toEqual(new Set([DRIVE]));
    expect((await playableUrl(DRIVE))?.local).toBe(true);
    auth.user = 'member-2';
    await legacyAudioSignedIn();
    expect(files.has(`LIBRARY_NO_CLOUD:regia-audio/${k}`)).toBe(false);
    expect(await cachedAudio([DRIVE])).toEqual(new Set());
  });

  it('moved once: a later sign-in deletes nothing', async () => {
    localStorage.clear();
    ownSongs();
    const k = await audioKey(DRIVE);
    files.set(`LIBRARY_NO_CLOUD:regia-audio/${k}`, mp3());
    await finishPendingAudioCleanup();
    await legacyAudioSignedIn();
    expect(files.has(`LIBRARY_NO_CLOUD:regia-audio-by-owner/admin-1/${k}`)).toBe(true);
  });

  it('a sign-in deletes them (AuthContext, SIGNED_IN)', () => {
    const listener = authContext.slice(authContext.indexOf('onAuthStateChange'), authContext.indexOf('Native OAuth'));
    expect(listener).toMatch(/event === 'SIGNED_IN'\) \{[^}]*import\('\.\/regiaAudio'\)\.then\(\(m\) => m\.legacyAudioSignedIn\(\)\)/);
  });
});

describe('#296 round 7 (Claude r6): older copies on a shared device, and cleanups that meet a sign-in', () => {
  it('M1: only the signed-in account’s own songs move; another account’s old copy is deleted, never handed over', async () => {
    localStorage.clear();
    ownSongs();
    const mineK = await audioKey(DRIVE);
    const theirs = await audioKey('https://drive.google.com/file/d/someone-elses/view');
    files.set(`LIBRARY_NO_CLOUD:regia-audio/${mineK}`, mp3());
    files.set(`LIBRARY_NO_CLOUD:regia-audio/${theirs}`, mp3());
    await finishPendingAudioCleanup();
    expect(files.has(`LIBRARY_NO_CLOUD:regia-audio-by-owner/admin-1/${mineK}`)).toBe(true);
    expect([...files.keys()].filter((f) => f.includes(theirs))).toEqual([]);
  });

  it('M1 web: the same', async () => {
    native.on = false;
    localStorage.clear();
    idbData.clear();
    Object.defineProperty(globalThis, 'indexedDB', { value: fakeIndexedDb(), configurable: true, writable: true });
    ownSongs();
    const mineK = await audioKey(DRIVE);
    idbData.set('bw-regia-audio', new Map([[mineK, { type: 'audio/mpeg', data: mp3().buffer }], ['0123456789abcdef01234567', { type: 'audio/mpeg', data: mp3().buffer }]]));
    await finishPendingAudioCleanup();
    expect([...idbData.get('bw-regia-audio')!.keys()]).toEqual([`admin-1/${mineK}`]);
  });

  it('M2: left unclaimed, then a launch with a session: deleted, not adopted (that account may be another one)', async () => {
    localStorage.clear();
    ownSongs();
    const k = await audioKey(DRIVE);
    files.set(`LIBRARY_NO_CLOUD:regia-audio/${k}`, mp3());
    auth.user = null;
    await finishPendingAudioCleanup();
    expect(files.has(`LIBRARY_NO_CLOUD:regia-audio/${k}`)).toBe(true);
    // Someone signs in; the app is closed before anything else runs. Next launch, signed in.
    auth.user = 'admin-1';
    await finishPendingAudioCleanup();
    expect([...files.keys()].filter((f) => f.includes(k))).toEqual([]);
    expect(await cachedAudio([DRIVE])).toEqual(new Set());
  });

  it('M2: a sign-in over unclaimed copies marks their deletion at once (the app may close before it ends)', async () => {
    localStorage.clear();
    files.set('LIBRARY_NO_CLOUD:regia-audio/abc', mp3());
    auth.user = null;
    await finishPendingAudioCleanup();
    let release!: () => void;
    rmdir.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    auth.user = 'member-2';
    const run = legacyAudioSignedIn();
    expect(JSON.parse(localStorage.getItem('bw-regia-audio:cleanup-pending')!)).toMatchObject({ legacy: true });
    await vi.waitFor(() => expect(rmdir).toHaveBeenCalled());
    release();
    await run;
  });

  it('M4: a slow sign-out cleanup, and the same account signs in again before it reaches its folder: its files are kept', async () => {
    localStorage.clear();
    auth.user = 'admin-a';
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // The older builds' folder goes first, slowly.
    rmdir.mockImplementationOnce(async () => {
      await gate;
    });
    auth.user = null;
    const clearing = clearDownloadedAudio();
    await vi.waitFor(() => expect(rmdir).toHaveBeenCalled());
    auth.user = 'admin-a';
    release();
    await clearing;
    expect(await cachedAudio([DRIVE])).toEqual(new Set([DRIVE]));
    expect(localStorage.getItem('bw-regia-audio:cleanup-pending')).toBeNull();
    // Still listed: its next sign-out deletes them.
    await signOutHere();
    expect(await cachedAudio([DRIVE])).toEqual(new Set());
  });
});

describe('#296 round 8: sign-out, the legacy move, a full storage and other accounts', () => {
  it('Codex r8 B2: a sign-out while the legacy move scans the songs: nothing it moves survives, signed out nothing is found', async () => {
    localStorage.clear();
    ownSongs();
    const k = await audioKey(DRIVE);
    files.set(`LIBRARY_NO_CLOUD:regia-audio/${k}`, mp3());
    let release!: () => void;
    scan.gate = new Promise<void>((r) => (release = r));
    scan.started = false;
    const launch = finishPendingAudioCleanup();
    await vi.waitFor(() => expect(scan.started).toBe(true));
    auth.user = null;
    const out = clearDownloadedAudio();
    release();
    scan.gate = null;
    await launch;
    await out;
    expect([...files.keys()].filter((f) => f.includes(k))).toEqual([]);
    expect(localStorage.getItem('bw-regia-audio:owner')).toBeNull();
    expect(await cachedAudio([DRIVE])).toEqual(new Set());
  });

  it('Codex r8 B3 / Claude r7 M-b: a sign-out that threw with the session still valid: the local sign-out first, then its recordings go (cleanup not mocked)', async () => {
    localStorage.clear();
    auth.user = 'admin-a';
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    const k = await audioKey(DRIVE);
    expect(files.has(`LIBRARY_NO_CLOUD:regia-audio-by-owner/admin-a/${k}`)).toBe(true);
    const { wipeAfterFailedSignOut } = await import('../signOutWipe');
    await wipeAfterFailedSignOut();
    expect(localSignOut).toHaveBeenCalledWith({ scope: 'local' });
    expect([...files.keys()].filter((f) => f.includes(k))).toEqual([]);
  });

  it('Codex r8 B4: the storage is full, the cleanup mark can’t be written: the recordings are still deleted, nothing throws', async () => {
    localStorage.clear();
    auth.user = 'admin-a';
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    const k = await audioKey(DRIVE);
    const real = localStorage.setItem.bind(localStorage);
    const full = vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, v: string) => {
      if (key === 'bw-regia-audio:cleanup-pending') throw new DOMException('quota', 'QuotaExceededError');
      return real(key, v);
    });
    try {
      auth.user = null;
      await expect(clearDownloadedAudio()).resolves.toBeUndefined();
      expect([...files.keys()].filter((f) => f.includes(k))).toEqual([]);
      expect(localStorage.getItem('bw-regia-audio:owners')).toBeNull();
    } finally {
      full.mockRestore();
    }
  });

  it('Codex r8 B4: full storage and the deletion fails: the account stays on the owner list until a later cleanup deletes it', async () => {
    localStorage.clear();
    auth.user = 'admin-a';
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    const k = await audioKey(DRIVE);
    const real = localStorage.setItem.bind(localStorage);
    const full = vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, v: string) => {
      if (key === 'bw-regia-audio:cleanup-pending') throw new DOMException('quota', 'QuotaExceededError');
      return real(key, v);
    });
    try {
      // Its folder can't be deleted this time.
      rmdir.mockImplementation(async (o: { path: string; directory: string; recursive?: boolean }) => {
        if (o.path.includes('admin-a')) throw new Error('busy');
        for (const f of [...files.keys()]) if (o.recursive && f.startsWith(`${key(o)}/`)) files.delete(f);
      });
      auth.user = null;
      await clearDownloadedAudio();
      expect(files.has(`LIBRARY_NO_CLOUD:regia-audio-by-owner/admin-a/${k}`)).toBe(true);
      expect(JSON.parse(localStorage.getItem('bw-regia-audio:owners')!)).toContain('admin-a');
    } finally {
      full.mockRestore();
      rmdir.mockReset();
      rmdir.mockImplementation(async (o: { path: string; directory: string; recursive?: boolean }) => {
        for (const f of [...files.keys()]) if (o.recursive && f.startsWith(`${key(o)}/`)) files.delete(f);
      });
    }
    // Someone else signs in: admin-a's recordings go (the owner list said so), theirs are kept.
    auth.user = 'member-2';
    expect(await downloadAudio(SECOND)).toEqual({ ok: true });
    await legacyAudioSignedIn();
    expect([...files.keys()].filter((f) => f.includes('admin-a'))).toEqual([]);
    expect(files.has(`LIBRARY_NO_CLOUD:regia-audio-by-owner/member-2/${await audioKey(SECOND)}`)).toBe(true);
    expect(JSON.parse(localStorage.getItem('bw-regia-audio:owners')!)).toEqual(['member-2']);
  });

  it('Claude r7 extra: a sign-in deletes the recordings of other accounts still listed here, never its own', async () => {
    localStorage.clear();
    auth.user = 'admin-a';
    expect(await downloadAudio(DRIVE)).toEqual({ ok: true });
    // admin-a's session ended elsewhere (no sign-out ran here); member-2 signs in.
    auth.user = 'member-2';
    expect(await downloadAudio(SECOND)).toEqual({ ok: true });
    await legacyAudioSignedIn();
    expect([...files.keys()].filter((f) => f.includes('admin-a'))).toEqual([]);
    expect([...files.keys()].filter((f) => f.includes('member-2'))).toHaveLength(1);
  });
});

describe('looksLikeAudio', () => {
  const b = (...x: number[]) => new Uint8Array(x);
  it.each([
    ['MP3 with ID3', b(0x49, 0x44, 0x33, 4)],
    ['MP3 frame', b(0xff, 0xfb, 0x90, 0)],
    ['WAV', new TextEncoder().encode('RIFF....WAVE')],
    ['M4A', new TextEncoder().encode('....ftypM4A ')],
    ['FLAC', new TextEncoder().encode('fLaC')],
    ['OGG', new TextEncoder().encode('OggS')],
  ])('%s is audio', (_n, bytes) => expect(looksLikeAudio(bytes)).toBe(true));
  it.each([
    ['HTML', new TextEncoder().encode('<!DOCTYPE html>')],
    ['HTML with spaces', new TextEncoder().encode('\n  <html>')],
    ['JSON error', new TextEncoder().encode('{"error":')],
  ])('%s is not', (_n, bytes) => expect(looksLikeAudio(bytes)).toBe(false));
});

describe('audioFailureFor', () => {
  it('offline wins; else what the download found; else the link', () => {
    expect(audioFailureFor({ online: false, downloadReason: 'link', local: false })).toBe('offline');
    expect(audioFailureFor({ online: true, downloadReason: 'link', local: false })).toBe('link');
    expect(audioFailureFor({ online: true, local: false })).toBe('link');
    expect(audioFailureFor({ online: true, local: true })).toBe('format');
  });
});
