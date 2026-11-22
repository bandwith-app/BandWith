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
-- An End stays (#296 round 6, round 8): a leader on those builds doesn't
-- hear another admin's End, and its next save (a song played) upserts its
-- running copy, which would undo the End for everyone; an older admin that
-- paused offline before the End has more paused time, so no paused-time rule
-- can tell its copy apart. So an ended row stays ended for every plain
-- write that clears ended_at: its End, pause fields and paused time stay as saved, the rest of
-- the write (the songs it adds) goes in, no error. Two ways reopen it:
--   * this build's Resume after an End: only through
--     bw_save_rehearsal_session() below (sets bw.rehearsal_reopen for its one
--     UPDATE, on the revision it read), which only this build calls;
--   * an older build's real Resume of the End (#296 round 8, Claude M-c): it
--     adds the gap since the End to its own paused time and saves right
--     away, so its paused_ms minus its share before (the row's paused_ms, or
--     one of the older builds' paused times this build saved in
--     summary.untimed) matches now() - ended_at, within 2 minutes. An
--     offline copy's own pauses match that only by chance. Wider than a
--     Resume of that End, accepted (Claude r8 N1): an online older leader that
--     paused around an End it never heard and resumes after it matches too,
--     and reopens it (its device and this build's merge agree). Known limit: an
--     older build's Resume saved later than 2 minutes after it (offline)
--     stays ended; its device shows the saved session at the next open.
-- Held is a write that clears ended_at; one with another End (an older
-- build's second End) moves ended_at and paused_ms, as before 196.
--
-- Songs played (#296 round 7): those builds' leaders don't hear the channel,
-- so their save (an End, a Resume) carries only the songs they saw; over a
-- row this build wrote, the saved songs stay and theirs are added (by id).
-- The rest this build keeps in the summary (pauses, log, untimed: #296 round
-- 8) stays as saved too.
--
-- Only the app's writes are checked (auth.uid() set): an operator's write
-- (SQL editor, service_role) goes through as written (#296 round 7).
--
-- Known limit, accepted as rare: an older build whose clock is off from the
-- server's by more than 2 minutes has its Resume after an End kept ended
-- (the gap it adds doesn't match). Phones keep their clocks in sync; its
-- device shows the saved session at the next open.
--
-- Same function as 131 plus these checks, and one new function
-- (bw_save_rehearsal_session: SECURITY INVOKER, so 131's grants and policies
-- apply; EXECUTE for authenticated only). No new columns or policies.
-- Idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION public.bw_trg_rehearsal_session_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_old_played jsonb;
  v_played jsonb;
  v_old_build boolean;
  v_gap numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.started_by := auth.uid();
    NEW.created_at := now();
  ELSE
    -- The app's writes only (a signed-in user): an operator's (SQL editor, service_role: no
    -- auth.uid()) goes through as written, never skipped quietly (#296 round 7).
    IF auth.uid() IS NOT NULL THEN
      IF NEW.started_at IS DISTINCT FROM OLD.started_at
         AND NOT (NEW.started_at < OLD.started_at AND COALESCE(jsonb_typeof(NEW.summary -> 'pauses') = 'array', false)) THEN
        -- Another start over a saved session: skipped, the saved one stays.
        RETURN NULL;
      END IF;
      v_old_build := COALESCE(jsonb_typeof(NEW.summary -> 'pauses') IS DISTINCT FROM 'array', true);
      -- The songs played: the saved ones first, then the ones this write adds (by id).
      v_old_played := CASE WHEN jsonb_typeof(OLD.summary -> 'played') = 'array' THEN OLD.summary -> 'played' ELSE '[]'::jsonb END;
      v_played := v_old_played || COALESCE((
        SELECT jsonb_agg(p ORDER BY ord)
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.summary -> 'played') = 'array' THEN NEW.summary -> 'played' ELSE '[]'::jsonb END)
          WITH ORDINALITY AS t(p, ord)
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_old_played) AS o(q) WHERE o.q ->> 'id' = t.p ->> 'id')
      ), '[]'::jsonb);
      IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS NULL
         AND COALESCE(current_setting('bw.rehearsal_reopen', true), '') <> 'on' THEN
        -- A plain write that clears the End of an ended session (#296 round 8): it stays ended,
        -- unless the paused time it added matches the time since the End (an older build's
        -- Resume, see the header). Only ended_at NULL is held here: a write with another End
        -- (an older build's second End) moves ended_at and paused_ms as before.
        v_gap := extract(epoch FROM (now() - OLD.ended_at)) * 1000;
        IF NOT (v_old_build AND EXISTS (
          SELECT 1
          FROM (
            SELECT OLD.paused_ms::numeric AS share
            UNION ALL
            SELECT (u ->> 0)::numeric
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(OLD.summary -> 'untimed') = 'array' THEN OLD.summary -> 'untimed' ELSE '[]'::jsonb END) AS x(u)
            WHERE jsonb_typeof(u) = 'array' AND jsonb_typeof(u -> 0) = 'number'
          ) c
          WHERE NEW.paused_ms - c.share > 0 AND abs(NEW.paused_ms - c.share - v_gap) <= 120000
        )) THEN
          NEW.ended_at := OLD.ended_at;
          NEW.paused_at := OLD.paused_at;
          NEW.paused_ms := OLD.paused_ms;
          NEW.summary := CASE WHEN jsonb_typeof(OLD.summary) = 'object' THEN OLD.summary ELSE '{}'::jsonb END
            || jsonb_build_object('played', v_played);
        END IF;
      END IF;
      IF jsonb_typeof(OLD.summary -> 'pauses') = 'array' AND v_old_build THEN
        -- An older build's save over a row this build wrote: what this build keeps in the summary
        -- (pause times, log, untimed) stays, and the songs played are the union.
        NEW.summary := CASE WHEN jsonb_typeof(NEW.summary) = 'object' THEN NEW.summary ELSE '{}'::jsonb END
          || (OLD.summary - 'v' - 'durationS' - 'played' - 'total')
          || jsonb_build_object('played', v_played);
      END IF;
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

-- This build's save of a running session on top of the revision it read
-- (#296 round 8): the one way to reopen an ended one (its Resume after the
-- End). The caller's own rights apply (SECURITY INVOKER: 131's column grants
-- and policies, so admins only). NULL: not written (the row moved on, or
-- another start was skipped), the app reads it again and merges.
CREATE OR REPLACE FUNCTION public.bw_save_rehearsal_session(
  p_event_id uuid,
  p_occurrence_date date,
  p_rev timestamptz,
  p_started_at timestamptz,
  p_paused_ms bigint,
  p_paused_at timestamptz,
  p_ended_at timestamptz,
  p_summary jsonb
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_rev timestamptz;
BEGIN
  PERFORM set_config('bw.rehearsal_reopen', 'on', true);
  UPDATE public.rehearsal_sessions
     SET started_at = p_started_at, paused_ms = p_paused_ms, paused_at = p_paused_at,
         ended_at = p_ended_at, summary = p_summary
   WHERE event_id = p_event_id AND occurrence_date = p_occurrence_date AND updated_at = p_rev
  RETURNING updated_at INTO v_rev;
  PERFORM set_config('bw.rehearsal_reopen', '', true);
  RETURN v_rev;
END;
$$;

REVOKE ALL ON FUNCTION public.bw_save_rehearsal_session(uuid, date, timestamptz, timestamptz, bigint, timestamptz, timestamptz, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_save_rehearsal_session(uuid, date, timestamptz, timestamptz, bigint, timestamptz, timestamptz, jsonb) TO authenticated;

COMMIT;
