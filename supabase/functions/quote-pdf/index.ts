// A quote's PDF, only while its quote link is on (migrations 176/177).
//
// GET /functions/v1/quote-pdf?t=<link token>[&k=balance]
// bw_quote_link_pdf_path says which file the link shows right now (none when
// the link is turned off or replaced); the answer is a redirect to that file
// signed for five minutes. The quotes bucket is private, so this is the only
// way a client reaches a PDF.
// Public by design: the 64-character link token is the key, as for the quote
// page itself. Deploy with --no-verify-jwt.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient } from "../_shared/auth.ts";

const SIGNED_SECONDS = 300;

const plain = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return plain("Method not allowed", 405);
  const url = new URL(req.url);
  const token = (url.searchParams.get("t") ?? "").toLowerCase();
  const kind = url.searchParams.get("k") === "balance" ? "balance" : "doc";
  if (!/^[0-9a-f]{64}$/.test(token)) return plain("This link is not active.", 404);

  const admin = adminClient();
  const { data: path, error } = await admin.rpc("bw_quote_link_pdf_path", { p_token: token, p_kind: kind });
  if (error) {
    console.error("quote-pdf: lookup failed", error.message);
    return plain("Please try again in a moment.", 503);
  }
  if (typeof path !== "string" || path.length === 0) return plain("This link is not active.", 404);

  const { data: signed, error: signError } = await admin.storage
    .from("quotes")
    .createSignedUrl(decodeURIComponent(path), SIGNED_SECONDS);
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
