-- Checks for 173_app_flags.sql. Runs in a transaction and rolls back.
BEGIN;

DO $$
DECLARE n int;
BEGIN
  -- Shape and seed
  SELECT count(*) INTO n FROM public.app_flags
   WHERE key IN ('live_pack','voice_parts','follow_tempo','count_in','ble_live') AND enabled;
  IF n <> 5 THEN RAISE EXCEPTION 'expected 5 seeded flags on, got %', n; END IF;

  -- anon: nothing
  IF has_table_privilege('anon', 'public.app_flags', 'SELECT') THEN RAISE EXCEPTION 'anon can select'; END IF;
  IF has_column_privilege('anon', 'public.app_flags', 'enabled', 'SELECT') THEN RAISE EXCEPTION 'anon can read enabled'; END IF;

  -- authenticated: reads the four columns, not the note, writes nothing
  IF NOT has_column_privilege('authenticated', 'public.app_flags', 'enabled', 'SELECT') THEN RAISE EXCEPTION 'authenticated cannot read enabled'; END IF;
  IF NOT has_column_privilege('authenticated', 'public.app_flags', 'min_app_version', 'SELECT') THEN RAISE EXCEPTION 'authenticated cannot read min_app_version'; END IF;
  IF has_column_privilege('authenticated', 'public.app_flags', 'note', 'SELECT') THEN RAISE EXCEPTION 'authenticated can read note'; END IF;
  IF has_table_privilege('authenticated', 'public.app_flags', 'INSERT')
     OR has_table_privilege('authenticated', 'public.app_flags', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.app_flags', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated can write';
  END IF;

  -- RLS on
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.app_flags'::regclass) THEN RAISE EXCEPTION 'RLS off'; END IF;
END;
$$;

-- As a signed-in user: the select the app sends works.
SET LOCAL ROLE authenticated;
SELECT key, enabled, min_app_version FROM public.app_flags;
RESET ROLE;

-- The admin line from docs/flags.md works.
UPDATE public.app_flags SET enabled = false, note = 'test', updated_at = now() WHERE key = 'voice_parts';
DO $$ BEGIN
  IF (SELECT enabled FROM public.app_flags WHERE key = 'voice_parts') THEN RAISE EXCEPTION 'turn-off line failed'; END IF;
END $$;

ROLLBACK;
