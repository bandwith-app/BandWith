/**
 * Quote PDF paths and the quote-pdf gate's texts (migrations 176/177).
 * Plain TypeScript with no imports: Deno and vitest share it.
 *
 * Stored URLs may keep the file name URL-encoded. Decoding has to come
 * BEFORE the folder check: an encoded `/` or `..` in the name (`%2F`, `%2E`)
 * would otherwise turn `quotes/<band>/<name>` into another band's folder after
 * the check passed, and the server would sign that file (Codex review #281).
 * A path that is already decoded (what bw_quote_link_pdf_path returns) is
 * only checked, never decoded again: decoding twice turns `%252F` into `/`.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * A decoded `quotes/<band>/<file>`, or null. The file name is one segment
 * with no `%`, `/`, `\`, `..` or control character (round 2).
 */
export function checkedQuotePath(path: string | null | undefined, bandId?: string | null): string | null {
  if (typeof path !== 'string' || !path) return null;
  const m = new RegExp(`^quotes/(${UUID})/([^/\\\\%]+)$`, 'i').exec(path);
  if (!m) return null;
  const file = m[2];
  if (file.includes('..') || /[\u0000-\u001f\u007f]/.test(file)) return null;
  if (bandId && m[1].toLowerCase() !== bandId.toLowerCase()) return null;
  return path;
}

/** A stored (encoded) `quotes/<band>/<file>`, decoded once and checked; null when it could reach anywhere else. */
export function quoteStoragePath(encoded: string | null | undefined, bandId?: string | null): string | null {
  if (typeof encoded !== 'string' || !encoded) return null;
  let path: string;
  try {
    path = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  return checkedQuotePath(path, bandId);
}

const STORAGE_MARKER = '/storage/v1/object/public/quotes/';

/**
 * The signed URL of a stored quote PDF for an email attachment.
 * `url: null, failed: false`: nothing to attach (no PDF, or not this band's
 * file). `failed: true`: there is a PDF but it could not be signed; the
 * caller must not send without it (round 2: the email went out without its
 * attachment and the app was told it was sent).
 */
export async function signQuotePdf(
  sign: (path: string) => Promise<{ url?: string | null; error?: string | null }>,
  stored: string | null | undefined,
  bandId: string,
): Promise<{ url: string | null; failed: boolean }> {
  if (!stored) return { url: null, failed: false };
  let pathname: string;
  try {
    const u = new URL(stored);
    if (u.protocol !== 'https:' || !u.pathname.startsWith(STORAGE_MARKER)) return { url: null, failed: false };
    pathname = u.pathname.slice(STORAGE_MARKER.length);
  } catch {
    return { url: null, failed: false };
  }
  const path = quoteStoragePath(pathname, bandId);
  if (!path) return { url: null, failed: false };
  try {
    const { url, error } = await sign(path);
    if (error || !url) return { url: null, failed: true };
    return { url, failed: false };
  } catch {
    return { url: null, failed: true };
  }
}

// ── The gate's answers, in the client page's language ─────────────────────
export type PdfGateLang = 'en' | 'it' | 'es' | 'fr' | 'de' | 'pt';
export type PdfGateMessage = 'inactive' | 'retry' | 'method';

const GATE_TEXT: Record<PdfGateLang, Record<PdfGateMessage, string>> = {
  en: { inactive: 'This link is not active.', retry: 'Please try again in a moment.', method: 'Method not allowed.' },
  it: { inactive: 'Questo link non è attivo.', retry: 'Riprova tra un momento.', method: 'Metodo non consentito.' },
  es: { inactive: 'Este enlace no está activo.', retry: 'Vuelve a intentarlo en un momento.', method: 'Método no permitido.' },
  fr: { inactive: 'Ce lien n’est pas actif.', retry: 'Réessayez dans un instant.', method: 'Méthode non autorisée.' },
  de: { inactive: 'Dieser Link ist nicht aktiv.', retry: 'Bitte versuche es gleich noch einmal.', method: 'Methode nicht erlaubt.' },
  pt: { inactive: 'Este link não está ativo.', retry: 'Tente novamente daqui a pouco.', method: 'Método não permitido.' },
};

const isGateLang = (l: string): l is PdfGateLang => Object.prototype.hasOwnProperty.call(GATE_TEXT, l);

/** `l=` from the page first, then the browser's Accept-Language, then English. */
export function pickPdfGateLang(param: string | null | undefined, acceptLanguage: string | null | undefined): PdfGateLang {
  const p = (param ?? '').slice(0, 2).toLowerCase();
  if (isGateLang(p)) return p;
  for (const part of (acceptLanguage ?? '').split(',')) {
    const l = part.trim().slice(0, 2).toLowerCase();
    if (isGateLang(l)) return l;
  }
  return 'en';
}

export function pdfGateText(lang: PdfGateLang, key: PdfGateMessage): string {
  return (GATE_TEXT[lang] ?? GATE_TEXT.en)[key];
}
