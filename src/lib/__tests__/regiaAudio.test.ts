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
  if (!f) throw new Error('File does not exist');
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

vi.mock('../services/songFiles', () => ({
  resolveSongFileUrl: async (ref: string) => (ref.startsWith('https://') ? ref : null),
  playableAudioUrl: (u: string) => u.replace('/view', '/direct'),
}));

import authContext from '../AuthContext.tsx?raw';
import { audioFailureFor, cachedAudio, clearDownloadedAudio, downloadAudio, finishPendingAudioCleanup, looksLikeAudio, playableUrl } from '../regiaAudio';

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
  return {
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
          put: (v: unknown, k: IDBValidKey) => req(() => (data.set(k, v), k)),
          delete: (k: IDBValidKey) => req(() => void data.delete(k)),
          clear: () => req(() => void data.clear()),
        };
        r.result = { createObjectStore: () => store, transaction: () => ({ objectStore: () => store }), close: () => {} };
        if (fresh) r.onupgradeneeded?.();
        r.onsuccess?.();
      }, 0);
      return r;
    },
    deleteDatabase: (name: string) => req(() => void idbData.delete(name)),
  };
}
const storedSongs = () => [...idbData.values()].reduce((n, m) => n + m.size, 0);

const DRIVE = 'https://drive.google.com/file/d/abc123456789/view';
const mp3 = () => {
  const b = new Uint8Array(4 << 20);
  b.set([0x49, 0x44, 0x33]); // "ID3"
  return b;
};

beforeEach(() => {
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
    await clearDownloadedAudio();
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
    await clearDownloadedAudio();
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
    await clearDownloadedAudio();
    expect(await cachedAudio([DRIVE])).toEqual(new Set());
    let land!: () => void;
    transfer.mockImplementationOnce(async (o: { url: string; path: string }) => {
      await new Promise<void>((r) => (land = r));
      files.set(key(fromUri(o.path)), mp3());
      return { path: o.path };
    });
    const run = downloadAudio(DRIVE);
    await vi.waitFor(() => expect(transfer).toHaveBeenCalledTimes(2));
    await clearDownloadedAudio();
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
    await clearDownloadedAudio();
    expect([...files.keys()].filter((k) => k.includes('regia-audio'))).toEqual([]);
  });

  it('a deletion that did not finish (the app closed, the 3 s ran out) is finished at the next launch', async () => {
    localStorage.clear();
    let done!: () => void;
    rmdir.mockImplementationOnce(() => new Promise<void>((r) => (done = r)));
    void clearDownloadedAudio();
    await vi.waitFor(() => expect(rmdir).toHaveBeenCalled());
    // The app is closed here: its files still there, the deletion marked.
    expect(localStorage.getItem('bw-regia-audio:cleanup-pending')).toBe('1');
    files.set('LIBRARY_NO_CLOUD:regia-audio/song', mp3());
    // Next launch.
    await finishPendingAudioCleanup();
    expect([...files.keys()].filter((k) => k.includes('regia-audio'))).toEqual([]);
    expect(localStorage.getItem('bw-regia-audio:cleanup-pending')).toBeNull();
    done();
  });

  it('nothing pending: the launch deletes nothing', async () => {
    localStorage.clear();
    files.set('LIBRARY_NO_CLOUD:regia-audio/song', mp3());
    await finishPendingAudioCleanup();
    expect(files.has('LIBRARY_NO_CLOUD:regia-audio/song')).toBe(true);
  });

  it('every sign-out deletes them (an expired or revoked session too), and the launch finishes a pending one', () => {
    const listener = authContext.slice(authContext.indexOf('onAuthStateChange'), authContext.indexOf('Native OAuth'));
    expect(listener).toMatch(/event === 'SIGNED_OUT'\) \{[^}]*import\('\.\/regiaAudio'\)\.then\(\(m\) => m\.clearDownloadedAudio\(\)\)/);
    const mount = authContext.slice(authContext.indexOf('initializeAuth();'), authContext.indexOf('onAuthStateChange'));
    expect(mount).toMatch(/import\('\.\/regiaAudio'\)\.then\(\(m\) => m\.finishPendingAudioCleanup\(\)\)/);
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
