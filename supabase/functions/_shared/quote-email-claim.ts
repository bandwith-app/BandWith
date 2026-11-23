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

/**
 * Round 5: an error from the mail service that the service raised before it
 * took the email (a 4xx: the request was refused, validation, rate limit):
 * nothing went out, the slot can be given back. Anything else (a timeout,
 * the connection lost, a 5xx, a 409 for a key already used) may have been
 * sent: the slot stays taken, so a second tap doesn't send it twice.
 */
export class MailServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const sentNothing = (e: unknown): boolean =>
  e instanceof MailServiceError && e.status >= 400 && e.status < 500 && e.status !== 409;

/** Round 5: one key per claimed slot, so a retry of the same send is one email. */
export const quoteEmailIdempotencyKey = (linkId: string, slotAt: string): string => `quote-email/${linkId}/${slotAt}`;
