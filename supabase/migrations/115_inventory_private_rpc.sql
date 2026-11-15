-- 115 · Gear purchase price, purchase date and serial number through an RPC
-- (step 1 of 2).
--
-- inventory has no column grant: every member of a band could read the
-- purchase price, purchase date and serial number of all the band's gear
-- and of everyone's personal gear (110). Prices are band money (admins
-- only); a member's own personal gear is theirs.
--
-- Step 1 (this migration): bw_inventory_private() returns those three
-- columns for a band's items to
--   * the band's active admins: every item;
--   * an active member: only their own personal gear (owner_id = them).
-- The same people can edit those items (the 006 / 110 policies), so the edit
-- sheet keeps everything it needs. Nothing is revoked yet, so installed apps
-- keep working.
--
-- Step 2 (119, once every installed app reads inventory with explicit
-- columns and these fields through this function): revoke direct SELECT on
-- the three columns.
--
-- Idempotent; safe to re-run on live data.

BEGIN;

CREATE OR REPLACE FUNCTION public.bw_inventory_private(p_band_id uuid)
RETURNS TABLE (inventory_id uuid, serial_number text, purchase_date date, purchase_price numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT i.id, i.serial_number::text, i.purchase_date, i.purchase_price
  FROM inventory i
  WHERE auth.uid() IS NOT NULL
    AND i.band_id = p_band_id
    AND public.bw_is_band_member(i.band_id)
    AND (public.bw_is_band_admin(i.band_id) OR i.owner_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.bw_inventory_private(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_inventory_private(uuid) TO authenticated;

COMMIT;
