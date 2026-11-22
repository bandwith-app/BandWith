-- 173: Remote kill switches (docs/flags.md). One row per new feature; the
-- app reads them at start and on resume, keeps the last answer on the
-- device, and uses its built-in default (ON) when the table or a row is
-- missing or can't be read. So this table only ever turns things OFF.
--
-- Turn a feature off (SQL editor, service role):
--   UPDATE public.app_flags SET enabled = false, note = 'why', updated_at = now() WHERE key = 'voice_parts';
--
-- min_app_version: the feature is on only for installs at or above it
-- (plain value for every platform, or "ios=…;android=…;web=…"; see docs/flags.md).
--
-- Test: supabase/tests/app_flags.sql (runs in a transaction, rolls back).

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_flags (
  key             text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  enabled         boolean NOT NULL DEFAULT true,
  min_app_version text NULL,
  note            text NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_flags ENABLE ROW LEVEL SECURITY;

-- anon has nothing on public tables; signed-in users read, only the service role writes.
REVOKE ALL ON TABLE public.app_flags FROM PUBLIC, anon, authenticated;
GRANT SELECT (key, enabled, min_app_version, updated_at) ON public.app_flags TO authenticated;

DROP POLICY IF EXISTS app_flags_select ON public.app_flags;
CREATE POLICY app_flags_select ON public.app_flags
  FOR SELECT TO authenticated
  USING (true);

-- The five features of the live release, all on (the app's default anyway).
INSERT INTO public.app_flags (key, enabled, note) VALUES
  ('live_pack',    true, 'Offline live pack: prefetch, consent sheet, ready rows, Settings > Offline & live'),
  ('voice_parts',  true, 'Voice part colours, legend, Highlight my part, Who sings what, Voice row in the chord editor'),
  ('follow_tempo', true, 'Follow the tempo (playhead) on Stage'),
  ('count_in',     true, 'Count-in before a song on Stage'),
  ('ble_live',     true, 'Click / playhead clock over Bluetooth on Stage')
ON CONFLICT (key) DO NOTHING;

COMMIT;
