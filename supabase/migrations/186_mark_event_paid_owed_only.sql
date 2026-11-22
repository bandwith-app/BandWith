-- ====================================================================
-- 186: "Mark all as paid" pays only who is owed (audit of 383f15b,
--      events #9, money & documents #11)
--
-- Home and Analytics list as owed only the musicians who confirmed and
-- have a fee above 0 (src/lib/payoutsDue.ts). bw_mark_event_paid (071)
-- stamped paid_at on every row not declined: a musician still pending,
-- or with no fee, got a payment the admin never saw listed, and once
-- they confirmed Home no longer showed their fee as owed. Now the same
-- rule as the list: confirmed, a fee above 0, not paid yet. The others
-- keep paid_at empty; the admin can still mark one by one (093).
--
-- Same signature and return: old builds get the fix too. Safe to run
-- more than once.
-- ====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bw_mark_event_paid(p_event_id uuid)
RETURNS TABLE (user_id uuid, paid_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.bw_can_manage_event(p_event_id) THEN
    RAISE EXCEPTION 'Only band admins can mark payouts' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    UPDATE event_members em
       SET paid_at = now()
     WHERE em.event_id = p_event_id
       AND em.paid_at IS NULL
       -- 186: who is owed, as payoutsDue lists them.
       AND lower(COALESCE(em.status, '')) = 'confirmed'
       AND COALESCE(em.fee, 0) > 0
    RETURNING em.user_id, em.paid_at;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bw_mark_event_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_mark_event_paid(uuid) TO authenticated;

COMMIT;
