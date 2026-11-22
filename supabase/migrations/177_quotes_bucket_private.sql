-- ============================================================================
-- 177 · Quote PDFs behind the quote link (step 2 of 2): private bucket
-- ----------------------------------------------------------------------------
-- DO NOT APPLY IN THIS RELEASE.
-- Released iOS / Android builds put the public storage URL of the PDF in
-- WhatsApp, email and "Copy text & link", and quote links already sent to
-- clients carry it: a private bucket would break all of them. Apply only
-- when BOTH hold:
--   * min_app_version is raised past every build that shares public URLs;
--   * this read-only check returns no rows: no quote link that is still live was
--     last shared (sent or republished) before that moment, i.e. while a
--     build that pastes the public storage URL could have shared it.
--     (Stored pdf_url values keep the public URL format: they are only
--     locators for the gate, so they can't be the test.)
--       -- :t = when min_app_version went past those builds
--       SELECT ql.status, count(*) AS live_links_shared_before_t
--         FROM public.quote_links ql
--        WHERE ql.revoked_at IS NULL
--          AND ql.status IN ('sent', 'viewed', 'discussing', 'accepted')
--          AND greatest(ql.sent_at, ql.version_at, ql.last_emailed_at, ql.created_at) < :t
--        GROUP BY ql.status;
--
-- Apply only after 176 and after quote-pdf, send-email and the web app are
-- deployed (see 176). Band admins keep reading and writing their band's
-- files (bw_quotes_admin_* policies, 042); everyone else goes through
-- /functions/v1/quote-pdf, which checks the quote link first.
--
-- No file is moved or deleted. Fix forward: never roll the web back past
-- 177 once it is applied.
-- ============================================================================

BEGIN;
UPDATE storage.buckets SET public = false WHERE id = 'quotes';
COMMIT;
