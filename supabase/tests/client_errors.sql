-- Checks for 174_client_errors.sql. Runs in a transaction and rolls back.
BEGIN;

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.client_errors', 'SELECT') OR has_table_privilege('authenticated', 'public.client_errors', 'SELECT')
     OR has_table_privilege('authenticated', 'public.client_errors', 'INSERT') THEN
    RAISE EXCEPTION 'client_errors is reachable directly';
  END IF;
  IF has_table_privilege('authenticated', 'public.client_error_quota', 'SELECT') THEN RAISE EXCEPTION 'quota readable'; END IF;
  IF has_function_privilege('anon', 'public.bw_report_client_error(text, text, text, text, text, text)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can report'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.bw_report_client_error(text, text, text, text, text, text)', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated cannot report'; END IF;
  IF has_function_privilege('authenticated', 'public.bw_prune_client_errors()', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated can prune'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bw-prune-client-errors' AND schedule = '7 * * * *') THEN RAISE EXCEPTION 'no hourly cron job'; END IF;
  IF has_table_privilege('authenticated', 'public.client_error_counters', 'SELECT') THEN RAISE EXCEPTION 'counters readable'; END IF;
  IF has_table_privilege('authenticated', 'public.client_error_keys', 'SELECT') THEN RAISE EXCEPTION 'hour secrets readable'; END IF;
  IF has_function_privilege('authenticated', 'public.bw_seal_client_errors()', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated can seal'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bw-seal-client-errors' AND schedule = '* * * * *') THEN RAISE EXCEPTION 'no seal cron job'; END IF;
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

-- 10 an hour per person (the app sends at most 10 a session), then refused.
DO $$
DECLARE i int; ok int := 0;
BEGIN
  FOR i IN 1..20 LOOP
    IF public.bw_report_client_error('rejection', 'boom ' || i, NULL, '1.0.14', 'android', 'Stage') THEN ok := ok + 1; END IF;
  END LOOP;
  IF ok <> 9 THEN RAISE EXCEPTION 'rate limit: % accepted (expected 9 after the first)', ok; END IF;
END;
$$;

-- The per-person counter: no user id, a key made with this hour's secret,
-- the clock hour only; report times to the minute. (Whether a stored row can
-- join a report to a counter afterwards, xmin included, is checked in
-- client_errors.pglite.mjs: here everything is one transaction.)
DO $$
DECLARE q record;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_error_quota' AND column_name ~ 'user') THEN
    RAISE EXCEPTION 'client_error_quota has a user column';
  END IF;
  SELECT * INTO q FROM public.client_error_quota
   WHERE key = encode(sha256((SELECT secret FROM public.client_error_keys WHERE hour = date_trunc('hour', now()))
                             || convert_to('11111111-1111-4111-8111-111111111111', 'UTF8')), 'hex');
  IF q.n <> 21 THEN RAISE EXCEPTION 'counter not found under the hour key (n = %)', q.n; END IF;
  IF q.window_start <> date_trunc('hour', now()) THEN RAISE EXCEPTION 'window_start is not the hour: %', q.window_start; END IF;
  IF EXISTS (SELECT 1 FROM public.client_errors WHERE created_at <> date_trunc('minute', created_at)) THEN
    RAISE EXCEPTION 'a report time finer than the minute';
  END IF;
  IF public.bw_seal_client_errors() < 1 THEN RAISE EXCEPTION 'seal found nothing to seal'; END IF;
  IF EXISTS (SELECT 1 FROM public.client_errors WHERE NOT sealed) THEN RAISE EXCEPTION 'seal left reports unsealed'; END IF;
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
INSERT INTO public.client_error_quota (key, window_start, n)
VALUES ('past-hour-key', date_trunc('hour', now()) - interval '1 hour', 3);
INSERT INTO public.client_error_keys (hour, secret) VALUES (date_trunc('hour', now()) - interval '1 hour', '\x00');
UPDATE public.client_errors SET created_at = now() - interval '15 days' WHERE message LIKE 'boom 1%';
DO $$ BEGIN
  IF public.bw_prune_client_errors() < 1 THEN RAISE EXCEPTION 'nothing pruned'; END IF;
  IF EXISTS (SELECT 1 FROM public.client_errors WHERE created_at < now() - interval '14 days') THEN RAISE EXCEPTION 'old reports kept'; END IF;
  IF EXISTS (SELECT 1 FROM public.client_error_quota WHERE window_start < date_trunc('hour', now())) THEN RAISE EXCEPTION 'past hour counter kept'; END IF;
  IF EXISTS (SELECT 1 FROM public.client_error_keys WHERE hour < date_trunc('hour', now())) THEN RAISE EXCEPTION 'past hour secret kept'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.client_error_quota WHERE window_start = date_trunc('hour', now())) THEN RAISE EXCEPTION 'this hour counter dropped'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.client_error_keys WHERE hour = date_trunc('hour', now())) THEN RAISE EXCEPTION 'this hour secret dropped'; END IF;
  IF (SELECT n FROM public.client_error_counters WHERE bucket = 'rows') <> (SELECT count(*) FROM public.client_errors) THEN RAISE EXCEPTION 'row count not reset'; END IF;
END $$;

ROLLBACK;
