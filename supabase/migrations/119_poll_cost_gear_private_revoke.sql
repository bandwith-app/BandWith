-- 119 · Poll room cost and gear purchase data: no direct read (step 2 of 2).
--
-- Apply only once every installed app reads rehearsal_polls with
-- POLL_COLUMNS and the cost through bw_rehearsal_poll_costs() (114), and
-- inventory with INVENTORY_COLUMNS and the purchase data through
-- bw_inventory_private() (115). An older app that still asks for select('*')
-- (or insert/update ... select()) on these tables would get
-- "permission denied": its rehearsal polls and gear list would not load.
--
-- Like events in 081: SELECT on every column except the private ones. New
-- columns on these tables must be added to these GRANTs if members may read
-- them. Writes are unchanged (RLS: poll admins; gear admins / owners).

BEGIN;

REVOKE SELECT ON public.rehearsal_polls FROM anon, authenticated;
GRANT SELECT (id, band_id, created_by, creator_role, title, notes, status, confirmed_event_id, created_at, updated_at, vote_by, location, focus_song_ids, invited_user_ids, vote_by_time)
  ON public.rehearsal_polls TO authenticated;

REVOKE SELECT ON public.inventory FROM anon, authenticated;
GRANT SELECT (id, band_id, name, category, quantity, status, location, notes, created_at, updated_at, owner_id)
  ON public.inventory TO authenticated;

COMMIT;
