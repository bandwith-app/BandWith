-- 114 · Rehearsal poll room cost through an RPC (step 1 of 2).
--
-- 097 added rehearsal_polls.room_cost, the room's total cost, with no column
-- revoke: every band member could read the total, while the app shows them
-- only their share ("€12 each"). Members see only their own money; the
-- total stays with the admins.
--
-- Step 1 (this migration): bw_rehearsal_poll_costs() returns, for each poll
-- of a band the caller is an active member of:
--   room_cost   the total, to the band's active admins only (NULL otherwise);
--   cost_share  the per-person share, to every member who can see the poll;
--   share_count how many people the cost is split between: the invited
--               members (098) or, with no invite list, the band's active
--               members.
-- Nothing is revoked yet, so installed apps keep working.
--
-- Step 2 (119, once every installed app reads polls with explicit columns
-- and the cost through this function): revoke direct SELECT on room_cost.
--
-- Idempotent; safe to re-run on live data.

BEGIN;

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
      AND public.bw_is_band_member(rp.band_id)
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

COMMIT;
