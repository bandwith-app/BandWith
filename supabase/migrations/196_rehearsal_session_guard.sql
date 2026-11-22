-- 196 · Rehearsal sessions: a saved session is never started over (audit 06 #3/#4).
--
-- A second admin's device that missed the end (or a fresh device that tapped
-- Start before the saved session was read) wrote a new start time over the
-- occurrence's row, erasing its start, end and songs played. From this build
-- the app saves only on top of the revision it read (updated_at) or as a new
-- row (src/lib/services/rehearsalSessions.ts); this guard covers the builds
-- already in the field, which upsert: a write that changes started_at of a
-- saved session is skipped (the row stays as it is, 0 rows written). Not an
-- error on purpose (PR #296 review): those builds keep a refused save as
-- "unsaved" on the device and retry it forever, so an error would trap them;
-- a skipped write reads as saved, their device copy turns clean and the next
-- open shows the saved session. This build sees 0 rows as a conflict and
-- merges. Pause, resume, end, resume after the end and the songs played keep
-- started_at, so they are unaffected. To really start an occurrence again,
-- delete its row first.
--
-- One move of started_at is allowed (#296 round 3): EARLIER, by this build's
-- merge of two copies started unread on two devices (it keeps the earlier
-- start). This build always writes summary.pauses (an array); the builds in
-- the field never do, so their Start over a saved session stays skipped.
-- Known limit for those builds: with a session already saved, their Start
-- there is skipped quietly (their device shows the saved one at the next
-- open). Rehearsal notes are not affected.
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
    IF NEW.started_at IS DISTINCT FROM OLD.started_at
       AND NOT (NEW.started_at < OLD.started_at AND COALESCE(jsonb_typeof(NEW.summary -> 'pauses') = 'array', false)) THEN
      -- Another start over a saved session: skipped, the saved one stays.
      RETURN NULL;
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
