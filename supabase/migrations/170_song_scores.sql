-- 170: song scores (sheet music plan, docs/plans/sheet-music.md §4.1).
--
--   songs.score_path    the song's score: a MusicXML / .mxl file in the
--                       private song-files bucket, stored as a reference
--                       `sb://song-files/<band>/score/<id>-<name>` (a member's
--                       for a song they suggest: `<band>/suggestions/<them>/score/…`),
--                       like chart_url and audio_url. NULL = no score.
--   song-files bucket   also takes the two MusicXML types the app uploads
--                       with: application/vnd.recordare.musicxml+xml
--                       (.musicxml / .xml) and application/vnd.recordare.musicxml (.mxl).
--                       Appended to the list (nothing else changes).
--   songs_member_suggest  a member's suggested song may carry a score only
--                       from their own suggestions folder (as audio and chart, 108).
--   bw_review_song_suggestion / bw_withdraw_song_suggestion
--                       a rejected or withdrawn suggested song returns its
--                       score too, so the app removes the file (as audio and
--                       chart). Bodies copied from 108 with score_path added:
--                       before applying, diff them against the live
--                       pg_get_functiondef (no later migration redefines them).
--
-- The readable column's grant is its own migration (171).
-- Dry run: strip this file's BEGIN; / COMMIT; and run it inside a
-- transaction that is rolled back (forced abort), then check that nothing
-- of it is left (score_path absent, bucket types unchanged).
--
-- Rollback (only before any score is stored):
--   ALTER TABLE public.songs DROP COLUMN IF EXISTS score_path;
--   UPDATE storage.buckets SET allowed_mime_types = array_remove(array_remove(allowed_mime_types,
--     'application/vnd.recordare.musicxml+xml'), 'application/vnd.recordare.musicxml') WHERE id = 'song-files';
--   then re-run the policy and the two functions from 108.

BEGIN;

-- ---------------------------------------------------------------- column --

ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS score_path text;
COMMENT ON COLUMN public.songs.score_path IS
  'The song''s score (MusicXML / .mxl in song-files): sb://song-files/<band>/score/<file>. NULL = none.';

-- Only references into song-files or nothing: never a link to elsewhere.
ALTER TABLE public.songs DROP CONSTRAINT IF EXISTS songs_score_path_ref;
ALTER TABLE public.songs ADD CONSTRAINT songs_score_path_ref
  CHECK (score_path IS NULL OR (score_path LIKE 'sb://song-files/%' AND char_length(score_path) <= 400));

-- ---------------------------------------------------------------- bucket --

UPDATE storage.buckets
   SET allowed_mime_types = (
     SELECT array_agg(t ORDER BY ord)
       FROM (
         SELECT t, min(ord) AS ord
           FROM unnest(coalesce(allowed_mime_types, '{}') ||
                       ARRAY['application/vnd.recordare.musicxml+xml', 'application/vnd.recordare.musicxml'])
                WITH ORDINALITY AS u(t, ord)
          GROUP BY t
       ) d
   )
 WHERE id = 'song-files';

-- ------------------------------------------------- member suggestions (108) --

DROP POLICY IF EXISTS songs_member_suggest ON public.songs;
CREATE POLICY songs_member_suggest ON public.songs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.bw_is_band_member(band_id)
    AND status = 'suggested'
    AND added_by = auth.uid()
    AND coalesce(times_played, 0) = 0
    AND last_played_at IS NULL
    -- Files only from the member's own suggestions folder.
    AND (audio_url IS NULL OR audio_url NOT LIKE 'sb://song-files/%'
         OR audio_url LIKE 'sb://song-files/' || band_id::text || '/suggestions/' || auth.uid()::text || '/%')
    AND (chart_url IS NULL OR chart_url NOT LIKE 'sb://song-files/%'
         OR chart_url LIKE 'sb://song-files/' || band_id::text || '/suggestions/' || auth.uid()::text || '/%')
    AND (score_path IS NULL
         OR score_path LIKE 'sb://song-files/' || band_id::text || '/suggestions/' || auth.uid()::text || '/%')
  );

-- ------------------------------------------------ rejected / withdrawn files --

CREATE OR REPLACE FUNCTION public.bw_review_song_suggestion(
  p_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL,
  p_applied jsonb DEFAULT NULL,
  p_edited boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  g record;
  s record;
  v_status text;
  v_apply jsonb := '{}'::jsonb;
  v_fields text[] := '{}';
  v_files jsonb := '[]'::jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO g FROM public.song_suggestions WHERE id = p_id FOR UPDATE;
  IF g.id IS NULL OR NOT public.bw_is_band_admin(g.band_id) THEN
    RAISE EXCEPTION 'Only band admins can review suggestions' USING ERRCODE = '42501';
  END IF;
  IF g.status <> 'pending' THEN
    RAISE EXCEPTION 'This suggestion was already reviewed' USING ERRCODE = '55000';
  END IF;
  IF p_decision NOT IN ('accept', 'reject') THEN
    RAISE EXCEPTION 'Unknown decision' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(v_reason, '')) > 1000 THEN
    RAISE EXCEPTION 'Reason too long' USING ERRCODE = '22001';
  END IF;
  SELECT id, status, notes, audio_url, chart_url, score_path INTO s FROM public.songs WHERE id = g.song_id;

  IF p_decision = 'reject' THEN
    v_status := 'rejected';
    UPDATE public.song_suggestions
       SET status = v_status, reason = v_reason, reviewed_by = v_uid, reviewed_at = now()
     WHERE id = g.id;
    IF g.kind = 'new_song' AND s.id IS NOT NULL AND s.status = 'suggested' THEN
      v_files := to_jsonb(array_remove(ARRAY[s.audio_url, s.chart_url, s.score_path], NULL));
      DELETE FROM public.songs WHERE id = s.id;
    END IF;
  ELSE
    IF s.id IS NULL THEN
      RAISE EXCEPTION 'The song no longer exists' USING ERRCODE = '55000';
    END IF;
    v_status := CASE WHEN p_edited THEN 'accepted_edited' ELSE 'accepted' END;
    IF g.kind IN ('lyrics', 'chords') THEN
      v_apply := coalesce(p_applied, g.proposed);
      IF v_apply ? 'lyrics' AND jsonb_typeof(v_apply -> 'lyrics') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'Bad lyrics' USING ERRCODE = '22023';
      END IF;
      IF v_apply ? 'chord_chart' AND jsonb_typeof(v_apply -> 'chord_chart') NOT IN ('object', 'null') THEN
        RAISE EXCEPTION 'Bad chord chart' USING ERRCODE = '22023';
      END IF;
      v_apply := (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
                    FROM jsonb_each(v_apply) WHERE key IN ('lyrics', 'chord_chart'));
    ELSIF g.kind = 'note' THEN
      IF p_applied IS NOT NULL AND p_applied ? 'notes' THEN
        IF jsonb_typeof(p_applied -> 'notes') NOT IN ('string', 'null') THEN
          RAISE EXCEPTION 'Bad notes' USING ERRCODE = '22023';
        END IF;
        v_apply := jsonb_build_object('notes', p_applied -> 'notes');
      ELSE
        v_apply := jsonb_build_object('notes',
          CASE WHEN nullif(btrim(coalesce(s.notes, '')), '') IS NULL THEN g.proposed ->> 'note'
               ELSE rtrim(s.notes) || E'\n\n' || (g.proposed ->> 'note') END);
      END IF;
    END IF;

    UPDATE public.song_suggestions
       SET status = v_status, reason = v_reason, applied = CASE WHEN g.kind = 'new_song' THEN NULL ELSE v_apply END,
           reviewed_by = v_uid, reviewed_at = now()
     WHERE id = g.id;

    IF g.kind = 'new_song' THEN
      IF s.status = 'suggested' THEN
        UPDATE public.songs SET status = 'learning' WHERE id = s.id;
      END IF;
    ELSIF v_apply <> '{}'::jsonb THEN
      UPDATE public.songs SET
        lyrics = CASE WHEN v_apply ? 'lyrics' THEN v_apply ->> 'lyrics' ELSE lyrics END,
        chord_chart = CASE WHEN v_apply ? 'chord_chart' THEN
                        CASE WHEN jsonb_typeof(v_apply -> 'chord_chart') = 'null' THEN NULL ELSE v_apply -> 'chord_chart' END
                      ELSE chord_chart END,
        notes = CASE WHEN v_apply ? 'notes' THEN v_apply ->> 'notes' ELSE notes END
      WHERE id = s.id;
      v_fields := array_remove(ARRAY[
        CASE WHEN v_apply ? 'lyrics' THEN 'lyrics' END,
        CASE WHEN v_apply ? 'chord_chart' THEN 'chords' END,
        CASE WHEN v_apply ? 'notes' THEN 'notes' END], NULL);
    END IF;
  END IF;

  PERFORM public.bw_notify_song_suggestion_outcome(g.id);
  -- The band hears about the changed song (107), like any admin edit.
  IF cardinality(v_fields) > 0 THEN
    PERFORM public.bw_notify_song_updated(s.id, v_fields);
  END IF;

  RETURN jsonb_build_object('status', v_status, 'song_id', g.song_id, 'files', v_files);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_review_song_suggestion(uuid, text, text, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_review_song_suggestion(uuid, text, text, jsonb, boolean) TO authenticated;

-- The author takes a pending suggestion back (a suggested song is deleted).
CREATE OR REPLACE FUNCTION public.bw_withdraw_song_suggestion(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  g record;
  s record;
  v_files jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO g FROM public.song_suggestions WHERE id = p_id FOR UPDATE;
  IF v_uid IS NULL OR g.id IS NULL OR g.created_by <> v_uid THEN
    RAISE EXCEPTION 'Not your suggestion' USING ERRCODE = '42501';
  END IF;
  IF g.status <> 'pending' THEN
    RAISE EXCEPTION 'This suggestion was already reviewed' USING ERRCODE = '55000';
  END IF;
  UPDATE public.song_suggestions SET status = 'withdrawn', reviewed_at = now() WHERE id = g.id;
  IF g.kind = 'new_song' THEN
    SELECT id, status, audio_url, chart_url, score_path INTO s FROM public.songs WHERE id = g.song_id;
    IF s.id IS NOT NULL AND s.status = 'suggested' THEN
      v_files := to_jsonb(array_remove(ARRAY[s.audio_url, s.chart_url, s.score_path], NULL));
      DELETE FROM public.songs WHERE id = s.id;
    END IF;
  END IF;
  -- The admins' unread notification about it goes away.
  DELETE FROM public.notifications
   WHERE type = 'song_suggestion' AND reference_id = g.id AND NOT coalesce(read, false);
  RETURN jsonb_build_object('status', 'withdrawn', 'files', v_files);
END;
$$;
REVOKE ALL ON FUNCTION public.bw_withdraw_song_suggestion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_withdraw_song_suggestion(uuid) TO authenticated;

COMMIT;
