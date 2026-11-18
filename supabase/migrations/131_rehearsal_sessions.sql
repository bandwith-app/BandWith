-- 131 · Rehearsal sessions (plan A1b): the timer, pauses and saved summary
-- of a rehearsal run in Live mode.
--
-- One row per rehearsal occurrence: recurring rehearsals share one event id,
-- so the key is (event_id, occurrence_date). The band admin (the live
-- leader) writes it: start, pause, resume, end, and the songs played as they
-- go (summary). Active band members read it, so their Live mode shows the
-- same clock and the saved summary. No check-ins (dropped, plan 3.0).
--
-- RLS on; nothing for anon. Column grants are explicit (the rule since
-- 079-081): src/lib/services/rehearsalSessions.ts SESSION_COLUMNS must match
-- the SELECT grant (rehearsalMigrations.test.ts).
--
-- Additive and idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rehearsal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id uuid NOT NULL REFERENCES public.bands(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  started_at timestamptz NOT NULL,
  paused_ms bigint NOT NULL DEFAULT 0 CHECK (paused_ms >= 0),
  paused_at timestamptz,
  ended_at timestamptz,
  started_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(summary) = 'object' AND pg_column_size(summary) <= 32768),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rehearsal_sessions_occurrence_key UNIQUE (event_id, occurrence_date),
  CONSTRAINT rehearsal_sessions_end_after_start CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT rehearsal_sessions_not_paused_and_ended CHECK (paused_at IS NULL OR ended_at IS NULL)
);

CREATE INDEX IF NOT EXISTS rehearsal_sessions_band_idx ON public.rehearsal_sessions (band_id, occurrence_date DESC);

ALTER TABLE public.rehearsal_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rehearsal_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, band_id, event_id, occurrence_date, started_at, paused_ms, paused_at, ended_at, started_by, summary, updated_at)
  ON public.rehearsal_sessions TO authenticated;
GRANT INSERT (band_id, event_id, occurrence_date, started_at, paused_ms, paused_at, ended_at, summary)
  ON public.rehearsal_sessions TO authenticated;
GRANT UPDATE (band_id, event_id, occurrence_date, started_at, paused_ms, paused_at, ended_at, summary)
  ON public.rehearsal_sessions TO authenticated;
GRANT DELETE ON public.rehearsal_sessions TO authenticated;

DROP POLICY IF EXISTS rehearsal_sessions_member_select ON public.rehearsal_sessions;
DROP POLICY IF EXISTS rehearsal_sessions_admin_insert ON public.rehearsal_sessions;
DROP POLICY IF EXISTS rehearsal_sessions_admin_update ON public.rehearsal_sessions;
DROP POLICY IF EXISTS rehearsal_sessions_admin_delete ON public.rehearsal_sessions;

CREATE POLICY rehearsal_sessions_member_select ON public.rehearsal_sessions
  FOR SELECT TO authenticated
  USING (public.bw_is_band_member(band_id));

CREATE POLICY rehearsal_sessions_admin_insert ON public.rehearsal_sessions
  FOR INSERT TO authenticated
  WITH CHECK (public.bw_is_band_admin(band_id) AND public.bw_event_band_id(event_id) = band_id);

CREATE POLICY rehearsal_sessions_admin_update ON public.rehearsal_sessions
  FOR UPDATE TO authenticated
  USING (public.bw_is_band_admin(band_id))
  WITH CHECK (public.bw_is_band_admin(band_id) AND public.bw_event_band_id(event_id) = band_id);

CREATE POLICY rehearsal_sessions_admin_delete ON public.rehearsal_sessions
  FOR DELETE TO authenticated
  USING (public.bw_is_band_admin(band_id));

-- Who started it is the signed-in admin; the occurrence never moves; updated_at on every write.
CREATE OR REPLACE FUNCTION public.bw_trg_rehearsal_session_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.started_by := auth.uid();
    NEW.created_at := now();
  ELSE
    NEW.started_by := OLD.started_by;
    NEW.created_at := OLD.created_at;
    NEW.band_id := OLD.band_id;
    NEW.event_id := OLD.event_id;
    NEW.occurrence_date := OLD.occurrence_date;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rehearsal_sessions_guard ON public.rehearsal_sessions;
CREATE TRIGGER rehearsal_sessions_guard BEFORE INSERT OR UPDATE ON public.rehearsal_sessions
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_rehearsal_session_guard();

COMMIT;
