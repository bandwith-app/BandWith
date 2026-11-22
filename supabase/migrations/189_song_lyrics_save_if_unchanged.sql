-- ============================================================================
-- 189 · Chords saved only over the lyrics they were placed on (audit 383f15b, 09 #6)
-- ----------------------------------------------------------------------------
-- The chord editor (ChordEditor.tsx) wrote its whole lyrics snapshot back with
-- only the song id as condition: admin A opens Edit chords, admin B adds a
-- verse and saves, A changes one chord and saves, B's verse is gone.
--
-- bw_save_song_lyrics(song, lyrics, expected) writes `lyrics` only while the
-- stored lyrics are still exactly `expected` (what the editor loaded):
--   { "saved": true,  "lyrics": <new> }
--   { "saved": false, "lyrics": <what is stored now> }   someone changed them;
--     nothing is written and the app keeps the editor's draft.
--
-- SECURITY INVOKER: the songs policies decide who may write, exactly as for
-- the direct update the app did before (108: band admins). The row is locked
-- while compared, so two saves can't both pass the check.
--
-- Additive only: older TestFlight / APK builds keep updating songs.lyrics
-- directly, unchanged. Safe to run more than once.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.bw_save_song_lyrics(
  p_song_id uuid,
  p_lyrics text,
  p_expected text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_current text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
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

  UPDATE public.songs SET lyrics = p_lyrics WHERE id = p_song_id;
  RETURN jsonb_build_object('saved', true, 'lyrics', p_lyrics);
END;
$$;

REVOKE ALL ON FUNCTION public.bw_save_song_lyrics(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bw_save_song_lyrics(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.bw_save_song_lyrics(uuid, text, text) IS
  'Write songs.lyrics only if they still equal p_expected (189, audit 09 #6). RLS decides who.';

COMMIT;
