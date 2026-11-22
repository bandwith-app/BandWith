// A quote's PDF, only while its quote link shows it (migrations 176/177).
//
// GET /functions/v1/quote-pdf?p=<PDF key>[&k=balance][&l=<lang>]
// Every document has its own random key (bw_quote_link_pdf_keys gives the
// client page its keys): a PDF link passed on opens that one PDF, never a
// later version, the balance PDF or the client page (src/lib/quotePdfLink.ts).
// bw_quote_link_pdf_path says which file the key opens right now (none when
// the link is turned off or the document changed), already decoded and
// checked; the answer is a redirect to that file signed for five minutes.
// Works with the quotes bucket public (this release) or private (177, a
// later release: then this is the only way a client reaches a PDF). Messages follow the page language (l=), else Accept-Language.
// Public by design: the 64-character key is the credential. Deploy with
// --no-verify-jwt.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient } from "../_shared/auth.ts";
import { checkedQuotePath, pdfGateText, pickPdfGateLang, type PdfGateMessage } from "../_shared/quote-pdf-path.ts";

const SIGNED_SECONDS = 300;

serve(async (req) => {
  const url = new URL(req.url);
  const lang = pickPdfGateLang(url.searchParams.get("l"), req.headers.get("accept-language"));
  const plain = (key: PdfGateMessage, status: number) =>
    new Response(pdfGateText(lang, key), {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Content-Language": lang },
    });

  if (req.method !== "GET" && req.method !== "HEAD") return plain("method", 405);
  const key = (url.searchParams.get("p") ?? "").toLowerCase();
  const kind = url.searchParams.get("k") === "balance" ? "balance" : "doc";
  if (!/^[0-9a-f]{64}$/.test(key)) return plain("inactive", 404);

  const admin = adminClient();
  const { data: path, error } = await admin.rpc("bw_quote_link_pdf_path", { p_key: key, p_kind: kind });
  if (error) {
    console.error("quote-pdf: lookup failed", error.message);
    return plain("retry", 503);
  }
  // Already decoded by the database: checked again, never decoded twice.
  const file = checkedQuotePath(typeof path === "string" ? path : null);
  if (!file) return plain("inactive", 404);

  const { data: signed, error: signError } = await admin.storage
    .from("quotes")
    .createSignedUrl(file, SIGNED_SECONDS);
  if (signError || !signed?.signedUrl) {
    console.error("quote-pdf: could not sign", signError?.message);
    return plain("retry", 503);
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: signed.signedUrl,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
});
