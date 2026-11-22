-- ============================================================================
-- 177 · Quote PDFs behind the quote link (step 2 of 2): private bucket
-- ----------------------------------------------------------------------------
-- Apply only after 176 and after quote-pdf, send-email and the web app are
-- deployed (see 176). Band admins keep reading and writing their band's
-- files (bw_quotes_admin_* policies, 042); everyone else goes through
-- /functions/v1/quote-pdf, which checks the quote link first.
--
-- No file is moved or deleted. To undo:
--   UPDATE storage.buckets SET public = true WHERE id = 'quotes';
-- ============================================================================

BEGIN;
UPDATE storage.buckets SET public = false WHERE id = 'quotes';
COMMIT;
