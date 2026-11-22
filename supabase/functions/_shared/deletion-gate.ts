// Edge functions that act for a signed-in caller with the service key
// (their writes skip 180's triggers, which only see app requests) refuse
// once the caller's account deletion is committed (Claude review #282,
// round 6, M3): nothing new is sent or written in their name. The answer
// carries the hint the app signs out on (src/lib/deletionSignOut.ts).
// No imports: the app's tests load this file as it is.

type Caller = { kind: "service" } | { kind: "user"; id: string };

interface PendingLookup {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        not(column: string, op: string, value: null): {
          maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
        };
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
    console.warn("deletion-gate: lookup failed", error);
    return { status: 503, body: { success: false, error: "Try again in a moment." } };
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
