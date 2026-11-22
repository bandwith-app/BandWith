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
  /** A retry once committed (180, round 5). */
  committed?: boolean;
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
  | { kind: 'ok'; bandIds: string[]; committed: boolean }
  | { kind: 'blocked'; bands: string[] }
  | { kind: 'busy' }
  | { kind: 'not_ready' } {
  if (error || !data || typeof data !== 'object') return { kind: 'not_ready' };
  if (data.ok === true) {
    return { kind: 'ok', bandIds: Array.isArray(data.band_ids) ? data.band_ids.map(String) : [], committed: data.committed === true };
  }
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

/** The bit of the Storage API that removeObjects needs (a bucket). */
export interface ObjectStore {
  remove(paths: string[]): Promise<{ error: unknown }>;
}

/** The server side removeObjects reads the names from, and removes them with. */
export interface ObjectServer {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  store(bucket: string): ObjectStore;
}

// One page of names from storage.objects, and one Storage remove call each
// (the API takes up to 1000 paths).
const NAMES_PAGE = 1000;
const REMOVE_CHUNK = 100;

/**
 * Delete every object under `prefix/`, at any depth (Codex review #282,
 * round 6: the folder walk stopped 64 levels down and the deletion stayed not
 * ready for good). The names come straight from storage.objects through
 * bw_account_storage_names (service role only, keyset pages ordered by
 * name), so there is no folder to walk and no depth. True when every name
 * listed was removed; a failed listing or removal is false (not ready yet).
 */
export async function removeObjects(server: ObjectServer, bucket: string, prefix: string): Promise<boolean> {
  const store = server.store(bucket);
  let after: string | null = null;
  for (;;) {
    const { data, error } = await server.rpc('bw_account_storage_names', {
      p_bucket: bucket,
      p_prefix: prefix,
      p_after: after,
      p_limit: NAMES_PAGE,
    });
    if (error || !Array.isArray(data)) return false;
    const names = data as string[];
    for (let i = 0; i < names.length; i += REMOVE_CHUNK) {
      const { error: removeError } = await store.remove(names.slice(i, i + REMOVE_CHUNK));
      if (removeError) return false;
    }
    if (names.length < NAMES_PAGE) return true;
    after = names[names.length - 1];
  }
}

/** What finishCommitted needs from the server (the edge function's admin client). */
export interface DeletionServer {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  store(bucket: string): ObjectStore;
  pendingBandIds(uid: string): PromiseLike<{ data: { band_ids?: string[] | null } | null; error: unknown }>;
  bandsStillThere(ids: string[]): PromiseLike<BandLookup>;
  deleteUser(uid: string): PromiseLike<{ error: unknown }>;
}

export type FinishResult = { kind: 'done' } | { kind: 'not_ready'; what: string; detail?: unknown };

/** Auth no longer has the user: the job and a retry ran at once (round 5). */
export function userAlreadyGone(error: unknown): boolean {
  const e = error as { status?: number; code?: string; message?: string } | null | undefined;
  if (!e) return false;
  return e.status === 404 || e.code === 'user_not_found' || /user not found/i.test(e.message ?? '');
}

/**
 * Everything after the point of no return (round 5): the deletion is
 * committed (bw_prepare_account_deletion ran), so nothing here refuses, it
 * can only be not ready yet. Files first, then the last step, Auth and the
 * final scrub. Run by delete-account for the user, and again by its server
 * job (bw-finish-account-deletions) for a committed deletion nobody
 * finished. Every step can run twice, also at the same time.
 */
export async function finishCommitted(server: DeletionServer, uid: string, knownBandIds: string[] = []): Promise<FinishResult> {
  const notReady = (what: string, detail?: unknown): FinishResult => ({ kind: 'not_ready', what, detail });

  // Personal files and the photo go; the band files they uploaded stay with
  // the bands but no longer belong to the account.
  await removeObjects(server, 'personal-files', uid);
  await removeObjects(server, 'avatars', uid);
  const release = await retryOnDeadlock(() => server.rpc('bw_account_storage_release', { p_uid: uid }));
  if (!storageReady(release.data as StorageRelease | null, release.error)) return notReady('storage', release.error ?? release.data);

  // Every band noted as going with the account (begin and prepare), also
  // from an earlier attempt. A failed lookup stops: it must never erase a
  // band that goes on.
  const pending = await server.pendingBandIds(uid);
  if (pending.error) return notReady('pending', pending.error);
  const noted = [...new Set([...knownBandIds, ...((pending.data?.band_ids as string[] | null | undefined) ?? [])])];
  if (noted.length > 0) {
    const toClean = bandsToClean(noted, await server.bandsStillThere(noted));
    if (toClean === null) return notReady('band lookup');
    let cleaned = true;
    for (const bandId of toClean) {
      for (const { bucket, prefix } of bandFolders(bandId)) {
        cleaned = (await removeObjects(server, bucket, prefix)) && cleaned;
      }
    }
    if (!cleaned) return notReady('band files', toClean);
  }

  // Personal files once more (another device may have uploaded before
  // uploads were blocked), then the last step: Storage re-checked,
  // notifications and messages once more.
  await removeObjects(server, 'personal-files', uid);
  await removeObjects(server, 'avatars', uid);
  const finish = await retryOnDeadlock(() => server.rpc('bw_account_deletion_finish', { p_uid: uid }));
  if (finish.error) return notReady('finish', finish.error);

  const { error: deleteError } = await server.deleteUser(uid);
  if (deleteError && !userAlreadyGone(deleteError)) return notReady('auth', deleteError);

  // The final scrub (Codex B4): notifications the Auth cascade wrote. The
  // trigger on profiles already ran it inside the delete; a failure here is
  // only logged.
  const scrub = await retryOnDeadlock(() => server.rpc('bw_account_deletion_scrub', { p_uid: uid }));
  if (scrub.error) console.warn('delete-account: final scrub', scrub.error);
  return { kind: 'done' };
}

/**
 * Runs an RPC once more when Postgres aborted it as a deadlock victim
 * (40P01, Claude review #282 round 4). Each RPC is one transaction that the
 * abort rolled back whole, so running it again is safe. Only once: a second
 * deadlock is returned to the caller.
 */
export async function retryOnDeadlock<T extends { error: unknown }>(call: () => PromiseLike<T>): Promise<T> {
  const first = await call();
  const code = (first.error as { code?: string } | null | undefined)?.code;
  return code === '40P01' ? await call() : first;
}
