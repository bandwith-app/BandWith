/**
 * The link to a quote's PDF that a client may open (migrations 176/177).
 *
 * Quote PDFs live in the private "quotes" bucket. A client reaches one only
 * through the quote link: /functions/v1/quote-pdf?p=<key> checks that the
 * link is still on and redirects to a short-lived signed URL. The key is
 * sha256 of the link token, so a PDF link passed on (to an accountant, say)
 * opens the PDF and nothing else: not the client page, not Accept/Decline.
 * The stored storage URL stays what the app publishes (older builds too);
 * it is only a locator, so this module never hands it out.
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

// SHA-256 of an ASCII string, in plain JS: crypto.subtle is missing outside
// secure contexts (and in tests), and the client page must never lose its PDF.
const K = Uint32Array.from(
  '428a2f98 71374491 b5c0fbcf e9b5dba5 3956c25b 59f111f1 923f82a4 ab1c5ed5 d807aa98 12835b01 243185be 550c7dc3 72be5d74 80deb1fe 9bdc06a7 c19bf174 e49b69c1 efbe4786 0fc19dc6 240ca1cc 2de92c6f 4a7484aa 5cb0a9dc 76f988da 983e5152 a831c66d b00327c8 bf597fc7 c6e00bf3 d5a79147 06ca6351 14292967 27b70a85 2e1b2138 4d2c6dfc 53380d13 650a7354 766a0abb 81c2c92e 92722c85 a2bfe8a1 a81a664b c24b8b70 c76c51a3 d192e819 d6990624 f40e3585 106aa070 19a4c116 1e376c08 2748774c 34b0bcb5 391c0cb3 4ed8aa4a 5b9cca4f 682e6ff3 748f82ee 78a5636f 84c87814 8cc70208 90befffa a4506ceb bef9a3f7 c67178f2'
    .split(' '),
  (h) => parseInt(h, 16),
);

function sha256Ascii(text: string): string {
  const len = text.length;
  const words = new Uint32Array((((len + 8) >> 6) + 1) * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= (text.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
  words[len >> 2] |= 0x80 << (24 - (len % 4) * 8);
  words[words.length - 1] = len * 8;
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < words.length; off += 16) {
    for (let t = 0; t < 64; t++) {
      if (t < 16) w[t] = words[off + t];
      else {
        const a = w[t - 15];
        const b = w[t - 2];
        w[t] = (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[t - 16] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)) + w[t - 7];
      }
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}

/** The PDF-only key of a link token: sha256, hex (what bw_quote_link_pdf_path matches). */
export function quotePdfKey(token: string | null | undefined): string | null {
  return typeof token === 'string' && /^[0-9a-f]{64}$/.test(token) ? sha256Ascii(token) : null;
}

/** The gated PDF link for a PDF key ("balance": the balance request's PDF). */
export function quotePdfGateUrl(supabaseUrl: string, key: string, kind: 'doc' | 'balance' = 'doc'): string {
  const base = supabaseUrl.replace(/\/+$/, '');
  const k = kind === 'balance' ? '&k=balance' : '';
  return `${base}/functions/v1/quote-pdf?p=${encodeURIComponent(key)}${k}`;
}

/**
 * What the client's page should link to: the gated link for a stored quote
 * PDF, nothing for anything else (a stray or foreign URL is never passed on).
 * `key`: quotePdfKey(token), never the token itself.
 */
export function clientQuotePdfUrl(
  stored: string | null | undefined,
  supabaseUrl: string | undefined,
  key: string | null | undefined,
  kind: 'doc' | 'balance' = 'doc',
): string | null {
  if (!stored || !supabaseUrl || !key || !/^[0-9a-f]{64}$/.test(key)) return null;
  return isQuoteStoragePdf(stored) ? quotePdfGateUrl(supabaseUrl, key, kind) : null;
}
