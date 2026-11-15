-- 112 · rehearsal_setlist: members read, admins write.
--
-- 073 exported "Band members can manage rehearsal setlist" as FOR ALL to any
-- band member (also inactive ones). Setlists became admin-only to edit in 074;
-- the rehearsal setlist table was left behind, so a member could still add,
-- change or delete its rows directly against the database.
--
-- After this migration, like setlists (074) and rehearsal tasks (071):
--   read                  whoever can see the rehearsal (bw_can_view_event)
--   create/edit/delete    whoever manages it: an active admin of its band
--                         (bw_can_manage_event)
-- The current app does not write this table (only the demo seed has rows).
--
-- Idempotent; safe to re-run on live data.

BEGIN;

DROP POLICY IF EXISTS "Band members can manage rehearsal setlist" ON public.rehearsal_setlist;

DROP POLICY IF EXISTS rehearsal_setlist_select ON public.rehearsal_setlist;
CREATE POLICY rehearsal_setlist_select ON public.rehearsal_setlist
  FOR SELECT TO authenticated
  USING (public.bw_can_view_event(event_id));

DROP POLICY IF EXISTS rehearsal_setlist_insert ON public.rehearsal_setlist;
CREATE POLICY rehearsal_setlist_insert ON public.rehearsal_setlist
  FOR INSERT TO authenticated
  WITH CHECK (public.bw_can_manage_event(event_id));

DROP POLICY IF EXISTS rehearsal_setlist_update ON public.rehearsal_setlist;
CREATE POLICY rehearsal_setlist_update ON public.rehearsal_setlist
  FOR UPDATE TO authenticated
  USING (public.bw_can_manage_event(event_id))
  WITH CHECK (public.bw_can_manage_event(event_id));

DROP POLICY IF EXISTS rehearsal_setlist_delete ON public.rehearsal_setlist;
CREATE POLICY rehearsal_setlist_delete ON public.rehearsal_setlist
  FOR DELETE TO authenticated
  USING (public.bw_can_manage_event(event_id));

COMMIT;
