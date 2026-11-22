-- ============================================================================
-- 197: an accepted suggested song's files are the band's (audit 09 #5, #9)
-- ----------------------------------------------------------------------------
-- 108 lets a member write in <band>/suggestions/<their id>/ (the files of a
-- song they suggest) and nowhere else. The folder stayed theirs after the
-- song was accepted: when an admin approved it from the song menu (Approve ·
-- learning, Mark as ready) only the status changed, and the member could
-- still replace or delete the recording or chart the band now uses.
--
-- 1. Storage: a member's update / delete in their suggestions folder only
--    applies to files no accepted song uses (a song of the band whose status
--    is no longer 'suggested' and whose audio_url or chart_url is the file).
--    While the song waits for review nothing changes for them. Admins keep
--    every right in the band's folder; upload (insert) is as in 108.
--
-- 2. Moving the files (the app does the Storage part): copy, repoint, sweep.
--    Nothing here can leave a song on a missing file, whatever runs at once
--    (two admins, one admin on phone + iPad) or stops half-way:
--      bw_song_file_adopt_begin(song, field)
--        admin only, song row locked. When the song is past review and its
--        field is a suggestions-folder file: {won, from, to}. `to` is
--        <band>/<kind>/<song id>-<name>, unique per song (no collision with
--        another song's file, even one named the same on purpose). Another
--        admin's run of the last 2 minutes: {won: false, reason: 'busy'}.
--      bw_song_file_adopt_repoint(song, field, from, to)
--        song row locked (FOR UPDATE); repoints only if the field is still
--        `from`: {won, ref (current), to_referenced}. A won repoint records
--        `from` for the sweep, in the same transaction.
--      bw_song_file_sweep_list(band)
--        the recorded originals no song references any more (checked across
--        all songs).
--      bw_song_file_sweep_claim(band, path)
--        right before each delete, the record row locked: re-checks that no
--        song links the path, then marks it 'deleting' ({ok: true}); else
--        {ok: false, reason: 'referenced' | 'busy' | 'gone'} and the app
--        skips it. While a path is 'deleting' (or removed), a trigger on
--        songs refuses to link it (BW_FILE_REMOVED); its row lock makes a
--        link and a claim wait for each other, so one always sees the other.
--      bw_song_file_sweep_done(band, paths)
--        after the Storage delete: claimed rows marked 'cleaned'. A delete
--        that failed leaves the claim, which lapses after 10 minutes: the
--        path is pending again and the next sweep retries it.
--    song_file_adoptions: that record. No access for anon / authenticated
--    (RLS on, no grants): only these functions (and the service role).
--
-- Older builds keep working: same policies' names and folders, no existing
-- function changed (their move + update still works for admins). Safe to run
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

-- ------------------------------------------------- moving accepted files --

CREATE TABLE IF NOT EXISTS public.song_file_adoptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id uuid NOT NULL,
  song_id uuid NOT NULL,
  field text NOT NULL CHECK (field IN ('audio_url', 'chart_url')),
  from_path text NOT NULL,
  to_path text,
  state text NOT NULL DEFAULT 'copying',
  claimed_by uuid,
  claimed_at timestamptz,
  deleting_by uuid,
  deleting_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (song_id, field, from_path)
);
ALTER TABLE public.song_file_adoptions ADD COLUMN IF NOT EXISTS deleting_by uuid;
ALTER TABLE public.song_file_adoptions ADD COLUMN IF NOT EXISTS deleting_at timestamptz;
ALTER TABLE public.song_file_adoptions DROP CONSTRAINT IF EXISTS song_file_adoptions_state_check;
ALTER TABLE public.song_file_adoptions ADD CONSTRAINT song_file_adoptions_state_check
  CHECK (state IN ('copying', 'repointed', 'deleting', 'cleaned'));
CREATE INDEX IF NOT EXISTS song_file_adoptions_sweep_idx ON public.song_file_adoptions (band_id, state);
CREATE INDEX IF NOT EXISTS song_file_adoptions_path_idx ON public.song_file_adoptions (from_path);
ALTER TABLE public.song_file_adoptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.song_file_adoptions FROM PUBLIC, anon, authenticated;

-- 'sb://song-files/' || path, the reference songs store.
CREATE OR REPLACE FUNCTION public.bw_song_file_ref(p_path text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT 'sb://song-files/' || p_path;
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_ref(text) FROM PUBLIC, anon, authenticated;

-- Any song (of any band) links to this file.
CREATE OR REPLACE FUNCTION public.bw_song_file_in_use(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.songs s
                  WHERE s.audio_url = public.bw_song_file_ref(p_path) OR s.chart_url = public.bw_song_file_ref(p_path));
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_in_use(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bw_song_file_adopt_begin(p_song_id uuid, p_field text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  s record;
  a record;
  v_ref text;
  v_from text;
  v_parts text[];
  v_to text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_field IS NULL OR p_field NOT IN ('audio_url', 'chart_url') THEN
    RAISE EXCEPTION 'Unknown field' USING ERRCODE = '22023';
  END IF;
  SELECT id, band_id, status, audio_url, chart_url INTO s FROM public.songs WHERE id = p_song_id FOR UPDATE;
  IF s.id IS NULL OR NOT public.bw_is_band_admin(s.band_id, v_uid) THEN
    RAISE EXCEPTION 'Only band admins can move song files' USING ERRCODE = '42501';
  END IF;
  IF s.status IS NOT DISTINCT FROM 'suggested' THEN
    RETURN jsonb_build_object('won', false, 'reason', 'waiting');
  END IF;
  v_ref := CASE p_field WHEN 'audio_url' THEN s.audio_url ELSE s.chart_url END;
  IF v_ref IS NULL OR left(v_ref, length(public.bw_song_file_ref(s.band_id::text || '/suggestions/')))
                      <> public.bw_song_file_ref(s.band_id::text || '/suggestions/') THEN
    RETURN jsonb_build_object('won', false, 'reason', 'nothing', 'ref', v_ref);
  END IF;
  v_from := substr(v_ref, length(public.bw_song_file_ref('')) + 1);
  v_parts := string_to_array(v_from, '/');
  IF array_length(v_parts, 1) <> 5 OR v_parts[4] NOT IN ('audio', 'chart') OR coalesce(v_parts[5], '') = '' THEN
    RETURN jsonb_build_object('won', false, 'reason', 'nothing', 'ref', v_ref);
  END IF;
  v_to := v_parts[1] || '/' || v_parts[4] || '/' || s.id::text || '-' || v_parts[5];

  SELECT * INTO a FROM public.song_file_adoptions
   WHERE song_id = s.id AND field = p_field AND from_path = v_from FOR UPDATE;
  IF a.id IS NOT NULL AND a.state = 'copying' AND a.claimed_by IS DISTINCT FROM v_uid
     AND a.claimed_at > now() - interval '2 minutes' THEN
    RETURN jsonb_build_object('won', false, 'reason', 'busy');
  END IF;
  INSERT INTO public.song_file_adoptions (band_id, song_id, field, from_path, to_path, state, claimed_by, claimed_at, updated_at)
  VALUES (s.band_id, s.id, p_field, v_from, v_to, 'copying', v_uid, now(), now())
  ON CONFLICT (song_id, field, from_path) DO UPDATE
    SET to_path = EXCLUDED.to_path, state = 'copying', claimed_by = v_uid, claimed_at = now(), updated_at = now();
  RETURN jsonb_build_object('won', true, 'from', v_from, 'to', v_to);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_adopt_begin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_file_adopt_begin(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.bw_song_file_adopt_repoint(p_song_id uuid, p_field text, p_from text, p_to text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  s record;
  v_ref text;
  v_parts text[];
  v_prefix text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_field IS NULL OR p_field NOT IN ('audio_url', 'chart_url') THEN
    RAISE EXCEPTION 'Unknown field' USING ERRCODE = '22023';
  END IF;
  SELECT id, band_id, audio_url, chart_url INTO s FROM public.songs WHERE id = p_song_id FOR UPDATE;
  IF s.id IS NULL OR NOT public.bw_is_band_admin(s.band_id, v_uid) THEN
    RAISE EXCEPTION 'Only band admins can move song files' USING ERRCODE = '42501';
  END IF;
  -- From: a file of this band's suggestions folders. To: this song's own name in the band's folder.
  v_parts := string_to_array(coalesce(p_from, ''), '/');
  IF array_length(v_parts, 1) <> 5 OR v_parts[1] <> s.band_id::text OR v_parts[2] <> 'suggestions'
     OR v_parts[4] NOT IN ('audio', 'chart') OR coalesce(v_parts[5], '') = '' THEN
    RAISE EXCEPTION 'Bad source' USING ERRCODE = '22023';
  END IF;
  v_prefix := s.band_id::text || '/' || v_parts[4] || '/' || s.id::text || '-';
  IF p_to IS NULL OR left(p_to, length(v_prefix)) <> v_prefix OR length(p_to) = length(v_prefix)
     OR position('/' IN substr(p_to, length(v_prefix) + 1)) > 0 OR length(p_to) > 400 THEN
    RAISE EXCEPTION 'Bad destination' USING ERRCODE = '22023';
  END IF;

  v_ref := CASE p_field WHEN 'audio_url' THEN s.audio_url ELSE s.chart_url END;
  IF v_ref IS DISTINCT FROM public.bw_song_file_ref(p_from) THEN
    -- Changed meanwhile (another run won, or an admin edited the song): nothing written.
    UPDATE public.song_file_adoptions SET claimed_by = NULL, updated_at = now()
     WHERE song_id = s.id AND field = p_field AND from_path = p_from AND claimed_by = v_uid AND state = 'copying';
    RETURN jsonb_build_object('won', false, 'ref', v_ref, 'to_referenced', public.bw_song_file_in_use(p_to));
  END IF;

  UPDATE public.songs SET
    audio_url = CASE WHEN p_field = 'audio_url' THEN public.bw_song_file_ref(p_to) ELSE audio_url END,
    chart_url = CASE WHEN p_field = 'chart_url' THEN public.bw_song_file_ref(p_to) ELSE chart_url END
   WHERE id = s.id;
  -- The original, recorded for the sweep in the same transaction.
  INSERT INTO public.song_file_adoptions (band_id, song_id, field, from_path, to_path, state, updated_at)
  VALUES (s.band_id, s.id, p_field, p_from, p_to, 'repointed', now())
  ON CONFLICT (song_id, field, from_path) DO UPDATE
    SET to_path = EXCLUDED.to_path, state = 'repointed', claimed_by = NULL, updated_at = now();
  RETURN jsonb_build_object('won', true, 'ref', public.bw_song_file_ref(p_to), 'to_referenced', true);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_adopt_repoint(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_file_adopt_repoint(uuid, text, text, text) TO authenticated;

-- Originals of moved files that no song links to any more: safe to delete.
CREATE OR REPLACE FUNCTION public.bw_song_file_sweep_list(p_band_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.bw_is_band_admin(p_band_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only band admins can move song files' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT array_agg(DISTINCT a.from_path ORDER BY a.from_path)
      FROM public.song_file_adoptions a
     WHERE a.band_id = p_band_id
       AND (a.state = 'repointed' OR (a.state = 'deleting' AND a.deleting_at < now() - interval '10 minutes'))
       AND a.from_path LIKE p_band_id::text || '/suggestions/%'
       AND NOT public.bw_song_file_in_use(a.from_path)), '{}'::text[]);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_sweep_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_file_sweep_list(uuid) TO authenticated;

-- Right before deleting one original: under the record's row lock, no song
-- may link it; then it is 'deleting' (a lapsed claim, 10 minutes, counts as
-- pending again).
CREATE OR REPLACE FUNCTION public.bw_song_file_sweep_claim(p_band_id uuid, p_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.bw_is_band_admin(p_band_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only band admins can move song files' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO a FROM public.song_file_adoptions
   WHERE band_id = p_band_id AND from_path = p_path AND state IN ('repointed', 'deleting')
     AND from_path LIKE p_band_id::text || '/suggestions/%'
   ORDER BY updated_at DESC LIMIT 1
   FOR UPDATE;
  IF a.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'gone');
  END IF;
  IF a.state = 'deleting' AND a.deleting_at >= now() - interval '10 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'busy');
  END IF;
  -- A new statement: it sees every link committed before this lock was taken.
  IF public.bw_song_file_in_use(p_path) THEN
    UPDATE public.song_file_adoptions SET state = 'repointed', deleting_by = NULL, deleting_at = NULL, updated_at = now()
     WHERE id = a.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'referenced');
  END IF;
  UPDATE public.song_file_adoptions SET state = 'deleting', deleting_by = auth.uid(), deleting_at = now(), updated_at = now()
   WHERE id = a.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_sweep_claim(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_file_sweep_claim(uuid, text) TO authenticated;

-- After the Storage delete: the claimed rows are done.
CREATE OR REPLACE FUNCTION public.bw_song_file_sweep_done(p_band_id uuid, p_paths text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.bw_is_band_admin(p_band_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only band admins can move song files' USING ERRCODE = '42501';
  END IF;
  UPDATE public.song_file_adoptions SET state = 'cleaned', updated_at = now()
   WHERE band_id = p_band_id AND state = 'deleting' AND from_path = ANY (coalesce(p_paths, '{}'::text[]));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_song_file_sweep_done(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_song_file_sweep_done(uuid, text[]) TO authenticated;

-- No song links a file being deleted (or already removed). The FOR SHARE
-- lock waits for a claim in progress, and a claim waits for this.
-- Older builds never link these paths: they only upload new files and keep
-- the ones a song has (an unchanged field is not checked).
CREATE OR REPLACE FUNCTION public.bw_trg_song_file_not_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ref text;
  v_path text;
  v_state text;
BEGIN
  FOREACH v_ref IN ARRAY ARRAY[NEW.audio_url, NEW.chart_url] LOOP
    CONTINUE WHEN v_ref IS NULL OR v_ref NOT LIKE 'sb://song-files/%/suggestions/%';
    IF TG_OP = 'UPDATE' AND (v_ref IS NOT DISTINCT FROM OLD.audio_url OR v_ref IS NOT DISTINCT FROM OLD.chart_url) THEN
      CONTINUE;
    END IF;
    v_path := substr(v_ref, length('sb://song-files/') + 1);
    FOR v_state IN
      SELECT state FROM public.song_file_adoptions WHERE from_path = v_path AND state IN ('repointed', 'deleting', 'cleaned') FOR SHARE
    LOOP
      IF v_state IN ('deleting', 'cleaned') THEN
        RAISE EXCEPTION 'BW_FILE_REMOVED: this file was moved into the band''s songs; upload it again'
          USING ERRCODE = '55000';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.bw_trg_song_file_not_removed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS songs_file_not_removed ON public.songs;
CREATE TRIGGER songs_file_not_removed
  BEFORE INSERT OR UPDATE OF audio_url, chart_url ON public.songs
  FOR EACH ROW EXECUTE FUNCTION public.bw_trg_song_file_not_removed();

-- ------------------------------------------------------------ storage RLS --

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
