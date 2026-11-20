-- Checks for 167_rehearsal_note_line.sql. One transaction, rolled back: no
-- note is kept.
--
-- After 167 is applied:
--   npx -y supabase db query --remote -f supabase/tests/rehearsal_note_line.sql
-- Before (dry run of the migration itself), strip its own BEGIN;/COMMIT; and
-- put it right after BEGIN:
--   { echo 'BEGIN;'; grep -v '^BEGIN;$\|^COMMIT;$' supabase/migrations/167_rehearsal_note_line.sql; sed '1,/^BEGIN;$/d' supabase/tests/rehearsal_note_line.sql; } > /tmp/t.sql

BEGIN;

DO $test$
DECLARE
  admin uuid;
  band uuid;
  ev uuid;
  nid uuid := gen_random_uuid();
  got text;
BEGIN
  SELECT bm.user_id, bm.band_id INTO admin, band
    FROM public.band_members bm WHERE bm.role = 'admin' ORDER BY bm.joined_at LIMIT 1;
  SELECT id INTO ev FROM public.events WHERE band_id = band ORDER BY created_at LIMIT 1;
  IF admin IS NULL OR ev IS NULL THEN RAISE EXCEPTION 'test needs a band admin with an event'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- The app writes and reads the line.
  INSERT INTO public.rehearsal_notes (id, band_id, event_id, occurrence_date, song_title, preset, section, line, scope, status)
  VALUES (nid, band, ev, current_date, 'Test song', 'tempo', 'Chorus', 'Lanterns in the rain', 'band', 'open');
  SELECT line INTO got FROM public.rehearsal_notes WHERE id = nid;
  IF got IS DISTINCT FROM 'Lanterns in the rain' THEN RAISE EXCEPTION 'read line: %', got; END IF;

  UPDATE public.rehearsal_notes SET line = NULL WHERE id = nid;
  SELECT line INTO got FROM public.rehearsal_notes WHERE id = nid;
  IF got IS NOT NULL THEN RAISE EXCEPTION 'clear line: %', got; END IF;

  -- Too long is refused.
  BEGIN
    UPDATE public.rehearsal_notes SET line = repeat('x', 201) WHERE id = nid;
    RAISE EXCEPTION 'a 201-character line was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RESET ROLE;
END
$test$;

-- anon still reads nothing.
SELECT CASE WHEN has_column_privilege('anon', 'public.rehearsal_notes', 'line', 'SELECT')
  THEN 'FAIL: anon reads line' ELSE 'ok' END AS rehearsal_note_line;

ROLLBACK;
