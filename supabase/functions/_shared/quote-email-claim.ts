/**
 * Round 4 (183): one quote email per link per minute, also when two taps
 * (or two admins) send at the same moment. The slot is taken with one
 * conditional update: only the request whose update returns the row sends;
 * the other sends nothing. A failed send gives the slot back, unless a
 * later send took it meanwhile.
 */

// The part of the Supabase client used here (keeps this module testable).
type Filter = {
  eq: (column: string, value: unknown) => Filter;
  or: (filters: string) => Filter;
  select: (columns: string) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
} & PromiseLike<{ error: unknown }>;
export interface ClaimClient {
  from: (table: string) => { update: (values: Record<string, unknown>) => Filter };
}

export interface EmailSlot {
  at: string;
  release: () => PromiseLike<unknown>;
}

export async function claimQuoteEmailSlot(
  admin: ClaimClient,
  linkId: string,
  previous: string | null,
  intervalMs: number,
  now = Date.now(),
): Promise<EmailSlot | null> {
  const at = new Date(now).toISOString();
  const cutoff = new Date(now - intervalMs).toISOString();
  const { data, error } = await admin
    .from("quote_links")
    .update({ last_emailed_at: at })
    .eq("id", linkId)
    .or(`last_emailed_at.is.null,last_emailed_at.lt.${cutoff}`)
    .select("id");
  if (error || !Array.isArray(data) || data.length === 0) return null;
  return {
    at,
    release: () => admin.from("quote_links").update({ last_emailed_at: previous }).eq("id", linkId).eq("last_emailed_at", at),
  };
}

/**
 * The balance the admin's screen showed is not the one on the client's
 * page now (another admin published a new one): the email waits. Only when
 * the app says which version it saw (older builds don't).
 */
export const staleBalanceVersion = (asked: unknown, current: unknown): boolean =>
  typeof asked === "number" && Number.isInteger(asked) && Number(current ?? 0) !== asked;
