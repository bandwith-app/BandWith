-- Personal gear (2026-11-14): a member can add their own equipment to the
-- band's gear list, marked as theirs. Only they (and the band's admins, whose
-- policies are unchanged) can change or delete it; the whole band sees it.
-- owner_id NULL = the band's gear, managed by admins only, as before.

ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inventory_owner_id_idx ON public.inventory (owner_id) WHERE owner_id IS NOT NULL;

DROP POLICY IF EXISTS "Members can add their own gear" ON public.inventory;
CREATE POLICY "Members can add their own gear" ON public.inventory
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.band_members bm
      WHERE bm.band_id = inventory.band_id AND bm.user_id = auth.uid() AND bm.is_active = true
    )
  );

DROP POLICY IF EXISTS "Members can update their own gear" ON public.inventory;
CREATE POLICY "Members can update their own gear" ON public.inventory
  FOR UPDATE TO authenticated
  USING (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.band_members bm
      WHERE bm.band_id = inventory.band_id AND bm.user_id = auth.uid() AND bm.is_active = true
    )
  )
  -- Stays theirs and in the same band (band_id can't be moved to another band).
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.band_members bm
      WHERE bm.band_id = inventory.band_id AND bm.user_id = auth.uid() AND bm.is_active = true
    )
  );

DROP POLICY IF EXISTS "Members can delete their own gear" ON public.inventory;
CREATE POLICY "Members can delete their own gear" ON public.inventory
  FOR DELETE TO authenticated
  USING (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.band_members bm
      WHERE bm.band_id = inventory.band_id AND bm.user_id = auth.uid() AND bm.is_active = true
    )
  );
