-- Checks for 166_band_invitations_admin.sql. Everything runs in one
-- transaction and is rolled back: no account, band or invite is kept, and
-- nothing is sent.
--
-- After 166 is applied:
--   npx -y supabase db query --remote -f supabase/tests/band_invitations_admin.sql
-- Before applying it (dry run of the migration itself), drop the
-- migration's own BEGIN;/COMMIT; and put it right after BEGIN:
--   { echo 'BEGIN;'; grep -v '^BEGIN;$\|^COMMIT;$' supabase/migrations/166_band_invitations_admin.sql; sed '1,/^BEGIN;$/d' supabase/tests/band_invitations_admin.sql; } > /tmp/t.sql
-- then check afterwards that bw_band_invitations does NOT exist.
--
-- Test emails use the reserved .invalid domain.

BEGIN;

DO $test$
DECLARE
  adm uuid := gen_random_uuid();
  mem uuid := gen_random_uuid();
  known uuid := gen_random_uuid();
  band uuid;
  inv_wait uuid; inv_old uuid; inv_declined uuid; inv_known uuid;
  emails text[];
  n int;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (adm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bw-inv-admin@example.invalid', '', now(), now(), now(), '{}', '{}'),
    (mem, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bw-inv-member@example.invalid', '', now(), now(), now(), '{}', '{}'),
    (known, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bw-inv-known@example.invalid', '', now(), now(), now(), '{}', '{}');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  INSERT INTO public.bands (name, created_by) VALUES ('Invites test band', adm) RETURNING id INTO band;
  IF NOT EXISTS (SELECT 1 FROM public.band_members WHERE band_id = band AND user_id = adm) THEN
    INSERT INTO public.band_members (band_id, user_id, role) VALUES (band, adm, 'admin');
  END IF;
  UPDATE public.band_members SET role = 'admin' WHERE band_id = band AND user_id = adm;
  INSERT INTO public.band_members (band_id, user_id, role) VALUES (band, mem, 'member');

  INSERT INTO public.band_invitations (band_id, email, role, status, invited_by, expires_at)
    VALUES (band, 'new-person@example.invalid', 'admin', 'pending', adm, now() + interval '5 days') RETURNING id INTO inv_wait;
  INSERT INTO public.band_invitations (band_id, email, role, status, invited_by, expires_at)
    VALUES (band, 'late@example.invalid', 'member', 'pending', adm, now() - interval '1 day') RETURNING id INTO inv_old;
  INSERT INTO public.band_invitations (band_id, email, role, status, invited_by, expires_at)
    VALUES (band, 'no-thanks@example.invalid', 'member', 'declined', adm, now() + interval '5 days') RETURNING id INTO inv_declined;
  INSERT INTO public.band_invitations (band_id, email, role, status, invited_by, expires_at)
    VALUES (band, 'bw-inv-known@example.invalid', 'member', 'pending', adm, now() + interval '5 days') RETURNING id INTO inv_known;
  -- Joined: not an invite any more.
  INSERT INTO public.band_invitations (band_id, email, role, status, invited_by, accepted_at, accepted_by)
    VALUES (band, 'bw-inv-member@example.invalid', 'member', 'accepted', adm, now(), mem);
  -- Still pending on paper, but the person is already in the band.
  INSERT INTO public.band_invitations (band_id, email, role, status, invited_by, expires_at)
    VALUES (band, 'BW-INV-MEMBER@example.invalid', 'member', 'pending', adm, now() + interval '5 days');
  INSERT INTO public.notifications (user_id, band_id, type, title, body)
    VALUES (known, band, 'invite_received', 'Invitation to join Invites test band', 'Open BandWith');

  SET LOCAL ROLE authenticated;

  -- 1) The admin sees waiting, expired and declined invites; not members.
  SELECT array_agg(i.email || ':' || i.status ORDER BY i.email) INTO emails FROM public.bw_band_invitations(band) i;
  IF emails IS DISTINCT FROM ARRAY[
    'bw-inv-known@example.invalid:pending',
    'late@example.invalid:expired',
    'new-person@example.invalid:pending',
    'no-thanks@example.invalid:declined'
  ] THEN
    RAISE EXCEPTION 'admin list wrong: %', emails;
  END IF;
  IF NOT (SELECT i.has_account FROM public.bw_band_invitations(band) i WHERE i.id = inv_known) THEN
    RAISE EXCEPTION 'has_account should be true for an existing account';
  END IF;
  IF (SELECT i.has_account FROM public.bw_band_invitations(band) i WHERE i.id = inv_wait) THEN
    RAISE EXCEPTION 'has_account should be false for a new person';
  END IF;
  IF (SELECT i.role FROM public.bw_band_invitations(band) i WHERE i.id = inv_wait) <> 'admin' THEN
    RAISE EXCEPTION 'role should come through';
  END IF;

  -- 2) A member can't list or cancel.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', mem, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM * FROM public.bw_band_invitations(band);
    RAISE EXCEPTION 'member listed invites';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.bw_cancel_invitation(inv_wait);
    RAISE EXCEPTION 'member cancelled an invite';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- 3) Signed out: refused.
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM * FROM public.bw_band_invitations(band);
    RAISE EXCEPTION 'signed-out call listed invites';
  EXCEPTION WHEN invalid_authorization_specification THEN NULL;
  END;

  -- 4) The admin cancels: the invite and the invitee's notice are gone.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  PERFORM public.bw_cancel_invitation(inv_known);
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.band_invitations WHERE id = inv_known) THEN
    RAISE EXCEPTION 'cancelled invite still there';
  END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = known AND type = 'invite_received';
  IF n <> 0 THEN
    RAISE EXCEPTION 'invite notice not removed (%)', n;
  END IF;
  SET LOCAL ROLE authenticated;

  -- 5) An accepted invite can't be cancelled.
  BEGIN
    PERFORM public.bw_cancel_invitation((SELECT id FROM public.band_invitations WHERE band_id = band AND status = 'accepted'));
    RAISE EXCEPTION 'cancelled an accepted invite';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  RESET ROLE;

  -- 6) Grants: authenticated only.
  IF has_function_privilege('anon', 'public.bw_band_invitations(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.bw_cancel_invitation(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can call the invite functions';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.bw_band_invitations(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot list invites';
  END IF;

  RAISE NOTICE 'band_invitations_admin: all checks passed';
END;
$test$;

ROLLBACK;
