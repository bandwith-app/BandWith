// Pure decisions of delete-account (no Deno or network here, so vitest runs it).

export interface BandLookup {
  data: { id: string }[] | null;
  error: unknown;
}

/**
 * Bands whose files go with the account: the caller's bands that no longer
 * exist. When the lookup failed or gave no answer, null: the caller must stop
 * and let the user retry (Codex review #282: going on deleted the account and
 * left a solo band's files public for good). Never a band that goes on: that
 * would erase the other members' files (audit 02 #1).
 */
export function bandsToClean(myBandIds: string[], stillThere: BandLookup): string[] | null {
  if (stillThere.error || !Array.isArray(stillThere.data)) return null;
  const kept = new Set(stillThere.data.map((b) => b.id));
  return myBandIds.filter((id) => !kept.has(id));
}

export interface StorageRelease {
  released?: number;
  personal_left?: number;
}

/** Personal files must all be gone before any data is deleted (02 #2, 04 #4). */
export function storageReady(release: StorageRelease | null | undefined, error: unknown): boolean {
  return !error && !!release && Number(release.personal_left ?? 1) === 0;
}

export interface DeletionBegin {
  ok?: boolean;
  code?: string;
  bands?: string[];
  band_ids?: string[];
}

/**
 * bw_account_deletion_begin's answer (180): go on, blocked by bands (last
 * admin), busy (everyone else in a band is deleting their account too: try
 * again later), or not ready.
 */
export function beginOutcome(
  data: DeletionBegin | null | undefined,
  error: unknown,
):
  | { kind: 'ok'; bandIds: string[] }
  | { kind: 'blocked'; bands: string[] }
  | { kind: 'busy' }
  | { kind: 'not_ready' } {
  if (error || !data || typeof data !== 'object') return { kind: 'not_ready' };
  if (data.ok === true) return { kind: 'ok', bandIds: Array.isArray(data.band_ids) ? data.band_ids.map(String) : [] };
  if (data.ok === false && data.code === 'deletion_in_progress') return { kind: 'busy' };
  if (data.ok === false) return { kind: 'blocked', bands: Array.isArray(data.bands) ? data.bands.map(String) : [] };
  return { kind: 'not_ready' };
}

/**
 * bw_prepare_account_deletion's answer: its last-admin check refusing is a
 * 409 like the one before any file went, never a generic error (Claude
 * review #282). Since 180 nothing can change that check once begin passed,
 * so this is the belt to begin's braces.
 */
export function prepareOutcome(error: { message?: string } | null | undefined): { kind: 'ok' | 'blocked' | 'error' } {
  if (!error) return { kind: 'ok' };
  return { kind: /account_has_bands/.test(error.message ?? '') ? 'blocked' : 'error' };
}

/**
 * Where a band's files are, for a band that goes with the account. Older
 * builds saved quote PDFs to avatars/quotes/<bandId>/ when the quotes bucket
 * failed (Codex review #282, round 2): those go too.
 */
export function bandFolders(bandId: string): { bucket: string; prefix: string }[] {
  return [
    { bucket: 'song-files', prefix: bandId },
    { bucket: 'band-branding', prefix: bandId },
    { bucket: 'quotes', prefix: `quotes/${bandId}` },
    { bucket: 'avatars', prefix: `quotes/${bandId}` },
  ];
}

/** The bit of the Storage API that removeFolder needs (a bucket). */
export interface FolderStore {
  list(prefix: string, opts: { limit: number }): Promise<{ data: { id?: string | null; name: string }[] | null; error: unknown }>;
  remove(paths: string[]): Promise<{ error: unknown }>;
}

const PAGE = 100;

/**
 * Delete every object under `prefix`. Storage lists one level at a time,
 * 100 entries per call: emptied subfolders disappear, so the same listing is
 * read again until it is empty. True when the folder is empty at the end.
 * (Codex review #282: a page of only folders used to end the loop, so the
 * 101st song folder survived and the deletion stopped with a 503.)
 */
export async function removeFolder(store: FolderStore, prefix: string, depth = 0): Promise<boolean> {
  if (depth > 4) return false;
  for (let round = 0; round < 50; round++) {
    const { data: items, error } = await store.list(prefix, { limit: PAGE });
    if (error || !items) return false;
    if (items.length === 0) return true;
    const files = items.filter((i) => i.id).map((i) => `${prefix}/${i.name}`);
    const folders = items.filter((i) => !i.id).map((i) => `${prefix}/${i.name}`);
    let progress = files.length > 0;
    for (const f of folders) {
      if (await removeFolder(store, f, depth + 1)) progress = true;
    }
    if (files.length > 0) {
      const { error: removeError } = await store.remove(files);
      if (removeError) return false;
    }
    if (!progress) return false;
  }
  return false;
}
