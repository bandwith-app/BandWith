-- ============================================================================
-- 189 · Chords saved only over the lyrics they were placed on (audit 383f15b, 09 #6)
-- ----------------------------------------------------------------------------
-- The chord editor (ChordEditor.tsx) wrote its whole lyrics snapshot back with
-- only the song id as condition: admin A opens Edit chords, admin B adds a
-- verse and saves, A changes one chord and saves, B's verse is gone.
--
-- bw_save_song_lyrics(song, lyrics, expected, fields) writes `lyrics` only
-- while the stored lyrics are still exactly `expected` (what the editor
-- loaded):
--   { "saved": true,  "lyrics": <new> }
--   { "saved": false, "lyrics": <what is stored now> }   someone changed them;
--     nothing is written and the app keeps the editor's draft.
--
-- `fields` (optional): other columns of the song form saved in the same
-- transaction, e.g. Transpose: the lyrics, the key and the chord chart go
-- together or not at all (never transposed chords with the old key). Only
-- the form's own columns: title, artist, genre, audio_url, chart_url,
-- youtube_url, notes, bpm, key, duration_seconds, chord_chart; any other key
-- is refused (22023). A value that doesn't fit its column fails the whole call.
--
-- SECURITY INVOKER: the songs policies decide who may write, exactly as for
-- the direct update the app did before (108: band admins). The row is locked
-- while compared, so two saves can't both pass the check.
--
-- Additive only: older TestFlight / APK builds keep updating songs directly,
-- unchanged. One function only (an earlier three-parameter draft is dropped:
-- next to this one PostgREST calls would be ambiguous); calls with three
-- arguments keep working through the default. Safe to run more than once.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.bw_save_song_lyrics(uuid, text, text);

CREATE OR REPLACE FUNCTION public.bw_save_song_lyrics(
  p_song_id uuid,
  p_lyrics text,
  p_expected text,
  p_fields jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current text;
  v_allowed text[] := ARRAY['title', 'artist', 'genre', 'audio_url', 'chart_url', 'youtube_url',
                            'notes', 'bpm', 'key', 'duration_seconds', 'chord_chart'];
  v_fields jsonb := CASE WHEN p_fields IS NULL OR jsonb_typeof(p_fields) = 'null' THEN '{}'::jsonb ELSE p_fields END;
  v_bad text[];
  v_set text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_fields) <> 'object' THEN
    RAISE EXCEPTION 'The song fields must be an object' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(k) INTO v_bad FROM jsonb_object_keys(v_fields) AS k WHERE k <> ALL (v_allowed);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'These song fields can''t be saved here: %', array_to_string(v_bad, ', ') USING ERRCODE = '22023';
  END IF;

  -- Locks the row; returns nothing when the songs policies don't let this
  -- user change it.
  SELECT s.lyrics INTO v_current FROM public.songs s WHERE s.id = p_song_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only band admins can change this song' USING ERRCODE = '42501';
  END IF;

  IF v_current IS DISTINCT FROM p_expected THEN
    RETURN jsonb_build_object('saved', false, 'lyrics', v_current);
  END IF;

  SELECT string_agg(format('%I = r.%I', k, k), ', ') INTO v_set
    FROM jsonb_object_keys(v_fields) AS k;
  IF v_set IS NULL THEN
    UPDATE public.songs SET lyrics = p_lyrics WHERE id = p_song_id;
  ELSE
    EXECUTE format(
      'UPDATE public.songs SET lyrics = $1, %s FROM jsonb_populate_record(NULL::public.songs, $2) AS r WHERE public.songs.id = $3',
      v_set)
      USING p_lyrics, v_fields, p_song_id;
  END IF;
  RETURN jsonb_build_object('saved', true, 'lyrics', p_lyrics);
END;
$$;

REVOKE ALL ON FUNCTION public.bw_save_song_lyrics(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_save_song_lyrics(uuid, text, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.bw_save_song_lyrics(uuid, text, text, jsonb) IS
  'Write songs.lyrics (and the song form''s p_fields with them) only if the lyrics still equal p_expected (189, audit 09 #6). RLS decides who.';

COMMIT;
