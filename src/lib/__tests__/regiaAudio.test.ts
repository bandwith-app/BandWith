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

const native = { on: true };
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.on,
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
const rmdir = vi.fn(async (_o: { path: string; directory: string }) => {});
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

import { audioFailureFor, cachedAudio, downloadAudio, looksLikeAudio, playableUrl } from '../regiaAudio';

const DRIVE = 'https://drive.google.com/file/d/abc123456789/view';
const mp3 = () => {
  const b = new Uint8Array(4 << 20);
  b.set([0x49, 0x44, 0x33]); // "ID3"
  return b;
};

beforeEach(() => {
  native.on = true;
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
