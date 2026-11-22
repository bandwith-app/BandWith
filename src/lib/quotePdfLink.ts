/**
 * The link to a quote's PDF that a client may open (migrations 176/177).
 *
 * Quote PDFs live in the private "quotes" bucket. A client reaches one only
 * through the quote link: /functions/v1/quote-pdf?t=<token> checks that the
 * link is still on and redirects to a short-lived signed URL. The stored
 * storage URL stays what the app publishes (older builds too); it is only a
 * locator, so this module never hands it out.
 */

const STORAGE_PDF = /\/storage\/v1\/object\/public\/quotes\/quotes\/[0-9a-f-]{36}\/[A-Za-z0-9._%-]+$/;

/** Is this one of the band's quote PDFs in storage (as uploaded by the app)? */
export function isQuoteStoragePdf(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && STORAGE_PDF.test(u.pathname);
  } catch {
    return false;
  }
}

/** The gated PDF link for a quote link token ("balance": the balance request's PDF). */
export function quotePdfGateUrl(supabaseUrl: string, token: string, kind: 'doc' | 'balance' = 'doc'): string {
  const base = supabaseUrl.replace(/\/+$/, '');
  const k = kind === 'balance' ? '&k=balance' : '';
  return `${base}/functions/v1/quote-pdf?t=${encodeURIComponent(token)}${k}`;
}

/**
 * What the client's page or a share message should link to: the gated link
 * for a stored quote PDF, nothing for anything else (a stray or foreign URL
 * is never passed on).
 */
export function clientQuotePdfUrl(
  stored: string | null | undefined,
  supabaseUrl: string | undefined,
  token: string | null | undefined,
  kind: 'doc' | 'balance' = 'doc',
): string | null {
  if (!stored || !supabaseUrl || !token || !/^[0-9a-f]{64}$/.test(token)) return null;
  return isQuoteStoragePdf(stored) ? quotePdfGateUrl(supabaseUrl, token, kind) : null;
}
