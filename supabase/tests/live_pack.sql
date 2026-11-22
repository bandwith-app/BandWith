-- Checks for 170_live_pack.sql on the real database. One transaction, rolled
-- back: no row, notification or queued refresh is kept.
--
-- After 170 is applied:
--   npx -y supabase db query --remote -f supabase/tests/live_pack.sql
-- Before (dry run of the migration itself), strip its own BEGIN;/COMMIT; and
-- put it right after BEGIN, then check afterwards that nothing leaked
-- (to_regclass('public.live_pack_status') IS NULL):
--   { echo 'BEGIN;'; grep -v '^BEGIN;$\|^COMMIT;$' supabase/migrations/170_live_pack.sql; sed '1,/^BEGIN;$/d' supabase/tests/live_pack.sql; } > /tmp/t.sql
-- The logic (invites, languages, silent refresh, Remind) is also checked
-- locally with supabase/tests/live_pack.pglite.mjs.

BEGIN;

DO $test$
DECLARE
  admin uuid;
  member uuid;
  band uuid;
  ev uuid;
  n int;
  ok boolean;
BEGIN
  -- Shape.
  IF to_regclass('public.live_pack_status') IS NULL THEN RAISE EXCEPTION 'live_pack_status missing'; END IF;
  IF NOT has_column_privilege('authenticated', 'public.profiles', 'live_pack_auto', 'SELECT,UPDATE') THEN
    RAISE EXCEPTION 'profiles.live_pack_auto not granted';
  END IF;
  IF has_table_privilege('anon', 'public.live_pack_status', 'SELECT') THEN RAISE EXCEPTION 'anon reads live_pack_status'; END IF;
  IF has_table_privilege('authenticated', 'public.live_pack_refresh_queue', 'SELECT') THEN RAISE EXCEPTION 'queue readable by the app'; END IF;
  SELECT count(*) INTO n FROM cron.job WHERE jobname IN ('bw-live-pack-invites', 'bw-live-pack-refresh');
  IF n <> 2 THEN RAISE EXCEPTION 'cron jobs: %', n; END IF;
  IF public.bw_live_pack_text('title.gig', 'it', '{"day":"sabato"}') <> 'La scaletta di sabato, pronta anche senza segnale' THEN
    RAISE EXCEPTION 'text: %', public.bw_live_pack_text('title.gig', 'it', '{"day":"sabato"}');
  END IF;

  -- A band with an admin and another active member, and one of its events.
  SELECT a.user_id, m.user_id, a.band_id INTO admin, member, band
    FROM public.band_members a
    JOIN public.band_members m ON m.band_id = a.band_id AND m.user_id <> a.user_id AND coalesce(m.is_active, true)
   WHERE a.role = 'admin' AND coalesce(a.is_active, true)
   LIMIT 1;
  SELECT id INTO ev FROM public.events WHERE band_id = band ORDER BY created_at DESC LIMIT 1;
  IF ev IS NULL THEN RAISE EXCEPTION 'test needs a band with two members and an event'; END IF;
  -- Make the member take part (the test is rolled back).
  DELETE FROM public.event_members WHERE event_id = ev AND user_id = member;
  INSERT INTO public.event_members (event_id, user_id, status) VALUES (ev, member, 'confirmed');

  -- The member writes their row; the admin reads it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.live_pack_status (event_id, device_id, version) VALUES (ev, 'test-device', 'v1');
  SELECT count(*) INTO n FROM public.live_pack_status WHERE event_id = ev;
  IF n <> 1 THEN RAISE EXCEPTION 'member sees own row: %', n; END IF;
  BEGIN
    INSERT INTO public.live_pack_status (event_id, user_id, device_id, version) VALUES (ev, admin, 'x', 'v1');
    RAISE EXCEPTION 'member wrote a row for someone else';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  UPDATE public.profiles SET live_pack_auto = true, live_pack_asked_at = now() WHERE id = member;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.live_pack_status WHERE event_id = ev AND user_id = member;
  IF n <> 1 THEN RAISE EXCEPTION 'admin reads the member row: %', n; END IF;
  -- Remind: refused for someone who already has the pack.
  SELECT public.bw_live_pack_remind(ev, member) INTO ok;
  IF ok THEN RAISE EXCEPTION 'reminded a member who has the pack'; END IF;
  RESET ROLE;

  -- Declining takes the right away.
  UPDATE public.event_members SET status = 'declined' WHERE event_id = ev AND user_id = member;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.live_pack_status (event_id, device_id, version) VALUES (ev, 'test-device-2', 'v1');
    RAISE EXCEPTION 'declined member wrote a row';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  RESET ROLE;

  -- The sweep and the flush run (nothing is sent: rolled back).
  PERFORM public.bw_live_pack_invite_sweep();
  PERFORM public.bw_live_pack_refresh_flush();
  RAISE NOTICE 'live_pack checks passed';
END;
$test$;

ROLLBACK;
