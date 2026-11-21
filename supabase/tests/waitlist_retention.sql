-- Checks for 169_waitlist_retention.sql. Everything runs in one transaction
-- and is rolled back: no account or waitlist row is kept.
--
-- After 169 is applied:
--   run this file against the project (SQL editor or `supabase db query`).
-- Dry run before applying: put 169 WITHOUT its own BEGIN;/COMMIT; right
-- after the BEGIN below (see the dry-run rule: an inner COMMIT would apply
-- the migration for real).
--
-- Test emails use the reserved .invalid domain, so nothing can be sent.

BEGIN;

DO $test$
DECLARE
  n integer;
BEGIN
  INSERT INTO public.beta_waitlist (email, created_at) VALUES
    ('bw-wl-old@example.invalid',    now() - interval '12 months' - interval '1 day'),
    ('bw-wl-recent@example.invalid', now() - interval '11 months'),
    ('bw-wl-joined@example.invalid', now() - interval '2 days');

  -- This one created an account in the meantime (email in another case).
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'BW-WL-Joined@example.invalid', '', now(), now(), now(), '{}', '{}');

  n := public.bw_prune_waitlist();
  IF n < 2 THEN RAISE EXCEPTION 'pruned % rows, expected at least 2', n; END IF;

  IF EXISTS (SELECT 1 FROM public.beta_waitlist WHERE email = 'bw-wl-old@example.invalid') THEN
    RAISE EXCEPTION 'row older than 12 months was kept';
  END IF;
  IF EXISTS (SELECT 1 FROM public.beta_waitlist WHERE email = 'bw-wl-joined@example.invalid') THEN
    RAISE EXCEPTION 'row of someone who has an account was kept';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.beta_waitlist WHERE email = 'bw-wl-recent@example.invalid') THEN
    RAISE EXCEPTION 'recent row was deleted';
  END IF;

  -- Daily job is scheduled; the API roles cannot call the function.
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bw-prune-waitlist') THEN
    RAISE EXCEPTION 'cron job bw-prune-waitlist missing';
  END IF;
  IF has_function_privilege('anon', 'public.bw_prune_waitlist()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.bw_prune_waitlist()', 'EXECUTE') THEN
    RAISE EXCEPTION 'bw_prune_waitlist must not be callable from the API';
  END IF;

  RAISE NOTICE 'waitlist_retention: OK';
END;
$test$;

ROLLBACK;
