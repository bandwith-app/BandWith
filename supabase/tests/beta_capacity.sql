-- Checks for 128_beta_capacity.sql. Everything runs in one transaction and
-- is rolled back: no account, invitation or waitlist row is kept.
--
-- After 128 is applied:
--   npx -y supabase db query --remote=<project-ref> -f supabase/tests/beta_capacity.sql
-- Before applying it (dry run of the migration itself), put the migration
-- right after BEGIN:
--   { echo 'BEGIN;'; cat supabase/migrations/128_beta_capacity.sql; sed '1,/^BEGIN;$/d' supabase/tests/beta_capacity.sql; } > /tmp/t.sql
--
-- Test emails use the reserved .invalid domain, so nothing can be sent.

BEGIN;

DO $test$
DECLARE
  base integer;
  s jsonb;
  w jsonb;
  band uuid;
  got_in boolean;
BEGIN
  SELECT id INTO band FROM public.bands ORDER BY created_at LIMIT 1;
  IF band IS NULL THEN RAISE EXCEPTION 'test needs one band'; END IF;

  -- 1 public spot, 2 kept for invites.
  base := public.bw_beta_taken();
  UPDATE public.beta_capacity SET total = base + 3, reserved = 2;
  s := public.bw_capacity_status();
  IF s->>'state' <> 'open' OR (s->>'public_left')::int <> 1 OR (s->>'invite_left')::int <> 3 THEN
    RAISE EXCEPTION 'start: %', s;
  END IF;

  -- A takes the last public spot.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bw-test-a@example.invalid', '', now(), now(), now(), '{}', '{}');
  s := public.bw_capacity_status();
  IF s->>'state' <> 'invites' OR (s->>'public_left')::int <> 0 OR (s->>'invite_left')::int <> 2 THEN
    RAISE EXCEPTION 'after A: %', s;
  END IF;

  -- B, not invited: refused.
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bw-test-b@example.invalid', '', now(), now(), now(), '{}', '{}');
    got_in := true;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bw_beta_full' THEN RAISE; END IF;
    got_in := false;
  END;
  IF got_in THEN RAISE EXCEPTION 'B got in without an invite'; END IF;

  -- D, invite expired: refused.
  INSERT INTO public.band_invitations (band_id, email, role, status, expires_at)
  VALUES (band, 'bw-test-d@example.invalid', 'member', 'pending', now() - interval '1 day');
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bw-test-d@example.invalid', '', now(), now(), now(), '{}', '{}');
    got_in := true;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bw_beta_full' THEN RAISE; END IF;
    got_in := false;
  END;
  IF got_in THEN RAISE EXCEPTION 'D got in with an expired invite'; END IF;

  -- C, invited by a band (email in another case): gets in from the reserve.
  INSERT INTO public.band_invitations (band_id, email, role, status, expires_at)
  VALUES (band, 'bw-test-c@example.invalid', 'member', 'pending', now() + interval '7 days');
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'BW-Test-C@example.invalid', '', now(), now(), now(), '{}', '{}');

  -- E, a deputy saved with this email: gets in, and that fills the beta.
  INSERT INTO public.band_deputies (band_id, name, email) VALUES (band, 'Test deputy', 'bw-test-e@example.invalid');
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bw-test-e@example.invalid', '', now(), now(), now(), '{}', '{}');
  s := public.bw_capacity_status();
  IF s->>'state' <> 'full' OR (s->>'invite_left')::int <> 0 OR (s->>'taken')::int <> base + 3 THEN
    RAISE EXCEPTION 'after E: %', s;
  END IF;

  -- F, invited, but every spot is taken: refused.
  INSERT INTO public.band_invitations (band_id, email, role, status, expires_at)
  VALUES (band, 'bw-test-f@example.invalid', 'member', 'pending', now() + interval '7 days');
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bw-test-f@example.invalid', '', now(), now(), now(), '{}', '{}');
    got_in := true;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bw_beta_full' THEN RAISE; END IF;
    got_in := false;
  END;
  IF got_in THEN RAISE EXCEPTION 'F got in past the total'; END IF;

  -- Exempt accounts and stale unconfirmed sign-ups don't count.
  INSERT INTO public.beta_capacity_exempt (user_id)
  SELECT id FROM auth.users WHERE email = 'bw-test-a@example.invalid';
  UPDATE auth.users SET email_confirmed_at = NULL, created_at = now() - interval '3 days'
  WHERE email = 'bw-test-e@example.invalid';
  IF public.bw_beta_taken() <> base + 1 THEN
    RAISE EXCEPTION 'exempt/unconfirmed still counted: % vs %', public.bw_beta_taken(), base + 1;
  END IF;

  -- Waitlist: lowercased, one row per email, same place when sent twice.
  w := public.bw_join_waitlist('  Wait.Test@Example.invalid ', 'ios', 'it-IT', 'site');
  IF NOT (w->>'ok')::boolean OR (w->>'already')::boolean THEN RAISE EXCEPTION 'waitlist 1: %', w; END IF;
  s := public.bw_join_waitlist('wait.test@example.invalid', 'android');
  IF NOT (s->>'already')::boolean OR s->'position' <> w->'position' THEN RAISE EXCEPTION 'waitlist 2: % vs %', s, w; END IF;
  IF (SELECT platform FROM public.beta_waitlist WHERE email = 'wait.test@example.invalid') <> 'ios' THEN
    RAISE EXCEPTION 'waitlist row changed on the second send';
  END IF;
  s := public.bw_join_waitlist('not-an-email', 'web');
  IF (s->>'ok')::boolean OR s->>'error' <> 'invalid_email' THEN RAISE EXCEPTION 'waitlist bad email: %', s; END IF;
  s := public.bw_join_waitlist('x@example.invalid', 'blackberry', repeat('x', 99), '');
  IF (SELECT platform || '|' || char_length(locale) || '|' || source FROM public.beta_waitlist WHERE email = 'x@example.invalid') <> '|35|site' THEN
    RAISE EXCEPTION 'waitlist did not clean its inputs';
  END IF;

  -- What the public API may call and read.
  IF NOT has_function_privilege('anon', 'public.bw_capacity_status()', 'execute') THEN RAISE EXCEPTION 'anon cannot read the counter'; END IF;
  IF NOT has_function_privilege('anon', 'public.bw_join_waitlist(text,text,text,text)', 'execute') THEN RAISE EXCEPTION 'anon cannot join the waitlist'; END IF;
  IF has_function_privilege('anon', 'public.bw_beta_taken()', 'execute') THEN RAISE EXCEPTION 'anon can call bw_beta_taken'; END IF;
  IF has_function_privilege('anon', 'public.bw_beta_is_invited(text)', 'execute') THEN RAISE EXCEPTION 'anon can probe invites'; END IF;
  IF has_function_privilege('authenticated', 'public.bw_beta_is_invited(text)', 'execute') THEN RAISE EXCEPTION 'users can probe invites'; END IF;
  IF has_table_privilege('anon', 'public.beta_waitlist', 'select') OR has_table_privilege('anon', 'public.beta_waitlist', 'insert') THEN RAISE EXCEPTION 'anon can touch beta_waitlist'; END IF;
  IF has_table_privilege('authenticated', 'public.beta_capacity', 'update') THEN RAISE EXCEPTION 'users can change the capacity'; END IF;

  -- No settings row: no limit.
  DELETE FROM public.beta_capacity;
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bw-test-g@example.invalid', '', now(), now(), now(), '{}', '{}');
  IF public.bw_capacity_status()->>'state' <> 'open' THEN RAISE EXCEPTION 'no row should mean open'; END IF;
END
$test$;

SELECT 'beta_capacity: all checks passed' AS result;

ROLLBACK;
