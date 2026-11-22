/**
 * The link to a quote's PDF that a client may open (migrations 176/177).
 *
 * Quote PDFs live in the "quotes" bucket (public until 177, a later release).
 * A client reaches one only through the quote link: /functions/v1/quote-pdf?p=<key> checks that the
 * link still shows that PDF and streams the file back (never a redirect, so the
 * storage path stays hidden). Each
 * document has its own random key (176), so a PDF link passed on (to an
 * accountant, say) opens that one PDF and nothing else: not a later version,
 * not the balance PDF, not the client page, not Accept/Decline.
 * The stored storage URL stays what the app publishes (older builds too);
 * it is only a locator, so this module never hands it out.
 */

// Same file name characters as the server (176: bw_quote_pdf_storage_path).
const STORAGE_PDF = /\/storage\/v1\/object\/public\/quotes\/quotes\/[0-9a-f-]{36}\/[A-Za-z0-9._~%-]+$/;

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

/** The page's PDF keys (bw_quote_link_pdf_keys, 176): one per document. */
export type QuotePdfKeys = { doc?: string | null; balance?: string | null };

const KEY = /^[0-9a-f]{64}$/;
const LANG = /^[a-z]{2}$/;

/**
 * The gated PDF link for a PDF key ("balance": the balance request's PDF).
 * `lang`: the page language, for the gate's messages.
 */
export function quotePdfGateUrl(supabaseUrl: string, key: string, kind: 'doc' | 'balance' = 'doc', lang?: string | null): string {
  const base = supabaseUrl.replace(/\/+$/, '');
  const k = kind === 'balance' ? '&k=balance' : '';
  const l = lang && LANG.test(lang) ? `&l=${lang}` : '';
  return `${base}/functions/v1/quote-pdf?p=${encodeURIComponent(key)}${k}${l}`;
}

/**
 * What the client's page should link to: the gated link for a stored quote
 * PDF, nothing for anything else (a stray or foreign URL is never passed on).
 * `key`: that document's key from bw_quote_link_pdf_keys, never the token.
 */
export function clientQuotePdfUrl(
  stored: string | null | undefined,
  supabaseUrl: string | undefined,
  key: string | null | undefined,
  kind: 'doc' | 'balance' = 'doc',
  lang?: string | null,
): string | null {
  if (!stored || !supabaseUrl || !key || !KEY.test(key)) return null;
  return isQuoteStoragePdf(stored) ? quotePdfGateUrl(supabaseUrl, key, kind, lang) : null;
}
