// Deletes the caller's own account (App Store / Play Store requirement).
//
// 1. Refuses (409) if the caller is the only admin of a band with other members.
// 2. Storage first, before any data is deleted (180): removes the caller's
//    personal files and avatar, and releases the files that stay with their
//    bands (bw_account_storage_release). If a personal file is still there it
//    stops (503, nothing deleted): Auth would refuse the deletion later.
// 3. bw_prepare_account_deletion(): removes solo bands and clears references.
// 4. Removes the files of the bands that are really gone, only when that
//    lookup succeeded (a failed lookup must not erase a band that goes on).
// 5. auth.admin.deleteUser() — profiles cascade from auth.users.
// Every step can run again, so a failed attempt can simply be retried.
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
import { bandsToClean, storageReady } from "../_shared/account-deletion.ts";

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

    const { data: blockers, error: blockersError } = await admin.rpc(
      "bw_account_deletion_blockers",
      { p_uid: caller.id },
    );
    if (blockersError) throw blockersError;
    if (Array.isArray(blockers) && blockers.length > 0) {
      return json({
        success: false,
        code: "account_has_bands",
        bands: blockers.map((b: { band_name: string }) => b.band_name),
      }, 409);
    }

    // Storage first: personal files and the avatar go, the rest stays with
    // the bands but no longer belongs to the account.
    await removeFolder(admin, "personal-files", caller.id).catch(() => undefined);
    try {
      const { data: files } = await admin.storage.from("avatars").list(caller.id, { limit: 100 });
      if (files && files.length > 0) {
        await admin.storage.from("avatars").remove(files.map((f) => `${caller.id}/${f.name}`));
      }
    } catch (_e) {
      // leftovers are released below
    }
    const { data: release, error: releaseError } = await admin.rpc("bw_account_storage_release", { p_uid: caller.id });
    if (!storageReady(release, releaseError)) {
      console.warn("delete-account: storage not ready", releaseError?.message ?? release);
      return json({ success: false, code: "storage_not_ready", error: "Could not remove your files yet. Try again." }, 503);
    }

    // Bands the user belongs to: the solo ones are deleted by the RPC below,
    // and their files must go too.
    const { data: myBands, error: myBandsError } = await admin
      .from("band_members")
      .select("band_id")
      .eq("user_id", caller.id);
    if (myBandsError) throw myBandsError;
    const myBandIds = [...new Set((myBands ?? []).map((b: { band_id: string }) => b.band_id))];

    const { error: prepError } = await admin.rpc("bw_prepare_account_deletion", { p_uid: caller.id });
    if (prepError) throw prepError;

    try {
      if (myBandIds.length > 0) {
        const stillThere = await admin.from("bands").select("id").in("id", myBandIds);
        for (const bandId of bandsToClean(myBandIds, stillThere)) {
          await removeFolder(admin, "song-files", bandId);
          await removeFolder(admin, "band-branding", bandId);
          await removeFolder(admin, "quotes", `quotes/${bandId}`);
        }
      }
    } catch (_e) {
      // ignore: storage cleanup must not block the deletion
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(caller.id);
    if (deleteError) throw deleteError;

    return json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
});

/** Delete every object under `prefix` (Storage lists one level at a time). */
async function removeFolder(
  admin: ReturnType<typeof adminClient>,
  bucket: string,
  prefix: string,
  depth = 0,
): Promise<void> {
  if (depth > 4) return;
  for (let round = 0; round < 50; round++) {
    const { data: items, error } = await admin.storage.from(bucket).list(prefix, { limit: 100 });
    if (error || !items || items.length === 0) return;
    const files = items.filter((i) => i.id).map((i) => `${prefix}/${i.name}`);
    const folders = items.filter((i) => !i.id).map((i) => `${prefix}/${i.name}`);
    for (const f of folders) await removeFolder(admin, bucket, f, depth + 1);
    if (files.length === 0) return;
    await admin.storage.from(bucket).remove(files);
    if (items.length < 100) return;
  }
}
