-- Gear categories (127): "Speakers" and the band's own categories.
--
-- 006 limited inventory.category to Instruments, Cables, Stands, Microphones,
-- Cases, Lighting, Other. The app now offers Speakers and lets a band type
-- its own category ("Keys", "In-ear monitors"), stored as typed. The column
-- stays VARCHAR(50); the check now only asks for 1 to 40 visible characters
-- (the app's limit, src/lib/services/inventory.ts CUSTOM_CATEGORY_MAX).
-- Existing rows all pass (they hold the old values). RLS and grants are
-- unchanged: who may write a row is still decided by the inventory policies.

ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_category_check;

ALTER TABLE public.inventory
  ADD CONSTRAINT inventory_category_check
  CHECK (char_length(btrim(category)) BETWEEN 1 AND 40);
