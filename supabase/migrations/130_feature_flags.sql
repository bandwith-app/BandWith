-- 130 · Feature flags (plan A0.1): platform switches and per-band features.
--
-- Generic, so later switches (paid tiers, payments) reuse it.
--   platform_switches  one row per key for everyone. enabled = false is a
--                      kill switch (wins over everything); true turns a
--                      feature that is off by default on for every band that
--                      says nothing.
--   band_features      per band, on or off.
-- With no row the app's default applies (src/lib/flags.ts FLAG_DEFAULTS).
--
-- Both tables: RLS on, no grants to anon or authenticated, written only with
-- the service role (SQL / admin script). The app reads them through
-- bw_band_features(band): the platform switches for any signed-in user, a
-- band's own settings only for its active members.
--
-- Additive and idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_switches (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  enabled boolean NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.band_features (
  band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (band_id, key)
);

ALTER TABLE public.platform_switches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_features ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.platform_switches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.band_features FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_band_features(p_band_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'platform', COALESCE((SELECT jsonb_object_agg(s.key, s.enabled) FROM platform_switches s), '{}'::jsonb),
    'band', CASE
      WHEN p_band_id IS NOT NULL AND public.bw_is_band_member(p_band_id) THEN
        COALESCE((SELECT jsonb_object_agg(f.key, f.enabled) FROM band_features f WHERE f.band_id = p_band_id), '{}'::jsonb)
      ELSE '{}'::jsonb
    END
  );
$function$;

REVOKE ALL ON FUNCTION public.bw_band_features(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_band_features(uuid) TO authenticated;

COMMIT;
