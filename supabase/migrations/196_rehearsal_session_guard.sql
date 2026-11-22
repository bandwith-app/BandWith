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
-- Pause times (#296 round 5): those builds rebuild the summary on every save
-- without summary.pauses; the saved pause times are carried over, so the
-- app's paused_ms minus the pause times is exactly what they added. A write
-- that has summary.pauses (this build) replaces them.
--
-- An End stays (#296 round 6): a leader on those builds doesn't hear another
-- admin's End, and its next save (a song played) upserts its running copy,
-- which would undo the End for everyone. Skipped when it reopens an ended
-- session with no summary.pauses (those builds) and no more paused time than
-- saved. Their real Resume after the End always adds the gap to paused_ms,
-- so it still goes through; this build always writes summary.pauses. Known
-- limit: an older build's stale running copy over a Pause can't be told
-- apart from its real Resume here (both clear paused_at, neither has pause
-- times), so that one is still written; this build's devices merge it.
--
-- Same function as 131 plus these checks. No new columns, grants or
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
    IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS NULL
       AND COALESCE(jsonb_typeof(NEW.summary -> 'pauses') IS DISTINCT FROM 'array', true)
       AND NEW.paused_ms <= OLD.paused_ms THEN
      -- An older build that missed the End saving its running copy: skipped, the End stays.
      RETURN NULL;
    END IF;
    IF jsonb_typeof(OLD.summary -> 'pauses') = 'array'
       AND COALESCE(jsonb_typeof(NEW.summary -> 'pauses') IS DISTINCT FROM 'array', true) THEN
      NEW.summary := CASE WHEN jsonb_typeof(NEW.summary) = 'object' THEN NEW.summary ELSE '{}'::jsonb END
        || jsonb_build_object('pauses', OLD.summary -> 'pauses');
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
