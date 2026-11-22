-- 174: Crash reports from the app's JavaScript (web app and the native
-- apps' WebView), src/lib/crashReports.ts. Native crashes go to Firebase
-- Crashlytics instead. Settings > Privacy & account > "Send crash reports".
--
-- No personal data: no user id, no names, no content. The app sends only
-- the error message and stack (scrubbed on the device: no emails, ids,
-- numbers, quoted text or URLs with queries), the app version, the platform
-- and the screen name ("Stage", "Gig"). The function cuts them again here.
--
-- Written only through bw_report_client_error (signed-in users; the user id
-- is only checked, never stored or used for anything else):
-- - per person: no count on the server, so no row for it. The app sends each
--   error once and at most 10 a session; one account sending more can only
--   use up the global caps below (crash reports stop for that hour), nothing
--   else.
-- - everyone together: 300 an hour, 1000 a day, and never more than 15000
--   rows kept (client_error_counters, one row per bucket, bumped atomically:
--   two reports at the limit can't both pass). Worst case ~15000 x 4.4 kB
--   = ~65 MB, far below the Free plan's 500 MB.
--
-- Unlinkable in the database: a report's transaction writes only the report
-- and the global counters (shared by everyone), so no stored row, and no
-- transaction id (xmin), ties a report to a person. Report times are kept to
-- the minute. Said plainly: Supabase's own request logs (outside this
-- database, kept for a short time) record each call with its caller.
-- Kept 14 days. Pruned every hour (pg_cron bw-prune-client-errors). The
-- prune also clears its own run history in cron.job_run_details older than
-- a day (pg_cron keeps a row per run).
--
-- First version: no database has an earlier 174 (prod checked 11-22: not
-- applied), so the CREATE TABLE IF NOT EXISTS below never meets an older
-- shape of these tables. If a local database ran an early draft, reset it.
--
-- Read (service role): SELECT created_at, platform, app_version, route, message
--   FROM public.client_errors ORDER BY created_at DESC LIMIT 50;
--
-- Test: supabase/tests/client_errors.sql (runs in a transaction, rolls back).
--
-- Rollback dry run: this file has its own BEGIN; and COMMIT;. Strip both
-- first, or that COMMIT makes the dry run real.

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_errors (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL CHECK (kind IN ('error', 'rejection', 'render')),
  message     text NOT NULL,
  stack       text NULL,
  app_version text NULL,
  platform    text NULL CHECK (platform IS NULL OR platform IN ('ios', 'android', 'web')),
  route       text NULL
);
CREATE INDEX IF NOT EXISTS client_errors_created_at_idx ON public.client_errors (created_at DESC);

-- Global limits: 'h:<UTC hour>', 'd:<UTC day>', 'rows' (reports kept; an
-- upper bound between prunes, set to the real count by every prune).
CREATE TABLE IF NOT EXISTS public.client_error_counters (
  bucket text PRIMARY KEY,
  n      int NOT NULL
);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_error_counters ENABLE ROW LEVEL SECURITY;
-- No policies and no grants: only the functions below (and the service role) touch them.
REVOKE ALL ON TABLE public.client_errors FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.client_error_counters FROM PUBLIC, anon, authenticated;

-- One atomic bump: the row lock of ON CONFLICT DO UPDATE serialises two
-- reports at the same time, so each sees its own count.
CREATE OR REPLACE FUNCTION public.bw_client_error_bump(p_bucket text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  INSERT INTO public.client_error_counters AS c (bucket, n) VALUES (p_bucket, 1)
  ON CONFLICT (bucket) DO UPDATE SET n = c.n + 1
  RETURNING n;
$$;
REVOKE ALL ON FUNCTION public.bw_client_error_bump(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_report_client_error(
  p_kind text,
  p_message text,
  p_stack text DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_platform text DEFAULT NULL,
  p_route text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Signed in only; the id is not kept.
  IF auth.uid() IS NULL OR p_message IS NULL OR btrim(p_message) = '' THEN
    RETURN false;
  END IF;

  -- Everyone together (a crash loop in a release must not fill the database).
  IF public.bw_client_error_bump('h:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24')) > 300 THEN
    RETURN false;
  END IF;
  IF public.bw_client_error_bump('d:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')) > 1000 THEN
    RETURN false;
  END IF;
  IF public.bw_client_error_bump('rows') > 15000 THEN
    RETURN false;
  END IF;

  INSERT INTO public.client_errors (created_at, kind, message, stack, app_version, platform, route)
  VALUES (
    date_trunc('minute', now()),
    CASE WHEN p_kind IN ('error', 'rejection', 'render') THEN p_kind ELSE 'error' END,
    left(p_message, 300),
    left(p_stack, 4000),
    left(p_app_version, 40),
    CASE WHEN p_platform IN ('ios', 'android', 'web') THEN p_platform END,
    left(p_route, 60)
  );
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_report_client_error(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bw_report_client_error(text, text, text, text, text, text) TO authenticated;

-- Every hour: reports older than 14 days, the global counters of past hours
-- and days; 'rows' set to the truth.
CREATE OR REPLACE FUNCTION public.bw_prune_client_errors()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.client_errors WHERE created_at < now() - interval '14 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public.client_error_counters
   WHERE (bucket LIKE 'h:%' AND bucket < 'h:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24'))
      OR (bucket LIKE 'd:%' AND bucket < 'd:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'));
  -- The row counter's lock first, then the count: a report holding the lock
  -- commits before we count it, and none can bump it between the count and
  -- the update (no stale number written over a newer one).
  INSERT INTO public.client_error_counters (bucket, n) VALUES ('rows', 0) ON CONFLICT (bucket) DO NOTHING;
  PERFORM 1 FROM public.client_error_counters WHERE bucket = 'rows' FOR UPDATE;
  UPDATE public.client_error_counters
     SET n = (SELECT count(*) FROM public.client_errors)
   WHERE bucket = 'rows';
  -- pg_cron keeps a row per run, for ever: keep a day of this job's.
  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    EXECUTE $q$
      DELETE FROM cron.job_run_details
       WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'bw-prune-client-errors')
         AND end_time < now() - interval '1 day'
    $q$;
  END IF;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_prune_client_errors() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('bw-prune-client-errors')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bw-prune-client-errors');
  PERFORM cron.schedule('bw-prune-client-errors', '7 * * * *', 'SELECT public.bw_prune_client_errors()');
END;
$$;

COMMIT;
