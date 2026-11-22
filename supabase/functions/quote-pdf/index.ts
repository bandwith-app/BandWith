// A quote's PDF, only while its quote link is on (migrations 176/177).
//
// GET /functions/v1/quote-pdf?p=<PDF key>[&k=balance]
// The key is sha256(link token): a PDF link passed on opens the PDF only,
// never the client page (src/lib/quotePdfLink.ts).
// bw_quote_link_pdf_path says which file the link shows right now (none when
// the link is turned off or replaced); the answer is a redirect to that file
// signed for five minutes. The quotes bucket is private, so this is the only
// way a client reaches a PDF.
// Public by design: the 64-character key is the credential. Deploy with
// --no-verify-jwt.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient } from "../_shared/auth.ts";
import { quoteStoragePath } from "../_shared/quote-pdf-path.ts";

const SIGNED_SECONDS = 300;

const plain = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return plain("Method not allowed", 405);
  const url = new URL(req.url);
  const key = (url.searchParams.get("p") ?? "").toLowerCase();
  const kind = url.searchParams.get("k") === "balance" ? "balance" : "doc";
  if (!/^[0-9a-f]{64}$/.test(key)) return plain("This link is not active.", 404);

  const admin = adminClient();
  const { data: path, error } = await admin.rpc("bw_quote_link_pdf_path", { p_key: key, p_kind: kind });
  if (error) {
    console.error("quote-pdf: lookup failed", error.message);
    return plain("Please try again in a moment.", 503);
  }
  // Decoded first, then checked: an encoded "/" or ".." can't leave the folder.
  const file = quoteStoragePath(typeof path === "string" ? path : null);
  if (!file) return plain("This link is not active.", 404);

  const { data: signed, error: signError } = await admin.storage
    .from("quotes")
    .createSignedUrl(file, SIGNED_SECONDS);
  if (signError || !signed?.signedUrl) {
    console.error("quote-pdf: could not sign", signError?.message);
    return plain("Please try again in a moment.", 503);
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
