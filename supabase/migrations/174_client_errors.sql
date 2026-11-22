-- 174: Crash reports from the app's JavaScript (web app and the native
-- apps' WebView), src/lib/crashReports.ts. Native crashes go to Firebase
-- Crashlytics instead. Settings > Privacy & account > "Send crash reports".
--
-- No personal data: no user id, no names, no content. The app sends only
-- the error message and stack (scrubbed on the device: no emails, ids,
-- numbers, quoted text or URLs with queries), the app version, the platform
-- and the screen name ("Stage", "Gig"). The function cuts them again here.
--
-- Written only through bw_report_client_error (signed-in users):
-- - per person: 30 per clock hour. The counter (client_error_quota) keeps
--   the user id apart from the reports and holds only the hour
--   (date_trunc), never a report's own time; it goes at the next hourly
--   prune, so about an hour at most.
-- - everyone together: 300 an hour, 1000 a day, and never more than 15000
--   rows kept (client_error_counters, one row per bucket, bumped atomically:
--   two reports at the limit can't both pass). Worst case ~15000 x 4.4 kB
--   = ~65 MB, far below the Free plan's 500 MB.
-- Kept 14 days. Pruned every hour (pg_cron bw-prune-client-errors).
--
-- Read (service role): SELECT created_at, platform, app_version, route, message
--   FROM public.client_errors ORDER BY created_at DESC LIMIT 50;
--
-- Test: supabase/tests/client_errors.sql (runs in a transaction, rolls back).

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

CREATE TABLE IF NOT EXISTS public.client_error_quota (
  user_id      uuid PRIMARY KEY,
  -- The clock hour (date_trunc('hour')), never a report's time.
  window_start timestamptz NOT NULL,
  n            int NOT NULL
);

-- Global limits: 'h:<UTC hour>', 'd:<UTC day>', 'rows' (reports kept; an
-- upper bound between prunes, set to the real count by every prune).
CREATE TABLE IF NOT EXISTS public.client_error_counters (
  bucket text PRIMARY KEY,
  n      int NOT NULL
);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_error_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_error_counters ENABLE ROW LEVEL SECURITY;
-- No policies and no grants: only the functions below (and the service role) touch them.
REVOKE ALL ON TABLE public.client_errors FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.client_error_quota FROM PUBLIC, anon, authenticated;
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
DECLARE
  v_uid  uuid := auth.uid();
  v_hour timestamptz := date_trunc('hour', now());
  v_n    int;
BEGIN
  IF v_uid IS NULL OR p_message IS NULL OR btrim(p_message) = '' THEN
    RETURN false;
  END IF;

  -- Per person: at most 30 in a clock hour. Only the hour is kept with the
  -- user id, never the report's time.
  INSERT INTO public.client_error_quota AS q (user_id, window_start, n)
  VALUES (v_uid, v_hour, 1)
  ON CONFLICT (user_id) DO UPDATE
     SET n            = CASE WHEN q.window_start = EXCLUDED.window_start THEN q.n + 1 ELSE 1 END,
         window_start = EXCLUDED.window_start
  RETURNING n INTO v_n;
  IF v_n > 30 THEN
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

  INSERT INTO public.client_errors (kind, message, stack, app_version, platform, route)
  VALUES (
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

-- Every hour: reports older than 14 days, the per-person counters of past
-- hours, the global counters of past hours and days; 'rows' set to the truth.
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
  DELETE FROM public.client_error_quota WHERE window_start < date_trunc('hour', now());
  DELETE FROM public.client_error_counters
   WHERE (bucket LIKE 'h:%' AND bucket < 'h:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24'))
      OR (bucket LIKE 'd:%' AND bucket < 'd:' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'));
  INSERT INTO public.client_error_counters AS c (bucket, n)
  VALUES ('rows', (SELECT count(*) FROM public.client_errors))
  ON CONFLICT (bucket) DO UPDATE SET n = EXCLUDED.n;
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
