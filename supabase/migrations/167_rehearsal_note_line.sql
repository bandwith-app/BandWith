-- 167: a rehearsal note on a precise point of a song (notes made clear, D).
-- Any note can already say where in the song (section); now it can also name
-- one line of it ("Lanterns in the rain"). Optional, short, plain text.
-- The app sends `line` only when there is one, so it keeps saving before
-- this is applied; it reads `line` once this is live (apply before deploy).

BEGIN;

ALTER TABLE public.rehearsal_notes
  ADD COLUMN IF NOT EXISTS line text CHECK (line IS NULL OR char_length(line) <= 200);

COMMENT ON COLUMN public.rehearsal_notes.line IS
  'One line of the section, chords removed (167). The point of the song the note is about.';

-- 132 grants by column: a new readable/writable column needs its own grant.
GRANT SELECT (line), INSERT (line), UPDATE (line) ON public.rehearsal_notes TO authenticated;

COMMIT;
