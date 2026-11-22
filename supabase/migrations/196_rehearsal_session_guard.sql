-- 196 · Rehearsal sessions: a saved session is never started over (audit 06 #3/#4).
--
-- A second admin's device that missed the end (or a fresh device that tapped
-- Start before the saved session was read) wrote a new start time over the
-- occurrence's row, erasing its start, end and songs played. From this build
-- the app saves only on top of the revision it read (updated_at) or as a new
-- row (src/lib/services/rehearsalSessions.ts); this guard covers the builds
-- already in the field, which upsert: a write that changes started_at of a
-- saved session is refused ('rehearsal_session_conflict'). Pause, resume,
-- end, resume after the end and the songs played keep started_at, so they
-- are unaffected. To really start an occurrence again, delete its row first.
--
-- Same function as 131 plus that one check. No new columns, grants or
-- policies. Idempotent.

BEGIN;

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
    IF NEW.started_at IS DISTINCT FROM OLD.started_at THEN
      RAISE EXCEPTION 'rehearsal_session_conflict: this rehearsal already has a saved session'
        USING ERRCODE = 'P0001', HINT = 'Read the saved session again.';
    END IF;
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
