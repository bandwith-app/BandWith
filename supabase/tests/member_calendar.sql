-- Checks for 165_member_calendar.sql. Everything runs in one transaction and
-- is rolled back: no account, band or event is kept, and nothing is sent.
--
-- After 165 is applied:
--   npx -y supabase db query --remote -f supabase/tests/member_calendar.sql
-- Before applying it (dry run of the migration itself), drop the
-- migration's own BEGIN;/COMMIT; and put it right after BEGIN:
--   { echo 'BEGIN;'; grep -v '^BEGIN;$\|^COMMIT;$' supabase/migrations/165_member_calendar.sql; sed '1,/^BEGIN;$/d' supabase/tests/member_calendar.sql; } > /tmp/t.sql
-- then check afterwards that calendar_feeds does NOT exist.
--
-- Test emails use the reserved .invalid domain.

BEGIN;

DO $test$
DECLARE
  adm uuid := gen_random_uuid();
  mem uuid := gen_random_uuid();
  band uuid;
  e_on uuid; e_off uuid; e_declined uuid; e_quote uuid; e_cancelled uuid;
  e_personal uuid; e_rehearsal uuid; e_old uuid;
  tok_m text; tok_a text; tok_m2 text;
  feed jsonb;
  ids jsonb;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (adm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bw-cal-admin@example.invalid', '', now(), now(), now(), '{}', '{}'),
    (mem, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bw-cal-member@example.invalid', '', now(), now(), now(), '{}', '{}');

  -- The band, created by the admin (on_band_created may add them already).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  INSERT INTO public.bands (name, created_by) VALUES ('Calendar test band', adm) RETURNING id INTO band;
  INSERT INTO public.band_members (band_id, user_id, role) VALUES (band, adm, 'admin')
    ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.band_members WHERE band_id = band AND user_id = adm) THEN
    INSERT INTO public.band_members (band_id, user_id, role) VALUES (band, adm, 'admin');
  END IF;
  UPDATE public.band_members SET role = 'admin' WHERE band_id = band AND user_id = adm;
  INSERT INTO public.band_members (band_id, user_id, role) VALUES (band, mem, 'member');

  INSERT INTO public.events (band_id, title, event_type, status, event_date, start_time, fee, client_name, created_by)
    VALUES (band, 'On it', 'gig', 'confirmed', current_date + 10, '21:00', 900, 'Secret client', adm) RETURNING id INTO e_on;
  INSERT INTO public.events (band_id, title, event_type, status, event_date, created_by)
    VALUES (band, 'Not on it', 'gig', 'confirmed', current_date + 11, adm) RETURNING id INTO e_off;
  INSERT INTO public.events (band_id, title, event_type, status, event_date, created_by)
    VALUES (band, 'Declined', 'gig', 'confirmed', current_date + 12, adm) RETURNING id INTO e_declined;
  INSERT INTO public.events (band_id, title, event_type, status, event_date, created_by)
    VALUES (band, 'A quote', 'wedding', 'tentative', current_date + 13, adm) RETURNING id INTO e_quote;
  INSERT INTO public.events (band_id, title, event_type, status, event_date, created_by)
    VALUES (band, 'Called off', 'gig', 'cancelled', current_date + 14, adm) RETURNING id INTO e_cancelled;
  INSERT INTO public.events (band_id, title, event_type, status, event_date, created_by)
    VALUES (NULL, 'My own gig', 'gig', 'confirmed', current_date + 15, mem) RETURNING id INTO e_personal;
  INSERT INTO public.events (band_id, title, event_type, status, event_date, start_time, end_time, is_recurring, recurrence_rule, created_by)
    VALUES (band, 'Weekly rehearsal', 'rehearsal', 'scheduled', current_date - 200, '19:00', '22:00', true, '{"frequency":"weekly","interval":1}', adm)
    RETURNING id INTO e_rehearsal;
  INSERT INTO public.events (band_id, title, event_type, status, event_date, created_by)
    VALUES (band, 'Long ago', 'gig', 'completed', current_date - 120, adm) RETURNING id INTO e_old;

  INSERT INTO public.event_members (event_id, user_id, status, role, fee) VALUES
    (e_on, mem, 'accepted', 'Bass', 150),
    (e_declined, mem, 'declined', NULL, NULL),
    (e_declined, adm, 'declined', NULL, NULL),
    (e_quote, mem, 'accepted', NULL, NULL),
    (e_cancelled, mem, 'accepted', NULL, NULL),
    (e_rehearsal, mem, 'accepted', NULL, NULL),
    (e_old, mem, 'accepted', NULL, NULL);

  -- Links: one per account, stable until rotated.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mem, 'role', 'authenticated')::text, true);
  tok_m := public.bw_my_calendar_token();
  IF tok_m !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'token shape: %', tok_m; END IF;
  IF public.bw_my_calendar_token() <> tok_m THEN RAISE EXCEPTION 'token not stable'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  tok_a := public.bw_my_calendar_token();
  IF tok_a = tok_m THEN RAISE EXCEPTION 'tokens shared'; END IF;

  -- Member: on it, personal, the recurring rehearsal. Not: off, declined,
  -- quote, cancelled, older than 60 days.
  feed := public.bw_member_calendar_feed(tok_m);
  SELECT coalesce(jsonb_agg(x->>'title' ORDER BY x->>'title'), '[]') INTO ids FROM jsonb_array_elements(feed->'events') x;
  IF ids <> '["My own gig", "On it", "Weekly rehearsal"]'::jsonb THEN RAISE EXCEPTION 'member feed: %', ids; END IF;
  IF (SELECT x->>'role' FROM jsonb_array_elements(feed->'events') x WHERE x->>'title' = 'On it') <> 'Bass' THEN
    RAISE EXCEPTION 'role missing: %', feed;
  END IF;
  IF (SELECT x->'recurrence'->>'frequency' FROM jsonb_array_elements(feed->'events') x WHERE x->>'title' = 'Weekly rehearsal') <> 'weekly' THEN
    RAISE EXCEPTION 'recurrence missing: %', feed;
  END IF;
  IF (SELECT x->>'type' FROM jsonb_array_elements(feed->'events') x WHERE x->>'title' = 'My own gig') <> 'personal' THEN
    RAISE EXCEPTION 'personal type: %', feed;
  END IF;
  -- No money and no client, ever.
  IF feed::text ~* '(fee|pay|price|client|900|150|Secret)' THEN RAISE EXCEPTION 'private data in feed: %', feed; END IF;

  -- Admin: every band event except declined, quote, cancelled, old; never
  -- someone else's personal gig.
  feed := public.bw_member_calendar_feed(tok_a);
  SELECT coalesce(jsonb_agg(x->>'title' ORDER BY x->>'title'), '[]') INTO ids FROM jsonb_array_elements(feed->'events') x;
  IF ids <> '["Not on it", "On it", "Weekly rehearsal"]'::jsonb THEN RAISE EXCEPTION 'admin feed: %', ids; END IF;

  -- A member who leaves the band keeps only their personal gigs.
  UPDATE public.band_members SET is_active = false, left_at = now() WHERE band_id = band AND user_id = mem;
  feed := public.bw_member_calendar_feed(tok_m);
  SELECT coalesce(jsonb_agg(x->>'title' ORDER BY x->>'title'), '[]') INTO ids FROM jsonb_array_elements(feed->'events') x;
  IF ids <> '["My own gig"]'::jsonb THEN RAISE EXCEPTION 'after leaving: %', ids; END IF;

  -- Rotating replaces the link: the old one shows nothing.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mem, 'role', 'authenticated')::text, true);
  tok_m2 := public.bw_my_calendar_token(true);
  IF tok_m2 = tok_m THEN RAISE EXCEPTION 'rotate kept the token'; END IF;
  IF public.bw_member_calendar_feed(tok_m) IS NOT NULL THEN RAISE EXCEPTION 'old token still works'; END IF;
  IF public.bw_member_calendar_feed(tok_m2) IS NULL THEN RAISE EXCEPTION 'new token does not work'; END IF;

  -- Bad tokens.
  IF public.bw_member_calendar_feed('nope') IS NOT NULL THEN RAISE EXCEPTION 'bad token accepted'; END IF;
  IF public.bw_member_calendar_feed(repeat('0', 64)) IS NOT NULL THEN RAISE EXCEPTION 'unknown token accepted'; END IF;

  -- Signed out: no link.
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.bw_my_calendar_token();
    RAISE EXCEPTION 'signed-out call worked';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'member_calendar: all checks passed';
END;
$test$;

-- The table is closed to the app's roles.
DO $grants$
BEGIN
  IF has_table_privilege('anon', 'public.calendar_feeds', 'SELECT')
     OR has_table_privilege('authenticated', 'public.calendar_feeds', 'SELECT') THEN
    RAISE EXCEPTION 'calendar_feeds readable by app roles';
  END IF;
  IF has_function_privilege('anon', 'public.bw_my_calendar_token(boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon may create links';
  END IF;
END;
$grants$;

SELECT 'member_calendar: all checks passed' AS result;

ROLLBACK;
