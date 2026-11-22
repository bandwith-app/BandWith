// Deletes the caller's own account (App Store / Play Store requirement).
//
// Everything that can refuse is decided before anything is erased (Codex
// review #282):
// 1-2. bw_account_deletion_begin (180): refuses (409) if the caller is the
//    only admin of a band with other members, under the band locks (a
//    co-admin deleting their own account counts as gone; then it is 409
//    account_deletion_in_progress: wait). A retry after prepare skips the
//    check and only finishes the job. Otherwise it records a pending
//    deletion. While it is pending no membership change that would make a
//    later step refuse goes through (a co-admin stepping down, someone
//    joining a band that goes, the last member leaving a band that stays).
//    It also notes the bands that go with the account.
// 3. Storage, before any data is deleted: personal files and the profile
//    photo go, the files that stay with their bands are released
//    (bw_account_storage_release). If a personal file or the photo is still
//    there it stops (503, nothing deleted).
// 4. bw_prepare_account_deletion(): removes solo bands (noting them too),
//    keeps band and event chat messages as a former member's, clears
//    references. Its last-admin check refusing is a 409 too.
// 5. Removes the files of the noted bands that are really gone (old quote
//    PDFs in avatars/quotes/<band> too). A failed
//    lookup or cleanup stops (503) before the account goes, so a retry still
//    finds them (a lookup that failed must never erase a band that goes on).
// 6. bw_account_deletion_finish(): after the personal folders are emptied
//    again, re-checks Storage (uploads are blocked while the deletion holds,
//    but one may have started before), then their notifications and
//    messages once more. A personal file still there is a 503.
// 7. auth.admin.deleteUser() — profiles cascade from auth.users, the pending
//    deletion with them.
// Every step can run again, so a failed attempt can simply be retried. Each
// RPC is retried once on a deadlock (40P01): it is one transaction, and the
// abort rolled it back whole.
//
// The caller can only ever delete themselves: the user id comes from the JWT.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  adminClient,
  corsHeaders,
  errorResponse,
  HttpError,
  json,
  requireCaller,
} from "../_shared/auth.ts";
import {
  bandFolders,
  bandsToClean,
  beginOutcome,
  type FolderStore,
  prepareOutcome,
  removeFolder,
  retryOnDeadlock,
  storageReady,
} from "../_shared/account-deletion.ts";

const notReady = (what: string, detail?: unknown) => {
  console.warn(`delete-account: ${what} not ready`, detail);
  return json({ success: false, code: "storage_not_ready", error: "Could not remove your files yet. Try again." }, 503);
};

const bucketStore = (admin: ReturnType<typeof adminClient>, bucket: string): FolderStore => ({
  list: (prefix, opts) => admin.storage.from(bucket).list(prefix, opts),
  remove: (paths) => admin.storage.from(bucket).remove(paths),
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const admin = adminClient();
    const caller = await requireCaller(req, admin);
    if (caller.kind !== "user") throw new HttpError(403, "Only a signed-in user can delete their account");

    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== "DELETE") throw new HttpError(400, "Missing confirmation");

    // The band check, held until the account is gone. A retry after prepare
    // skips it (begin answers prepared): part of the account is already gone.
    const { data: beginData, error: beginError } = await retryOnDeadlock(() => admin.rpc('bw_account_deletion_begin', { p_uid: caller.id }));
    const begin = beginOutcome(beginData, beginError);
    if (begin.kind === "blocked") {
      return json({ success: false, code: "account_has_bands", bands: begin.bands }, 409);
    }
    if (begin.kind === "busy") {
      return json({ success: false, code: "account_deletion_in_progress", error: "A bandmate is deleting their account. Try again in a few minutes." }, 409);
    }
    if (begin.kind === "not_ready") return notReady("begin", beginError?.message ?? beginData);

    // Storage: personal files and the photo go, the rest stays with the
    // bands but no longer belongs to the account.
    await removeFolder(bucketStore(admin, "personal-files"), caller.id);
    await removeFolder(bucketStore(admin, "avatars"), caller.id);
    const { data: release, error: releaseError } = await retryOnDeadlock(() => admin.rpc("bw_account_storage_release", { p_uid: caller.id }));
    if (!storageReady(release, releaseError)) return notReady("storage", releaseError?.message ?? release);

    const { error: prepError } = await retryOnDeadlock(() => admin.rpc("bw_prepare_account_deletion", { p_uid: caller.id }));
    const prepare = prepareOutcome(prepError);
    if (prepare.kind === "blocked") {
      const { data: still } = await admin.rpc("bw_account_deletion_blockers", { p_uid: caller.id });
      const bands = Array.isArray(still) ? still.map((b: { band_name: string }) => b.band_name) : [];
      return json({ success: false, code: "account_has_bands", bands }, 409);
    }
    if (prepError) throw prepError;

    // Every band noted as going with the account (begin and prepare), also
    // from an earlier attempt that stopped after its bands were deleted.
    const { data: pending, error: pendingError } = await admin
      .from("account_deletions_pending")
      .select("band_ids")
      .eq("user_id", caller.id)
      .maybeSingle();
    if (pendingError) return notReady("pending", pendingError.message);
    const noted = [...new Set([...begin.bandIds, ...((pending?.band_ids as string[] | null) ?? [])])];
    if (noted.length > 0) {
      const stillThere = await admin.from("bands").select("id").in("id", noted);
      const toClean = bandsToClean(noted, stillThere);
      if (toClean === null) return notReady("band lookup", stillThere.error);
      let cleaned = true;
      for (const bandId of toClean) {
        for (const { bucket, prefix } of bandFolders(bandId)) {
          cleaned = (await removeFolder(bucketStore(admin, bucket), prefix)) && cleaned;
        }
      }
      if (!cleaned) return notReady("band files", toClean);
    }

    // The last step: personal files once more (another device may have
    // uploaded before uploads were blocked), then notifications and messages
    // once more. It stops (503) while a personal file is still there.
    await removeFolder(bucketStore(admin, "personal-files"), caller.id);
    await removeFolder(bucketStore(admin, "avatars"), caller.id);
    const { error: finishError } = await retryOnDeadlock(() => admin.rpc("bw_account_deletion_finish", { p_uid: caller.id }));
    if (finishError) return notReady("finish", finishError.message);

    const { error: deleteError } = await admin.auth.admin.deleteUser(caller.id);
    if (deleteError) throw deleteError;

    return json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
});
