-- ============================================================================
-- 176 · Quote PDFs behind the quote link (step 1 of 2)
-- ----------------------------------------------------------------------------
-- Quote PDFs sit in the public "quotes" bucket: turning a quote link off left
-- the PDF (which can carry the band's bank details) downloadable from its
-- storage URL for good. From now on a PDF is reached only through the link:
--
--   GET /functions/v1/quote-pdf?p=<PDF key>[&k=balance]
--
-- The PDF key is sha256(link token) in hex: a PDF link passed on (to an
-- accountant, say) opens that PDF and nothing else. It can't be turned back
-- into the token, so not the client page, Accept/Decline or the messages.
--
-- The quote-pdf function asks bw_quote_link_pdf_path which file the link
-- shows right now (the same rule as bw_quote_link_view: the accepted PDF once
-- accepted, else the current version's PDF; the balance PDF once a balance is
-- shown) and answers with a storage URL signed for five minutes. A link that
-- is turned off, deleted or replaced gets nothing.
--
-- Rollout (nothing is moved, copied or deleted; files stay where they are):
--   1. apply this migration (adds the function only; changes nothing visible);
--   2. deploy the functions quote-pdf (new, --no-verify-jwt) and send-email,
--      and the web app (quote.html builds the gated links);
--   3. apply 177, which makes the bucket private. Old direct storage URLs
--      stop working then; the quote page link in sent emails keeps working
--      and its PDF button goes through the gate.
-- Older app builds keep uploading and publishing the same storage URL
-- format: it is only used as a locator now (bw_quote_link_pdf_path).
-- Idempotent.
-- ============================================================================

BEGIN;

-- The parameter is a key, not a token (same signature, new name).
DROP FUNCTION IF EXISTS public.bw_quote_link_pdf_path(text, text);
CREATE FUNCTION public.bw_quote_link_pdf_path(p_key text, p_kind text DEFAULT 'doc')
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_link public.quote_links;
  v_url text;
  v_gig_status text;
  v_m text[];
BEGIN
  IF p_key IS NULL OR p_key !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO v_link FROM public.quote_links l
   WHERE encode(sha256(convert_to(l.token, 'UTF8')), 'hex') = p_key;
  IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL OR v_link.snapshot IS NULL THEN RETURN NULL; END IF;

  IF coalesce(p_kind, 'doc') = 'balance' THEN
    SELECT e.status INTO v_gig_status FROM public.events e WHERE e.id = public.bw_quote_gig_id(v_link.quote_id);
    IF v_link.status <> 'accepted' OR v_link.balance IS NULL OR coalesce(v_gig_status, '') = 'cancelled' THEN
      RETURN NULL;
    END IF;
    v_url := v_link.balance ->> 'pdfUrl';
  ELSIF v_link.status = 'accepted' THEN
    v_url := v_link.accepted_pdf_url;
  ELSIF v_link.pdf_version = v_link.version THEN
    v_url := v_link.pdf_url;
  END IF;

  -- Only a file of this band, in the layout the app uploads (still encoded:
  -- the function decodes, then checks the folder again).
  v_m := regexp_match(coalesce(v_url, ''),
    '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/quotes/(quotes/' || v_link.band_id::text || '/[A-Za-z0-9._%-]+)$');
  RETURN v_m[1];
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_link_pdf_path(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_pdf_path(text, text) TO service_role;

COMMIT;
