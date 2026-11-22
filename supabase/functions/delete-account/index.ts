// Deletes the caller's own account (App Store / Play Store requirement).
//
// Two states (Codex and Claude reviews #282, round 5):
// 1-2. bw_account_deletion_begin (180): refuses (409) if the caller is the
//    only admin of a band with other members, under the band locks (a
//    co-admin deleting their own account counts as gone; then it is 409
//    account_deletion_in_progress: wait). Otherwise it records a pending
//    deletion: begun, nothing erased yet; it lapses after 15 minutes. While
//    it holds, no membership change that would make a later step refuse
//    goes through. It also notes the bands that go with the account.
// 3. bw_prepare_account_deletion(): the point of no return. In one
//    transaction it re-checks the bands, marks the deletion committed
//    (committed_at, never lapses) and erases the data: solo bands, personal
//    gigs, direct messages; band and gig chat messages stay as a former
//    member's. No file has gone before this.
// 4. finishCommitted (_shared/account-deletion.ts): personal files and the
//    photo, the Storage release check, the files of the bands that went,
//    the personal folders again, bw_account_deletion_finish, Auth, and the
//    final scrub of notifications. Not ready (503, committed: true) only
//    means "not yet": nothing can refuse any more.
// A retry once committed: begin answers committed and skips the band checks,
// prepare skips them too, and finishCommitted runs again. A committed
// deletion nobody retries is finished by the server: the job
// bw-finish-account-deletions (pg_cron, 180) calls this function with the
// dispatch secret every 5 minutes while one is due (committed and untouched
// for 5 minutes, leased with SKIP LOCKED). Every step can run twice, also at
// the same time. Each RPC is retried once on a deadlock (40P01): it is one
// transaction, and the abort rolled it back whole.
//
// The caller can only ever delete themselves: the user id comes from the JWT.
// The job only finishes deletions already committed by their own user.

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
  beginOutcome,
  type DeletionServer,
  finishCommitted,
  type FolderStore,
  prepareOutcome,
  retryOnDeadlock,
} from "../_shared/account-deletion.ts";

const notReady = (what: string, detail?: unknown, committed = false) => {
  console.warn(`delete-account: ${what} not ready`, detail);
  return json({
    success: false,
    code: "storage_not_ready",
    error: "Could not remove your files yet. Try again.",
    ...(committed ? { committed: true } : {}),
  }, 503);
};

const bucketStore = (admin: ReturnType<typeof adminClient>, bucket: string): FolderStore => ({
  list: (prefix, opts) => admin.storage.from(bucket).list(prefix, opts),
  remove: (paths) => admin.storage.from(bucket).remove(paths),
});

const deletionServer = (admin: ReturnType<typeof adminClient>): DeletionServer => ({
  rpc: (name, args) => admin.rpc(name, args),
  store: (bucket) => bucketStore(admin, bucket),
  pendingBandIds: (uid) => admin.from("account_deletions_pending").select("band_ids").eq("user_id", uid).maybeSingle(),
  bandsStillThere: (ids) => admin.from("bands").select("id").in("id", ids),
  deleteUser: (uid) => admin.auth.admin.deleteUser(uid),
});

// The server job (180's bw-finish-account-deletions): committed deletions
// nobody finished, a few per run (each one leased for 5 minutes).
async function sweep(admin: ReturnType<typeof adminClient>) {
  const { data: due, error } = await admin.rpc("bw_account_deletions_due", { p_limit: 3 });
  if (error) throw error;
  const ids = (Array.isArray(due) ? due : []).map((r: unknown) =>
    typeof r === "string" ? r : String((r as Record<string, unknown>)?.bw_account_deletions_due ?? ""),
  ).filter(Boolean);
  let finished = 0;
  for (const uid of ids) {
    const result = await finishCommitted(deletionServer(admin), uid);
    if (result.kind === "done") finished++;
    else console.warn(`delete-account sweep: ${result.what} not ready`, result.detail);
  }
  return json({ success: true, due: ids.length, finished });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const admin = adminClient();

    const dispatchSecret = req.headers.get("x-bw-dispatch-secret");
    if (dispatchSecret) {
      const { data: ok, error } = await admin.rpc("bw_verify_push_dispatch_secret", { p_secret: dispatchSecret });
      if (error || ok !== true) throw new HttpError(401, "Invalid dispatch secret");
      const body = await req.json().catch(() => ({}));
      if (body?.sweep !== true) throw new HttpError(400, "Missing sweep");
      return await sweep(admin);
    }

    const caller = await requireCaller(req, admin);
    if (caller.kind !== "user") throw new HttpError(403, "Only a signed-in user can delete their account");

    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== "DELETE") throw new HttpError(400, "Missing confirmation");

    // The band check, held until the account is gone. A retry once
    // committed skips it (begin answers committed): part of the account is
    // already gone.
    const { data: beginData, error: beginError } = await retryOnDeadlock(() => admin.rpc('bw_account_deletion_begin', { p_uid: caller.id }));
    const begin = beginOutcome(beginData, beginError);
    if (begin.kind === "blocked") {
      return json({ success: false, code: "account_has_bands", bands: begin.bands }, 409);
    }
    if (begin.kind === "busy") {
      return json({ success: false, code: "account_deletion_in_progress", error: "A bandmate is deleting their account. Try again in a few minutes." }, 409);
    }
    if (begin.kind === "not_ready") return notReady("begin", beginError?.message ?? beginData);

    // The point of no return, before any file goes: committed, data erased.
    const { error: prepError } = await retryOnDeadlock(() => admin.rpc("bw_prepare_account_deletion", { p_uid: caller.id }));
    const prepare = prepareOutcome(prepError);
    if (prepare.kind === "blocked") {
      const { data: still } = await admin.rpc("bw_account_deletion_blockers", { p_uid: caller.id });
      const bands = Array.isArray(still) ? still.map((b: { band_name: string }) => b.band_name) : [];
      return json({ success: false, code: "account_has_bands", bands }, 409);
    }
    // A retry once committed stays committed whatever prepare says (round 6,
    // Claude): the job finishes it.
    if (prepError && begin.committed) return notReady("prepare", prepError, true);
    if (prepError) throw prepError;

    // Files, the last step, Auth, the final scrub. Not ready is "not yet":
    // a retry or the job finishes it. The bands: what prepare noted as
    // deleted (round 6, Codex B2: begin's list was only a guess).
    const result = await finishCommitted(deletionServer(admin), caller.id);
    if (result.kind === "not_ready") return notReady(result.what, result.detail, true);

    return json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
});
