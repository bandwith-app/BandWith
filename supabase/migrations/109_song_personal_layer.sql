-- ============================================================================
-- 109: a personal layer over band songs
-- ----------------------------------------------------------------------------
-- The band song (songs.lyrics, chord_chart, files) stays the same for
-- everyone. Each person can add, for themselves only:
--
--   song_personal_notes  a note on the whole song, a line, a word or a chord.
--                        anchor = {"type": "song" | "line" | "word" | "chord",
--                                  "line": <the line's words, chords removed>,
--                                  "occ": <which occurrence of that line, 0…>,
--                                  "word": <word index in the line>,
--                                  "chord": <chord name>}
--                        The line is found by its words, so it stays put when
--                        an admin edits chords or moves sections.
--   song_personal_files  their own recording or score for the song, stored in
--                        the private bucket personal-files under <their id>/.
--
-- Visible only to their author: RLS user_id = auth.uid() for every command,
-- with no admin exception (band admins don't see members' notes or files).
-- A row can only be added for a song of a band the person is in; when they
-- leave the band the rows stay theirs but the song is no longer readable.
--
-- Grants: authenticated gets SELECT, INSERT, UPDATE, DELETE on both tables;
-- anon nothing (101). Safe to run more than once.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------- notes --

CREATE TABLE IF NOT EXISTS public.song_personal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id uuid NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  anchor jsonb NOT NULL DEFAULT '{"type": "song"}'::jsonb,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT song_personal_notes_anchor_type CHECK (anchor ->> 'type' IN ('song', 'line', 'word', 'chord')),
  CONSTRAINT song_personal_notes_anchor_size CHECK (pg_column_size(anchor) <= 4000)
);

CREATE INDEX IF NOT EXISTS song_personal_notes_user_song_idx ON public.song_personal_notes (user_id, song_id);

-- ----------------------------------------------------------------- files --

CREATE TABLE IF NOT EXISTS public.song_personal_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  song_id uuid NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('audio', 'chart')),
  ref text NOT NULL CHECK (ref LIKE 'sb://personal-files/%'),
  size bigint CHECK (size IS NULL OR size >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The file must sit in the author's own folder.
  CONSTRAINT song_personal_files_own_folder CHECK (split_part(substr(ref, 21), '/', 1) = user_id::text)
);

CREATE INDEX IF NOT EXISTS song_personal_files_user_song_idx ON public.song_personal_files (user_id, song_id);

-- -------------------------------------------------------------- security --

ALTER TABLE public.song_personal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.song_personal_files ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.song_personal_notes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.song_personal_files FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.song_personal_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.song_personal_files TO authenticated;

-- A song of one of my bands.
CREATE OR REPLACE FUNCTION public.bw_song_in_my_bands(p_song uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.songs s WHERE s.id = p_song AND s.band_id::text = ANY (public.bw_my_band_ids()));
$$;
REVOKE ALL ON FUNCTION public.bw_song_in_my_bands(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_in_my_bands(uuid) TO authenticated;

DROP POLICY IF EXISTS song_personal_notes_own_select ON public.song_personal_notes;
DROP POLICY IF EXISTS song_personal_notes_own_insert ON public.song_personal_notes;
DROP POLICY IF EXISTS song_personal_notes_own_update ON public.song_personal_notes;
DROP POLICY IF EXISTS song_personal_notes_own_delete ON public.song_personal_notes;
CREATE POLICY song_personal_notes_own_select ON public.song_personal_notes
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY song_personal_notes_own_insert ON public.song_personal_notes
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.bw_song_in_my_bands(song_id));
CREATE POLICY song_personal_notes_own_update ON public.song_personal_notes
  FOR UPDATE TO authenticated USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.bw_song_in_my_bands(song_id));
CREATE POLICY song_personal_notes_own_delete ON public.song_personal_notes
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS song_personal_files_own_select ON public.song_personal_files;
DROP POLICY IF EXISTS song_personal_files_own_insert ON public.song_personal_files;
DROP POLICY IF EXISTS song_personal_files_own_update ON public.song_personal_files;
DROP POLICY IF EXISTS song_personal_files_own_delete ON public.song_personal_files;
CREATE POLICY song_personal_files_own_select ON public.song_personal_files
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY song_personal_files_own_insert ON public.song_personal_files
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND public.bw_song_in_my_bands(song_id));
CREATE POLICY song_personal_files_own_update ON public.song_personal_files
  FOR UPDATE TO authenticated USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.bw_song_in_my_bands(song_id));
CREATE POLICY song_personal_files_own_delete ON public.song_personal_files
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- updated_at on edit
CREATE OR REPLACE FUNCTION public.bw_trg_touch_personal_note()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.user_id := OLD.user_id;
  NEW.song_id := OLD.song_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS song_personal_notes_touch ON public.song_personal_notes;
CREATE TRIGGER song_personal_notes_touch BEFORE UPDATE ON public.song_personal_notes
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_touch_personal_note();

-- --------------------------------------------------------------- storage --

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'personal-files', 'personal-files', false, 52428800,
  ARRAY[
    'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/wav', 'audio/x-wav',
    'audio/wave', 'audio/aiff', 'audio/x-aiff', 'audio/ogg', 'audio/flac', 'audio/x-flac',
    'application/pdf', 'image/png', 'image/jpeg', 'image/heic', 'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- <user id>/<song id>/<file>: only the owner reads or writes.
DROP POLICY IF EXISTS bw_personal_files_own_select ON storage.objects;
DROP POLICY IF EXISTS bw_personal_files_own_insert ON storage.objects;
DROP POLICY IF EXISTS bw_personal_files_own_update ON storage.objects;
DROP POLICY IF EXISTS bw_personal_files_own_delete ON storage.objects;
CREATE POLICY bw_personal_files_own_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'personal-files' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY bw_personal_files_own_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'personal-files' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY bw_personal_files_own_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'personal-files' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'personal-files' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY bw_personal_files_own_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'personal-files' AND (storage.foldername(name))[1] = auth.uid()::text);

COMMIT;
