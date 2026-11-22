/**
 * My own files for a song (song_personal_files, 109), kept on the device
 * for live mode with no signal (live pack, plan §3.1). Native apps only:
 * downloaded once into the library with no cloud backup (like the Regia's
 * audio, regiaAudio.ts), opened from there with the system's share/preview
 * sheet. Signed URLs expire after an hour, so the pack never keeps them.
 */
import { Capacitor } from '@capacitor/core';
import { resolveSongFileUrl, safeName } from './services/songFiles';
import type { LivePackFile } from './livePack';

const DIR = 'live-pack';

const fs = () => import('@capacitor/filesystem');

export const packFilesAvailable = () => Capacitor.isNativePlatform();

/** Where a file goes: live-pack/<user>/<file id>-<name>. */
const locOf = async (userId: string, file: Pick<LivePackFile, 'id' | 'name'>) => {
  const { Directory } = await fs();
  return { path: `${DIR}/${userId}/${file.id}-${safeName(file.name || 'file')}`, directory: Directory.LibraryNoCloud as string };
};

/** The file is on the device (its size > 0). */
export async function hasPackFile(local: LivePackFile['local']): Promise<boolean> {
  if (!local || !packFilesAvailable()) return false;
  try {
    const { Filesystem } = await fs();
    const st = await Filesystem.stat(local as never);
    return st.size > 0;
  } catch {
    return false;
  }
}

/** Download one of my files onto the device; null when it can't be (offline, link gone). */
export async function downloadPackFile(userId: string, file: LivePackFile): Promise<LivePackFile['local'] | null> {
  if (!packFilesAvailable()) return null;
  const loc = await locOf(userId, file);
  if (await hasPackFile(loc)) return loc;
  const url = await resolveSongFileUrl(file.ref).catch(() => null);
  if (!url) return null;
  try {
    const { Filesystem } = await fs();
    const { FileTransfer } = await import('@capacitor/file-transfer');
    await Filesystem.mkdir({ path: `${DIR}/${userId}`, directory: loc.directory as never, recursive: true }).catch(() => undefined);
    const { uri } = await Filesystem.getUri(loc as never);
    await FileTransfer.downloadFile({ url, path: uri });
    return (await hasPackFile(loc)) ? loc : null;
  } catch {
    return null;
  }
}

/** Space my kept files take (bytes). */
export async function packFilesSize(files: LivePackFile[]): Promise<number> {
  if (!packFilesAvailable()) return 0;
  const { Filesystem } = await fs();
  let total = 0;
  for (const f of files) {
    if (!f.local) continue;
    try {
      total += (await Filesystem.stat(f.local as never)).size || 0;
    } catch {
      /* gone */
    }
  }
  return total;
}

/** Remove the given kept files. */
export async function removePackFiles(files: LivePackFile[]): Promise<void> {
  if (!packFilesAvailable()) return;
  const { Filesystem } = await fs();
  await Promise.all(files.filter((f) => f.local).map((f) => Filesystem.deleteFile(f.local as never).catch(() => undefined)));
}

/** Sign-out: every kept file of every user on this device goes. */
export async function removeAllPackFiles(): Promise<void> {
  if (!packFilesAvailable()) return;
  try {
    const { Filesystem, Directory } = await fs();
    await Filesystem.rmdir({ path: DIR, directory: Directory.LibraryNoCloud, recursive: true });
  } catch {
    /* nothing kept */
  }
}

/** Open a kept file with the system sheet (preview, open in, save). */
export async function openPackFile(file: LivePackFile): Promise<boolean> {
  if (!file.local || !(await hasPackFile(file.local))) return false;
  try {
    const [{ Filesystem }, { Share }] = await Promise.all([fs(), import('@capacitor/share')]);
    const { uri } = await Filesystem.getUri(file.local as never);
    await Share.share({ title: file.name, files: [uri] });
    return true;
  } catch {
    return false;
  }
}
