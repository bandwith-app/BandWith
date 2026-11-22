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
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bw-prune-client-errors') THEN RAISE EXCEPTION 'no cron job'; END IF;
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

-- 30 an hour per person, then refused.
DO $$
DECLARE i int; ok int := 0;
BEGIN
  FOR i IN 1..40 LOOP
    IF public.bw_report_client_error('rejection', 'boom ' || i, NULL, '1.0.14', 'android', 'Stage') THEN ok := ok + 1; END IF;
  END LOOP;
  IF ok <> 29 THEN RAISE EXCEPTION 'rate limit: % accepted (expected 29 after the first)', ok; END IF;
END;
$$;

-- Prune: old rows go.
UPDATE public.client_errors SET created_at = now() - interval '31 days' WHERE message LIKE 'boom 1%';
DO $$ BEGIN
  IF public.bw_prune_client_errors() < 1 THEN RAISE EXCEPTION 'nothing pruned'; END IF;
END $$;

ROLLBACK;
