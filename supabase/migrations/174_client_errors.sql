-- 174: Crash reports from the app's JavaScript (web app and the native
-- apps' WebView), src/lib/crashReports.ts. Native crashes go to Firebase
-- Crashlytics instead. Settings > Privacy & account > "Send crash reports".
--
-- No personal data: no user id, no names, no content. The app sends only
-- the error message and stack (scrubbed on the device: no emails, ids,
-- numbers, quoted text or URLs with queries), the app version, the platform
-- and the screen name ("Stage", "Gig"). The function cuts them again here.
--
-- Written only through bw_report_client_error (signed-in users), at most 30
-- per person per hour and 2000 per hour in all. The rate-limit counter keeps
-- the user id apart from the reports, for one hour. Kept 30 days (pg_cron).
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
  window_start timestamptz NOT NULL,
  n            int NOT NULL
);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_error_quota ENABLE ROW LEVEL SECURITY;
-- No policies and no grants: only the function below (and the service role) touch them.
REVOKE ALL ON TABLE public.client_errors FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.client_error_quota FROM PUBLIC, anon, authenticated;

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
  v_uid uuid := auth.uid();
  v_n int;
BEGIN
  IF v_uid IS NULL OR p_message IS NULL OR btrim(p_message) = '' THEN
    RETURN false;
  END IF;

  -- Everyone together: at most 2000 an hour (a crash loop in a release must not fill the database).
  IF (SELECT count(*) FROM public.client_errors WHERE created_at > now() - interval '1 hour') >= 2000 THEN
    RETURN false;
  END IF;

  -- Per person: at most 30 an hour.
  INSERT INTO public.client_error_quota AS q (user_id, window_start, n)
  VALUES (v_uid, now(), 1)
  ON CONFLICT (user_id) DO UPDATE
     SET window_start = CASE WHEN q.window_start < now() - interval '1 hour' THEN now() ELSE q.window_start END,
         n            = CASE WHEN q.window_start < now() - interval '1 hour' THEN 1 ELSE q.n + 1 END
  RETURNING n INTO v_n;
  IF v_n > 30 THEN
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

-- Kept 30 days; the rate-limit rows go after an hour.
CREATE OR REPLACE FUNCTION public.bw_prune_client_errors()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.client_errors WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public.client_error_quota WHERE window_start < now() - interval '1 hour';
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_prune_client_errors() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('bw-prune-client-errors')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bw-prune-client-errors');
  PERFORM cron.schedule('bw-prune-client-errors', '50 3 * * *', 'SELECT public.bw_prune_client_errors()');
END;
$$;

COMMIT;
