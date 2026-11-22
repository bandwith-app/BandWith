-- ============================================================================
-- 172: who sings what (voice parts, plan "live offline & tempo" §5.2, C2)
-- ----------------------------------------------------------------------------
-- The parts themselves live in songs.lyrics as markers ({v2} {bv} {all} {sp},
-- src/lib/voiceParts.ts). These columns say which members sing them:
--
--   songs.vocal_parts          { "lead": [user ids], "v2": [...], "bv": [...], "sp": [...] }
--   setlist_songs.vocal_parts  the same, for one setlist (one gig: a deputy
--                              sings instead); null = the song's assignment.
--
-- "all" is everyone and is never assigned. The app reads only known parts
-- and uuids (parseVocalParts), so the shape is checked loosely here.
--
-- Access is today's, unchanged: band members read songs and setlist songs;
-- only admins write them (108 songs_admin_update, 074 setlist songs). The
-- explicit column grants keep the columns readable/writable even if a table
-- is moved to column grants later (as events were in 081).
-- Safe to apply before the app ships: nothing reads the columns until C2.
-- ============================================================================

BEGIN;

ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS vocal_parts jsonb;
ALTER TABLE public.setlist_songs ADD COLUMN IF NOT EXISTS vocal_parts jsonb;

ALTER TABLE public.songs DROP CONSTRAINT IF EXISTS songs_vocal_parts_shape;
ALTER TABLE public.songs
  ADD CONSTRAINT songs_vocal_parts_shape
  CHECK (vocal_parts IS NULL OR (jsonb_typeof(vocal_parts) = 'object' AND pg_column_size(vocal_parts) <= 16384));

ALTER TABLE public.setlist_songs DROP CONSTRAINT IF EXISTS setlist_songs_vocal_parts_shape;
ALTER TABLE public.setlist_songs
  ADD CONSTRAINT setlist_songs_vocal_parts_shape
  CHECK (vocal_parts IS NULL OR (jsonb_typeof(vocal_parts) = 'object' AND pg_column_size(vocal_parts) <= 16384));

COMMENT ON COLUMN public.songs.vocal_parts IS
  'Who sings which voice part: {"lead"|"v2"|"bv"|"sp": [user ids]} (172). Parts are marked in lyrics; see src/lib/voiceParts.ts.';
COMMENT ON COLUMN public.setlist_songs.vocal_parts IS
  'Per-setlist override of songs.vocal_parts for one gig (172); null = the song''s assignment.';

GRANT SELECT (vocal_parts), INSERT (vocal_parts), UPDATE (vocal_parts) ON public.songs TO authenticated;
GRANT SELECT (vocal_parts), INSERT (vocal_parts), UPDATE (vocal_parts) ON public.setlist_songs TO authenticated;

COMMIT;
