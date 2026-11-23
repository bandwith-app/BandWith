// A quote's PDF, only while its quote link shows it (migrations 176/177).
//
// GET /functions/v1/quote-pdf?p=<PDF key>[&k=balance][&l=<lang>]
// Every document has its own random key (bw_quote_link_pdf_keys gives the
// client page its keys): a PDF link passed on opens that one PDF, never a
// later version, the balance PDF or the client page (src/lib/quotePdfLink.ts).
// bw_quote_link_pdf_path says which file the key opens right now (none when
// the link is turned off or the document changed), already decoded and
// checked. Round 4: the file is streamed back (serveQuotePdf), never a
// redirect: the answer must not reveal the storage path, which stays a
// public URL while the bucket is public (this release; 177 later).
// Known limits until 177: older app builds still share the public storage
// URL, and public URLs already shared keep working.
// Messages follow the page language (l=), else Accept-Language.
// Public by design: the 64-character key is the credential. Deploy with
// --no-verify-jwt.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient } from "../_shared/auth.ts";
import { serveQuotePdf } from "../_shared/quote-pdf-path.ts";

serve((req) => {
  const admin = adminClient();
  return serveQuotePdf(req, {
    lookup: async (key, kind) => {
      const { data, error } = await admin.rpc("bw_quote_link_pdf_path", { p_key: key, p_kind: kind });
      if (error) console.error("quote-pdf: lookup failed", error.message);
      return { path: typeof data === "string" ? data : null, error: error?.message ?? null };
    },
    download: async (path) => {
      const { data, error } = await admin.storage.from("quotes").download(path);
      return { data: data ?? null, error: error?.message ?? null };
    },
  });
});
