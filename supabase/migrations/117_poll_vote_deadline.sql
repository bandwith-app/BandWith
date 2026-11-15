-- 117 · Rehearsal poll: no votes after the vote-by deadline.
--
-- vote_by (058) and vote_by_time (098) were shown to members ("Vote by Fri
-- 11 Dec, 18:00") but nothing stopped a vote after that. Now the database
-- refuses adding or removing a vote, and adding or removing a "None of these
-- work" answer (102), once the deadline has passed. The app shows the poll as
-- closed for voting; admins can still lock in a date.
--
-- The deadline is vote_by at vote_by_time (end of that day without a time),
-- in the poll creator's time zone (profiles.timezone). Without a valid time
-- zone it is read in the latest time zone on Earth (UTC-12), so no vote is
-- ever refused before the deadline has passed for the band.
--
-- The vote and "none work" policies are the live ones (073 / 098 / 102)
-- plus the deadline; their band check now uses bw_is_band_member (active
-- members only), like the other helpers.
--
-- Idempotent; safe to re-run on live data.

BEGIN;

-- When voting closes, or NULL when the poll has no vote-by date.
CREATE OR REPLACE FUNCTION public.bw_poll_vote_deadline(p_poll_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_by date;
  v_time time;
  v_tz text;
  v_local timestamp;
BEGIN
  SELECT rp.vote_by, rp.vote_by_time, nullif(trim(p.timezone), '')
    INTO v_by, v_time, v_tz
  FROM rehearsal_polls rp
  LEFT JOIN profiles p ON p.id = rp.created_by
  WHERE rp.id = p_poll_id;
  IF v_by IS NULL THEN
    RETURN NULL;
  END IF;
  v_local := v_by + coalesce(v_time, time '23:59:59');
  IF v_tz IS NOT NULL THEN
    BEGIN
      RETURN v_local AT TIME ZONE v_tz;
    EXCEPTION WHEN invalid_parameter_value OR data_exception THEN
      NULL; -- unknown zone name: fall through
    END;
  END IF;
  RETURN v_local AT TIME ZONE 'Etc/GMT+12';
END;
$$;

-- Votes can still change: the deadline (if any) has not passed.
CREATE OR REPLACE FUNCTION public.bw_poll_voting_open(p_poll_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(now() <= public.bw_poll_vote_deadline(p_poll_id), true);
$$;

REVOKE ALL ON FUNCTION public.bw_poll_vote_deadline(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bw_poll_voting_open(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_poll_vote_deadline(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bw_poll_voting_open(uuid) TO authenticated;

-- ── rehearsal_poll_votes ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "users_can_insert_own_vote" ON public.rehearsal_poll_votes;
CREATE POLICY "users_can_insert_own_vote" ON public.rehearsal_poll_votes
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.rehearsal_polls rp
      WHERE rp.id = rehearsal_poll_votes.poll_id
        AND public.bw_is_band_member(rp.band_id)
        AND rp.status = 'polling'
        AND (cardinality(rp.invited_user_ids) = 0 OR auth.uid() = ANY (rp.invited_user_ids))
        AND public.bw_poll_voting_open(rp.id)
    )
  );

DROP POLICY IF EXISTS "users_can_delete_own_vote" ON public.rehearsal_poll_votes;
CREATE POLICY "users_can_delete_own_vote" ON public.rehearsal_poll_votes
  AS PERMISSIVE FOR DELETE TO public
  USING (auth.uid() = user_id AND public.bw_poll_voting_open(poll_id));

-- ── rehearsal_poll_unavailable ("None of these work", 102) ───────────────
DROP POLICY IF EXISTS "users_can_insert_own_unavailable" ON public.rehearsal_poll_unavailable;
CREATE POLICY "users_can_insert_own_unavailable" ON public.rehearsal_poll_unavailable
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.rehearsal_polls rp
      WHERE rp.id = rehearsal_poll_unavailable.poll_id
        AND public.bw_is_band_member(rp.band_id)
        AND rp.status = 'polling'
        AND (cardinality(rp.invited_user_ids) = 0 OR auth.uid() = ANY (rp.invited_user_ids))
        AND public.bw_poll_voting_open(rp.id)
    )
  );

DROP POLICY IF EXISTS "users_can_delete_own_unavailable" ON public.rehearsal_poll_unavailable;
CREATE POLICY "users_can_delete_own_unavailable" ON public.rehearsal_poll_unavailable
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.bw_poll_voting_open(poll_id));

COMMIT;
