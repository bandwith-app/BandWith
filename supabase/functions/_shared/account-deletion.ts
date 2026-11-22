// Pure decisions of delete-account (no Deno or network here, so vitest runs it).

export interface BandLookup {
  data: { id: string }[] | null;
  error: unknown;
}

/**
 * Bands whose files go with the account: the caller's bands that no longer
 * exist. When the lookup failed or gave no answer, nothing: deleting a band
 * that goes on would erase the other members' files (audit 02 #1).
 */
export function bandsToClean(myBandIds: string[], stillThere: BandLookup): string[] {
  if (stillThere.error || !Array.isArray(stillThere.data)) return [];
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
