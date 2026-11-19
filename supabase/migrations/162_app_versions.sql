-- 162 · Paid plans, P4: the minimum app version (docs/plans/paid-plans.md §7).
--
-- One row per platform, written by hand with the service role (no rows in
-- the migration = no minimum anywhere, nothing changes):
--   ios      compared with the build number (CFBundleVersion, e.g. 202612141030)
--   android  compared with the version name (e.g. 1.0.9)
--   web      compared with the build stamp of the web app (yyyymmddhhmm, UTC)
-- min_version   below it the app shows a full-screen "Update BandWith"
-- latest_version newer than the installed one: a soft hint only
-- store_url     where the iOS button goes (TestFlight until the App Store)
--
-- Read by bw_app_version(platform), open before sign-in (anon), because an
-- old build must be told to update even on the sign-in screen.
--
-- Additive and idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_versions (
  platform text PRIMARY KEY CHECK (platform IN ('ios', 'android', 'web')),
  min_version text CHECK (min_version IS NULL OR min_version ~ '^[0-9]+(\.[0-9]+)*$'),
  latest_version text CHECK (latest_version IS NULL OR latest_version ~ '^[0-9]+(\.[0-9]+)*$'),
  store_url text CHECK (store_url IS NULL OR store_url ~ '^(https://|itms-beta://|itms-apps://)'),
  message_key text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_versions FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_app_version(p_platform text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'min_version', v.min_version,
    'latest_version', v.latest_version,
    'store_url', v.store_url,
    'message_key', v.message_key
  )
  FROM app_versions v
  WHERE v.platform = p_platform;
$function$;

REVOKE ALL ON FUNCTION public.bw_app_version(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bw_app_version(text) TO anon, authenticated;

COMMIT;
