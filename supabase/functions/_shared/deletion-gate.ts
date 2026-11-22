// Edge functions that act for a signed-in caller with the service key
// (their writes skip 180's triggers, which only see app requests) refuse
// once the caller's account deletion is committed (Claude review #282,
// round 6, M3): nothing new is sent or written in their name. A failed
// lookup lets the call through (round 9). The answer
// carries the hint the app signs out on (src/lib/deletionSignOut.ts).
// No imports: the app's tests load this file as it is.

type Caller = { kind: "service" } | { kind: "user"; id: string };

type Row = PromiseLike<{ data: unknown; error: unknown }>;
interface PendingLookup {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        not(column: string, op: string, value: null): { maybeSingle(): Row };
        maybeSingle?(): Row;
      };
    };
  };
}

export type DeletionRefusal = { status: number; body: Record<string, unknown> };

/** A refusal to answer with, or null when the caller may go on. */
export async function callerDeletionRefusal(admin: PendingLookup, caller: Caller): Promise<DeletionRefusal | null> {
  if (caller.kind !== "user") return null;
  const { data, error } = await admin
    .from("account_deletions_pending")
    .select("user_id")
    .eq("user_id", caller.id)
    .not("committed_at", "is", null)
    .maybeSingle();
  if (error) {
    // Round 9 (Claude): fail open. Before 180 the table is missing (passes
    // quietly); any other error passes with a warning. 180's triggers stay
    // the hard guard; only a committed answer refuses here.
    const code = (error as { code?: string } | null)?.code ?? "";
    if (!["PGRST205", "42P01", "42703"].includes(code)) console.warn("deletion-gate: lookup failed, letting the call through", error);
    return null;
  }
  if (!data) return null;
  return {
    status: 409,
    body: {
      success: false,
      code: "account_being_deleted",
      hint: "account_being_deleted",
      error: "Your account is being deleted.",
    },
  };
}

/**
 * Round 10 (Claude r9): right before any device rings. The sender's
 * deletion may have committed after the gate: 180's trigger then dropped
 * the inbox rows, and no lock screen may show the preview either. True when
 * the sender's deletion is committed or the account is gone; a failed
 * lookup is false (the push goes, as before).
 */
export async function senderBeingDeleted(admin: PendingLookup, senderId: unknown): Promise<boolean> {
  if (typeof senderId !== "string" || !senderId) return false;
  if (await deletionCommitted(admin, senderId)) return true;
  const byId = admin.from("profiles").select("id").eq("id", senderId);
  if (!byId.maybeSingle) return false;
  const profile = await byId.maybeSingle();
  if (profile.error) {
    console.warn("deletion-gate: sender lookup failed, pushing", profile.error);
    return false;
  }
  return !profile.data;
}

/** A committed deletion for this id; a failed lookup is false (the push goes). */
async function deletionCommitted(admin: PendingLookup, userId: string): Promise<boolean> {
  const pending = await admin
    .from("account_deletions_pending")
    .select("user_id")
    .eq("user_id", userId)
    .not("committed_at", "is", null)
    .maybeSingle();
  if (pending.error) {
    console.warn("deletion-gate: sender lookup failed, pushing", pending.error);
    return false;
  }
  return !!pending.data;
}

/**
 * Round 11 (Claude r10 F1): the push's actors, as 180's notifications
 * trigger reads them. `sender` (a chat sender: committed, or gone) and `by`
 * (108's suggestion author: committed only). send-push passes the caller
 * as the sender for a user call (never the sender_id the app sent), and
 * data.sender_id only for a service call.
 */
export async function pushActorBeingDeleted(
  admin: PendingLookup,
  actors: { sender?: unknown; by?: unknown },
): Promise<boolean> {
  if (await senderBeingDeleted(admin, actors.sender)) return true;
  const by = actors.by;
  if (typeof by !== "string" || !by || by === actors.sender) return false;
  return deletionCommitted(admin, by);
}
