-- ============================================================================
-- 195 · Rehearsal polls: invite-only reads, one-step publish, deadline;
--       one rehearsal date deleted in one step
--       (audit 383f15b, 05 #1 #3 #4 #8 #11; Codex review of #297)
-- ----------------------------------------------------------------------------
-- #3  A poll with an invite list (098) was readable by every member of the
--     band: the app filtered it out after the response had reached the
--     device (title, notes, place, who is invited, options, votes). Reads are
--     now limited in the database to the invited members, the poll's creator
--     and the band's admins. Polls without a list (every poll before 098, and
--     proposals) stay readable by every active member, as before.
--
--       rehearsal_polls               select policy
--       rehearsal_poll_options        select policy
--       rehearsal_poll_votes          select policy (118)
--       rehearsal_poll_unavailable    select policy (102)
--       bw_rehearsal_poll_costs()     same shape (114), visible polls only
--
-- #1 #8  bw_publish_rehearsal_proposal(poll, fields, options) turns a
--     member's proposal into a poll in one transaction: it locks the row,
--     checks the caller is an admin of the PROPOSAL's band (not the band the
--     app has selected), and only acts while the row is still 'proposed'. A
--     second admin publishing a stale form gets { published: false } and no
--     option (and so no vote) is touched. Returns the proposal's band_id: the
--     app notifies that band's members, never the selected band's.
--
--       p_fields   { title, notes, vote_by, vote_by_time, location, room_cost,
--                    focus_song_ids, invited_user_ids } — keys left out keep
--                    the stored value (as the app's update did).
--       p_options  [{ proposed_date, start_time, end_time? }, …], at least one.
--       returns    { published, poll_id, band_id, status }
--
-- #11 bw_poll_vote_deadlines(poll ids) returns the deadline the database
--     enforces (bw_poll_vote_deadline, 117: the creator's time zone) as an
--     absolute timestamp, so a travelling member's app does not close voting
--     early (it read vote_by + vote_by_time in the device's zone).
--     bw_poll_vote_deadline(poll) itself (117) is no longer granted to
--     authenticated: it answered for any poll id, invited or not. No app
--     build ever called it; the vote policies reach it through
--     bw_poll_voting_open (SECURITY DEFINER), which keeps working.
--
-- #4  bw_skip_rehearsal_date(event, date) — "Delete this date" of a repeating
--     rehearsal: locks the event row, checks the caller is an admin of its
--     band and that it still repeats, and appends the date to
--     recurrence_rule.skip_dates (sorted, no duplicates; every other key of
--     the rule kept). Two admins deleting different dates at once both keep
--     theirs (the app's read-then-write lost one). Errors: 42501 not an
--     admin, 22023 not repeating. Returns { event_id, skip_dates }.
--     Builds without it (or before 195) fall back to the read-then-write.
--
-- Older TestFlight / APK builds keep working: they read the same columns and
-- simply receive fewer rows for invite-only polls they were not on (they hid
-- those already); their own publish (update + delete + insert) is unchanged.
-- No new columns, so no table GRANT changes. Idempotent; safe to re-run.
-- ============================================================================

BEGIN;

-- ── Who may read a poll ───────────────────────────────────────────────────
-- The caller (auth.uid()) only: no asking about someone else.
CREATE OR REPLACE FUNCTION public.bw_can_see_rehearsal_poll(p_poll_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.rehearsal_polls rp
     WHERE rp.id = p_poll_id
       AND auth.uid() IS NOT NULL
       AND public.bw_is_band_member(rp.band_id)
       AND (
            cardinality(rp.invited_user_ids) = 0
         OR auth.uid() = ANY (rp.invited_user_ids)
         OR rp.created_by = auth.uid()
         OR public.bw_is_band_admin(rp.band_id)
       )
  );
$$;

REVOKE ALL ON FUNCTION public.bw_can_see_rehearsal_poll(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_can_see_rehearsal_poll(uuid) TO authenticated;

DROP POLICY IF EXISTS "rehearsal_polls_select" ON public.rehearsal_polls;
CREATE POLICY "rehearsal_polls_select" ON public.rehearsal_polls
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.bw_is_band_member(band_id)
    AND (
         cardinality(invited_user_ids) = 0
      OR auth.uid() = ANY (invited_user_ids)
      OR created_by = auth.uid()
      OR public.bw_is_band_admin(band_id)
    )
  );

DROP POLICY IF EXISTS "rehearsal_poll_options_select" ON public.rehearsal_poll_options;
CREATE POLICY "rehearsal_poll_options_select" ON public.rehearsal_poll_options
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.bw_can_see_rehearsal_poll(poll_id));

DROP POLICY IF EXISTS "band_members_can_select_votes" ON public.rehearsal_poll_votes;
-- TO authenticated, as in 118 (Claude #297 round 3).
CREATE POLICY "band_members_can_select_votes" ON public.rehearsal_poll_votes
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.bw_can_see_rehearsal_poll(poll_id));

DROP POLICY IF EXISTS "band_members_can_select_unavailable" ON public.rehearsal_poll_unavailable;
CREATE POLICY "band_members_can_select_unavailable" ON public.rehearsal_poll_unavailable
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.bw_can_see_rehearsal_poll(poll_id));

-- 114, same shape: only polls the caller may read.
CREATE OR REPLACE FUNCTION public.bw_rehearsal_poll_costs(p_poll_ids uuid[])
RETURNS TABLE (poll_id uuid, room_cost numeric, cost_share numeric, share_count integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH p AS (
    SELECT rp.id, rp.band_id, rp.room_cost,
           CASE WHEN cardinality(rp.invited_user_ids) > 0
                THEN cardinality(rp.invited_user_ids)
                ELSE (SELECT count(*)::int FROM band_members bm
                      WHERE bm.band_id = rp.band_id AND coalesce(bm.is_active, true))
           END AS n
    FROM rehearsal_polls rp
    WHERE auth.uid() IS NOT NULL
      AND rp.id = ANY (p_poll_ids)
      AND public.bw_can_see_rehearsal_poll(rp.id)
  )
  SELECT p.id,
         CASE WHEN public.bw_is_band_admin(p.band_id) THEN p.room_cost END,
         CASE WHEN p.room_cost IS NOT NULL AND p.room_cost > 0
              THEN round(p.room_cost / greatest(1, p.n), 2) END,
         greatest(1, p.n)
  FROM p;
$$;

REVOKE ALL ON FUNCTION public.bw_rehearsal_poll_costs(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_rehearsal_poll_costs(uuid[]) TO authenticated;

-- ── Publish a proposal as a poll, once ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bw_publish_rehearsal_proposal(
  p_poll_id uuid,
  p_fields jsonb,
  p_options jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_band uuid;
  v_status text;
  v_f jsonb := coalesce(p_fields, '{}'::jsonb);
  v_invited uuid[];
  v_bad integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_options IS NULL OR jsonb_typeof(p_options) <> 'array' OR jsonb_array_length(p_options) = 0 THEN
    RAISE EXCEPTION 'At least one date/time option is required to publish a poll.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_options) AS e(item)
   WHERE jsonb_typeof(e.item) <> 'object'
      OR coalesce(e.item ->> 'proposed_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
      OR coalesce(e.item ->> 'start_time', '') !~ '^\d{2}:\d{2}(:\d{2})?$'
      OR coalesce(nullif(e.item ->> 'end_time', ''), '00:00') !~ '^\d{2}:\d{2}(:\d{2})?$';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'A date/time option is not valid' USING ERRCODE = '22023';
  END IF;

  -- One publish at a time per proposal; the band is the proposal's own.
  SELECT rp.band_id, rp.status INTO v_band, v_status
    FROM public.rehearsal_polls rp
   WHERE rp.id = p_poll_id
   FOR UPDATE;
  IF v_band IS NULL OR NOT public.bw_is_band_admin(v_band, v_uid) THEN
    RAISE EXCEPTION 'Only band admins can publish this poll' USING ERRCODE = '42501';
  END IF;
  IF v_status <> 'proposed' THEN
    -- Another admin published (or declined) it already: change nothing.
    RETURN jsonb_build_object('published', false, 'poll_id', p_poll_id, 'band_id', v_band, 'status', v_status);
  END IF;

  IF v_f ? 'invited_user_ids' THEN
    SELECT coalesce(array_agg(DISTINCT u), '{}'::uuid[]) INTO v_invited
      FROM (
        SELECT (x)::uuid AS u FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(v_f -> 'invited_user_ids') = 'array' THEN v_f -> 'invited_user_ids' ELSE '[]'::jsonb END) AS x
      ) s;
    -- A list always has the admin who publishes it.
    IF cardinality(v_invited) > 0 AND NOT v_uid = ANY (v_invited) THEN
      v_invited := v_invited || v_uid;
    END IF;
  END IF;

  UPDATE public.rehearsal_polls rp
     SET title = CASE WHEN v_f ? 'title' THEN coalesce(nullif(btrim(v_f ->> 'title'), ''), 'Rehearsal Availability Poll') ELSE rp.title END,
         notes = CASE WHEN v_f ? 'notes' THEN nullif(btrim(coalesce(v_f ->> 'notes', '')), '') ELSE rp.notes END,
         vote_by = CASE WHEN v_f ? 'vote_by' THEN nullif(v_f ->> 'vote_by', '')::date ELSE rp.vote_by END,
         vote_by_time = CASE WHEN v_f ? 'vote_by_time' THEN nullif(v_f ->> 'vote_by_time', '')::time ELSE rp.vote_by_time END,
         location = CASE WHEN v_f ? 'location' THEN nullif(btrim(coalesce(v_f ->> 'location', '')), '') ELSE rp.location END,
         room_cost = CASE WHEN v_f ? 'room_cost'
                          THEN CASE WHEN jsonb_typeof(v_f -> 'room_cost') = 'number' AND (v_f ->> 'room_cost')::numeric > 0
                                    THEN (v_f ->> 'room_cost')::numeric END
                          ELSE rp.room_cost END,
         focus_song_ids = CASE WHEN v_f ? 'focus_song_ids' AND jsonb_typeof(v_f -> 'focus_song_ids') = 'array'
                               THEN ARRAY(SELECT (x)::uuid FROM jsonb_array_elements_text(v_f -> 'focus_song_ids') AS x)
                               ELSE rp.focus_song_ids END,
         invited_user_ids = CASE WHEN v_f ? 'invited_user_ids' THEN v_invited ELSE rp.invited_user_ids END,
         status = 'polling',
         updated_at = now()
   WHERE rp.id = p_poll_id;

  -- The proposal's own suggestions (nobody can vote on a proposal).
  DELETE FROM public.rehearsal_poll_options WHERE poll_id = p_poll_id;
  INSERT INTO public.rehearsal_poll_options (poll_id, proposed_date, start_time, end_time)
  SELECT p_poll_id,
         (e.item ->> 'proposed_date')::date,
         (e.item ->> 'start_time')::time,
         nullif(e.item ->> 'end_time', '')::time
    FROM jsonb_array_elements(p_options) WITH ORDINALITY AS e(item, ord)
   ORDER BY e.ord;

  RETURN jsonb_build_object('published', true, 'poll_id', p_poll_id, 'band_id', v_band, 'status', 'polling');
END;
$$;

REVOKE ALL ON FUNCTION public.bw_publish_rehearsal_proposal(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_publish_rehearsal_proposal(uuid, jsonb, jsonb) TO authenticated;

COMMENT ON FUNCTION public.bw_publish_rehearsal_proposal(uuid, jsonb, jsonb) IS
  'Turn a proposal into a poll in one transaction, only while it is still proposed; admins of the proposal''s band (195, audit 05 #1 #8).';

-- ── The deadline the database enforces, for the app ───────────────────────
CREATE OR REPLACE FUNCTION public.bw_poll_vote_deadlines(p_poll_ids uuid[])
RETURNS TABLE (poll_id uuid, vote_deadline timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT rp.id, public.bw_poll_vote_deadline(rp.id)
    FROM public.rehearsal_polls rp
   WHERE auth.uid() IS NOT NULL
     AND rp.id = ANY (p_poll_ids)
     AND public.bw_can_see_rehearsal_poll(rp.id);
$$;

REVOKE ALL ON FUNCTION public.bw_poll_vote_deadlines(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_poll_vote_deadlines(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.bw_poll_vote_deadlines(uuid[]) IS
  'When voting closes for each poll the caller may read, as enforced by the vote policies (117); 195, audit 05 #11.';

-- ── The single-poll deadline: no longer callable by clients ───────────────
-- Only SECURITY DEFINER functions use it (bw_poll_voting_open, the vote
-- policies' check, and bw_poll_vote_deadlines above, which filters by
-- visibility); they run as the owner, so this changes nothing for them.
REVOKE EXECUTE ON FUNCTION public.bw_poll_vote_deadline(uuid) FROM authenticated;

-- ── One date of a repeating rehearsal, in one step (#4, Codex #297) ───────
CREATE OR REPLACE FUNCTION public.bw_skip_rehearsal_date(p_event_id uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_band uuid;
  v_recurring boolean;
  v_rule jsonb;
  v_skips jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Only band admins can delete this event' USING ERRCODE = '42501';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'A date is needed' USING ERRCODE = '22023';
  END IF;

  SELECT e.band_id, e.is_recurring, e.recurrence_rule
    INTO v_band, v_recurring, v_rule
    FROM public.events e
   WHERE e.id = p_event_id
   FOR UPDATE;

  IF NOT FOUND OR v_band IS NULL OR NOT public.bw_is_band_admin(v_band, auth.uid()) THEN
    RAISE EXCEPTION 'Only band admins can delete this event' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce(v_recurring, false) OR v_rule IS NULL OR jsonb_typeof(v_rule) <> 'object' THEN
    RAISE EXCEPTION 'This rehearsal does not repeat any more' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(d ORDER BY d), '[]'::jsonb)
    INTO v_skips
    FROM (
      SELECT DISTINCT x AS d
        FROM jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(v_rule -> 'skip_dates') = 'array' THEN v_rule -> 'skip_dates' ELSE '[]'::jsonb END
             ) AS x
       WHERE x ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      UNION
      SELECT to_char(p_date, 'YYYY-MM-DD')
    ) AS all_dates;

  UPDATE public.events
     SET recurrence_rule = v_rule || jsonb_build_object('skip_dates', v_skips),
         updated_at = now()
   WHERE id = p_event_id;

  RETURN jsonb_build_object('event_id', p_event_id, 'skip_dates', v_skips);
END;
$$;

REVOKE ALL ON FUNCTION public.bw_skip_rehearsal_date(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_skip_rehearsal_date(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.bw_skip_rehearsal_date(uuid, date) IS
  'Delete one date of a repeating rehearsal: append it to recurrence_rule.skip_dates under a row lock; admins of the event''s band (195, audit 05 #4, Codex #297 B3).';

COMMIT;
