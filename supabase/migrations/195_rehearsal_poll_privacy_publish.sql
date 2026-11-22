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
--       p_client_id the request's id (the app keeps one per open form). A
--                  retry of the same request after a lost answer gets
--                  { published: true, replayed: true } and the app sends
--                  its notices; any other request on a published poll gets
--                  { published: false } (Codex #297 round 3). Stored in
--                  the side table rehearsal_poll_publish_requests (new; RLS
--                  on, no grants: only this SECURITY DEFINER function reads
--                  or writes it). Not a column of rehearsal_polls: members
--                  hold a table-level SELECT on it, so a column would be
--                  readable whatever 119 grants (Claude #297 r5 minor 9).
--       returns    { published, replayed?, poll_id, band_id, status,
--                    invited_user_ids } — the invite list as stored, so the
--                    app tells only the invitees (minor 8).
--
-- #8  bw_rehearsal_polls_keep_open_fields (BEFORE UPDATE): while a poll is
--     open ('polling') and has votes, the title, the invite list and the
--     vote-by date and time keep their stored values, unless the write comes
--     from the publish above (transaction-local flag bw.poll_publish). A
--     stale form of an older build can no longer rename the poll or change
--     who votes under the members who voted (Claude #297 r5 minor 7). New
--     builds write these columns only through the publish (or, before 195,
--     while the row is still 'proposed'), so they are not affected.
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
-- #4  bw_move_rehearsal_date(event, date, new date, fields, client id) —
--     "Only this date" moves one date of a repeating rehearsal in one
--     transaction (Codex #297 round 3): locks the series row, copies it as a
--     one-off on the new date (every column but the recurrence and the
--     date: studio cost, setlist, place, notes...; title and times from
--     p_fields), copies the lineup (each member's own row, as it is) and the
--     rider & stage (event_stage), and adds the old date to skip_dates. The
--     client id is the new event's id: a retry finds it and creates nothing.
--     Claude #297 r5:
--       - the one-off gets its own copy of the setlist (setlists +
--         setlist_songs), so editing it there leaves the series' one alone;
--         only a setlist of the series' own band is copied, any other
--         leaves the one-off without one (Codex #297 B1);
--       - p_fields may carry the other columns edited in the wizard (venue,
--         notes, fee...; never the band, the links, the recurrence, the date,
--         the status or the type): one write, one notice listing the
--         changes, no second update from the app;
--       - refused (22023, HINT for the app's translated message) when p_date
--         is not a date of the series (bw:not_a_date), is already deleted
--         (bw:date_deleted), or p_new_date is before today in the caller's
--         time zone (bw:date_past). Nothing is created then.
--     Returns { event_id, series_id, skip_dates, setlist_id }.
--
-- #4  bw_events_skip_notice: a deleted future date is announced to the
--     series' lineup ("Rehearsal cancelled", translated by 089's
--     bw_trg_server_notification_text, redefined here from its 089 body so
--     the date shown is the deleted date: data.occurrence_date). A date moved
--     with "Only this date" is announced as an update of the new one-off,
--     listing what changed (data.changes: date, time, venue). Draft and
--     cancelled series announce nothing (Claude #297 r5 minor 3).
--
-- #8  bw_poll_options_keep_voted: no option of an open poll with votes is
--     removed or added (an older build's stale publish), Claude #297 round 3.
--
-- #4  Deleted dates survive every write (Codex #297 round 3): the BEFORE
--     UPDATE trigger bw_events_00_keep_skip_dates puts the stored
--     skip_dates back into any new recurrence_rule (union), so a cadence
--     edit made at the same time, or an older build writing the whole rule,
--     never brings a deleted date back. When the series start moves, the
--     stored dates follow only a change of phase: weekly modulo its period
--     (a start moved along its cadence moves nothing), monthly to the new
--     day in the same month (clamped, #298). Turning the repeat off (rule NULL)
--     still clears it. Only bw_restore_rehearsal_date(event, date) takes a
--     date out, through a transaction-local flag (bw.restore_skip); it
--     refuses a NULL date (22023, HINT bw:not_a_date, Codex #297 M2). Only
--     bw_skip_rehearsal_date and bw_move_rehearsal_date add one (flag
--     bw.skip_add): any other write's list is ignored, so a cadence edit
--     replayed from an offline queue cannot cancel a date restored meanwhile
--     (Codex #297 M3). The
--     only other BEFORE UPDATE trigger on events is update_events_updated_at
--     (002); "bw_events_00_" fires first by name, and neither reads what
--     the other writes. 178 (#294) adds only AFTER triggers on events.
--
-- M1  bw_band_free_slots (095): a series' deleted first date is free in the
--     date pickers' heatmap, as in the demo (Codex #297 M1). Redefined from
--     095 only when the function in place does not read skip_dates yet;
--     178 (#294) carries the same rule and is left as it is.
--
-- B4  The calendar feeds' EXDATE lines for deleted and moved dates live in
--     #285 (182 + _shared/deputy-calendar.ts, same batch); they read
--     recurrence_rule.skip_dates as 'YYYY-MM-DD' strings, the form stored here.
--
-- Older TestFlight / APK builds keep working: they read the same columns and
-- simply receive fewer rows for invite-only polls they were not on (they hid
-- those already); their own publish (update + delete + insert on a
-- 'proposed' row) is unchanged. They ignore skip_dates, so they still show
-- deleted dates, and the old date of a moved one next to its one-off: a
-- release-notes item, not fixable on the server (Claude #297 r5 minor 10).
-- No new column on an existing table; one new table with no grants
-- (rehearsal_poll_publish_requests). Idempotent; safe to re-run.
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
-- The request that published a poll, so its own retry is recognised. A
-- side table with no grant and no policy: authenticated has table-level
-- SELECT on rehearsal_polls, so a column there would be readable by every
-- member (Claude #297 round 5). Only the SECURITY DEFINER publish reads it.
CREATE TABLE IF NOT EXISTS public.rehearsal_poll_publish_requests (
  poll_id uuid PRIMARY KEY REFERENCES public.rehearsal_polls(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rehearsal_poll_publish_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rehearsal_poll_publish_requests FROM PUBLIC, anon, authenticated;

-- 195 was never applied: the 3-argument form is replaced, not overloaded.
DROP FUNCTION IF EXISTS public.bw_publish_rehearsal_proposal(uuid, jsonb, jsonb);
CREATE OR REPLACE FUNCTION public.bw_publish_rehearsal_proposal(
  p_poll_id uuid,
  p_fields jsonb,
  p_options jsonb,
  p_client_id uuid DEFAULT NULL
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
  v_request uuid;
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
  SELECT rp.band_id, rp.status, rp.invited_user_ids INTO v_band, v_status, v_invited
    FROM public.rehearsal_polls rp
   WHERE rp.id = p_poll_id
   FOR UPDATE;
  IF v_band IS NULL OR NOT public.bw_is_band_admin(v_band, v_uid) THEN
    RAISE EXCEPTION 'Only band admins can publish this poll' USING ERRCODE = '42501';
  END IF;
  SELECT pr.request_id INTO v_request FROM public.rehearsal_poll_publish_requests pr WHERE pr.poll_id = p_poll_id;
  IF v_status <> 'proposed' AND p_client_id IS NOT NULL AND v_request = p_client_id THEN
    -- This same request published it and its answer was lost: nothing to
    -- change; the app sends the notices it did not send, to the stored
    -- invite list (empty = the whole band).
    RETURN jsonb_build_object('published', true, 'replayed', true, 'poll_id', p_poll_id, 'band_id', v_band, 'status', v_status,
                              'invited_user_ids', to_jsonb(coalesce(v_invited, '{}'::uuid[])));
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

  -- The proposal's own suggestions (nobody can vote on a proposal), while it
  -- is still one (bw_poll_options_keep_voted guards open polls).
  DELETE FROM public.rehearsal_poll_options WHERE poll_id = p_poll_id;

  -- This write may set the title, invitees and vote-by
  -- (bw_rehearsal_polls_keep_open_fields keeps them on other writes).
  PERFORM set_config('bw.poll_publish', 'on', true);

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
   WHERE rp.id = p_poll_id
  RETURNING rp.invited_user_ids INTO v_invited;
  PERFORM set_config('bw.poll_publish', '', true);

  IF p_client_id IS NOT NULL THEN
    INSERT INTO public.rehearsal_poll_publish_requests (poll_id, request_id)
    VALUES (p_poll_id, p_client_id)
    ON CONFLICT (poll_id) DO UPDATE SET request_id = EXCLUDED.request_id, created_at = now();
  END IF;

  INSERT INTO public.rehearsal_poll_options (poll_id, proposed_date, start_time, end_time)
  SELECT p_poll_id,
         (e.item ->> 'proposed_date')::date,
         (e.item ->> 'start_time')::time,
         nullif(e.item ->> 'end_time', '')::time
    FROM jsonb_array_elements(p_options) WITH ORDINALITY AS e(item, ord)
   ORDER BY e.ord;

  -- The stored invite list: the app notifies only them (empty = the band).
  RETURN jsonb_build_object('published', true, 'poll_id', p_poll_id, 'band_id', v_band, 'status', 'polling',
                            'invited_user_ids', to_jsonb(coalesce(v_invited, '{}'::uuid[])));
END;
$$;

REVOKE ALL ON FUNCTION public.bw_publish_rehearsal_proposal(uuid, jsonb, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_publish_rehearsal_proposal(uuid, jsonb, jsonb, uuid) TO authenticated;

COMMENT ON FUNCTION public.bw_publish_rehearsal_proposal(uuid, jsonb, jsonb, uuid) IS
  'Turn a proposal into a poll in one transaction, only while it is still proposed; the same request (p_client_id) replays as published; admins of the proposal''s band (195, audit 05 #1 #8, Codex #297).';

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

  -- Transaction-local: only this step (and the move) may add a date
  -- (bw_events_00_keep_skip_dates, Codex #297 M3).
  PERFORM set_config('bw.skip_add', 'on', true);
  UPDATE public.events
     SET recurrence_rule = v_rule || jsonb_build_object('skip_dates', v_skips),
         updated_at = now()
   WHERE id = p_event_id;
  PERFORM set_config('bw.skip_add', '', true);

  RETURN jsonb_build_object('event_id', p_event_id, 'skip_dates', v_skips);
END;
$$;

REVOKE ALL ON FUNCTION public.bw_skip_rehearsal_date(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_skip_rehearsal_date(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.bw_skip_rehearsal_date(uuid, date) IS
  'Delete one date of a repeating rehearsal: append it to recurrence_rule.skip_dates under a row lock; admins of the event''s band (195, audit 05 #4, Codex #297 B3).';

-- ── A poll's options stay while it has votes (Claude #297 round 3) ──────
-- An older build (383f15b) publishing a stale form deletes the options of a
-- poll already voted on, then adds its own (it ignores the delete's error).
-- While a poll is open with votes, its options can be neither removed nor
-- added; that build then shows the insert's message. Deleting the poll
-- itself still removes everything (the cascade runs once the poll is gone).
CREATE OR REPLACE FUNCTION public.bw_trg_poll_options_keep_voted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_poll uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.poll_id ELSE NEW.poll_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM public.rehearsal_polls rp WHERE rp.id = v_poll AND rp.status = 'polling')
     AND EXISTS (SELECT 1 FROM public.rehearsal_poll_votes v WHERE v.poll_id = v_poll) THEN
    RAISE EXCEPTION 'This poll already has votes, so its dates can''t be changed. Close and reopen it to see the votes.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_poll_options_keep_voted() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_poll_options_keep_voted ON public.rehearsal_poll_options;
CREATE TRIGGER bw_poll_options_keep_voted
  BEFORE INSERT OR DELETE ON public.rehearsal_poll_options
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_poll_options_keep_voted();

-- ── An open poll with votes keeps what people voted on (Claude #297 r5) ──
-- An older build (383f15b) publishing a stale form also rewrites the poll:
-- its title, who is invited and the vote-by day. While the poll is open
-- with votes, those stay as they are; only the publish RPC (flag
-- bw.poll_publish, set by it alone) writes them. Status changes (lock in,
-- close, cancel) and every other column go through as before. No current
-- build writes these columns on an open poll (checked in src: only the
-- publish of a proposal, while it is still 'proposed').
CREATE OR REPLACE FUNCTION public.bw_trg_polls_keep_open_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status = 'polling'
     AND coalesce(current_setting('bw.poll_publish', true), '') <> 'on'
     AND (NEW.title IS DISTINCT FROM OLD.title
          OR NEW.invited_user_ids IS DISTINCT FROM OLD.invited_user_ids
          OR NEW.vote_by IS DISTINCT FROM OLD.vote_by
          OR NEW.vote_by_time IS DISTINCT FROM OLD.vote_by_time)
     AND EXISTS (SELECT 1 FROM public.rehearsal_poll_votes v WHERE v.poll_id = OLD.id) THEN
    NEW.title := OLD.title;
    NEW.invited_user_ids := OLD.invited_user_ids;
    NEW.vote_by := OLD.vote_by;
    NEW.vote_by_time := OLD.vote_by_time;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_polls_keep_open_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_rehearsal_polls_keep_open_fields ON public.rehearsal_polls;
CREATE TRIGGER bw_rehearsal_polls_keep_open_fields
  BEFORE UPDATE ON public.rehearsal_polls
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_polls_keep_open_fields();

-- ── "Only this date": one date of a series moved, in one step ────────────
-- A date of the series as the app counts it (lib/recurrence, #298): weekly
-- (× interval) and biweekly by days from the first date; monthly by months
-- from the first date, on its day or the last day of a shorter month; up to
-- `until`, and `count` repeats after the first. Deleted dates still count
-- here (the caller checks skip_dates).
CREATE OR REPLACE FUNCTION public.bw_rehearsal_series_has_date(p_rule jsonb, p_start date, p_day date)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_freq text := lower(coalesce(p_rule ->> 'frequency', p_rule ->> 'freq', ''));
  v_every integer := CASE WHEN coalesce(p_rule ->> 'interval', '') ~ '^[0-9]+$' AND (p_rule ->> 'interval')::int >= 1
                          THEN (p_rule ->> 'interval')::int ELSE 1 END;
  v_until date;
  v_months integer;
  v_steps integer;
BEGIN
  IF p_rule IS NULL OR p_start IS NULL OR p_day IS NULL OR p_day < p_start THEN
    RETURN false;
  END IF;
  IF coalesce(p_rule ->> 'until', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    v_until := left(p_rule ->> 'until', 10)::date;
    IF p_day > v_until THEN RETURN false; END IF;
  END IF;
  IF v_freq = 'biweekly' THEN v_freq := 'weekly'; v_every := 2; END IF;
  IF v_freq = 'weekly' THEN
    IF (p_day - p_start) % (7 * v_every) <> 0 THEN RETURN false; END IF;
    v_steps := (p_day - p_start) / (7 * v_every);
  ELSIF v_freq = 'monthly' THEN
    v_months := (extract(year FROM p_day)::int * 12 + extract(month FROM p_day)::int)
              - (extract(year FROM p_start)::int * 12 + extract(month FROM p_start)::int);
    IF v_months % v_every <> 0 OR (p_start + make_interval(months => v_months))::date <> p_day THEN RETURN false; END IF;
    v_steps := v_months / v_every;
  ELSE
    RETURN false;
  END IF;
  IF coalesce(p_rule ->> 'count', '') ~ '^[0-9]+$' AND (p_rule ->> 'count')::int > 0 AND v_steps > (p_rule ->> 'count')::int THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_rehearsal_series_has_date(jsonb, date, date) FROM PUBLIC, anon, authenticated;

-- Errors the app translates (HINT): bw:not_a_date (p_date is not one of
-- the series' dates), bw:date_deleted (already deleted), bw:date_past (the
-- new date is before today where the admin is), as 22023.
CREATE OR REPLACE FUNCTION public.bw_move_rehearsal_date(
  p_event_id uuid,
  p_date date,
  p_new_date date,
  p_fields jsonb DEFAULT '{}'::jsonb,
  p_client_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ev public.events%ROWTYPE;
  v_row jsonb;
  v_new public.events%ROWTYPE;
  v_id uuid := coalesce(p_client_id, gen_random_uuid());
  v_f jsonb := coalesce(p_fields, '{}'::jsonb);
  v_edit jsonb;
  v_rule jsonb;
  v_skips jsonb;
  v_set jsonb;
  v_tz text;
  v_today date;
  v_setlist uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_event_id IS NULL OR p_date IS NULL OR p_new_date IS NULL THEN
    RAISE EXCEPTION 'The event, its date and the new date are needed' USING ERRCODE = '22023';
  END IF;

  -- The series first, locked: a delete or another move waits for this one.
  SELECT * INTO v_ev FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_ev.band_id IS NULL OR NOT public.bw_is_band_admin(v_ev.band_id) THEN
    RAISE EXCEPTION 'Only band admins can move a rehearsal date' USING ERRCODE = '42501';
  END IF;

  -- A retry of the same request: its one-off is there already.
  IF p_client_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.events WHERE id = p_client_id) THEN
    IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_client_id AND parent_event_id = p_event_id) THEN
      RAISE EXCEPTION 'This id belongs to another event' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('event_id', p_client_id, 'series_id', p_event_id,
                              'skip_dates', coalesce(v_ev.recurrence_rule -> 'skip_dates', '[]'::jsonb), 'replayed', true);
  END IF;

  IF NOT coalesce(v_ev.is_recurring, false) OR jsonb_typeof(v_ev.recurrence_rule) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'This rehearsal does not repeat' USING ERRCODE = '22023';
  END IF;

  -- The date moved is one of the series' dates, still on; the new one is
  -- not before today in the admin's time zone (Claude #297 round 5).
  IF NOT public.bw_rehearsal_series_has_date(v_ev.recurrence_rule, v_ev.event_date, p_date) THEN
    RAISE EXCEPTION 'This date is not one of the rehearsal''s dates' USING ERRCODE = '22023', HINT = 'bw:not_a_date';
  END IF;
  IF jsonb_typeof(v_ev.recurrence_rule -> 'skip_dates') = 'array'
     AND (v_ev.recurrence_rule -> 'skip_dates') ? to_char(p_date, 'YYYY-MM-DD') THEN
    RAISE EXCEPTION 'This date was deleted already' USING ERRCODE = '22023', HINT = 'bw:date_deleted';
  END IF;
  SELECT nullif(btrim(p.timezone), '') INTO v_tz FROM public.profiles p WHERE p.id = auth.uid();
  BEGIN
    v_today := (now() AT TIME ZONE coalesce(v_tz, 'UTC'))::date;
  EXCEPTION WHEN others THEN
    v_today := (now() AT TIME ZONE 'UTC')::date;
  END;
  IF p_new_date < v_today THEN
    RAISE EXCEPTION 'The new date is in the past' USING ERRCODE = '22023', HINT = 'bw:date_past';
  END IF;

  -- What the admin edited for this date (title, times, place, notes,
  -- studio cost...): columns of events only, never the keys that tie the
  -- copy to its band, its series or its date. Empty strings are empty.
  SELECT coalesce(jsonb_object_agg(k, CASE WHEN v = '""'::jsonb THEN 'null'::jsonb ELSE v END), '{}'::jsonb)
    INTO v_edit
    FROM jsonb_each(CASE WHEN jsonb_typeof(v_f) = 'object' THEN v_f ELSE '{}'::jsonb END) AS e(k, v)
   WHERE to_jsonb(v_ev) ? k
     AND k NOT IN ('id', 'band_id', 'created_by', 'created_at', 'updated_at', 'is_recurring', 'recurrence_rule',
                   'event_date', 'date', 'parent_event_id', 'quote_id', 'setlist_id', 'status', 'event_type');
  IF v_edit ? 'title' AND nullif(btrim(coalesce(v_edit ->> 'title', '')), '') IS NULL THEN
    v_edit := v_edit - 'title';
  END IF;
  IF v_edit ? 'start_time' AND to_jsonb(v_ev) ? 'time' THEN
    v_edit := v_edit || jsonb_build_object('time', v_edit -> 'start_time');
  END IF;

  -- The series' setlist is copied (its songs too): editing this date's
  -- setlist never changes the series' (Claude #297 round 5). The copy has
  -- no event yet while its songs go in, so nobody is told about them.
  -- Only a setlist of the series' own band: this function runs as its
  -- owner, and a link to another band's setlist must not create rows there
  -- (Codex #297 B1). Any other setlist leaves the one-off without one.
  IF v_ev.setlist_id IS NOT NULL THEN
    v_setlist := gen_random_uuid();
    INSERT INTO public.setlists
    SELECT (jsonb_populate_record(sl, to_jsonb(sl) || jsonb_build_object('id', v_setlist, 'created_at', now(), 'updated_at', now(),
                                                                         'created_by', auth.uid()))).*
      FROM public.setlists sl WHERE sl.id = v_ev.setlist_id AND sl.band_id = v_ev.band_id;
    IF FOUND THEN
      INSERT INTO public.setlist_songs
      SELECT (jsonb_populate_record(ss, to_jsonb(ss) || jsonb_build_object('id', gen_random_uuid(), 'setlist_id', v_setlist, 'created_at', now()))).*
        FROM public.setlist_songs ss WHERE ss.setlist_id = v_ev.setlist_id;
    ELSE
      v_setlist := NULL;
    END IF;
  END IF;

  -- Every column of the series, but the recurrence and the date (studio
  -- cost, place, notes, ... and any column added later), then the edits.
  v_row := to_jsonb(v_ev);
  v_set := jsonb_build_object('id', v_id, 'event_date', p_new_date, 'is_recurring', false, 'recurrence_rule', NULL,
                              'setlist_id', v_setlist);
  IF v_row ? 'parent_event_id' THEN v_set := v_set || jsonb_build_object('parent_event_id', p_event_id); END IF;
  IF v_row ? 'date' THEN v_set := v_set || jsonb_build_object('date', p_new_date); END IF;
  IF v_row ? 'created_at' THEN v_set := v_set || jsonb_build_object('created_at', now()); END IF;
  IF v_row ? 'updated_at' THEN v_set := v_set || jsonb_build_object('updated_at', now()); END IF;
  v_new := jsonb_populate_record(v_ev, v_row || v_edit || v_set);
  INSERT INTO public.events SELECT (v_new).*;

  -- The lineup: each member's own row as it is (their fee stays theirs:
  -- read only through bw_event_member_money, as on the series).
  INSERT INTO public.event_members (event_id, user_id, status, fee, role, notes)
  SELECT v_id, em.user_id, em.status, em.fee, em.role, em.notes
    FROM public.event_members em
   WHERE em.event_id = p_event_id
  ON CONFLICT DO NOTHING;

  -- Rider & stage (092).
  INSERT INTO public.event_stage (event_id, band_id, plots, inputs, mixer, band_brings, venue_provides, venue_agreed, updated_by)
  SELECT v_id, st.band_id, st.plots, st.inputs, st.mixer, st.band_brings, st.venue_provides, st.venue_agreed, auth.uid()
    FROM public.event_stage st
   WHERE st.event_id = p_event_id
  ON CONFLICT (event_id) DO NOTHING;

  -- The old date leaves the series.
  v_rule := v_ev.recurrence_rule;
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
  -- The lineup hears one notice: what changed on the new one-off (date,
  -- time, place), not "cancelled" (bw_trg_events_skip_notice).
  PERFORM set_config('bw.skip_moved_to', v_id::text, true);
  PERFORM set_config('bw.skip_add', 'on', true);
  UPDATE public.events
     SET recurrence_rule = v_rule || jsonb_build_object('skip_dates', v_skips),
         updated_at = now()
   WHERE id = p_event_id;
  PERFORM set_config('bw.skip_add', '', true);
  PERFORM set_config('bw.skip_moved_to', '', true);

  RETURN jsonb_build_object('event_id', v_id, 'series_id', p_event_id, 'skip_dates', v_skips, 'setlist_id', v_setlist);
END;
$$;

REVOKE ALL ON FUNCTION public.bw_move_rehearsal_date(uuid, date, date, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_move_rehearsal_date(uuid, date, date, jsonb, uuid) TO authenticated;

COMMENT ON FUNCTION public.bw_move_rehearsal_date(uuid, date, date, jsonb, uuid) IS
  'Move one date of a repeating rehearsal: a one-off copy (every column with the edits in p_fields, a copy of the setlist, lineup, rider & stage) on the new date and the old date skipped, in one transaction; one notice; idempotent by client id; admins of the band (195, Codex/Claude #297).';

-- ── Deleted dates survive every write ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bw_trg_events_keep_skip_dates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_shift integer := 0;
  v_monthly boolean := false;
  v_freq text;
  v_every integer;
  v_period integer;
  v_day integer;
  v_all jsonb;
BEGIN
  IF jsonb_typeof(NEW.recurrence_rule) IS DISTINCT FROM 'object' THEN
    RETURN NEW; -- the repeat turned off: the rule (and its dates) goes
  END IF;
  IF coalesce(current_setting('bw.restore_skip', true), '') = 'on' THEN
    RETURN NEW; -- bw_restore_rehearsal_date takes a date out
  END IF;
  v_old := CASE WHEN jsonb_typeof(OLD.recurrence_rule -> 'skip_dates') = 'array' THEN OLD.recurrence_rule -> 'skip_dates' ELSE '[]'::jsonb END;
  -- A date is added only by bw_skip_rehearsal_date / bw_move_rehearsal_date
  -- (transaction-local bw.skip_add). Any other write's list is ignored: a
  -- cadence edit replayed from an offline queue carries a stale list, and
  -- would cancel a date restored meanwhile (Codex #297 M3).
  IF coalesce(current_setting('bw.skip_add', true), '') = 'on' THEN
    v_new := CASE WHEN jsonb_typeof(NEW.recurrence_rule -> 'skip_dates') = 'array' THEN NEW.recurrence_rule -> 'skip_dates' ELSE '[]'::jsonb END;
  ELSE
    v_new := '[]'::jsonb;
  END IF;
  IF jsonb_array_length(v_old) = 0 AND jsonb_array_length(v_new) = 0 THEN
    NEW.recurrence_rule := NEW.recurrence_rule - 'skip_dates';
    RETURN NEW;
  END IF;
  -- The series start moved: its deleted dates follow only a change of
  -- phase (Claude #297 round 5). A start moved along its own cadence (an
  -- older build saving a later date's overview card writes event_date = that
  -- date) changes no date of the series, so no deleted date moves.
  --   weekly / biweekly: by the days between the old and the new start,
  --     modulo the period (7 × interval), to the nearest date (-3..+3 for
  --     weekly): 0 when the new start is a date of the old series;
  --   monthly: each deleted date keeps its month and takes the new start's
  --     day of the month, or the last day of a shorter month (#298's rule:
  --     the 31st -> the 29th turns Apr 30 into Apr 29, Feb 28 stays).
  -- Dates the skip / move step adds (not in the stored list) are kept as sent.
  IF NEW.event_date IS NOT NULL AND OLD.event_date IS NOT NULL AND NEW.event_date <> OLD.event_date THEN
    v_freq := lower(coalesce(OLD.recurrence_rule ->> 'frequency', OLD.recurrence_rule ->> 'freq', ''));
    v_every := CASE WHEN coalesce(OLD.recurrence_rule ->> 'interval', '') ~ '^[0-9]+$' AND (OLD.recurrence_rule ->> 'interval')::int >= 1
                    THEN (OLD.recurrence_rule ->> 'interval')::int ELSE 1 END;
    IF v_freq IN ('weekly', 'biweekly') THEN
      v_period := CASE WHEN v_freq = 'biweekly' THEN 14 ELSE 7 * v_every END;
      v_shift := (((NEW.event_date - OLD.event_date) % v_period) + v_period) % v_period;
      IF v_shift * 2 > v_period THEN v_shift := v_shift - v_period; END IF;
    ELSIF v_freq = 'monthly' THEN
      v_monthly := true;
      v_day := extract(day FROM NEW.event_date)::int;
    END IF;
  END IF;
  SELECT coalesce(jsonb_agg(d ORDER BY d), '[]'::jsonb)
    INTO v_all
    FROM (
      SELECT DISTINCT to_char(
               CASE WHEN v_monthly
                    THEN make_date(extract(year FROM x::date)::int, extract(month FROM x::date)::int,
                                   least(v_day, extract(day FROM (date_trunc('month', x::date) + interval '1 month - 1 day'))::int))
                    ELSE x::date + v_shift END,
               'YYYY-MM-DD') AS d
        FROM jsonb_array_elements_text(v_old) AS x
       WHERE x ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      UNION
      SELECT y
        FROM jsonb_array_elements_text(v_new) AS y
       WHERE y ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         AND NOT (v_old ? y)
    ) AS all_dates;
  NEW.recurrence_rule := NEW.recurrence_rule || jsonb_build_object('skip_dates', v_all);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_events_keep_skip_dates() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_events_00_keep_skip_dates ON public.events;
CREATE TRIGGER bw_events_00_keep_skip_dates
  BEFORE UPDATE OF recurrence_rule, event_date ON public.events
  FOR EACH ROW
  WHEN (OLD.recurrence_rule IS NOT NULL)
  EXECUTE FUNCTION public.bw_trg_events_keep_skip_dates();


-- ── A deleted date is announced (Claude #297 round 3) ────────────────────
-- When skip_dates grows (from any build, any path), the series' lineup (or
-- the band, if it has none: bw_event_recipient_ids) gets "Rehearsal
-- cancelled" for each new future date, like 046 / 111 announce a cancelled
-- event, through bw_notify (data.server = true): 089's translator writes it
-- in each member's profiles.preferred_language. A date moved with "Only this
-- date" is announced as an update of the new one-off instead. A series moved
-- whole (its dates shift with it) announces nothing here; the event's own
-- notice (111) covers the move. Members of that band only.
-- 089's translator, from its 089 body; only the date line changes.
CREATE OR REPLACE FUNCTION public.bw_trg_server_notification_text()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d jsonb := coalesce(NEW.data, '{}'::jsonb);
  v_lang text;
  v_event uuid;
  v_ev_title text;
  v_ev_type text;
  v_ev_date date;
  v_ev_start time;
  v_ev_currency text;
  v_kind text;
  v_title text;
  v_when text;
  v_changes text;
  v_name text;
  v_band text;
  v_vars jsonb;
  v_head text;
  v_body text;
  v_tx_title text;
BEGIN
  SELECT lower(left(btrim(p.preferred_language), 2)) INTO v_lang FROM public.profiles p WHERE p.id = NEW.user_id;
  IF v_lang IS NULL OR v_lang NOT IN ('it', 'es', 'fr', 'de', 'pt') THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_event := nullif(d ->> 'event_id', '')::uuid;
  EXCEPTION WHEN others THEN v_event := NULL;
  END;
  IF v_event IS NOT NULL THEN
    -- Scalars, not a record: a record's shape would be cached between rows.
    SELECT e.title::text, e.event_type::text, coalesce(e.event_date, e.date)::date, e.start_time::time, e.currency::text
      INTO v_ev_title, v_ev_type, v_ev_date, v_ev_start, v_ev_currency
      FROM public.events e WHERE e.id = v_event;
  END IF;
  v_kind := CASE WHEN lower(coalesce(v_ev_type, d ->> 'event_type', 'gig')) = 'rehearsal' THEN 'rehearsal' ELSE 'gig' END;
  v_title := coalesce(nullif(v_ev_title, ''), nullif(d ->> 'event_title', ''), public.bw_server_text(v_kind, v_lang));
  -- 195: a date of a series (one deleted) is the date in the row, not the
  -- series' first date (Claude #297 round 3).
  v_when := public.bw_i18n_short_date(coalesce(nullif(d ->> 'occurrence_date', '')::date, v_ev_date, nullif(d ->> 'event_date', '')::date), v_lang);

  CASE NEW.type
  WHEN 'event_cancelled', 'event_confirmed', 'event_update' THEN
    v_when := v_when || CASE WHEN v_ev_start IS NOT NULL THEN ' · ' || to_char(v_ev_start, 'HH24:MI') ELSE '' END;
    SELECT string_agg(coalesce(public.bw_deputy_text('change.' || c, v_lang), c), ', ' ORDER BY o)
      INTO v_changes
      FROM jsonb_array_elements_text(coalesce(d -> 'changes', '[]'::jsonb)) WITH ORDINALITY AS x(c, o);
    v_vars := jsonb_build_object('title', v_title, 'when', v_when, 'changes', coalesce(v_changes, ''));
    IF NEW.type = 'event_cancelled' THEN
      v_head := public.bw_server_text('cancelled.' || v_kind, v_lang);
      v_body := public.bw_server_text(CASE WHEN (d ->> 'deleted')::boolean IS TRUE THEN 'removed.body' ELSE 'cancelled.body' END, v_lang, v_vars);
    ELSIF NEW.type = 'event_confirmed' THEN
      v_head := public.bw_server_text('confirmed.' || v_kind, v_lang);
      v_body := public.bw_server_text('confirmed.body', v_lang, v_vars);
    ELSE
      v_head := public.bw_server_text('updated.' || v_kind, v_lang);
      v_body := CASE WHEN v_changes IS NULL THEN NULL ELSE public.bw_server_text('updated.body', v_lang, v_vars) END;
    END IF;

  WHEN 'member_joined', 'member_left' THEN
    v_name := nullif(d ->> 'member_name', '');
    IF v_name IS NULL OR v_name = 'A member' THEN v_name := public.bw_server_text('a_member', v_lang); END IF;
    v_band := coalesce(nullif(d ->> 'band_name', ''), 'BandWith');
    v_vars := jsonb_build_object('name', v_name, 'band', v_band);
    IF NEW.type = 'member_joined' THEN
      v_head := public.bw_server_text('joined.title', v_lang, v_vars);
      v_body := public.bw_server_text('joined.body', v_lang, v_vars);
    ELSIF d ? 'member_user_id' THEN
      v_head := public.bw_server_text('left.title', v_lang, v_vars);
      v_body := public.bw_server_text(CASE WHEN (d ->> 'removed')::boolean IS TRUE THEN 'left.removed' ELSE 'left.body' END, v_lang, v_vars);
    ELSE
      -- To the person an admin removed.
      v_head := public.bw_server_text('removed_you.title', v_lang, v_vars);
      v_body := public.bw_server_text('removed_you.body', v_lang, v_vars);
    END IF;

  WHEN 'fee_changed' THEN
    v_head := public.bw_server_text('fee.title', v_lang);
    v_body := public.bw_server_text('fee.body', v_lang, jsonb_build_object(
      'title', v_title, 'when', v_when,
      'new', public.bw_i18n_amount((d ->> 'new_fee')::numeric, v_ev_currency, v_lang),
      'old', public.bw_i18n_amount((d ->> 'old_fee')::numeric, v_ev_currency, v_lang)));

  WHEN 'payment_received' THEN
    v_head := public.bw_server_text('payment.title', v_lang);
    IF d ? 'transaction_id' THEN
      -- To the admins: the amount and what it was for.
      SELECT t.title::text INTO v_tx_title FROM public.transactions t WHERE t.id = (d ->> 'transaction_id')::uuid;
      v_body := public.bw_i18n_amount((d ->> 'amount')::numeric, d ->> 'currency', v_lang)
                || ' · ' || coalesce(nullif(v_ev_title, ''), v_tx_title, '');
    ELSE
      v_body := public.bw_server_text('payment.lineup', v_lang, jsonb_build_object(
        'title', coalesce(nullif(v_ev_title, ''), public.bw_server_text('a_gig', v_lang))));
    END IF;

  WHEN 'setlist_updated' THEN
    v_head := public.bw_server_text('setlist.title', v_lang);
    v_body := public.bw_server_text('setlist.body', v_lang, jsonb_build_object('name', coalesce(nullif(d ->> 'setlist_name', ''), 'Setlist')));

  WHEN 'invite_received' THEN
    v_vars := jsonb_build_object('band', coalesce(nullif(d ->> 'band_name', ''), 'BandWith'));
    v_head := public.bw_server_text('invite.title', v_lang, v_vars);
    v_body := public.bw_server_text('invite.body', v_lang);

  ELSE
    RETURN NEW;
  END CASE;

  NEW.title := left(coalesce(v_head, NEW.title), 255);
  NEW.body := coalesce(v_body, NEW.body);
  RETURN NEW;
EXCEPTION WHEN others THEN
  -- Never lose a notification over its translation: keep the English.
  RAISE WARNING 'bw_trg_server_notification_text: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_server_notification_text() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_trg_events_skip_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old jsonb := CASE WHEN jsonb_typeof(OLD.recurrence_rule -> 'skip_dates') = 'array' THEN OLD.recurrence_rule -> 'skip_dates' ELSE '[]'::jsonb END;
  v_new jsonb := CASE WHEN jsonb_typeof(NEW.recurrence_rule -> 'skip_dates') = 'array' THEN NEW.recurrence_rule -> 'skip_dates' ELSE '[]'::jsonb END;
  v_moved text := coalesce(current_setting('bw.skip_moved_to', true), '');
  v_kind text := CASE WHEN lower(coalesce(NEW.event_type, 'gig')) = 'rehearsal' THEN 'rehearsal' ELSE 'gig' END;
  v_label text;
  v_title text;
  v_recipients uuid[];
  v_day date;
  v_when text;
  v_new_ev record;
  v_changes text[];
BEGIN
  IF NEW.band_id IS NULL OR NEW.event_date IS DISTINCT FROM OLD.event_date THEN
    RETURN NULL;
  END IF;
  -- Nobody hears about a draft, or a series already cancelled (Claude #297 r5).
  IF coalesce(NEW.status, '') IN ('draft', 'cancelled') THEN
    RETURN NULL;
  END IF;
  v_label := CASE WHEN v_kind = 'rehearsal' THEN 'Rehearsal' ELSE 'Gig' END;
  v_title := coalesce(nullif(NEW.title, ''), v_label);
  v_recipients := public.bw_event_recipient_ids(NEW.id, NEW.band_id, false);
  FOR v_day IN
    SELECT x::date FROM jsonb_array_elements_text(v_new) AS x
     WHERE x ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND NOT (v_old ? x) AND x::date >= current_date
     ORDER BY 1
  LOOP
    v_when := to_char(v_day, 'Dy DD Mon') || CASE WHEN NEW.start_time IS NOT NULL THEN ' · ' || to_char(NEW.start_time, 'HH24:MI') ELSE '' END;
    IF v_moved ~ '^[0-9a-f-]{36}$' THEN
      -- "Only this date": one notice for the new one-off, with everything
      -- that changed for that date (the edits came in the same step).
      SELECT id, title, event_date, start_time, end_time, venue_name, venue_address, venue_city
        INTO v_new_ev FROM public.events WHERE id = v_moved::uuid;
      v_changes := ARRAY['date'];
      IF v_new_ev.start_time IS DISTINCT FROM NEW.start_time OR v_new_ev.end_time IS DISTINCT FROM NEW.end_time THEN
        v_changes := v_changes || 'time'::text;
      END IF;
      IF v_new_ev.venue_name IS DISTINCT FROM NEW.venue_name OR v_new_ev.venue_address IS DISTINCT FROM NEW.venue_address
         OR v_new_ev.venue_city IS DISTINCT FROM NEW.venue_city THEN
        v_changes := v_changes || 'venue'::text;
      END IF;
      PERFORM public.bw_notify(v_recipients, NEW.band_id, 'event_update',
        v_label || ' updated',
        coalesce(nullif(v_new_ev.title, ''), v_title) || ' · ' || coalesce(to_char(v_new_ev.event_date, 'Dy DD Mon'), v_when)
          || CASE WHEN v_new_ev.start_time IS NOT NULL THEN ' · ' || to_char(v_new_ev.start_time, 'HH24:MI') ELSE '' END
          || ' — new ' || array_to_string(v_changes, ', ') || '.',
        jsonb_build_object('event_id', v_moved, 'event_type', v_kind, 'event_title', coalesce(nullif(v_new_ev.title, ''), v_title),
                           'changes', to_jsonb(v_changes), 'moved_from', to_char(v_day, 'YYYY-MM-DD'), 'series_id', NEW.id),
        v_moved::uuid, 'event');
    ELSE
      PERFORM public.bw_notify(v_recipients, NEW.band_id, 'event_cancelled',
        v_label || ' cancelled', v_title || ' · ' || v_when || ' has been cancelled.',
        jsonb_build_object('event_id', NEW.id, 'event_type', v_kind, 'event_title', v_title,
                           'event_date', to_char(v_day, 'YYYY-MM-DD'), 'occurrence_date', to_char(v_day, 'YYYY-MM-DD'), 'skipped', true),
        NEW.id, 'event');
    END IF;
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'bw_trg_events_skip_notice: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_events_skip_notice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bw_events_skip_notice ON public.events;
CREATE TRIGGER bw_events_skip_notice
  AFTER UPDATE OF recurrence_rule ON public.events
  FOR EACH ROW
  WHEN (NEW.recurrence_rule IS DISTINCT FROM OLD.recurrence_rule)
  EXECUTE FUNCTION public.bw_trg_events_skip_notice();

-- ── A deleted date back on ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bw_restore_rehearsal_date(p_event_id uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_band uuid;
  v_rule jsonb;
  v_skips jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  -- No date: refused, never "every date" (x <> NULL keeps nothing; Codex
  -- #297 M2). A string that is not a date never gets here (the date cast).
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'A date is needed' USING ERRCODE = '22023', HINT = 'bw:not_a_date';
  END IF;
  SELECT band_id, recurrence_rule INTO v_band, v_rule FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_band IS NULL OR NOT public.bw_is_band_admin(v_band) THEN
    RAISE EXCEPTION 'Only band admins can restore a rehearsal date' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_rule) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'This rehearsal does not repeat' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x), '[]'::jsonb)
    INTO v_skips
    FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(v_rule -> 'skip_dates') = 'array' THEN v_rule -> 'skip_dates' ELSE '[]'::jsonb END
         ) AS x
   WHERE x <> to_char(p_date, 'YYYY-MM-DD');
  -- Transaction-local: only this statement's trigger lets a date go.
  PERFORM set_config('bw.restore_skip', 'on', true);
  UPDATE public.events
     SET recurrence_rule = v_rule || jsonb_build_object('skip_dates', v_skips),
         updated_at = now()
   WHERE id = p_event_id;
  PERFORM set_config('bw.restore_skip', '', true);
  RETURN jsonb_build_object('event_id', p_event_id, 'skip_dates', v_skips);
END;
$$;

REVOKE ALL ON FUNCTION public.bw_restore_rehearsal_date(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_restore_rehearsal_date(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.bw_restore_rehearsal_date(uuid, date) IS
  'Put a deleted date of a repeating rehearsal back: the only way a date leaves recurrence_rule.skip_dates (bw_events_00_keep_skip_dates); admins of the band (195, Codex #297).';

-- ── Availability: a deleted date is free (Codex #297 M1) ────────────────
-- The date pickers' heatmap (bw_band_free_slots, 095) counted a series'
-- deleted first date as busy; only the demo left it out. 178 (#294)
-- redefines this function with the same rule, so 195 redefines it from 095
-- (the latest definition before it on main) only when the definition in
-- place does not read skip_dates yet: after 178 it is left as 178 wrote it.
-- Same signature, same columns, same grants.
DO $do$
DECLARE
  v_fn regprocedure := to_regprocedure('public.bw_band_free_slots(uuid,date,date,time,time,integer,uuid)');
BEGIN
  IF v_fn IS NULL OR position('skip_dates' IN pg_get_functiondef(v_fn)) = 0 THEN
    EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.bw_band_free_slots(
  p_band_id uuid,
  p_from date,
  p_to date,
  p_start time DEFAULT NULL,
  p_end time DEFAULT NULL,
  p_slot_minutes integer DEFAULT NULL,
  p_exclude_event uuid DEFAULT NULL
)
RETURNS TABLE (
  day date,
  slot_start time,
  free_count integer,
  total_count integer
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $body$
  WITH allowed AS (
    SELECT auth.uid() IS NOT NULL
       AND public.bw_is_band_member(p_band_id, auth.uid())
       AND p_from IS NOT NULL AND p_to IS NOT NULL
       AND p_to >= p_from
       AND p_to - p_from <= 62 AS ok
  ),
  members AS (
    SELECT DISTINCT bm.user_id
    FROM band_members bm, allowed a
    WHERE a.ok
      AND bm.band_id = p_band_id
      AND bm.user_id IS NOT NULL
      AND coalesce(bm.is_active, true)
      AND bm.left_at IS NULL
  ),
  days AS (
    SELECT d::date AS day
    FROM allowed a, generate_series(p_from, p_to, interval '1 day') d
    WHERE a.ok
  ),
  win AS (
    SELECT
      (extract(epoch FROM p_start) / 60)::int AS ws,
      CASE
        WHEN p_end IS NULL THEN NULL
        WHEN p_end <= p_start THEN (extract(epoch FROM p_end) / 60)::int + 1440
        ELSE (extract(epoch FROM p_end) / 60)::int
      END AS we
  ),
  slots AS (
    -- One row per day (whole window) or per slot inside the window.
    SELECT d.day,
           CASE WHEN w.ws IS NOT NULL AND w.we IS NOT NULL AND coalesce(p_slot_minutes, 0) >= 15
                THEN s.m ELSE w.ws END AS s_from,
           CASE WHEN w.ws IS NOT NULL AND w.we IS NOT NULL AND coalesce(p_slot_minutes, 0) >= 15
                THEN least(s.m + p_slot_minutes, w.we) ELSE w.we END AS s_to
    FROM days d
    CROSS JOIN win w
    CROSS JOIN LATERAL (
      SELECT generate_series(w.ws, w.we - 1, greatest(coalesce(p_slot_minutes, 0), 15)) AS m
      WHERE w.ws IS NOT NULL AND w.we IS NOT NULL AND coalesce(p_slot_minutes, 0) >= 15
      UNION ALL
      SELECT NULL::int
      WHERE NOT (w.ws IS NOT NULL AND w.we IS NOT NULL AND coalesce(p_slot_minutes, 0) >= 15)
    ) s
  ),
  busy_events AS (
    -- Every commitment of every member in the range, with its time span in minutes.
    SELECT x.user_id, x.event_date, x.e_from,
           CASE
             WHEN x.e_from IS NULL THEN NULL
             WHEN x.e_to IS NULL THEN x.e_from + 180
             WHEN x.e_to <= x.e_from THEN x.e_to + 1440
             ELSE x.e_to
           END AS e_to
    FROM (
      SELECT m.user_id,
             e.event_date,
             (extract(epoch FROM coalesce(e.start_time, e."time")) / 60)::int AS e_from,
             coalesce(
               (extract(epoch FROM e.end_time) / 60)::int,
               CASE WHEN e.duration_hours IS NOT NULL AND coalesce(e.start_time, e."time") IS NOT NULL
                    THEN (extract(epoch FROM coalesce(e.start_time, e."time")) / 60)::int + (e.duration_hours * 60)::int
               END
             ) AS e_to
      FROM members m
      JOIN events e
        ON e.event_date BETWEEN p_from AND p_to
       AND (p_exclude_event IS NULL OR e.id <> p_exclude_event)
       AND lower(coalesce(e.status, '')) NOT IN ('cancelled', 'canceled', 'quote', 'quoted')
       -- A date deleted from its series is free (Codex #297 M1).
       AND NOT (coalesce(e.recurrence_rule -> 'skip_dates', '[]'::jsonb) ? coalesce(to_char(e.event_date, 'YYYY-MM-DD'), ''))
       AND (
         EXISTS (
           SELECT 1 FROM event_members em
           WHERE em.event_id = e.id
             AND em.user_id = m.user_id
             AND lower(coalesce(em.status, '')) NOT IN ('declined', 'removed')
         )
         OR (e.band_id IS NULL AND e.created_by = m.user_id)
       )
    ) x
  ),
  busy AS (
    SELECT DISTINCT s.day, s.s_from, b.user_id
    FROM slots s
    JOIN busy_events b ON b.event_date = s.day
    WHERE s.s_from IS NULL
       OR b.e_from IS NULL
       OR (b.e_from < s.s_to AND s.s_from < b.e_to)
  )
  SELECT s.day,
         CASE WHEN s.s_from IS NULL THEN NULL
              ELSE make_time(((s.s_from / 60) % 24)::int, (s.s_from % 60)::int, 0) END AS slot_start,
         ((SELECT count(*) FROM members)
           - (SELECT count(*) FROM busy b WHERE b.day = s.day AND b.s_from IS NOT DISTINCT FROM s.s_from))::int AS free_count,
         (SELECT count(*) FROM members)::int AS total_count
  FROM slots s
  ORDER BY s.day, s.s_from NULLS FIRST;
$body$;
    $ddl$;
  END IF;
END
$do$;
REVOKE ALL ON FUNCTION public.bw_band_free_slots(uuid, date, date, time, time, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_band_free_slots(uuid, date, date, time, time, integer, uuid) TO authenticated;

COMMIT;
