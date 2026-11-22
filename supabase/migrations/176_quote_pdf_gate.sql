-- ============================================================================
-- 176 · Quote PDFs behind the quote link (step 1 of 2)
-- ----------------------------------------------------------------------------
-- Quote PDFs sit in the public "quotes" bucket: turning a quote link off left
-- the PDF (which can carry the band's bank details) downloadable from its
-- storage URL for good. From now on a PDF is reached only through the link:
--
--   GET /functions/v1/quote-pdf?p=<PDF key>[&k=balance][&l=<lang>]
--
-- Every document has its own PDF key (round 2):
--   * quote_links.pdf_key: the quote PDF the client page shows now (the
--     accepted PDF once accepted, else the current version's PDF);
--   * quote_links.balance_pdf_key: the balance request PDF the client was
--     sent (185's balance_sent when that column exists, else the published
--     balance, as the page shows it before 187).
-- A key is random and changes whenever its document changes (a new version,
-- a new PDF, acceptance, a new balance, a new link token; once accepted only
-- the frozen accepted PDF counts, round 3), and is dropped
-- while the link is turned off. So a PDF link passed on (to an accountant,
-- say) opens that one document: not a later revision, not the balance PDF,
-- not the client page, Accept/Decline or the messages. Lookups go through a
-- unique index (no hashing of every link on each request).
--
-- bw_quote_link_pdf_keys(token) gives the client page its keys (anon, by
-- token: the page already holds the token). bw_quote_link_pdf_path(key,
-- kind) tells quote-pdf which file a key opens right now; the function
-- answers with a storage URL signed for five minutes. A link that is turned
-- off, deleted or replaced gets nothing. Stored URLs are decoded here and
-- checked after decoding ("%", "/", "\", ".." and control characters are
-- refused in the file name); quote-pdf checks the path again.
--
-- Rollout (nothing is moved, copied or deleted; files stay where they are):
--   1. apply this migration (adds columns and functions; nothing visible);
--   2. deploy the functions quote-pdf (new, --no-verify-jwt) and send-email,
--      and the web app (quote.html builds the gated links).
-- Everything here works with the quotes bucket still public (round 3: 177,
-- the private bucket, is NOT part of this release: released apps still
-- share public storage URLs). The gate signs URLs, which a public bucket
-- serves as well.
-- Older app builds keep uploading and publishing the same storage URL
-- format: it is only used as a locator now. Works before and after 185
-- (balance_sent is read at run time). Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.quote_links
  ADD COLUMN IF NOT EXISTS pdf_key text,
  ADD COLUMN IF NOT EXISTS balance_pdf_key text,
  -- Which document each key was made for (a hash): a key changes only when
  -- its document does, also across 185 adding balance_sent.
  ADD COLUMN IF NOT EXISTS pdf_key_doc text,
  ADD COLUMN IF NOT EXISTS balance_pdf_key_doc text;
CREATE UNIQUE INDEX IF NOT EXISTS quote_links_pdf_key_idx ON public.quote_links (pdf_key);
CREATE UNIQUE INDEX IF NOT EXISTS quote_links_balance_pdf_key_idx ON public.quote_links (balance_pdf_key);

-- The quote PDF a link shows now (as bw_quote_link_view: the accepted PDF
-- once accepted, else the current version's PDF).
CREATE OR REPLACE FUNCTION public.bw_quote_link_doc_pdf(p_link public.quote_links)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN p_link.status = 'accepted' THEN p_link.accepted_pdf_url
              WHEN p_link.pdf_version = p_link.version THEN p_link.pdf_url END;
$$;

-- The balance the client was sent: 185's balance_sent when that column
-- exists (read at run time: this works before and after 185), else the
-- published balance.
CREATE OR REPLACE FUNCTION public.bw_quote_link_balance_doc(p_link public.quote_links)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT nullif(CASE WHEN to_jsonb(p_link) ? 'balance_sent' THEN to_jsonb(p_link) -> 'balance_sent'
                     ELSE to_jsonb(p_link) -> 'balance' END, 'null'::jsonb);
$$;

-- Which document a key opens: NULL when there is none (or the link is off).
CREATE OR REPLACE FUNCTION public.bw_quote_link_doc_id(p_link public.quote_links)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  -- Accepted: the frozen accepted PDF alone (round 3: editing the quote after
  -- acceptance bumps its version, not the document the client sees, so the
  -- key stays). Otherwise the current version and its PDF.
  SELECT CASE WHEN p_link.revoked_at IS NULL AND public.bw_quote_link_doc_pdf(p_link) IS NOT NULL THEN
    CASE WHEN p_link.status = 'accepted'
         THEN md5(concat_ws('|', 'accepted', p_link.token, p_link.accepted_pdf_url))
         ELSE md5(concat_ws('|', 'doc', p_link.token, p_link.version, p_link.pdf_url)) END END;
$$;
CREATE OR REPLACE FUNCTION public.bw_quote_link_balance_id(p_link public.quote_links)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN p_link.revoked_at IS NULL AND public.bw_quote_link_balance_doc(p_link) IS NOT NULL THEN
    md5(concat_ws('|', 'balance', p_link.token, public.bw_quote_link_balance_doc(p_link)::text)) END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_link_doc_pdf(public.quote_links) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_quote_link_balance_doc(public.quote_links) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_quote_link_doc_id(public.quote_links) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bw_quote_link_balance_id(public.quote_links) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_quote_pdf_new_key()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex');
$$;
REVOKE ALL ON FUNCTION public.bw_quote_pdf_new_key() FROM PUBLIC, anon, authenticated;

-- A new key whenever the document changes; none while there is no document
-- or the link is turned off. Nobody sets a key by hand. (Definer: the
-- helpers it calls are not granted to app roles, and admins update links.)
CREATE OR REPLACE FUNCTION public.bw_trg_quote_link_pdf_keys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_doc text := public.bw_quote_link_doc_id(NEW);
  v_bal text := public.bw_quote_link_balance_id(NEW);
BEGIN
  IF v_doc IS NULL THEN
    NEW.pdf_key := NULL;
  ELSIF TG_OP = 'UPDATE' AND OLD.pdf_key IS NOT NULL AND OLD.pdf_key_doc = v_doc THEN
    NEW.pdf_key := OLD.pdf_key;
  ELSE
    NEW.pdf_key := public.bw_quote_pdf_new_key();
  END IF;
  NEW.pdf_key_doc := v_doc;

  IF v_bal IS NULL THEN
    NEW.balance_pdf_key := NULL;
  ELSIF TG_OP = 'UPDATE' AND OLD.balance_pdf_key IS NOT NULL AND OLD.balance_pdf_key_doc = v_bal THEN
    NEW.balance_pdf_key := OLD.balance_pdf_key;
  ELSE
    NEW.balance_pdf_key := public.bw_quote_pdf_new_key();
  END IF;
  NEW.balance_pdf_key_doc := v_bal;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_quote_link_pdf_keys() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bw_quote_link_pdf_keys ON public.quote_links;
CREATE TRIGGER bw_quote_link_pdf_keys
  BEFORE INSERT OR UPDATE ON public.quote_links
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_quote_link_pdf_keys();

-- Links that already show a document get their keys (the trigger makes them).
UPDATE public.quote_links l
   SET pdf_key = l.pdf_key
 WHERE l.pdf_key_doc IS DISTINCT FROM public.bw_quote_link_doc_id(l)
    OR l.balance_pdf_key_doc IS DISTINCT FROM public.bw_quote_link_balance_id(l);

-- The storage path of one of the band's quote PDFs, decoded and checked:
-- quotes/<band>/<file>, the file name one segment with no "%", "/", "\",
-- ".." or control character after decoding. NULL for anything else.
CREATE OR REPLACE FUNCTION public.bw_quote_pdf_storage_path(p_url text, p_band_id uuid)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_m text[];
  v_file text;
BEGIN
  IF p_url IS NULL OR p_band_id IS NULL THEN RETURN NULL; END IF;
  v_m := regexp_match(p_url,
    '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/quotes/quotes/' || p_band_id::text || '/([A-Za-z0-9._~%-]+)$');
  IF v_m IS NULL THEN RETURN NULL; END IF;
  -- Every "%" starts a %XX escape.
  IF regexp_replace(v_m[1], '%[0-9A-Fa-f]{2}', '', 'g') ~ '%' THEN RETURN NULL; END IF;
  BEGIN
    SELECT convert_from(string_agg(CASE WHEN r.m[1] IS NOT NULL THEN decode(r.m[1], 'hex')
                                        ELSE convert_to(r.m[2], 'UTF8') END, ''::bytea ORDER BY r.n), 'UTF8')
      INTO v_file
      FROM regexp_matches(v_m[1], '%([0-9A-Fa-f]{2})|([^%])', 'g') WITH ORDINALITY AS r(m, n);
  EXCEPTION WHEN others THEN
    RETURN NULL; -- not UTF-8, or a NUL byte
  END;
  IF v_file IS NULL OR v_file = '' OR v_file ~ '[%/\\]' OR position('..' IN v_file) > 0
     OR v_file ~ '[\x01-\x1f\x7f]' THEN
    RETURN NULL;
  END IF;
  RETURN 'quotes/' || p_band_id::text || '/' || v_file;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_pdf_storage_path(text, uuid) FROM PUBLIC, anon, authenticated;

-- Is the balance shown? Accepted, a balance sent, the gig not cancelled.
CREATE OR REPLACE FUNCTION public.bw_quote_link_balance_shown(p_link public.quote_links)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p_link.status = 'accepted'
     AND public.bw_quote_link_balance_doc(p_link) IS NOT NULL
     AND coalesce((SELECT lower(e.status::text) FROM public.events e
                    WHERE e.id = public.bw_quote_gig_id(p_link.quote_id)), '') <> 'cancelled';
$$;
REVOKE ALL ON FUNCTION public.bw_quote_link_balance_shown(public.quote_links) FROM PUBLIC, anon, authenticated;

-- The file a PDF key opens right now (server only: quote-pdf).
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
BEGIN
  IF p_key IS NULL OR p_key !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;

  IF coalesce(p_kind, 'doc') = 'balance' THEN
    SELECT * INTO v_link FROM public.quote_links l WHERE l.balance_pdf_key = p_key;
    -- The key's document must still be the one shown (it is, unless a
    -- column came in without the trigger: 185's balance_sent).
    IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL OR v_link.snapshot IS NULL
       OR v_link.balance_pdf_key_doc IS DISTINCT FROM public.bw_quote_link_balance_id(v_link)
       OR NOT public.bw_quote_link_balance_shown(v_link) THEN
      RETURN NULL;
    END IF;
    v_url := public.bw_quote_link_balance_doc(v_link) ->> 'pdfUrl';
  ELSE
    SELECT * INTO v_link FROM public.quote_links l WHERE l.pdf_key = p_key;
    IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL OR v_link.snapshot IS NULL
       OR v_link.pdf_key_doc IS DISTINCT FROM public.bw_quote_link_doc_id(v_link) THEN
      RETURN NULL;
    END IF;
    v_url := public.bw_quote_link_doc_pdf(v_link);
  END IF;

  RETURN public.bw_quote_pdf_storage_path(v_url, v_link.band_id);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_link_pdf_path(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_pdf_path(text, text) TO service_role;

-- The client page's PDF keys (anon, by token, like bw_quote_link_view).
-- New anon function: explicit grant.
CREATE OR REPLACE FUNCTION public.bw_quote_link_pdf_keys(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_link public.quote_links;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO v_link FROM public.quote_links l WHERE l.token = p_token;
  IF v_link.id IS NULL OR v_link.revoked_at IS NOT NULL OR v_link.snapshot IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'doc', CASE WHEN v_link.pdf_key_doc = public.bw_quote_link_doc_id(v_link) THEN v_link.pdf_key END,
    'balance', CASE WHEN public.bw_quote_link_balance_shown(v_link)
                     AND v_link.balance_pdf_key_doc = public.bw_quote_link_balance_id(v_link) THEN v_link.balance_pdf_key END);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_quote_link_pdf_keys(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_quote_link_pdf_keys(text) TO anon, authenticated;

COMMIT;
