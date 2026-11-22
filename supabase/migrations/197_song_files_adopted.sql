-- ============================================================================
-- 197: an accepted suggested song's files are the band's (audit 09 #5)
-- ----------------------------------------------------------------------------
-- 108 lets a member write in <band>/suggestions/<their id>/ (the files of a
-- song they suggest) and nowhere else. The folder stayed theirs after the
-- song was accepted: when an admin approved it from the song menu (Approve ·
-- learning, Mark as ready) only the status changed, and the member could
-- still replace or delete the recording or chart the band now uses.
--
-- Now a member's update / delete in their suggestions folder only applies to
-- files no accepted song uses: a song of the band whose status is no longer
-- 'suggested' and whose audio_url or chart_url points at the file. While the
-- song waits for review nothing changes for them (replace a file, withdraw
-- it). Admins keep every right in the band's folder. Upload (insert) is as
-- in 108. The app also moves accepted files into <band>/audio|chart/ (copy,
-- point the song at the copy, delete the original), from both review and the
-- song menu, and retries when an admin opens the repertoire.
--
-- bw_song_file_adopted(name): true only for a file of a band the caller is
-- an active member of (says nothing about other bands). Authenticated only.
-- Older builds keep working: same policies' names, same folders. Safe to run
-- more than once.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bw_song_file_adopted(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.songs s
     WHERE s.band_id::text = split_part(p_name, '/', 1)
       AND s.band_id::text = ANY (public.bw_my_band_ids())
       AND s.status IS DISTINCT FROM 'suggested'
       AND (s.audio_url = 'sb://song-files/' || p_name OR s.chart_url = 'sb://song-files/' || p_name)
  );
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_adopted(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_file_adopted(text) TO authenticated;

DROP POLICY IF EXISTS bw_song_files_write_update ON storage.objects;
CREATE POLICY bw_song_files_write_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'song-files'
    AND (
      (storage.foldername(name))[1] = ANY (public.bw_my_admin_band_ids())
      OR ((storage.foldername(name))[1] = ANY (public.bw_my_band_ids())
          AND (storage.foldername(name))[2] = 'suggestions'
          AND (storage.foldername(name))[3] = auth.uid()::text
          AND NOT public.bw_song_file_adopted(name))
    )
  );

DROP POLICY IF EXISTS bw_song_files_write_delete ON storage.objects;
CREATE POLICY bw_song_files_write_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'song-files'
    AND (
      (storage.foldername(name))[1] = ANY (public.bw_my_admin_band_ids())
      OR ((storage.foldername(name))[1] = ANY (public.bw_my_band_ids())
          AND (storage.foldername(name))[2] = 'suggestions'
          AND (storage.foldername(name))[3] = auth.uid()::text
          AND NOT public.bw_song_file_adopted(name))
    )
  );

COMMIT;
