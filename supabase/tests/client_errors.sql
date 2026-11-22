-- Checks for 174_client_errors.sql. Runs in a transaction and rolls back.
BEGIN;

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.client_errors', 'SELECT') OR has_table_privilege('authenticated', 'public.client_errors', 'SELECT')
     OR has_table_privilege('authenticated', 'public.client_errors', 'INSERT') THEN
    RAISE EXCEPTION 'client_errors is reachable directly';
  END IF;
  IF has_function_privilege('anon', 'public.bw_report_client_error(text, text, text, text, text, text)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can report'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.bw_report_client_error(text, text, text, text, text, text)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated cannot report'; END IF;
  IF has_function_privilege('authenticated', 'public.bw_prune_client_errors()', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated can prune'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bw-prune-client-errors' AND schedule = '7 * * * *') THEN RAISE EXCEPTION 'no hourly cron job'; END IF;
  IF has_table_privilege('authenticated', 'public.client_error_counters', 'SELECT') THEN RAISE EXCEPTION 'counters readable'; END IF;
  IF to_regclass('public.client_error_quota') IS NOT NULL OR to_regclass('public.client_error_keys') IS NOT NULL THEN
    RAISE EXCEPTION 'a per-person table exists (no stored link to a person)';
  END IF;
END;
$$;

-- Not signed in: nothing written.
SELECT set_config('request.jwt.claims', '', true);
DO $$ BEGIN
  IF public.bw_report_client_error('error', 'x') THEN RAISE EXCEPTION 'reported without a user'; END IF;
END $$;

-- Signed in: written, cut to size, no user id kept with the report.
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111"}', true);
DO $$
DECLARE r record;
BEGIN
  IF NOT public.bw_report_client_error('weird', repeat('m', 500), repeat('s', 5000), '1.0.14', 'mars', repeat('r', 100)) THEN
    RAISE EXCEPTION 'first report refused';
  END IF;
  SELECT * INTO r FROM public.client_errors ORDER BY id DESC LIMIT 1;
  IF r.kind <> 'error' OR length(r.message) <> 300 OR length(r.stack) <> 4000 OR r.platform IS NOT NULL OR length(r.route) <> 60 THEN
    RAISE EXCEPTION 'not cut: % % % % %', r.kind, length(r.message), length(r.stack), r.platform, length(r.route);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_errors' AND column_name ~ 'user') THEN
    RAISE EXCEPTION 'client_errors has a user column';
  END IF;
END;
$$;

-- No per-person count on the server: more than 10 from one person still
-- go in (the app sends at most 10 a session; the global caps below bound it).
-- Report times to the minute. No shared xmin across real transactions: checked
-- in client_errors.pglite.mjs (here everything is one transaction).
DO $$
DECLARE i int; ok int := 0;
BEGIN
  FOR i IN 1..20 LOOP
    IF public.bw_report_client_error('rejection', 'boom ' || i, NULL, '1.0.14', 'android', 'Stage') THEN ok := ok + 1; END IF;
  END LOOP;
  IF ok <> 20 THEN RAISE EXCEPTION 'refused under the global caps: % accepted', ok; END IF;
  IF EXISTS (SELECT 1 FROM public.client_errors WHERE created_at <> date_trunc('minute', created_at)) THEN
    RAISE EXCEPTION 'a report time finer than the minute';
  END IF;
  IF EXISTS (SELECT 1 FROM public.client_error_counters WHERE bucket !~ '^(h:\d{4}-\d\d-\d\dT\d\d|d:\d{4}-\d\d-\d\d|rows)$') THEN
    RAISE EXCEPTION 'a counter that is not a global bucket';
  END IF;
END;
$$;

-- Everyone together: 300 an hour, 1000 a day, 15000 kept, whoever sends them
-- (counters are one row each, bumped atomically: two reports at 299 can't both pass).
SELECT set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333"}', true);
DO $$ BEGIN
  UPDATE public.client_error_counters SET n = 300 WHERE bucket LIKE 'h:%';
  IF public.bw_report_client_error('error', 'hour full') THEN RAISE EXCEPTION 'hourly cap not applied'; END IF;
  UPDATE public.client_error_counters SET n = 0 WHERE bucket LIKE 'h:%';
  UPDATE public.client_error_counters SET n = 1000 WHERE bucket LIKE 'd:%';
  IF public.bw_report_client_error('error', 'day full') THEN RAISE EXCEPTION 'daily cap not applied'; END IF;
  UPDATE public.client_error_counters SET n = 0 WHERE bucket LIKE 'd:%';
  UPDATE public.client_error_counters SET n = 15000 WHERE bucket = 'rows';
  IF public.bw_report_client_error('error', 'table full') THEN RAISE EXCEPTION 'row cap not applied'; END IF;
  UPDATE public.client_error_counters SET n = 0 WHERE bucket = 'rows';
  IF NOT public.bw_report_client_error('error', 'room again') THEN RAISE EXCEPTION 'refused with room'; END IF;
END $$;

-- Prune (hourly): reports older than 14 days, counters of past hours; the
-- row count is set to the truth again.
INSERT INTO public.client_error_counters (bucket, n) VALUES ('h:2000-01-01T00', 3);
UPDATE public.client_errors SET created_at = now() - interval '15 days' WHERE message LIKE 'boom 1%';
DO $$ BEGIN
  IF public.bw_prune_client_errors() < 1 THEN RAISE EXCEPTION 'nothing pruned'; END IF;
  IF EXISTS (SELECT 1 FROM public.client_errors WHERE created_at < now() - interval '14 days') THEN RAISE EXCEPTION 'old reports kept'; END IF;
  IF EXISTS (SELECT 1 FROM public.client_error_counters WHERE bucket = 'h:2000-01-01T00') THEN RAISE EXCEPTION 'past hour counter kept'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.client_error_counters WHERE bucket LIKE 'h:%') THEN RAISE EXCEPTION 'this hour counter dropped'; END IF;
  IF (SELECT n FROM public.client_error_counters WHERE bucket = 'rows') <> (SELECT count(*) FROM public.client_errors) THEN RAISE EXCEPTION 'row count not reset'; END IF;
END $$;

ROLLBACK;
